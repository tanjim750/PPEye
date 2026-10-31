import { useCallback, useEffect, useState } from 'react';
import { Image, ImageSource } from 'expo-image';
import { useFocusEffect, useSegments } from 'expo-router';
import { Pressable, RefreshControl, ScrollView, StyleSheet, Text, View } from 'react-native';
import { SafeAreaView, useSafeAreaInsets } from 'react-native-safe-area-context';
import { useTranslation } from 'react-i18next';

import { Icon } from '@/components/ui/Icon';
import { assets } from '@/constants/assets';
import { useAuth } from '@/hooks/useAuth';
import { useNavigate } from '@/hooks/useNavigate';
import { authStore } from '@/stores/auth.store';
import { getProfilePictureUri } from '@/services/storage';
import {
  formatWorkerCheckTime,
  formatWorkerCheckTitle,
  useWorkerChecks,
  WorkerCheck,
} from '@/features/submissions/services/workerChecks.service';
import { formatReviewTime, ReviewItem, useReviews } from '@/features/reviews/services/reviews.service';
import { InProgressLimitModal } from '@/features/reviews/components/InProgressLimitModal';
import {
  clearPendingSubmissionReviewCaptures,
  setPendingResubmissionContext,
  setPendingSubmissionReviewSite,
  setPendingSubmissionReviewTarget,
} from '@/features/submissions/services/pendingSubmissionReview.service';
import { SubmissionDetailsBottomSheet } from '@/features/submissions/components/SubmissionDetailsBottomSheet';
import { NotificationBell } from '@/components/common/NotificationBell';
import { RealtimeNotificationBanner } from '@/components/common/RealtimeNotificationBanner';
import { useExpoPushToken } from '@/services/notifications/useExpoPushToken';
import { useWindowSizeClass } from '@/hooks/useWindowSizeClass';
import { DummyUserRole } from '@/utils/dummy-users';
import { UserRole } from '@/features/auth/types';

export type SharedHomeScreenRole =
  | 'vendor'
  | 'reviewer'
  | 'external'
  | 'internal'
  | UserRole
  | DummyUserRole;

export type SharedHomeScreenProps = {
  role?: SharedHomeScreenRole;
};




function getBdtTimeOfDayKey(): 'morning' | 'afternoon' | 'evening' {
  const now = new Date();
  // BDT is UTC+6
  const utcHours = now.getUTCHours();
  const bdtHours = (utcHours + 6) % 24;

  if (bdtHours >= 5 && bdtHours < 12) {
    return 'morning';
  }
  if (bdtHours >= 12 && bdtHours < 18) {
    return 'afternoon';
  }
  return 'evening';
}

function VendorCheckThumbnail({ check }: { check: WorkerCheck }) {
  const directUri = check.image?.uri || check.workerReviews?.find((w) => w.frontUri || w.backUri)?.frontUri || check.workerReviews?.find((w) => w.backUri)?.backUri || null;
  const [sourceUri, setSourceUri] = useState<string | null>(directUri);

  useEffect(() => {
    const currentDirect = check.image?.uri || check.workerReviews?.find((w) => w.frontUri || w.backUri)?.frontUri || check.workerReviews?.find((w) => w.backUri)?.backUri || null;
    if (currentDirect) {
      setSourceUri(currentDirect);
      return;
    }
    let isCancelled = false;
    async function resolveThumb() {
      const subId = check.submissionId || Number(String(check.id).replace(/\D/g, ''));
      if (subId && !isNaN(subId)) {
        try {
          const { getSubmissionWorkerPhotos, supabaseStorageService } = require('@/services/storage/supabase-storage.client');
          const photosMap: Map<string, string> = await getSubmissionWorkerPhotos(subId);
          let photoPath: string | null = null;
          if (photosMap && photosMap.size > 0) {
            const first = Array.from(photosMap.values())[0];
            photoPath = typeof first === 'string' ? first : null;
          }
          if (photoPath && !isCancelled) {
            const { getCachedImageUriSync } = require('@/utils/image');
            const localCached = getCachedImageUriSync(photoPath);
            if (localCached) {
              setSourceUri(localCached);
              check.image = { uri: localCached };
              return;
            }
            const bucket = photoPath.startsWith('users/') ? 'avatars' : 'evidence';
            const signedRes = await supabaseStorageService.createSignedUrl(bucket, photoPath, 86400 * 7);
            const urlStr = typeof signedRes === 'string' ? signedRes : signedRes?.signedUrl;
            if (urlStr && typeof urlStr === 'string' && urlStr.startsWith('http') && !isCancelled) {
              setSourceUri(urlStr);
              check.image = { uri: urlStr };
            }
          }
        } catch {}
      }
    }
    void resolveThumb();
    return () => {
      isCancelled = true;
    };
  }, [check.image?.uri, check.id, check.submissionId]);

  if (sourceUri) {
    return (
      <Image
        cachePolicy="memory-disk"
        source={{ uri: sourceUri }}
        style={vendorStyles.thumbnail}
      />
    );
  }

  return (
    <View style={vendorStyles.pendingThumbnail}>
      <Icon
        color={vendorColors.outlineVariant}
        name={{ ios: 'clock', android: 'schedule', web: 'schedule' }}
        size={24}
      />
    </View>
  );
}

