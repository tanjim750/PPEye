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

  await test('notifications are sorted in descending order (newest first)', async () => {
    await clearAllNotifications();
    const t0 = 1700000000000;
    await addNotification({
      recipientRole: 'reviewer',
      type: 'NEW_SUBMISSION',
      title: 'Old Submission',
      titleBn: 'পুরাতন সাবমিশন',
      body: 'Old notification 4 days ago',
      bodyBn: '৪ দিন আগের নোটিফিকেশন',
      createdAt: t0 - 400000,
      showBanner: false,
    });
    await addNotification({
      recipientRole: 'reviewer',
      type: 'NEW_SUBMISSION',
      title: 'Newest Submission',
      titleBn: 'নতুন সাবমিশন',
      body: 'Recent notification 23m ago',
      bodyBn: '২৩ মিনিট আগের নোটিফিকেশন',
      createdAt: t0,
      showBanner: false,
    });
    await addNotification({
      recipientRole: 'reviewer',
      type: 'NEW_SUBMISSION',
      title: 'Middle Submission',
      titleBn: 'মধ্যবর্তী সাবমিশন',
      body: 'Middle notification 1 day ago',
      bodyBn: '১ দিন আগের নোটিফিকেশন',
      createdAt: t0 - 100000,
      showBanner: false,
    });

    const notifs = getNotifications('reviewer');
    if (notifs.length !== 3) throw new Error(`Expected 3 notifications, got ${notifs.length}`);
    if (notifs[0].title !== 'Newest Submission') {
      throw new Error(`Expected first item to be 'Newest Submission', got '${notifs[0].title}'`);
    }
    if (notifs[1].title !== 'Middle Submission') {
      throw new Error(`Expected second item to be 'Middle Submission', got '${notifs[1].title}'`);
    }
    if (notifs[2].title !== 'Old Submission') {
      throw new Error(`Expected third item to be 'Old Submission', got '${notifs[2].title}'`);
    }
  });

  await test('broadcastReviewVerdictAlert aggregates all safe workers into single notification', async () => {
    const { broadcastReviewVerdictAlert } = require('../notification.service');
    await clearAllNotifications();

    await broadcastReviewVerdictAlert({
      submissionId: 501,
      siteName: 'Gazipur-ER-101',
      vendorName: 'ABC Telecom Ltd',
      verdict: 'safe',
      hasUnsafe: false,
      totalWorkers: 3,
      safeCount: 3,
      unsafeCount: 0,
    });

    const vendorNotifs = getNotifications('vendor');
    if (vendorNotifs.length !== 1) throw new Error(`Expected exactly 1 notification, got ${vendorNotifs.length}`);
    const notif = vendorNotifs[0];
    if (notif.title !== 'PPE Verified: All Safe') {
      throw new Error(`Expected title 'PPE Verified: All Safe', got '${notif.title}'`);
    }
    if (notif.body !== 'All 3 workers approved for site Gazipur-ER-101.') {
      throw new Error(`Expected body 'All 3 workers approved for site Gazipur-ER-101.', got '${notif.body}'`);
    }
    if (notif.allSafe !== true) throw new Error('Expected allSafe to be true');
    if (notif.type !== 'REVIEW_SAFE') throw new Error(`Expected type 'REVIEW_SAFE', got '${notif.type}'`);
  });

  await test('broadcastReviewVerdictAlert aggregates unsafe workers into single action-required notification', async () => {
    const { broadcastReviewVerdictAlert } = require('../notification.service');
    await clearAllNotifications();

    await broadcastReviewVerdictAlert({
      submissionId: 502,
      siteName: 'Dhaka-DH-204',
      vendorName: 'ABC Telecom Ltd',
      verdict: 'unsafe',
      hasUnsafe: true,
      totalWorkers: 3,
      safeCount: 1,
      unsafeCount: 2,
      unsafeReasons: ['helmet', 'lanyard'],
    });

    const vendorNotifs = getNotifications('vendor');
    if (vendorNotifs.length !== 1) throw new Error(`Expected exactly 1 notification, got ${vendorNotifs.length}`);
    const notif = vendorNotifs[0];
    if (notif.title !== 'Action Required: Unsafe Workers Flagged') {
      throw new Error(`Expected title 'Action Required: Unsafe Workers Flagged', got '${notif.title}'`);
    }
    if (notif.body !== '2 of 3 workers flagged for safety issues at Dhaka-DH-204. Tap to fix & resubmit.') {
      throw new Error(`Expected body '2 of 3 workers flagged for safety issues at Dhaka-DH-204. Tap to fix & resubmit.', got '${notif.body}'`);
    }
    if (notif.allSafe !== false) throw new Error('Expected allSafe to be false');
    if (notif.unsafeCount !== 2) throw new Error(`Expected unsafeCount 2, got ${notif.unsafeCount}`);
    if (notif.totalWorkers !== 3) throw new Error(`Expected totalWorkers 3, got ${notif.totalWorkers}`);
    if (notif.type !== 'REVIEW_UNSAFE') throw new Error(`Expected type 'REVIEW_UNSAFE', got '${notif.type}'`);
  });

  await test('self-action isolation: vendor does not receive own submission alert and reviewer does not receive own verdict', async () => {
    const { authStore } = require('../../../stores/auth.store');
    const { broadcastNewSubmissionAlert, broadcastReviewVerdictAlert } = require('../notification.service');
    await clearAllNotifications();

    // 1. Simulate logged-in Vendor submitting an inspection
    authStore.user = {
      id: 99,
      email: 'vendor@example.com',
      role: 'vendor',
      category: 'EXTERNAL',
      vendorProfileId: 10,
      vendorName: 'Vendor Co',
    };

    await broadcastNewSubmissionAlert({
      submissionId: 901,
      siteName: 'Self-Site-Vendor',
      workerCount: 2,
      vendorName: 'Vendor Co',
    });

    const vendorNotifs = getNotifications('vendor');
    if (vendorNotifs.length !== 0) {
      throw new Error(`Expected vendor to receive 0 self-submission alerts, got ${vendorNotifs.length}`);
    }

    // 2. Simulate logged-in Reviewer completing an inspection review
    authStore.user = {
      id: 1,
      email: 'reviewer@example.com',
      role: 'reviewer',
      category: 'INTERNAL',
    };

    await broadcastReviewVerdictAlert({
      submissionId: 901,
      siteName: 'Self-Site-Vendor',
      vendorName: 'Vendor Co',
      verdict: 'safe',
      totalWorkers: 2,
    });

    const reviewerNotifs = getNotifications('reviewer');
    if (reviewerNotifs.length !== 0) {
      throw new Error(`Expected reviewer to receive 0 self-verdict alerts, got ${reviewerNotifs.length}`);
    }

    // Clean up mock auth session
    authStore.user = null;
  });

  await test('per-user external vendor isolation: Vendor A and Vendor B in same company never see each other notifications or cached history across account switches', async () => {
    const { authStore } = require('../../../stores/auth.store');
    const { syncWorkerChecksToNotifications } = require('../notification.service');

    try {
      // 1. Log in as External User A (Ahnaf, id=10, vendorProfileId=1)
      authStore.user = {
        id: 10,
        email: 'ahnaf@vendor.com',
        name: 'Ahnaf',
        role: 'vendor',
        category: 'EXTERNAL',
        vendorProfileId: 1,
        vendorName: 'ABC Telecom Ltd',
      };
      await clearAllNotifications();

      // Verdict belonging to User A (submittedBy: 10) -> accepted
      await addNotification({
        recipientRole: 'vendor',
        submittedBy: 10,
        vendorProfileId: 1,
        vendorName: 'ABC Telecom Ltd',
        type: 'REVIEW_SAFE',
        title: 'Ahnaf Safe Check',
        titleBn: 'আহনাফ নিরাপদ',
        body: 'Approved for Ahnaf.',
        bodyBn: 'অনুমোদিত।',
        submissionId: 701,
        showBanner: false,
      });

      // Verdict belonging to User B (submittedBy: 11, SAME vendorProfileId=1 & vendorName!) -> MUST BE DROPPED
      const droppedOtherVendor = await addNotification({
        recipientRole: 'vendor',
        submittedBy: 11,
        vendorProfileId: 1,
        vendorName: 'ABC Telecom Ltd',
        type: 'REVIEW_UNSAFE',
        title: 'Abir Unsafe Check',
        titleBn: 'আবির অনিরাপদ',
        body: 'Flagged for Abir.',
        bodyBn: 'ত্রুটি।',
        submissionId: 702,
        showBanner: false,
      });
      if (droppedOtherVendor !== null) {
        throw new Error('Expected notification for another external user (id=11) to be dropped while id=10 is active');
      }

      const ahnafNotifs = getNotifications('vendor', { userId: 10, vendorProfileId: 1, vendorName: 'ABC Telecom Ltd' });
      if (ahnafNotifs.length !== 1 || ahnafNotifs[0].submissionId !== 701) {
        throw new Error(`Expected Ahnaf to see only submission 701, got ${ahnafNotifs.length}`);
      }

      // 2. Switch account directly to External User B (Abir, id=11, same vendorProfileId=1)
      authStore.user = {
        id: 11,
        email: 'abir@vendor.com',
        name: 'Abir',
        role: 'vendor',
        category: 'EXTERNAL',
        vendorProfileId: 1,
        vendorName: 'ABC Telecom Ltd',
      };

      const abirInitial = getNotifications('vendor', { userId: 11, vendorProfileId: 1, vendorName: 'ABC Telecom Ltd' });
      if (abirInitial.length !== 0) {
        throw new Error(`Expected 0 leaked notifications after switching to Abir, got ${abirInitial.length}`);
      }

      // Sync checks containing both id=10 and id=11 -> only id=11 must be synced for Abir
      syncWorkerChecksToNotifications([
        { id: 'sub_701_safe', submissionId: 701, submittedBy: 10, vendorProfileId: 1, siteName: 'Ahnaf-Site', status: 'safe' },
        { id: 'sub_702_unsafe', submissionId: 702, submittedBy: 11, vendorProfileId: 1, siteName: 'Abir-Site', status: 'unsafe' },
      ]);

      const abirAfterSync = getNotifications('vendor', { userId: 11, vendorProfileId: 1, vendorName: 'ABC Telecom Ltd' });
      if (abirAfterSync.length !== 1 || abirAfterSync[0].submissionId !== 702) {
        throw new Error(`Expected Abir to see only his own submission 702, got ${abirAfterSync.length}`);
      }
    } finally {
      authStore.user = null;
      await clearAllNotifications();
    }
  });

  await test('end-to-end Vendor -> Reviewer broadcast: Reviewer receives new_submission, unread count increments, banner activates, and stale sync does NOT wipe it', async () => {
    const { authStore } = require('../../../stores/auth.store');
    const {
      handleIncomingNewSubmissionBroadcast,
      syncPendingReviewsToNotifications,
      getActiveNotificationBanner,
    } = require('../notification.service');

    try {
      // 1. On Vendor device: incoming or self new_submission broadcast must be dropped
      authStore.user = {
        id: 10,
        email: 'ahnaf@vendor.com',
        role: 'vendor',
        category: 'EXTERNAL',
        vendorProfileId: 1,
        vendorName: 'ABC Telecom Ltd',
      };
      await clearAllNotifications();

      const droppedForVendor = await handleIncomingNewSubmissionBroadcast({
        submissionId: 801,
        siteName: 'Uttara-Tower-09',
        workerCount: 2,
        vendorName: 'ABC Telecom Ltd',
        submitted_by: 10,
        vendorProfileId: 1,
      });
      if (droppedForVendor !== null || getUnreadCount('vendor') !== 0) {
        throw new Error('Expected Vendor to drop new_submission broadcast');
      }

      // 2. On Reviewer device: incoming new_submission broadcast is accepted, bell increments, banner shows
      authStore.user = {
        id: '1',
        email: 'inspector@ehs.com',
        role: 'admin',
        category: 'INTERNAL',
      };
      await clearAllNotifications();

      const acceptedForReviewer = await handleIncomingNewSubmissionBroadcast({
        submissionId: 801,
        siteName: 'Uttara-Tower-09',
        workerCount: 2,
        vendorName: 'ABC Telecom Ltd',
        submitted_by: 10,
        vendorProfileId: 1,
      });
      if (!acceptedForReviewer) {
        throw new Error('Expected Reviewer to receive new_submission broadcast notification');
      }
      if (getUnreadCount('reviewer') !== 1) {
        throw new Error(`Expected Reviewer unread bell count = 1, got ${getUnreadCount('reviewer')}`);
      }
      const banner = getActiveNotificationBanner();
      if (!banner || String(banner.submissionId) !== '801') {
        throw new Error('Expected Reviewer in-app banner to activate for submission 801');
      }

      // 3. Simulate pre-fetch stale waitingItems sync BEFORE DB query returns 801 -> must NOT wipe 801!
      syncPendingReviewsToNotifications([
        { id: 799, vendor: 'Other Co', location: 'Old-Site', workers: 1, timestamp: Date.now() - 60000 },
      ]);
      const afterStaleSync = getNotifications('reviewer');
      const stillHas801 = afterStaleSync.some((n) => String(n.submissionId) === '801');
      if (!stillHas801) {
        throw new Error('Expected live broadcast submission 801 to survive stale pre-fetch sync');
      }
    } finally {
      authStore.user = null;
      await clearAllNotifications();
    }
  });

  await test('end-to-end Reviewer -> Vendor broadcast: matching Vendor receives Safe/Unsafe verdict with string/number ID normalization while Reviewer and other Vendors do not', async () => {
    const { authStore } = require('../../../stores/auth.store');
    const {
      handleIncomingNewSubmissionBroadcast,
      handleIncomingReviewVerdictBroadcast,
      getActiveNotificationBanner,
    } = require('../notification.service');

    try {
      // 1. Reviewer has pending submission 802; receiving review_verdict clears pending 802 and does NOT add self-verdict
      authStore.user = {
        id: 1,
        email: 'reviewer@ehs.com',
        role: 'reviewer',
        category: 'INTERNAL',
      };
      await clearAllNotifications();
      await handleIncomingNewSubmissionBroadcast({
        submissionId: 802,
        siteName: 'Banani-Site-12',
        workerCount: 2,
        vendorName: 'ABC Telecom Ltd',
        submitted_by: 10,
      });
      if (getUnreadCount('reviewer') !== 1) {
        throw new Error('Expected Reviewer to have 1 unread before verdict');
      }

      const droppedForReviewer = await handleIncomingReviewVerdictBroadcast({
        submissionId: 802,
        siteName: 'Banani-Site-12',
        vendorName: 'ABC Telecom Ltd',
        vendorProfileId: 1,
        submitted_by: '10',
        verdict: 'unsafe',
        hasUnsafe: true,
        totalWorkers: 2,
        unsafeCount: 1,
        safeCount: 1,
      });
      if (droppedForReviewer !== null) {
        throw new Error('Expected Reviewer not to self-notify on review_verdict');
      }
      if (getUnreadCount('reviewer') !== 0) {
        throw new Error('Expected Reviewer pending notification for 802 to be cleared upon verdict');
      }

      // 2. Vendor B (id: 11, same company vendorProfileId: 1) must NOT receive Vendor A's (submitted_by: '10') verdict
      authStore.user = {
        id: 11,
        email: 'abir@vendor.com',
        role: 'vendor',
        category: 'EXTERNAL',
        vendorProfileId: 1,
        vendorName: 'ABC Telecom Ltd',
      };
      await clearAllNotifications();

      const droppedForVendorB = await handleIncomingReviewVerdictBroadcast({
        submissionId: 802,
        siteName: 'Banani-Site-12',
        vendorName: 'ABC Telecom Ltd',
        vendorProfileId: 1,
        submitted_by: '10',
        verdict: 'unsafe',
        hasUnsafe: true,
        totalWorkers: 2,
        unsafeCount: 1,
        safeCount: 1,
      });
      if (droppedForVendorB !== null || getUnreadCount('vendor', { userId: 11 }) !== 0) {
        throw new Error('Expected Vendor B (id=11) to drop verdict intended for Vendor A (submitted_by=10)');
      }

      // 3. Vendor A (id: 10 numeric, payload submitted_by: '10' string) MUST receive Unsafe verdict + banner + unread count = 1
      authStore.user = {
        id: 10,
        email: 'ahnaf@vendor.com',
        role: 'vendor',
        category: 'EXTERNAL',
        vendorProfileId: 1,
        vendorName: 'ABC Telecom Ltd',
      };
      await clearAllNotifications();

      const deliveredUnsafe = await handleIncomingReviewVerdictBroadcast({
        submissionId: 802,
        siteName: 'Banani-Site-12',
        vendorName: 'ABC Telecom Ltd',
        vendorProfileId: 1,
        submitted_by: '10',
        verdict: 'unsafe',
        hasUnsafe: true,
        totalWorkers: 2,
        unsafeCount: 1,
        safeCount: 1,
      });
      if (!deliveredUnsafe || deliveredUnsafe.type !== 'REVIEW_UNSAFE') {
        throw new Error('Expected Vendor A (id=10) to receive REVIEW_UNSAFE notification even when submitted_by is string "10"');
      }
      if (getUnreadCount('vendor', { userId: 10 }) !== 1) {
        throw new Error(`Expected Vendor A unread count = 1, got ${getUnreadCount('vendor', { userId: 10 })}`);
      }
      const vendorBanner = getActiveNotificationBanner();
      if (!vendorBanner || vendorBanner.type !== 'REVIEW_UNSAFE') {
        throw new Error('Expected Vendor A in-app banner to show REVIEW_UNSAFE');
      }

      // 4. String demo user ID ('demo_vendor_1') also receives matching Safe verdict
      authStore.user = {
        id: 'demo_vendor_1' as any,
        email: 'demo@vendor.com',
        role: 'EXTERNAL' as any,
        category: 'EXTERNAL',
        vendorProfileId: 2,
      };
      await clearAllNotifications();

      const deliveredSafeDemo = await handleIncomingReviewVerdictBroadcast({
        submissionId: 'rev-demo-99',
        siteName: 'Mirpur-Site-01',
        submitted_by: 'demo_vendor_1',
        verdict: 'safe',
        hasUnsafe: false,
        totalWorkers: 3,
        unsafeCount: 0,
        safeCount: 3,
      });
      if (!deliveredSafeDemo || deliveredSafeDemo.type !== 'REVIEW_SAFE') {
        throw new Error('Expected string-ID vendor user to receive REVIEW_SAFE notification');
      }
      if (getUnreadCount('vendor', { userId: 'demo_vendor_1' }) !== 1) {
        throw new Error('Expected unread count = 1 for string-ID vendor user');
      }

      // 5. Self-echo guard on new_submission drops broadcast if sender matches active user
      authStore.user = {
        id: 1,
        email: 'reviewer@company.com',
        role: 'reviewer',
        category: 'INTERNAL',
      };
      await clearAllNotifications();
      const droppedSelfEcho = await handleIncomingNewSubmissionBroadcast({
        submissionId: 803,
        siteName: 'Self-Echo-Site',
        submitted_by: '1',
      });
      if (droppedSelfEcho !== null) {
        throw new Error('Expected self-echo new_submission broadcast to be dropped');
      }
    } finally {
      authStore.user = null;
      await clearAllNotifications();
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
