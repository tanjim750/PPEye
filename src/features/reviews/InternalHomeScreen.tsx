import { Href, useRouter } from 'expo-router';
import { Image } from 'expo-image';
import { Pressable, ScrollView, StyleSheet, Text, View } from 'react-native';
import { SafeAreaView } from 'react-native-safe-area-context';
import { useTranslation } from 'react-i18next';

import { Icon } from '@/components/ui/Icon';
import { assets } from '@/constants/assets';

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

export function InternalHomeScreen() {
  const router = useRouter();
  const { t } = useTranslation('home');

  function openReviewQueue() {
    router.push('/reviews' as Href);
  }

  function openHistory() {
    router.push('/history' as Href);
  }

  return (
    <SafeAreaView style={styles.safeArea}>
      <View style={styles.shell}>
        <View style={styles.header}>
          <View>
            <Text style={styles.greeting}>{t('internal.greeting', { name: 'Mahmud' })}</Text>
            <Text style={styles.role}>{t('internal.role')}</Text>
          </View>
          <Image source={assets.ehsProfile} style={styles.profileImage} />
        </View>

        <ScrollView
          contentContainerStyle={styles.scrollContent}
          showsVerticalScrollIndicator={false}
          style={styles.scroll}>
          <Pressable
            accessibilityRole="button"
            onPress={openReviewQueue}
            style={({ pressed }) => [styles.reviewCard, pressed && styles.pressed]}>
            <View style={styles.glow} />
            <Text style={styles.reviewTitle}>{t('internal.reviewTitle')}</Text>
            <View style={styles.reviewMetaRow}>
              <View style={styles.waitingDot} />
              <Text style={styles.reviewMeta}>{t('internal.waitingCount', { count: 12 })}</Text>
            </View>
            <View style={styles.reviewButton}>
              <Text style={styles.reviewButtonText}>{t('internal.reviewNow')}</Text>
              <Icon
                color={colors.primary}
                name={{ ios: 'arrow.right', android: 'arrow_forward', web: 'arrow_forward' }}
                size={16}
                weight="semibold"
              />
            </View>
          </Pressable>

          <View style={styles.sectionHeader}>
            <Text style={styles.sectionTitle}>{t('internal.recent')}</Text>
            <Pressable
              accessibilityRole="button"
              onPress={openHistory}
              style={({ pressed }) => pressed && styles.textPressed}>
              <Text style={styles.viewAll}>{t('internal.viewAll')}</Text>
            </Pressable>
          </View>

          <View style={styles.feed}>
            {recentReviews.map((item, index) => (
              <Pressable
                accessibilityRole="button"
                key={`${item.vendor}-${item.timeKey}`}
                onPress={openReviewQueue}
                style={({ pressed }) => [
                  styles.feedRow,
                  index < recentReviews.length - 1 && styles.feedDivider,
                  pressed && styles.pressed,
                ]}>
                <View style={styles.rowHeader}>
                  <View style={styles.identityRow}>
                    {item.avatar ? (
                      <View style={styles.avatarPhoto}>
                        <Text style={styles.avatarPhotoText}>{item.avatar}</Text>
                      </View>
                    ) : (
                      <View style={styles.avatarInitial}>
                        <Text style={styles.avatarInitialText}>{item.initials}</Text>
                      </View>
                    )}
                    <View style={styles.identityCopy}>
                      <Text style={styles.vendor}>{item.vendor}</Text>
                      <Text style={styles.teamLead}>
                        {t(`internal.reviewItems.${item.teamLeadKey}`, { count: 5 })}
                      </Text>
                    </View>
                  </View>
                  <Text style={styles.time}>{t(`internal.reviewItems.${item.timeKey}`)}</Text>
                </View>

                <View style={styles.detailBlock}>
                  <Text style={styles.location}>
                    {item.location} ·{' '}
                    {t('internal.reviewItems.workersPhotos', {
                      photos: item.photos,
                      workers: item.workers,
                    })}
                  </Text>
                  <View
                    style={[
                      styles.statusChip,
                      item.status === 'waiting' ? styles.waitingChip : styles.reviewedChip,
                    ]}>
                    {item.status === 'waiting' ? (
                      <Icon
                        color={colors.warningOrange}
                        name={{ ios: 'clock', android: 'schedule', web: 'schedule' }}
                        size={14}
                      />
                    ) : (
                      <Icon
                        color={colors.successGreen}
                        name={{
                          ios: 'checkmark.circle.fill',
                          android: 'check_circle',
                          web: 'check_circle',
                        }}
                        size={14}
                      />
                    )}
                    <Text
                      style={[
                        styles.statusText,
                        item.status === 'waiting' ? styles.waitingText : styles.reviewedText,
                      ]}>
                      {t(`internal.statuses.${item.status}`)}
                    </Text>
                  </View>
                </View>
              </Pressable>
            ))}
          </View>
        </ScrollView>

        <View style={styles.bottomNav}>
          <Pressable accessibilityRole="button" style={styles.navItemActive}>
            <Icon
              color="#00376f"
              name={{ ios: 'house.fill', android: 'home', web: 'home' }}
              size={20}
              weight="bold"
            />
            <Text style={styles.navTextActive}>{t('internal.bottomNav.home')}</Text>
          </Pressable>
          <Pressable
            accessibilityRole="button"
            onPress={openReviewQueue}
            style={({ pressed }) => [styles.navItem, pressed && styles.navPressed]}>
            <Icon
              color={colors.textMuted}
              name={{ ios: 'arrow.triangle.2.circlepath', android: 'repeat', web: 'repeat' }}
              size={20}
            />
            <Text style={styles.navText}>{t('internal.bottomNav.reviews')}</Text>
          </Pressable>
          <Pressable
            accessibilityRole="button"
            onPress={openHistory}
            style={({ pressed }) => [styles.navItem, pressed && styles.navPressed]}>
            <Icon
              color={colors.textMuted}
              name={{ ios: 'clock.arrow.circlepath', android: 'history', web: 'history' }}
              size={20}
            />
            <Text style={styles.navText}>{t('internal.bottomNav.history')}</Text>
          </Pressable>
        </View>
      </View>
    </SafeAreaView>
  );
}

