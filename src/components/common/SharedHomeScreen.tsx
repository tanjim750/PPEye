import { Image, ImageSource } from 'expo-image';
import { useSegments } from 'expo-router';
import { Pressable, ScrollView, StyleSheet, Text, View } from 'react-native';
import { SafeAreaView, useSafeAreaInsets } from 'react-native-safe-area-context';
import { useTranslation } from 'react-i18next';

import { Icon } from '@/components/ui/Icon';
import { assets } from '@/constants/assets';
import { useAuth } from '@/hooks/useAuth';
import { useNavigate } from '@/hooks/useNavigate';
import { formatWorkerCheckTime, formatWorkerCheckTitle, useWorkerChecks } from '@/features/submissions/services/workerChecks.service';
import { formatReviewTime, useReviews } from '@/features/reviews/services/reviews.service';
import {
  clearPendingSubmissionReviewCaptures,
  setPendingSubmissionReviewTarget,
} from '@/features/submissions/services/pendingSubmissionReview.service';
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

type RecentReview = {
  avatar?: string;
  initials?: string;
  location: string;
  photos: number;
  status: 'waiting' | 'reviewed';
  teamLeadKey: 'rahimLead' | 'karimLead' | 'shakibLead';
  timeKey: 'time1042' | 'time1018' | 'yesterday';
  vendor: string;
  workers: number;
};

const recentReviews: RecentReview[] = [
  {
    avatar: 'RM',
    location: 'Gazipur-ER-102',
    photos: 8,
    status: 'waiting',
    teamLeadKey: 'rahimLead',
    timeKey: 'time1042',
    vendor: 'ABC Telecom',
    workers: 4,
  },
  {
    initials: 'K',
    location: 'Dhaka-ER-231',
    photos: 6,
    status: 'reviewed',
    teamLeadKey: 'karimLead',
    timeKey: 'time1018',
    vendor: 'XYZ Networks',
    workers: 3,
  },
  {
    initials: 'S',
    location: 'Narayanganj-ER-087',
    photos: 10,
    status: 'reviewed',
    teamLeadKey: 'shakibLead',
    timeKey: 'yesterday',
    vendor: 'ABC Telecom',
    workers: 5,
  },
];


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

