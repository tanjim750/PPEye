import {
  addNotification,
  clearAllNotifications,
  getNotifications,
  getUnreadCount,
  markAllAsRead,
  markAsRead,
} from '../notification.service';

export async function runNotificationTests() {
  console.log('\n--- PPEye Real-Time Notification Test Suite ---');
  let passed = 0;
  let failed = 0;

  async function test(name: string, fn: () => Promise<void> | void) {
    try {
      await fn();
      console.log(`  ✔ [PASS] ${name}`);
      passed++;
    } catch (err: any) {
      console.error(`  ✖ [FAIL] ${name}: ${err?.message || err}`);
      failed++;
    }
  }

  await test('clearAllNotifications clears all notifications for role', async () => {
    await clearAllNotifications();
    const all = getNotifications();
    if (all.length !== 0) throw new Error(`Expected 0 notifications, got ${all.length}`);
  });

  await test('addNotification adds unread notification with red badge state', async () => {
    const notif = await addNotification({
      recipientRole: 'reviewer',
      type: 'NEW_SUBMISSION',
      title: 'Site-01 Submitted',
      titleBn: 'সাইট-০১ জমা দেওয়া হয়েছে',
      body: 'ABC Telecom submitted 1 worker photo for review.',
      bodyBn: 'এবিসি টেলিকম ১ জন কর্মীর ছবি জমা দিয়েছে।',
      submissionId: 101,
      showBanner: false,
    });

    if (!notif || !notif.id) throw new Error('Expected notif id to be generated');
    if (notif.read !== false) throw new Error('Expected notif to be unread');

    const unreadReviewer = getUnreadCount('reviewer');
    if (unreadReviewer !== 1) throw new Error(`Expected 1 unread reviewer notif, got ${unreadReviewer}`);
  });

  await test('role isolation: vendor does not count reviewer unread notifications', async () => {
    const unreadVendor = getUnreadCount('vendor');
    if (unreadVendor !== 0) throw new Error(`Expected 0 unread vendor notif, got ${unreadVendor}`);
  });

  await test('addNotification adds vendor notification for safe review verdict', async () => {
    await addNotification({
      recipientRole: 'vendor',
      type: 'REVIEW_SAFE',
      title: 'PPE Safe Approved',
      titleBn: 'নিরাপদ অনুমোদিত',
      body: 'Site-01 passed safety inspection.',
      bodyBn: 'সাইট-০১ সুরক্ষা নিরীক্ষায় উত্তীর্ণ হয়েছে।',
      submissionId: 101,
      showBanner: false,
    });

    const unreadVendor = getUnreadCount('vendor');
    if (unreadVendor !== 1) throw new Error(`Expected 1 unread vendor notif, got ${unreadVendor}`);
  });

  await test('markAsRead marks specific notification as read and decrements unread count', async () => {
    const vendorNotifs = getNotifications('vendor');
    if (vendorNotifs.length === 0) throw new Error('No vendor notifications found');
    const targetId = vendorNotifs[0].id;

    await markAsRead(targetId);
    const updatedUnread = getUnreadCount('vendor');
    if (updatedUnread !== 0) throw new Error(`Expected 0 unread vendor notif, got ${updatedUnread}`);
  });

  await test('markAllAsRead marks all notifications as read', async () => {
    // Add two new notifications for reviewer
    await addNotification({
      recipientRole: 'reviewer',
      type: 'RESUBMISSION',
      title: 'Site-02 Resubmitted',
      titleBn: 'সাইট-০২ পুনরায় জমা দেওয়া হয়েছে',
      body: 'Fixed photos uploaded.',
      bodyBn: 'সংশোধিত ছবি জমা দেওয়া হয়েছে।',
      submissionId: 102,
      showBanner: false,
    });

    const unreadBefore = getUnreadCount('reviewer');
    if (unreadBefore === 0) throw new Error('Expected unread notifications');

    await markAllAsRead('reviewer');
    const unreadAfter = getUnreadCount('reviewer');
    if (unreadAfter !== 0) throw new Error(`Expected 0 unread, got ${unreadAfter}`);
  });

  await test('preference toggle filters out muted notifications', async () => {
    const { setNotificationPreferences, getNotificationPreferences } = require('../notification.service');
    // Disable new submissions
    await setNotificationPreferences({ newSubmissions: false });
    const notifs = getNotifications('reviewer');
    const hasNewSubmission = notifs.some(
      (n: any) => n.type === 'NEW_SUBMISSION' || n.type === 'RESUBMISSION'
    );
    if (hasNewSubmission) {
      throw new Error('Expected new submission notifications to be filtered out when toggle is off');
    }
    // Re-enable
    await setNotificationPreferences({ newSubmissions: true });
    const notifsReenabled = getNotifications('reviewer');
    const hasNewSubmissionReenabled = notifsReenabled.some(
      (n: any) => n.type === 'NEW_SUBMISSION' || n.type === 'RESUBMISSION'
    );
    if (!hasNewSubmissionReenabled) {
      throw new Error('Expected new submission notifications to be visible when toggle is on');
    }
  });

  await test('removeReviewedSubmissionNotification removes reviewed submission from reviewer notifications and decrements unread count', async () => {
    const { removeReviewedSubmissionNotification } = require('../notification.service');
    await clearAllNotifications();
    await addNotification({
      recipientRole: 'reviewer',
      type: 'NEW_SUBMISSION',
      title: 'Site-02 Review Required',
      titleBn: 'সাইট-০২ নিরীক্ষা প্রয়োজন',
      body: 'Review worker safety.',
      bodyBn: 'কর্মী সুরক্ষা নিরীক্ষা করুন।',
      submissionId: 202,
      showBanner: false,
    });

    const countBefore = getUnreadCount('reviewer');
    if (countBefore !== 1) throw new Error(`Expected 1 unread reviewer notification, got ${countBefore}`);

    // Simulate review completion from Recent
    removeReviewedSubmissionNotification(202);

    const countAfter = getUnreadCount('reviewer');
    if (countAfter !== 0) throw new Error(`Expected 0 unread reviewer notifications after review, got ${countAfter}`);
    const remaining = getNotifications('reviewer').filter((n) => String(n.submissionId) === '202');
    if (remaining.length !== 0) throw new Error(`Expected submission 202 to be removed from panel, got ${remaining.length}`);
  });

  await test('syncPendingReviewsToNotifications automatically prunes submissions that are no longer waiting', async () => {
    const { syncPendingReviewsToNotifications } = require('../notification.service');
    await clearAllNotifications();
    await addNotification({
      recipientRole: 'reviewer',
      type: 'NEW_SUBMISSION',
      title: 'Site-03 Pending',
      titleBn: 'সাইট-০৩ পেন্ডিং',
      body: 'Pending review.',
      bodyBn: 'পেন্ডিং নিরীক্ষা।',
      submissionId: 303,
      showBanner: false,
    });

    // Sync waiting reviews without 303 (meaning 303 was reviewed from Recent)
    syncPendingReviewsToNotifications([
      { id: 404, vendor: 'Other Vendor', location: 'Site-04', workers: 1, timestamp: Date.now() },
    ]);

    const reviewerNotifs = getNotifications('reviewer');
    const has303 = reviewerNotifs.some((n) => String(n.submissionId) === '303');
    if (has303) throw new Error('Expected reviewed submission 303 to be purged by syncPendingReviewsToNotifications');
    const has404 = reviewerNotifs.some((n) => String(n.submissionId) === '404');
    if (!has404) throw new Error('Expected new waiting submission 404 to be present');
  });

  await test('vendor filtering: vendor notifications match by vendorProfileId with numeric resilience', async () => {
    await clearAllNotifications();
    await addNotification({
      recipientRole: 'vendor',
      type: 'REVIEW_SAFE',
      title: 'PPE Safe Approved',
      titleBn: 'নিরাপদ অনুমোদিত',
      body: 'Site-01 passed safety inspection.',
      bodyBn: 'সাইট-০১ নিরীক্ষায় উত্তীর্ণ হয়েছে।',
      submissionId: 501,
      vendorName: 'ABC Telecom Ltd',
      vendorProfileId: 1,
      showBanner: false,
    });

    // Vendor with matching profile ID should see the notification
    const vendor1Notifs = getNotifications('vendor', { vendorProfileId: 1, vendorName: 'ABC Telecom Ltd' });
    if (vendor1Notifs.length !== 1) throw new Error(`Expected 1 notification for vendor 1, got ${vendor1Notifs.length}`);

    // Different vendor profile should NOT see it
    const vendor2Notifs = getNotifications('vendor', { vendorProfileId: 2, vendorName: 'Other Vendor' });
    if (vendor2Notifs.length !== 0) throw new Error(`Expected 0 notifications for vendor 2, got ${vendor2Notifs.length}`);

    // General notifications without vendor restrictions should be visible to any vendor
    await addNotification({
      recipientRole: 'vendor',
      type: 'SYSTEM',
      title: 'System Notice',
      titleBn: 'সিস্টেম বিজ্ঞপ্তি',
      body: 'Maintenance notice.',
      bodyBn: 'রক্ষণাবেক্ষণ বার্তা।',
      showBanner: false,
    });
    const vendor1After = getNotifications('vendor', { vendorProfileId: 1 });
    if (vendor1After.length !== 2) throw new Error(`Expected 2 notifications for vendor 1, got ${vendor1After.length}`);
  });

  console.log(`\n========================================`);
  console.log(`Result: ${passed}/${passed + failed} passed (${failed} failed)`);
  console.log(`========================================\n`);

  return { passed, failed };
}

if (require.main === module) {
  void runNotificationTests();
}