const colors = {
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

const styles = StyleSheet.create({
  safeArea: {
    flex: 1,
    backgroundColor: colors.background,
  },
  shell: {
    alignSelf: 'center',
    backgroundColor: colors.background,
    flex: 1,
    maxWidth: 448,
    width: '100%',
  },
  header: {
    alignItems: 'center',
    backgroundColor: colors.surface,
    flexDirection: 'row',
    justifyContent: 'space-between',
    paddingHorizontal: 20,
    paddingVertical: 16,
  },
  greeting: {
    color: colors.text,
    fontSize: 24,
    fontWeight: '600',
    letterSpacing: 0,
    lineHeight: 32,
  },
  role: {
    color: colors.textMuted,
    fontSize: 14,
    lineHeight: 20,
  },
  profileImage: {
    borderColor: colors.primaryFixed,
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
    backgroundColor: colors.primary,
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
    color: colors.white,
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
    color: colors.primaryFixed,
    fontSize: 14,
    lineHeight: 20,
  },
  reviewButton: {
    alignItems: 'center',
    alignSelf: 'flex-start',
    backgroundColor: colors.white,
    borderRadius: 8,
    flexDirection: 'row',
    gap: 8,
    minHeight: 40,
    paddingHorizontal: 16,
    paddingVertical: 8,
  },
  reviewButtonText: {
    color: colors.primary,
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
    color: colors.text,
    fontSize: 18,
    fontWeight: '600',
    lineHeight: 24,
  },
  viewAll: {
    color: colors.primary,
    fontSize: 12,
    fontWeight: '600',
    lineHeight: 16,
  },
  feed: {
    backgroundColor: colors.surface,
    borderColor: colors.outlineVariant,
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
    backgroundColor: colors.primaryFixed,
    borderRadius: 20,
    height: 40,
    justifyContent: 'center',
    width: 40,
  },
  avatarPhotoText: {
    color: colors.primary,
    fontSize: 12,
    fontWeight: '700',
  },
  avatarInitial: {
    alignItems: 'center',
    backgroundColor: colors.surfaceContainerHigh,
    borderRadius: 20,
    height: 40,
    justifyContent: 'center',
    width: 40,
  },
  avatarInitialText: {
    color: colors.textMuted,
    fontSize: 18,
    fontWeight: '600',
    lineHeight: 24,
  },
  identityCopy: {
    flex: 1,
  },
  vendor: {
    color: colors.text,
    fontSize: 18,
    fontWeight: '600',
    lineHeight: 24,
  },
  teamLead: {
    color: colors.textMuted,
    fontSize: 14,
    lineHeight: 20,
  },
  time: {
    color: colors.textMuted,
    fontSize: 11,
    fontWeight: '500',
    lineHeight: 14,
  },
  detailBlock: {
    marginLeft: 52,
  },
  location: {
    color: colors.textMuted,
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
    backgroundColor: colors.chipOrange,
  },
  reviewedChip: {
    backgroundColor: colors.chipGreen,
  },
  statusText: {
    fontSize: 11,
    fontWeight: '500',
    lineHeight: 14,
  },
  waitingText: {
    color: colors.warningOrange,
  },
  reviewedText: {
    color: colors.successGreen,
  },
  bottomNav: {
    alignItems: 'center',
    backgroundColor: 'rgba(255, 255, 255, 0.95)',
    borderTopColor: 'rgba(192, 199, 213, 0.3)',
    borderTopWidth: 1,
    bottom: 0,
    flexDirection: 'row',
    height: 64,
    justifyContent: 'space-around',
    left: 0,
    paddingHorizontal: 12,
    position: 'absolute',
    right: 0,
    shadowColor: '#000000',
    shadowOffset: { height: -4, width: 0 },
    shadowOpacity: 0.08,
    shadowRadius: 20,
  },
  navItemActive: {
    alignItems: 'center',
    backgroundColor: colors.secondaryContainer,
    borderRadius: 999,
    justifyContent: 'center',
    minWidth: 92,
    paddingHorizontal: 20,
    paddingVertical: 4,
  },
  navItem: {
    alignItems: 'center',
    justifyContent: 'center',
    minWidth: 72,
  },
  navTextActive: {
    color: '#00376f',
    fontSize: 12,
    fontWeight: '600',
    lineHeight: 16,
    marginTop: 2,
  },
  navText: {
    color: colors.textMuted,
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