export function SharedHomeScreen({ role: propRole }: SharedHomeScreenProps = {}) {
  const navigate = useNavigate();
  const insets = useSafeAreaInsets();
  const { contentMaxWidth } = useWindowSizeClass();
  const { user } = useAuth();
  const segments = useSegments();
  const { t, i18n } = useTranslation('home');
  const { recentChecks: vendorRecentChecks } = useWorkerChecks();
  const { pendingReviews, recentPendingReviews, inProgressCount, syncReviewsFromSupabase } = useReviews();
  const [isRefreshingReviewer, setIsRefreshingReviewer] = useState(false);
  const [isInProgressLimitModalVisible, setIsInProgressLimitModalVisible] = useState(false);
  const [, setHomeFocusTick] = useState(0);

  const activeUser = user || authStore.user;

  // Registers Expo push token on device and persists to Supabase for background alerts
  useExpoPushToken(activeUser?.id);

  useEffect(() => {
    // Proactively initialize Android channels and request OS notification permission once foreground UI is mounted
    const { requestNotificationPermission } = require('@/services/notifications/notification.service');
    void requestNotificationPermission();
  }, []);

  useEffect(() => {
    if (!activeUser?.profilePictureUrl && activeUser?.id) {
      const dbUid = typeof activeUser.id === 'number' ? activeUser.id : Number(activeUser.id) || null;
      if (dbUid) {
        getProfilePictureUri(dbUid)
          .then((cachedUri) => {
            if (cachedUri) {
              authStore.setProfilePictureUrl(cachedUri);
            }
          })
          .catch(() => {});
      }
    }
  }, [activeUser]);

  const [selectedVendorCheck, setSelectedVendorCheck] = useState<WorkerCheck | null>(null);
  const [isVendorDetailsModalVisible, setIsVendorDetailsModalVisible] = useState(false);

  const handleVendorFixAndResubmit = useCallback((item: WorkerCheck) => {
    setIsVendorDetailsModalVisible(false);
    setSelectedVendorCheck(null);
    const unsafeWorkers =
      item.workerReviews?.filter((w) => w.status === 'unsafe') || [];

    setPendingResubmissionContext({
      submissionId: item.submissionId,
      unsafeWorkers: unsafeWorkers.map((w) => ({
        workerInstanceId: w.workerInstanceId!,
        sequenceNo: w.sequenceNo,
      })),
      sequenceNo: unsafeWorkers[0]?.sequenceNo || 1,
      workerInstanceId: unsafeWorkers[0]?.workerInstanceId,
    });

    setPendingSubmissionReviewTarget({
      workerNumber: unsafeWorkers[0]?.sequenceNo || 1,
      side: 'FRONT',
    });
    setPendingSubmissionReviewSite(item.siteName || '');
    navigate('/continuous-ppe-capture' as any);
  }, [navigate]);

  const handleReviewItemPress = useCallback((item: ReviewItem) => {
    if (inProgressCount >= 3 && !item.isDraft) {
      setIsInProgressLimitModalVisible(true);
      return;
    }
    navigate(`/review/${item.id}`);
  }, [inProgressCount, navigate]);

  useFocusEffect(
    useCallback(() => {
      setHomeFocusTick((prev) => prev + 1);
      syncReviewsFromSupabase();
    }, [syncReviewsFromSupabase])
  );

  const handleReviewerRefresh = useCallback(async () => {
    setIsRefreshingReviewer(true);
    await syncReviewsFromSupabase();
    setIsRefreshingReviewer(false);
  }, [syncReviewsFromSupabase]);

  const timeOfDayKey = getBdtTimeOfDayKey();
  const timeGreeting = t(`greetings.${timeOfDayKey}`);

  // Determine whether to show Vendor or Reviewer UI
  const resolvedRole =
    propRole ||
    (activeUser?.role
      ? activeUser.role === 'external'
        ? 'vendor'
        : activeUser.role === 'internal'
          ? 'reviewer'
          : activeUser.role
      : undefined) ||
    ((segments as string[]).includes('(external)')
      ? 'vendor'
      : (segments as string[]).includes('(internal)')
        ? 'reviewer'
        : 'vendor');

  const isVendor = resolvedRole === 'vendor' || resolvedRole === 'external';
  const rawName = activeUser?.name?.trim();
  const userFirstName = rawName ? rawName.split(/\s+/)[0] : (isVendor ? 'Vendor' : 'Reviewer');
  const assignedVendor =
    activeUser?.vendorName || activeUser?.projectName || 'Vendor Organization';

  // Dynamic calculations for Vendor checks and compliance
  const todayMidnight = new Date();
  todayMidnight.setHours(0, 0, 0, 0);
  const todayMidnightMs = todayMidnight.getTime();

  const todayChecksCount = vendorRecentChecks.filter(
    (c) => (c.timestamp || 0) >= todayMidnightMs
  ).length;

  const reviewedChecks = vendorRecentChecks.filter(
    (c) => c.status === 'safe' || c.status === 'unsafe'
  );
  const safeCount = reviewedChecks.filter((c) => c.status === 'safe').length;
  const complianceRate =
    vendorRecentChecks.length === 0 || reviewedChecks.length === 0
      ? 0
      : Math.round((safeCount / reviewedChecks.length) * 100);

  if (isVendor) {
    return (
      <SafeAreaView edges={['top', 'left', 'right']} style={vendorStyles.safeArea}>
        <View style={[vendorStyles.shell, { maxWidth: contentMaxWidth }]}>
          <View style={vendorStyles.header}>
            <View style={vendorStyles.headerCopy}>
              <Text style={vendorStyles.greeting}>
                {t('external.greeting', { timeGreeting, name: userFirstName })}
              </Text>
              <View style={vendorStyles.companyRow}>
                <Icon
                  color={vendorColors.textMuted}
                  name={{ ios: 'building.2', android: 'business', web: 'business' }}
                  size={18}
                />
                <Text style={vendorStyles.company}>
                  {assignedVendor}
                </Text>
              </View>
            </View>
            <View style={{ flexDirection: 'row', alignItems: 'center', gap: 10 }}>
              <NotificationBell role="vendor" />
              <Pressable
                accessibilityLabel="Profile"
                accessibilityRole="button"
                onPress={() => navigate('/profile')}
                {...({ onClick: () => navigate('/profile') } as any)}
                style={({ pressed }) => [{ opacity: pressed ? 0.8 : 1 }]}>
                {activeUser?.profilePictureUrl ? (
                  <Image
                    contentFit="cover"
                    source={{ uri: activeUser.profilePictureUrl }}
                    style={vendorStyles.avatar}
                  />
                ) : (
                  <View style={[vendorStyles.avatar, vendorStyles.placeholderAvatar]}>
                    <Text style={vendorStyles.placeholderInitial}>
                      {(userFirstName || 'V').charAt(0).toUpperCase()}
                    </Text>
                  </View>
                )}
              </Pressable>
            </View>
          </View>

          <ScrollView
            contentContainerStyle={[
              vendorStyles.scrollContent,
              { paddingBottom: 80 + Math.max(insets.bottom, 16) },
            ]}
            showsVerticalScrollIndicator={false}
            style={vendorStyles.scroll}>
            <Pressable
              accessibilityRole="button"
              onPress={() => {
                clearPendingSubmissionReviewCaptures();
                setPendingSubmissionReviewTarget(null);
                navigate('/continuous-ppe-capture');
              }}
              style={({ pressed }) => [vendorStyles.captureCard, pressed && vendorStyles.pressed]}>
              <View style={vendorStyles.captureGlow} />
              <View style={vendorStyles.cameraIconBox}>
                <Icon
                  color={vendorColors.white}
                  name={{ ios: 'camera.fill', android: 'photo_camera', web: 'photo_camera' }}
                  size={32}
                  weight="bold"
                />
              </View>
              <View>
                <Text style={vendorStyles.captureTitle}>{t('external.captureTitle')}</Text>
                <Text style={vendorStyles.captureDescription}>
                  {t('external.captureDescription')}
                </Text>
              </View>
            </Pressable>

            <View style={vendorStyles.statsGrid}>
              <View style={vendorStyles.statCard}>
                <Text style={vendorStyles.statLabel}>{t('external.todayChecks')}</Text>
                <Text style={vendorStyles.statValue}>{todayChecksCount}</Text>
              </View>
              <View style={vendorStyles.statCard}>
                <Text style={vendorStyles.statLabel}>{t('external.compliance')}</Text>
                <View style={vendorStyles.percentRow}>
                  <Text style={vendorStyles.statValue}>{complianceRate}</Text>
                  <Text style={vendorStyles.percent}>%</Text>
                </View>
              </View>
            </View>

            <View style={vendorStyles.section}>
              <View style={vendorStyles.sectionHeader}>
                <Text style={vendorStyles.sectionTitle}>{t('external.recentChecks')}</Text>
                <Pressable
                  accessibilityRole="button"
                  onPress={() => navigate('/history?filter=pending')}
                  style={({ pressed }) => pressed && vendorStyles.textPressed}>
                  <View style={vendorStyles.viewAllRow}>
                    <Text style={vendorStyles.viewAll}>{t('external.viewAll')}</Text>
                    <Icon
                      color={vendorColors.primary}
                      name={{ ios: 'arrow.right', android: 'arrow_forward', web: 'arrow_forward' }}
                      size={16}
                      weight="semibold"
                    />
                  </View>
                </Pressable>
              </View>

              <View style={vendorStyles.feed}>
                {vendorRecentChecks.length === 0 ? (
                  <View style={vendorStyles.emptyFeed}>
                    <Icon
                      color={vendorColors.outlineVariant}
                      name={{ ios: 'tray', android: 'inbox', web: 'inbox' }}
                      size={36}
                    />
                    <Text style={vendorStyles.emptyFeedText}>
                      {t('external.history.noRecords', { defaultValue: 'No recent checks found' })}
                    </Text>
                  </View>
                ) : (
                  vendorRecentChecks
                    .slice()
                    .sort((a, b) => (b.timestamp || 0) - (a.timestamp || 0))
                    .map((item, index) => {
                      const isSafe = item.status === 'safe';
                      const statusLabel = t(`external.statuses.${item.status}`);

                      return (
                        <Pressable
                          accessibilityRole="button"
                          key={item.id}
                          onPress={() => {
                            setSelectedVendorCheck(item);
                            setIsVendorDetailsModalVisible(true);
                          }}
                          style={({ pressed }) => [
                            vendorStyles.feedRow,
                            index < vendorRecentChecks.length - 1 && vendorStyles.feedDivider,
                            pressed && vendorStyles.pressed,
                          ]}>
                          <VendorCheckThumbnail check={item} />

                          <View style={vendorStyles.feedCopy}>
                            <View style={vendorStyles.feedTitleRow}>
                              <Text numberOfLines={1} style={vendorStyles.workerName}>
                                {formatWorkerCheckTitle(item, t, i18n.language)}
                              </Text>
                              <Text style={vendorStyles.time}>
                                {formatWorkerCheckTime(item, t)}
                              </Text>
                            </View>

                            {/* Workers count summary text - matches Reviewer side */}
                            {item.workerReviews && item.workerReviews.length > 0 && (
                              <Text style={vendorStyles.workerSummaryText}>
                                {item.status === 'unsafe'
                                  ? `${item.workerReviews.filter((w) => w.status === 'unsafe').length} of ${item.workerCount || item.workerReviews.length} workers unsafe`
                                  : item.status === 'safe'
                                  ? `${item.workerReviews.filter((w) => w.status === 'safe').length} of ${item.workerCount || item.workerReviews.length} workers safe`
                                  : `${item.workerCount || item.workerReviews.length} workers pending review`}
                              </Text>
                            )}

                            <View style={vendorStyles.metaRow}>
                              <View
                                style={[
                                  vendorStyles.statusChip,
                                  item.status === 'safe' && vendorStyles.safeChip,
                                  item.status === 'unsafe' && vendorStyles.unsafeChip,
                                  item.status === 'review' && vendorStyles.reviewChip,
                                ]}>
                                {item.status === 'safe' ? (
                                  <Icon
                                    color={vendorColors.successGreen}
                                    name={{
                                      ios: 'checkmark.circle.fill',
                                      android: 'check_circle',
                                      web: 'check_circle',
                                    }}
                                    size={12}
                                  />
                                ) : item.status === 'unsafe' ? (
                                  <Icon
                                    color={vendorColors.error}
                                    name={{
                                      ios: 'exclamationmark.triangle.fill',
                                      android: 'warning',
                                      web: 'warning',
                                    }}
                                    size={12}
                                  />
                                ) : (
                                  <Icon
                                    color={vendorColors.pendingYellow}
                                    name={{ ios: 'clock.fill', android: 'schedule', web: 'schedule' }}
                                    size={12}
                                  />
                                )}
                                <Text
                                  style={[
                                    vendorStyles.statusText,
                                    item.status === 'safe' && vendorStyles.safeText,
                                    item.status === 'unsafe' && vendorStyles.unsafeText,
                                    item.status === 'review' && vendorStyles.reviewText,
                                  ]}>
                                  {item.workerReviews && item.workerReviews.length > 1
                                    ? item.status === 'unsafe'
                                      ? `${item.workerReviews.filter((w) => w.status === 'unsafe').length} Unsafe`
                                      : item.status === 'safe'
                                      ? `${item.workerReviews.filter((w) => w.status === 'safe').length} Safe`
                                      : statusLabel
                                    : statusLabel}
                                </Text>
                              </View>

                              {isSafe ? (
                                <Text style={vendorStyles.badgeHint}>
                                  {t('external.history.approvedByEhs')}
                                </Text>
                              ) : null}

                              <Text style={vendorStyles.viewDetailsText}>Tap to view details</Text>
                            </View>
                          </View>
                        </Pressable>
                      );
                    })
                )}
              </View>
            </View>
          </ScrollView>

          <View
            style={[
              vendorStyles.bottomNav,
              {
                maxWidth: contentMaxWidth,
                paddingBottom: Math.max(insets.bottom, 12),
                height: 60 + Math.max(insets.bottom, 12),
              },
            ]}>
            <Pressable accessibilityRole="button" style={vendorStyles.navItemActive}>
              <Icon
                color="#00376f"
                name={{ ios: 'house.fill', android: 'home', web: 'home' }}
                size={20}
                weight="bold"
              />
              <Text style={vendorStyles.navTextActive}>{t('external.bottomNav.home')}</Text>
            </Pressable>
            <Pressable
              accessibilityRole="button"
              onPress={() => navigate('/history?filter=all')}
              style={({ pressed }) => [vendorStyles.navItem, pressed && vendorStyles.navPressed]}>
              <Icon
                color={vendorColors.textMuted}
                name={{ ios: 'clock.arrow.circlepath', android: 'history', web: 'history' }}
                size={20}
              />
              <Text style={vendorStyles.navText}>{t('external.bottomNav.history')}</Text>
            </Pressable>
            <Pressable
              accessibilityRole="button"
              onPress={() => navigate('/settings?role=vendor')}
              {...({ onClick: () => navigate('/settings?role=vendor') } as any)}
              style={({ pressed }) => [vendorStyles.navItem, pressed && vendorStyles.navPressed]}>
              <Icon
                color={vendorColors.textMuted}
                name={{ ios: 'gear', android: 'settings', web: 'settings' }}
                size={20}
              />
              <Text style={vendorStyles.navText}>{t('external.bottomNav.settings')}</Text>
            </Pressable>
          </View>
        </View>

        <SubmissionDetailsBottomSheet
          visible={isVendorDetailsModalVisible}
          item={selectedVendorCheck}
          onClose={() => {
            setIsVendorDetailsModalVisible(false);
            setSelectedVendorCheck(null);
          }}
          onFixAndResubmit={handleVendorFixAndResubmit}
        />
      </SafeAreaView>
    );
  }

  // Reviewer UI
  return (
    <SafeAreaView edges={['top', 'left', 'right']} style={reviewerStyles.safeArea}>
      <View style={[reviewerStyles.shell, { maxWidth: contentMaxWidth }]}>
        <View style={reviewerStyles.header}>
          <View style={{ flex: 1, paddingRight: 12 }}>
            <Text numberOfLines={1} style={reviewerStyles.greeting}>
              {t('internal.greeting', { timeGreeting, name: userFirstName })}
            </Text>
            <Text style={reviewerStyles.role}>{activeUser?.designation || t('internal.role')}</Text>
          </View>
          <View style={{ flexDirection: 'row', alignItems: 'center', gap: 10 }}>
            <NotificationBell role="reviewer" />
            <Pressable
              accessibilityLabel="Profile"
              accessibilityRole="button"
              onPress={() => navigate('/profile')}
              {...({ onClick: () => navigate('/profile') } as any)}
              style={({ pressed }) => [{ opacity: pressed ? 0.8 : 1 }]}>
              {activeUser?.profilePictureUrl ? (
                <Image
                  contentFit="cover"
                  source={{ uri: activeUser.profilePictureUrl }}
                  style={reviewerStyles.profileImage}
                />
              ) : (
                <View style={[reviewerStyles.profileImage, reviewerStyles.placeholderAvatar]}>
                  <Text style={reviewerStyles.placeholderInitial}>
                    {(userFirstName || 'R').charAt(0).toUpperCase()}
                  </Text>
                </View>
              )}
            </Pressable>
          </View>
        </View>

        <ScrollView
          contentContainerStyle={[
            reviewerStyles.scrollContent,
            { paddingBottom: 80 + Math.max(insets.bottom, 16) },
          ]}
          showsVerticalScrollIndicator={false}
          style={reviewerStyles.scroll}
          refreshControl={
            <RefreshControl
              refreshing={isRefreshingReviewer}
              onRefresh={handleReviewerRefresh}
              tintColor="#005cad"
            />
          }>
          {/* 1. Hero Review Card - At Top */}
          <Pressable
            accessibilityRole="button"
            onPress={() => navigate('/reviews')}
            style={({ pressed }) => [reviewerStyles.reviewCard, pressed && reviewerStyles.pressed]}>
            <View style={reviewerStyles.glow} />
            <Text style={reviewerStyles.reviewTitle}>{t('internal.reviewTitle')}</Text>
            <View style={reviewerStyles.reviewMetaRow}>
              <View style={reviewerStyles.waitingDot} />
              <Text style={reviewerStyles.reviewMeta}>
                {t('internal.waitingCount', { count: pendingReviews.length })}
              </Text>
            </View>
            <View style={reviewerStyles.reviewButton}>
              <Text style={reviewerStyles.reviewButtonText}>{t('internal.reviewNow')}</Text>
              <Icon
                color={reviewerColors.primary}
                name={{ ios: 'arrow.right', android: 'arrow_forward', web: 'arrow_forward' }}
                size={16}
                weight="semibold"
              />
            </View>
          </Pressable>

          {/* 2. Recent Section */}
          <View style={reviewerStyles.sectionHeader}>
            <Text style={reviewerStyles.sectionTitle}>{t('internal.recent')}</Text>
            <Pressable
              accessibilityRole="button"
              onPress={() => navigate('/reviews')}
              style={({ pressed }) => pressed && reviewerStyles.textPressed}>
              <Text style={reviewerStyles.viewAll}>{t('internal.viewAll')}</Text>
            </Pressable>
          </View>

          <View style={reviewerStyles.feed}>
            {recentPendingReviews.map((item, index) => (
              <Pressable
                accessibilityRole="button"
                key={item.id}
                onPress={() => handleReviewItemPress(item)}
                style={({ pressed }) => [
                  reviewerStyles.feedRow,
                  index < recentPendingReviews.length - 1 && reviewerStyles.feedDivider,
                  pressed && reviewerStyles.pressed,
                ]}>
                <View style={reviewerStyles.rowHeader}>
                  <View style={reviewerStyles.identityRow}>
                    {item.avatar ? (
                      <View style={reviewerStyles.avatarPhoto}>
                        <Text style={reviewerStyles.avatarPhotoText}>{item.avatar}</Text>
                      </View>
                    ) : (
                      <View style={reviewerStyles.avatarInitial}>
                        <Text style={reviewerStyles.avatarInitialText}>{item.initials}</Text>
                      </View>
                    )}
                    <View style={reviewerStyles.identityCopy}>
                      <View style={{ flexDirection: 'row', alignItems: 'center', gap: 6 }}>
                        <Text style={reviewerStyles.vendor}>{item.vendor}</Text>
                        {item.isDraft && (
                          <View style={reviewerStyles.draftBadge}>
                            <Icon
                              color={reviewerColors.warningOrange}
                              name={{ ios: 'pencil', android: 'edit', web: 'edit' }}
                              size={10}
                            />
                            <Text style={reviewerStyles.draftBadgeText}>In Progress</Text>
                          </View>
                        )}
                      </View>
                      <Text style={reviewerStyles.teamLead}>
                        {item.teamLeadKey
                          ? t(`internal.reviewItems.${item.teamLeadKey}`, {
                              count: item.workers,
                              defaultValue: item.teamLead,
                            })
                          : item.teamLead}
                      </Text>
                    </View>
                  </View>
                  <Text style={reviewerStyles.time}>
                    {formatReviewTime(item)}
                  </Text>
                </View>

                <View style={reviewerStyles.detailBlock}>
                  <Text style={reviewerStyles.location}>
                    {item.location} ·{' '}
                    {t('internal.reviewItems.workersPhotos', {
                      photos: item.workers * 2,
                      workers: item.workers,
                      defaultValue: `${item.workers} workers · ${item.workers * 2} PPE photos`,
                    })}
                  </Text>
                  {item.isDraft ? (
                    <View style={[reviewerStyles.statusChip, reviewerStyles.inProgressChip]}>
                      <Icon
                        color={reviewerColors.warningOrange}
                        name={{ ios: 'clock.arrow.circlepath', android: 'pending', web: 'pending' }}
                        size={14}
                      />
                      <Text style={[reviewerStyles.statusText, reviewerStyles.inProgressText]}>
                        {item.workerReviews && item.workerReviews.length > 0
                          ? `In Progress · ${item.workerReviews.length} of ${item.workers} reviewed`
                          : `Review Started · 0 of ${item.workers}`}
                      </Text>
                    </View>
                  ) : (
                    <View style={[reviewerStyles.statusChip, reviewerStyles.waitingChip]}>
                      <Icon
                        color={reviewerColors.pendingYellow}
                        name={{ ios: 'clock.fill', android: 'schedule', web: 'schedule' }}
                        size={14}
                      />
                      <Text style={[reviewerStyles.statusText, reviewerStyles.waitingText]}>
                        {t('internal.statuses.waiting')}
                      </Text>
                    </View>
                  )}
                </View>
              </Pressable>
            ))}
          </View>
        </ScrollView>

        <View
          style={[
            reviewerStyles.bottomNav,
            {
              maxWidth: contentMaxWidth,
              paddingBottom: Math.max(insets.bottom, 10),
              height: 56 + Math.max(insets.bottom, 10),
            },
          ]}>
          <Pressable accessibilityRole="button" style={reviewerStyles.navItemActive}>
            <Icon
              color="#00376f"
              name={{ ios: 'house.fill', android: 'home', web: 'home' }}
              size={20}
              weight="bold"
            />
            <Text style={reviewerStyles.navTextActive}>{t('internal.bottomNav.home')}</Text>
          </Pressable>
          <Pressable
            accessibilityRole="button"
            onPress={() => navigate('/reviews')}
            style={({ pressed }) => [reviewerStyles.navItem, pressed && reviewerStyles.navPressed]}>
            <Icon
              color={reviewerColors.textMuted}
              name={{ ios: 'clock', android: 'schedule', web: 'schedule' }}
              size={20}
            />
            <Text style={reviewerStyles.navText}>{t('internal.bottomNav.reviews')}</Text>
          </Pressable>
          <Pressable
            accessibilityRole="button"
            onPress={() => navigate('/history')}
            style={({ pressed }) => [reviewerStyles.navItem, pressed && reviewerStyles.navPressed]}>
            <Icon
              color={reviewerColors.textMuted}
              name={{ ios: 'checklist', android: 'checklist', web: 'checklist' }}
              size={20}
            />
            <Text style={reviewerStyles.navText}>{t('internal.bottomNav.history')}</Text>
          </Pressable>
          <Pressable
            accessibilityRole="button"
            onPress={() => navigate('/settings?role=reviewer')}
            {...({ onClick: () => navigate('/settings?role=reviewer') } as any)}
            style={({ pressed }) => [reviewerStyles.navItem, pressed && reviewerStyles.navPressed]}>
            <Icon
              color={reviewerColors.textMuted}
              name={{ ios: 'gear', android: 'settings', web: 'settings' }}
              size={20}
            />
            <Text style={reviewerStyles.navText}>{t('internal.bottomNav.settings')}</Text>
          </Pressable>
        </View>

        <InProgressLimitModal
          visible={isInProgressLimitModalVisible}
          inProgressCount={inProgressCount}
          onClose={() => setIsInProgressLimitModalVisible(false)}
        />
      </View>
    </SafeAreaView>
  );
}