export function SharedHomeScreen({ role: propRole }: SharedHomeScreenProps = {}) {
  const navigate = useNavigate();
  const insets = useSafeAreaInsets();
  const { user } = useAuth();
  const segments = useSegments();
  const { t, i18n } = useTranslation('home');
  const { recentChecks: vendorRecentChecks } = useWorkerChecks();
  const { pendingReviews, recentPendingReviews } = useReviews();
  const timeOfDayKey = getBdtTimeOfDayKey();
  const timeGreeting = t(`greetings.${timeOfDayKey}`);

  // Determine whether to show Vendor or Reviewer UI
  const resolvedRole =
    propRole ||
    (user?.role
      ? user.role === 'external'
        ? 'vendor'
        : user.role === 'internal'
          ? 'reviewer'
          : user.role
      : undefined) ||
    ((segments as string[]).includes('(external)')
      ? 'vendor'
      : (segments as string[]).includes('(internal)')
        ? 'reviewer'
        : 'vendor');

  const isVendor = resolvedRole === 'vendor' || resolvedRole === 'external';

  if (isVendor) {
    return (
      <SafeAreaView style={vendorStyles.safeArea}>
        <View style={vendorStyles.shell}>
          <View style={vendorStyles.header}>
            <View style={vendorStyles.headerCopy}>
              <Text style={vendorStyles.greeting}>
                {t('external.greeting', { timeGreeting, name: 'Rahim' })}
              </Text>
              <View style={vendorStyles.companyRow}>
                <Icon
                  color={vendorColors.textMuted}
                  name={{ ios: 'building.2', android: 'business', web: 'business' }}
                  size={18}
                />
                <Text style={vendorStyles.company}>
                  {t('external.company', { team: 'Team 07', vendor: 'ABC Telecom' })}
                </Text>
              </View>
            </View>
            <Pressable
              accessibilityLabel="Profile"
              accessibilityRole="button"
              onPress={() => navigate('/profile')}
              {...({ onClick: () => navigate('/profile') } as any)}
              style={({ pressed }) => [{ opacity: pressed ? 0.8 : 1 }]}>
              <Image source={assets.fieldRahimAvatar} style={vendorStyles.avatar} />
            </Pressable>
          </View>

          <ScrollView
            contentContainerStyle={vendorStyles.scrollContent}
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
                <Text style={vendorStyles.statValue}>12</Text>
              </View>
              <View style={vendorStyles.statCard}>
                <Text style={vendorStyles.statLabel}>{t('external.compliance')}</Text>
                <View style={vendorStyles.percentRow}>
                  <Text style={vendorStyles.statValue}>98</Text>
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
                {vendorRecentChecks
                  .slice()
                  .sort((a, b) => (b.timestamp || 0) - (a.timestamp || 0))
                  .map((item, index) => {
                  const isSafe = item.status === 'safe';
                  const statusLabel = t(`external.statuses.${item.status}`);

                  return (
                    <Pressable
                      accessibilityRole="button"
                      accessibilityState={{ disabled: isSafe }}
                      disabled={isSafe}
                      key={item.id}
                      onPress={item.status === 'unsafe' ? () => navigate(`/submission-details?id=${item.id}` as any) : undefined}
                      style={({ pressed }) => [
                        vendorStyles.feedRow,
                        index < vendorRecentChecks.length - 1 && vendorStyles.feedDivider,
                        pressed && !isSafe && vendorStyles.pressed,
                      ]}>
                      {item.image ? (
                        <Image source={item.image} style={vendorStyles.thumbnail} />
                      ) : (
                        <View style={vendorStyles.pendingThumbnail}>
                          <Icon
                            color={vendorColors.outlineVariant}
                            name={{ ios: 'clock', android: 'schedule', web: 'schedule' }}
                            size={24}
                          />
                        </View>
                      )}

                      <View style={vendorStyles.feedCopy}>
                        <View style={vendorStyles.feedTitleRow}>
                          <Text numberOfLines={1} style={vendorStyles.workerName}>
                            {formatWorkerCheckTitle(item, t, i18n.language)}
                          </Text>
                          <Text style={vendorStyles.time}>
                            {formatWorkerCheckTime(item, t)}
                          </Text>
                        </View>
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
                              color={vendorColors.tertiaryContainer}
                              name={{ ios: 'clock', android: 'schedule', web: 'schedule' }}
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
                            {statusLabel}
                          </Text>
                        </View>
                      </View>

                      {!isSafe ? (
                        <Icon
                          color={vendorColors.outline}
                          name={{
                            ios: 'chevron.right',
                            android: 'chevron_right',
                            web: 'chevron_right',
                          }}
                          size={22}
                          style={vendorStyles.chevron}
                        />
                      ) : null}
                    </Pressable>
                  );
                })}
              </View>
            </View>
          </ScrollView>

          <View
            style={[
              vendorStyles.bottomNav,
              {
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
      </SafeAreaView>
    );
  }

  // Reviewer UI
  return (
    <SafeAreaView style={reviewerStyles.safeArea}>
      <View style={reviewerStyles.shell}>
        <View style={reviewerStyles.header}>
          <View style={{ flex: 1, paddingRight: 12 }}>
            <Text numberOfLines={1} style={reviewerStyles.greeting}>
              {t('internal.greeting', { timeGreeting, name: 'Mahmud' })}
            </Text>
            <Text style={reviewerStyles.role}>{t('internal.role')}</Text>
          </View>
          <Pressable
            accessibilityLabel="Profile"
            accessibilityRole="button"
            onPress={() => navigate('/profile')}
            {...({ onClick: () => navigate('/profile') } as any)}
            style={({ pressed }) => [{ opacity: pressed ? 0.8 : 1 }]}>
            <Image source={assets.ehsProfile} style={reviewerStyles.profileImage} />
          </Pressable>
        </View>

        <ScrollView
          contentContainerStyle={reviewerStyles.scrollContent}
          showsVerticalScrollIndicator={false}
          style={reviewerStyles.scroll}>
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
                onPress={() => navigate(`/review/${item.id}`)}
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
                      <Text style={reviewerStyles.vendor}>{item.vendor}</Text>
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
                      photos: item.photos,
                      workers: item.workers,
                    })}
                  </Text>
                  <View style={[reviewerStyles.statusChip, reviewerStyles.waitingChip]}>
                    <Icon
                      color={reviewerColors.warningOrange}
                      name={{ ios: 'clock', android: 'schedule', web: 'schedule' }}
                      size={14}
                    />
                    <Text style={[reviewerStyles.statusText, reviewerStyles.waitingText]}>
                      {t('internal.statuses.waiting')}
                    </Text>
                  </View>
                </View>
              </Pressable>
            ))}
          </View>
        </ScrollView>

        <View
          style={[
            reviewerStyles.bottomNav,
            {
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
      </View>
    </SafeAreaView>
  );
}

const vendorColors = {
  background: '#f9f9ff',
  borderSubtle: '#E4E7EC',
  chipGreen: 'rgba(22, 163, 74, 0.1)',
  chipRed: 'rgba(186, 26, 26, 0.1)',
  chipReview: 'rgba(190, 86, 0, 0.1)',
  error: '#ba1a1a',
  outline: '#717785',
  outlineVariant: '#c0c7d5',
  primary: '#005cad',
  safetyBlue: '#0082F0',
  secondaryContainer: '#63a1ff',
  successGreen: '#16A34A',
  surface: '#f9f9ff',
  surfaceContainer: '#ebedf7',
  surfaceContainerLow: '#f1f3fd',
  tertiaryContainer: '#be5600',
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
    paddingTop: 32,
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
    alignItems: 'baseline',
    flexDirection: 'row',
    gap: 8,
    justifyContent: 'space-between',
  },
  workerName: {
    color: vendorColors.text,
    flex: 1,
    fontSize: 16,
    lineHeight: 24,
  },
  time: {
    color: vendorColors.textMuted,
    fontSize: 11,
    fontWeight: '500',
    lineHeight: 14,
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
    backgroundColor: vendorColors.chipReview,
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
    color: vendorColors.tertiaryContainer,
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
  chipGreen: 'rgba(22, 163, 74, 0.1)',
  chipOrange: 'rgba(152, 67, 0, 0.1)',
  outlineVariant: '#c0c7d5',
  primary: '#005cad',
  primaryFixed: '#d5e3ff',
  secondaryContainer: '#64a1fe',
  successGreen: '#16A34A',
  surface: '#f9f9ff',
  surfaceContainerHigh: '#e5e8f1',
  surfaceContainerLow: '#f1f3fd',
  text: '#181c22',
  textMuted: '#404753',
  warningOrange: '#984300',
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
    backgroundColor: '#ffdad6',
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
    backgroundColor: reviewerColors.chipOrange,
  },
  reviewedChip: {
    backgroundColor: reviewerColors.chipGreen,
  },
  statusText: {
    fontSize: 11,
    fontWeight: '500',
    lineHeight: 14,
  },
  waitingText: {
    color: reviewerColors.warningOrange,
  },
  reviewedText: {
    color: reviewerColors.successGreen,
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
