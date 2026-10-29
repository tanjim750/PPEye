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

  console.log(`\n========================================`);
  console.log(`Result: ${passed}/${passed + failed} passed (${failed} failed)`);
  console.log(`========================================\n`);

  return { passed, failed };
}

if (require.main === module) {
  void runNotificationTests();
}