const vendorColors = {
  background: '#f9f9ff',
  borderSubtle: '#E4E7EC',
  chipGreen: 'rgba(22, 163, 74, 0.12)',
  chipRed: 'rgba(186, 26, 26, 0.12)',
  chipYellow: 'rgba(234, 179, 8, 0.15)',
  chipOrange: 'rgba(234, 88, 12, 0.15)',
  chipReview: 'rgba(234, 179, 8, 0.15)',
  error: '#ba1a1a',
  outline: '#74777F',
  outlineVariant: '#c0c7d5',
  primary: '#0082F0',
  safetyBlue: '#0082F0',
  secondary: '#005DB6',
  tertiary: '#D36001',
  neutral: '#74777F',
  secondaryContainer: '#63a1ff',
  successGreen: '#16A34A',
  pendingYellow: '#CA8A04',
  inProgressOrange: '#EA580C',
  surface: '#f9f9ff',
  surfaceContainer: '#ebedf7',
  surfaceContainerLow: '#f1f3fd',
  tertiaryContainer: '#CA8A04',
  text: '#181c22',
  textMuted: '#404753',
  white: '#ffffff',
};

const vendorStyles = StyleSheet.create({
  safeArea: {
    flex: 1,
    backgroundColor: vendorColors.background,
  },
  shell: {
    alignSelf: 'center',
    backgroundColor: vendorColors.background,
    flex: 1,
    maxWidth: 448,
    overflow: 'hidden',
    width: '100%',
  },
  header: {
    alignItems: 'flex-start',
    flexDirection: 'row',
    justifyContent: 'space-between',
    paddingBottom: 16,
    paddingHorizontal: 20,
    paddingTop: 16,
  },
  headerCopy: {
    flex: 1,
    paddingRight: 16,
  },
  greeting: {
    color: vendorColors.text,
    fontSize: 28,
    fontWeight: '700',
    letterSpacing: 0,
    lineHeight: 36,
  },
  companyRow: {
    alignItems: 'center',
    flexDirection: 'row',
    gap: 8,
    marginTop: 4,
  },
  company: {
    color: vendorColors.textMuted,
    flex: 1,
    fontSize: 16,
    lineHeight: 24,
  },
  avatar: {
    borderColor: vendorColors.surface,
    borderRadius: 24,
    borderWidth: 2,
    height: 48,
    shadowColor: '#000000',
    shadowOffset: { height: 1, width: 0 },
    shadowOpacity: 0.08,
    shadowRadius: 3,
    width: 48,
  },
  placeholderAvatar: {
    alignItems: 'center',
    backgroundColor: '#dbeafe',
    justifyContent: 'center',
  },
  placeholderInitial: {
    color: vendorColors.safetyBlue,
    fontSize: 18,
    fontWeight: '700',
  },
  scroll: {
    flex: 1,
  },
  scrollContent: {
    gap: 16,
    paddingBottom: 112,
    paddingHorizontal: 20,
  },
  captureCard: {
    backgroundColor: vendorColors.safetyBlue,
    borderRadius: 16,
    justifyContent: 'space-between',
    minHeight: 160,
    overflow: 'hidden',
    padding: 24,
    shadowColor: '#000000',
    shadowOffset: { height: 4, width: 0 },
    shadowOpacity: 0.08,
    shadowRadius: 12,
  },
  captureGlow: {
    backgroundColor: 'rgba(255, 255, 255, 0.12)',
    borderRadius: 96,
    height: 192,
    position: 'absolute',
    right: -44,
    top: -28,
    width: 192,
  },
  cameraIconBox: {
    alignItems: 'center',
    alignSelf: 'flex-start',
    backgroundColor: 'rgba(255, 255, 255, 0.2)',
    borderColor: 'rgba(255, 255, 255, 0.12)',
    borderRadius: 12,
    borderWidth: 1,
    height: 56,
    justifyContent: 'center',
    marginBottom: 16,
    width: 56,
  },
  captureTitle: {
    color: vendorColors.white,
    fontSize: 18,
    fontWeight: '600',
    lineHeight: 24,
    marginBottom: 4,
  },
  captureDescription: {
    color: 'rgba(255, 255, 255, 0.9)',
    fontSize: 14,
    lineHeight: 20,
  },
  statsGrid: {
    flexDirection: 'row',
    gap: 12,
    marginTop: 8,
  },
  statCard: {
    backgroundColor: 'rgba(255, 255, 255, 0.95)',
    borderColor: vendorColors.borderSubtle,
    borderRadius: 12,
    borderWidth: 1,
    flex: 1,
    gap: 4,
    padding: 16,
    shadowColor: '#000000',
    shadowOffset: { height: 2, width: 0 },
    shadowOpacity: 0.04,
    shadowRadius: 10,
  },
  statLabel: {
    color: vendorColors.textMuted,
    fontSize: 11,
    fontWeight: '500',
    letterSpacing: 0,
    lineHeight: 14,
  },
  statValue: {
    color: vendorColors.text,
    fontSize: 24,
    fontWeight: '600',
    lineHeight: 32,
  },
  percentRow: {
    alignItems: 'baseline',
    flexDirection: 'row',
    gap: 4,
  },
  percent: {
    color: vendorColors.textMuted,
    fontSize: 16,
    lineHeight: 24,
  },
  section: {
    gap: 16,
    marginTop: 16,
  },
  sectionHeader: {
    alignItems: 'center',
    flexDirection: 'row',
    justifyContent: 'space-between',
  },
  sectionTitle: {
    color: vendorColors.text,
    fontSize: 18,
    fontWeight: '600',
    lineHeight: 24,
  },
  viewAll: {
    color: vendorColors.primary,
    fontSize: 12,
    fontWeight: '600',
    lineHeight: 16,
  },
  viewAllRow: {
    alignItems: 'center',
    flexDirection: 'row',
    gap: 4,
  },
  feed: {
    backgroundColor: vendorColors.surface,
    borderColor: vendorColors.outlineVariant,
    borderRadius: 16,
    borderWidth: 1,
    overflow: 'hidden',
  },
  feedRow: {
    alignItems: 'center',
    flexDirection: 'row',
    gap: 12,
    padding: 16,
  },
  feedDivider: {
    borderBottomColor: vendorColors.outlineVariant,
    borderBottomWidth: 1,
  },
  thumbnail: {
    backgroundColor: vendorColors.surfaceContainer,
    borderRadius: 8,
    height: 48,
    width: 48,
  },
  pendingThumbnail: {
    alignItems: 'center',
    backgroundColor: vendorColors.surfaceContainer,
    borderRadius: 8,
    height: 48,
    justifyContent: 'center',
    width: 48,
  },
  feedCopy: {
    flex: 1,
    gap: 4,
    minWidth: 0,
  },
  feedTitleRow: {
    alignItems: 'center',
    flexDirection: 'row',
    gap: 8,
    justifyContent: 'space-between',
  },
  workerName: {
    color: vendorColors.text,
    flex: 1,
    fontSize: 16,
    fontWeight: '600',
    lineHeight: 24,
  },
  time: {
    color: vendorColors.textMuted,
    fontSize: 12,
    fontWeight: '500',
    lineHeight: 16,
    textAlign: 'right',
    flexShrink: 0,
  },
  statusChip: {
    alignItems: 'center',
    alignSelf: 'flex-start',
    borderRadius: 999,
    flexDirection: 'row',
    gap: 4,
    paddingHorizontal: 8,
    paddingVertical: 2,
  },
  safeChip: {
    backgroundColor: vendorColors.chipGreen,
  },
  unsafeChip: {
    backgroundColor: vendorColors.chipRed,
  },
  reviewChip: {
    backgroundColor: vendorColors.chipYellow,
  },
  statusText: {
    fontSize: 11,
    fontWeight: '500',
    lineHeight: 14,
  },
  safeText: {
    color: vendorColors.successGreen,
  },
  unsafeText: {
    color: vendorColors.error,
  },
  reviewText: {
    color: vendorColors.pendingYellow,
  },
  metaRow: {
    alignItems: 'center',
    flexDirection: 'row',
    flexWrap: 'wrap',
    gap: 8,
  },
  badgeHint: {
    color: vendorColors.textMuted,
    fontSize: 11,
    lineHeight: 14,
  },
  emptyFeed: {
    alignItems: 'center',
    justifyContent: 'center',
    paddingVertical: 32,
    gap: 8,
  },
  emptyFeedText: {
    color: vendorColors.textMuted,
    fontSize: 13,
    fontWeight: '500',
  },
  workerSummaryText: {
    color: vendorColors.textMuted,
    fontSize: 12,
    fontWeight: '500',
    marginTop: -2,
  },
  viewDetailsContainer: {
    justifyContent: 'center',
    alignItems: 'flex-end',
    paddingLeft: 4,
  },
  viewDetailsText: {
    color: vendorColors.primary,
    fontSize: 11,
    fontWeight: '600',
  },
  chevron: {
    height: 22,
    width: 22,
  },
  bottomNav: {
    alignItems: 'center',
    alignSelf: 'center',
    backgroundColor: vendorColors.surface,
    borderTopColor: vendorColors.outlineVariant,
    borderTopWidth: 1,
    bottom: 0,
    flexDirection: 'row',
    justifyContent: 'space-around',
    left: 0,
    maxWidth: 448,
    paddingHorizontal: 12,
    position: 'absolute',
    right: 0,
    shadowColor: '#000000',
    shadowOffset: { height: -2, width: 0 },
    shadowOpacity: 0.12,
    shadowRadius: 8,
    width: '100%',
  },
  navItemActive: {
    alignItems: 'center',
    backgroundColor: vendorColors.secondaryContainer,
    borderRadius: 999,
    flex: 1,
    justifyContent: 'center',
    marginHorizontal: 4,
    paddingVertical: 4,
    transform: [{ scale: 0.95 }],
  },
  navItem: {
    alignItems: 'center',
    flex: 1,
    justifyContent: 'center',
    paddingVertical: 4,
    transform: [{ scale: 0.95 }],
  },
  navTextActive: {
    color: '#00376f',
    fontSize: 11,
    fontWeight: '500',
    lineHeight: 14,
    marginTop: 2,
  },
  navText: {
    color: vendorColors.textMuted,
    fontSize: 11,
    fontWeight: '500',
    lineHeight: 14,
    marginTop: 2,
  },
  pressed: {
    transform: [{ scale: 0.98 }],
  },
  navPressed: {
    opacity: 0.72,
    transform: [{ scale: 0.9 }],
  },
  textPressed: {
    opacity: 0.68,
  },
});

const reviewerColors = {
  background: '#F7F8FA',
  chipGreen: 'rgba(22, 163, 74, 0.12)',
  chipOrange: 'rgba(234, 88, 12, 0.15)',
  chipYellow: 'rgba(234, 179, 8, 0.15)',
  chipRed: 'rgba(186, 26, 26, 0.12)',
  outlineVariant: '#c0c7d5',
  primary: '#0082F0',
  secondary: '#005DB6',
  tertiary: '#D36001',
  neutral: '#74777F',
  primaryFixed: '#d5e3ff',
  secondaryContainer: '#64a1fe',
  successGreen: '#16A34A',
  warningOrange: '#EA580C',
  pendingYellow: '#CA8A04',
  surface: '#f9f9ff',
  surfaceContainerHigh: '#e5e8f1',
  surfaceContainerLow: '#f1f3fd',
  text: '#181c22',
  textMuted: '#404753',
  white: '#ffffff',
};

const reviewerStyles = StyleSheet.create({
  safeArea: {
    flex: 1,
    backgroundColor: reviewerColors.background,
  },
  shell: {
    alignSelf: 'center',
    backgroundColor: reviewerColors.background,
    flex: 1,
    maxWidth: 448,
    width: '100%',
  },
  header: {
    alignItems: 'center',
    backgroundColor: reviewerColors.surface,
    flexDirection: 'row',
    justifyContent: 'space-between',
    paddingHorizontal: 20,
    paddingVertical: 16,
  },
  greeting: {
    color: reviewerColors.text,
    fontSize: 24,
    fontWeight: '600',
    letterSpacing: 0,
    lineHeight: 32,
  },
  role: {
    color: reviewerColors.textMuted,
    fontSize: 14,
    lineHeight: 20,
  },
  profileImage: {
    borderColor: reviewerColors.primaryFixed,
    borderRadius: 24,
    borderWidth: 2,
    height: 48,
    width: 48,
  },
  placeholderAvatar: {
    alignItems: 'center',
    backgroundColor: '#dbeafe',
    justifyContent: 'center',
  },
  placeholderInitial: {
    color: '#005cad',
    fontSize: 18,
    fontWeight: '700',
  },
  scroll: {
    flex: 1,
  },
  scrollContent: {
    gap: 16,
    paddingBottom: 96,
    paddingHorizontal: 20,
    paddingTop: 16,
  },
  reviewCard: {
    backgroundColor: reviewerColors.primary,
    borderRadius: 12,
    minHeight: 168,
    overflow: 'hidden',
    padding: 24,
    shadowColor: '#000000',
    shadowOffset: { height: 4, width: 0 },
    shadowOpacity: 0.08,
    shadowRadius: 20,
  },
  glow: {
    backgroundColor: 'rgba(255, 255, 255, 0.12)',
    borderRadius: 80,
    height: 160,
    position: 'absolute',
    right: -48,
    top: -48,
    width: 160,
  },
  reviewTitle: {
    color: reviewerColors.white,
    fontSize: 18,
    fontWeight: '600',
    lineHeight: 24,
    marginBottom: 4,
  },
  reviewMetaRow: {
    alignItems: 'center',
    flexDirection: 'row',
    gap: 8,
    marginBottom: 24,
  },
  waitingDot: {
    backgroundColor: '#EAB308',
    borderRadius: 4,
    height: 8,
    width: 8,
  },
  reviewMeta: {
    color: reviewerColors.primaryFixed,
    fontSize: 14,
    lineHeight: 20,
  },
  reviewButton: {
    alignItems: 'center',
    alignSelf: 'flex-start',
    backgroundColor: reviewerColors.white,
    borderRadius: 8,
    flexDirection: 'row',
    gap: 8,
    minHeight: 40,
    paddingHorizontal: 16,
    paddingVertical: 8,
  },
  reviewButtonText: {
    color: reviewerColors.primary,
    fontSize: 12,
    fontWeight: '600',
    lineHeight: 16,
  },
  sectionHeader: {
    alignItems: 'center',
    flexDirection: 'row',
    justifyContent: 'space-between',
    marginTop: 16,
  },
  sectionTitle: {
    color: reviewerColors.text,
    fontSize: 18,
    fontWeight: '600',
    lineHeight: 24,
  },
  viewAll: {
    color: reviewerColors.primary,
    fontSize: 12,
    fontWeight: '600',
    lineHeight: 16,
  },
  feed: {
    backgroundColor: reviewerColors.surface,
    borderColor: reviewerColors.outlineVariant,
    borderRadius: 12,
    borderWidth: 1,
    overflow: 'hidden',
  },
  feedRow: {
    padding: 16,
  },
  feedDivider: {
    borderBottomColor: 'rgba(192, 199, 213, 0.5)',
    borderBottomWidth: 1,
  },
  rowHeader: {
    alignItems: 'flex-start',
    flexDirection: 'row',
    justifyContent: 'space-between',
    marginBottom: 8,
  },
  identityRow: {
    flex: 1,
    flexDirection: 'row',
    gap: 12,
    paddingRight: 8,
  },
  avatarPhoto: {
    alignItems: 'center',
    backgroundColor: reviewerColors.primaryFixed,
    borderRadius: 20,
    height: 40,
    justifyContent: 'center',
    width: 40,
  },
  avatarPhotoText: {
    color: reviewerColors.primary,
    fontSize: 12,
    fontWeight: '700',
  },
  avatarInitial: {
    alignItems: 'center',
    backgroundColor: reviewerColors.surfaceContainerHigh,
    borderRadius: 20,
    height: 40,
    justifyContent: 'center',
    width: 40,
  },
  avatarInitialText: {
    color: reviewerColors.textMuted,
    fontSize: 18,
    fontWeight: '600',
    lineHeight: 24,
  },
  identityCopy: {
    flex: 1,
  },
  vendor: {
    color: reviewerColors.text,
    fontSize: 18,
    fontWeight: '600',
    lineHeight: 24,
  },
  teamLead: {
    color: reviewerColors.textMuted,
    fontSize: 14,
    lineHeight: 20,
  },
  time: {
    color: reviewerColors.textMuted,
    fontSize: 11,
    fontWeight: '500',
    lineHeight: 14,
  },
  detailBlock: {
    marginLeft: 52,
  },
  location: {
    color: reviewerColors.textMuted,
    fontSize: 14,
    lineHeight: 20,
    marginBottom: 8,
  },
  statusChip: {
    alignItems: 'center',
    alignSelf: 'flex-start',
    borderRadius: 999,
    flexDirection: 'row',
    gap: 6,
    paddingHorizontal: 10,
    paddingVertical: 4,
  },
  waitingChip: {
    backgroundColor: reviewerColors.chipYellow,
    borderColor: 'rgba(234, 179, 8, 0.3)',
    borderWidth: 1,
  },
  reviewedChip: {
    backgroundColor: reviewerColors.chipGreen,
  },
  inProgressChip: {
    backgroundColor: reviewerColors.chipOrange,
    borderColor: 'rgba(234, 88, 12, 0.3)',
    borderWidth: 1,
  },
  statusText: {
    fontSize: 11,
    fontWeight: '500',
    lineHeight: 14,
  },
  waitingText: {
    color: reviewerColors.pendingYellow,
    fontWeight: '600',
  },
  reviewedText: {
    color: reviewerColors.successGreen,
  },
  inProgressText: {
    color: reviewerColors.warningOrange,
    fontWeight: '600',
  },
  draftBadge: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 3,
    backgroundColor: reviewerColors.chipOrange,
    borderColor: 'rgba(234, 88, 12, 0.3)',
    borderWidth: 1,
    borderRadius: 6,
    paddingHorizontal: 6,
    paddingVertical: 2,
  },
  draftBadgeText: {
    color: reviewerColors.warningOrange,
    fontSize: 10,
    fontWeight: '700',
  },
  bottomNav: {
    alignItems: 'center',
    alignSelf: 'center',
    backgroundColor: 'rgba(255, 255, 255, 0.95)',
    borderTopColor: 'rgba(192, 199, 213, 0.3)',
    borderTopWidth: 1,
    bottom: 0,
    flexDirection: 'row',
    justifyContent: 'space-around',
    left: 0,
    maxWidth: 448,
    paddingHorizontal: 8,
    position: 'absolute',
    right: 0,
    shadowColor: '#000000',
    shadowOffset: { height: -4, width: 0 },
    shadowOpacity: 0.08,
    shadowRadius: 20,
    width: '100%',
  },
  navItemActive: {
    alignItems: 'center',
    backgroundColor: reviewerColors.secondaryContainer,
    borderRadius: 999,
    flex: 1,
    justifyContent: 'center',
    marginHorizontal: 2,
    paddingVertical: 4,
  },
  navItem: {
    alignItems: 'center',
    flex: 1,
    justifyContent: 'center',
    marginHorizontal: 2,
    paddingVertical: 4,
  },
  navTextActive: {
    color: '#00376f',
    fontSize: 12,
    fontWeight: '600',
    lineHeight: 16,
    marginTop: 2,
  },
  navText: {
    color: reviewerColors.textMuted,
    fontSize: 12,
    fontWeight: '600',
    lineHeight: 16,
    marginTop: 2,
  },
  pressed: {
    transform: [{ scale: 0.98 }],
  },
  navPressed: {
    transform: [{ scale: 0.9 }],
  },
  textPressed: {
    opacity: 0.68,
  },
});

export default SharedHomeScreen;
