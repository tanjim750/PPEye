import { Href, useRouter } from 'expo-router';
import { Image, ImageSource } from 'expo-image';
import { Pressable, ScrollView, StyleSheet, Text, View } from 'react-native';
import { SafeAreaView } from 'react-native-safe-area-context';
import { useTranslation } from 'react-i18next';

import { Icon } from '@/components/ui/Icon';
import { assets } from '@/constants/assets';

type RecentCheck = {
  image?: ImageSource;
  status: 'safe' | 'unsafe' | 'review';
  timeKey: 'time1042' | 'today' | 'yesterday';
  titleKey: 'worker124' | 'worker127' | 'worker131';
};

const recentChecks: RecentCheck[] = [
  {
    image: assets.fieldSafeCheck,
    status: 'safe',
    timeKey: 'time1042',
    titleKey: 'worker124',
  },
  {
    image: assets.fieldUnsafeCheck,
    status: 'unsafe',
    timeKey: 'yesterday',
    titleKey: 'worker127',
  },
  {
    status: 'review',
    timeKey: 'today',
    titleKey: 'worker131',
  },
];

export function ExternalHomeScreen() {
  const router = useRouter();
  const { t } = useTranslation('home');

  function openCapture() {
    router.push('/continuous-ppe-capture' as Href);
  }

  function openHistory() {
    router.push('/history' as Href);
  }

  function openSubmissionDetails() {
    router.push('/submission-details' as Href);
  }

  function openProfile() {
    router.push('/settings/profile' as Href);
  }

  return (
    <SafeAreaView style={styles.safeArea}>
      <View style={styles.shell}>
        <View style={styles.header}>
          <View style={styles.headerCopy}>
            <Text style={styles.greeting}>{t('external.greeting', { name: 'Rahim' })}</Text>
            <View style={styles.companyRow}>
              <Icon
                color={colors.textMuted}
                name={{ ios: 'building.2', android: 'business', web: 'business' }}
                size={18}
              />
              <Text style={styles.company}>
                {t('external.company', { team: 'Team 07', vendor: 'ABC Telecom' })}
              </Text>
            </View>
          </View>
          <Image source={assets.fieldRahimAvatar} style={styles.avatar} />
        </View>

        <ScrollView
          contentContainerStyle={styles.scrollContent}
          showsVerticalScrollIndicator={false}
          style={styles.scroll}>
          <Pressable
            accessibilityRole="button"
            onPress={openCapture}
            style={({ pressed }) => [styles.captureCard, pressed && styles.pressed]}>
            <View style={styles.captureGlow} />
            <View style={styles.cameraIconBox}>
              <Icon
                color={colors.white}
                name={{ ios: 'camera.fill', android: 'photo_camera', web: 'photo_camera' }}
                size={32}
                weight="bold"
              />
            </View>
            <View>
              <Text style={styles.captureTitle}>{t('external.captureTitle')}</Text>
              <Text style={styles.captureDescription}>{t('external.captureDescription')}</Text>
            </View>
          </Pressable>

          <View style={styles.statsGrid}>
            <View style={styles.statCard}>
              <Text style={styles.statLabel}>{t('external.todayChecks')}</Text>
              <Text style={styles.statValue}>12</Text>
            </View>
            <View style={styles.statCard}>
              <Text style={styles.statLabel}>{t('external.compliance')}</Text>
              <View style={styles.percentRow}>
                <Text style={styles.statValue}>98</Text>
                <Text style={styles.percent}>%</Text>
              </View>
            </View>
          </View>

          <View style={styles.section}>
            <View style={styles.sectionHeader}>
              <Text style={styles.sectionTitle}>{t('external.recentChecks')}</Text>
              <Pressable
                accessibilityRole="button"
                onPress={openHistory}
                style={({ pressed }) => pressed && styles.textPressed}>
                <View style={styles.viewAllRow}>
                  <Text style={styles.viewAll}>{t('external.viewAll')}</Text>
                  <Icon
                    color={colors.primary}
                    name={{ ios: 'arrow.right', android: 'arrow_forward', web: 'arrow_forward' }}
                    size={16}
                    weight="semibold"
                  />
                </View>
              </Pressable>
            </View>

            <View style={styles.feed}>
              {recentChecks.map((item, index) => {
                const statusLabel = t(`external.statuses.${item.status}`);

                return (
                  <Pressable
                    accessibilityRole="button"
                    key={item.titleKey}
                    onPress={openSubmissionDetails}
                    style={({ pressed }) => [
                      styles.feedRow,
                      index < recentChecks.length - 1 && styles.feedDivider,
                      pressed && styles.pressed,
                    ]}>
                    {item.image ? (
                      <Image source={item.image} style={styles.thumbnail} />
                    ) : (
                      <View style={styles.pendingThumbnail}>
                        <Icon
                          color={colors.outlineVariant}
                          name={{ ios: 'clock', android: 'schedule', web: 'schedule' }}
                          size={24}
                        />
                      </View>
                    )}

                    <View style={styles.feedCopy}>
                      <View style={styles.feedTitleRow}>
                        <Text numberOfLines={1} style={styles.workerName}>
                          {t(`external.recent.${item.titleKey}`)}
                        </Text>
                        <Text style={styles.time}>{t(`external.recent.${item.timeKey}`)}</Text>
                      </View>
                      <View
                        style={[
                          styles.statusChip,
                          item.status === 'safe' && styles.safeChip,
                          item.status === 'unsafe' && styles.unsafeChip,
                          item.status === 'review' && styles.reviewChip,
                        ]}>
                        {item.status === 'safe' ? (
                          <Icon
                            color={colors.successGreen}
                            name={{
                              ios: 'checkmark.circle.fill',
                              android: 'check_circle',
                              web: 'check_circle',
                            }}
                            size={12}
                          />
                        ) : item.status === 'unsafe' ? (
                          <Icon
                            color={colors.error}
                            name={{
                              ios: 'exclamationmark.triangle.fill',
                              android: 'warning',
                              web: 'warning',
                            }}
                            size={12}
                          />
                        ) : (
                          <Icon
                            color={colors.tertiaryContainer}
                            name={{ ios: 'clock', android: 'schedule', web: 'schedule' }}
                            size={12}
                          />
                        )}
                        <Text
                          style={[
                            styles.statusText,
                            item.status === 'safe' && styles.safeText,
                            item.status === 'unsafe' && styles.unsafeText,
                            item.status === 'review' && styles.reviewText,
                          ]}>
                          {statusLabel}
                        </Text>
                      </View>
                    </View>

                    <Icon
                      color={colors.outline}
                      name={{ ios: 'chevron.right', android: 'chevron_right', web: 'chevron_right' }}
                      size={22}
                      style={styles.chevron}
                    />
                  </Pressable>
                );
              })}
            </View>
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
            <Text style={styles.navTextActive}>{t('external.bottomNav.home')}</Text>
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
            <Text style={styles.navText}>{t('external.bottomNav.history')}</Text>
          </Pressable>
          <Pressable
            accessibilityRole="button"
            onPress={openProfile}
            style={({ pressed }) => [styles.navItem, pressed && styles.navPressed]}>
            <Icon
              color={colors.textMuted}
              name={{ ios: 'person', android: 'person', web: 'person' }}
              size={20}
            />
            <Text style={styles.navText}>{t('external.bottomNav.profile')}</Text>
          </Pressable>
        </View>
      </View>
    </SafeAreaView>
  );
}

const colors = {
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
    color: colors.text,
    fontSize: 32,
    fontWeight: '700',
    letterSpacing: 0,
    lineHeight: 40,
  },
  companyRow: {
    alignItems: 'center',
    flexDirection: 'row',
    gap: 8,
    marginTop: 4,
  },
  company: {
    color: colors.textMuted,
    flex: 1,
    fontSize: 16,
    lineHeight: 24,
  },
  avatar: {
    borderColor: colors.surface,
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
    backgroundColor: colors.safetyBlue,
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
    color: colors.white,
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
    borderColor: colors.borderSubtle,
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
    color: colors.textMuted,
    fontSize: 11,
    fontWeight: '500',
    letterSpacing: 0,
    lineHeight: 14,
  },
  statValue: {
    color: colors.text,
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
    color: colors.textMuted,
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
  viewAllRow: {
    alignItems: 'center',
    flexDirection: 'row',
    gap: 4,
  },
  feed: {
    backgroundColor: colors.surface,
    borderColor: colors.outlineVariant,
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
    borderBottomColor: colors.outlineVariant,
    borderBottomWidth: 1,
  },
  thumbnail: {
    backgroundColor: colors.surfaceContainer,
    borderRadius: 8,
    height: 48,
    width: 48,
  },
  pendingThumbnail: {
    alignItems: 'center',
    backgroundColor: colors.surfaceContainer,
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
    color: colors.text,
    flex: 1,
    fontSize: 16,
    lineHeight: 24,
  },
  time: {
    color: colors.textMuted,
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
    backgroundColor: colors.chipGreen,
  },
  unsafeChip: {
    backgroundColor: colors.chipRed,
  },
  reviewChip: {
    backgroundColor: colors.chipReview,
  },
  statusText: {
    fontSize: 11,
    fontWeight: '500',
    lineHeight: 14,
  },
  safeText: {
    color: colors.successGreen,
  },
  unsafeText: {
    color: colors.error,
  },
  reviewText: {
    color: colors.tertiaryContainer,
  },
  chevron: {
    height: 22,
    width: 22,
  },
  bottomNav: {
    alignItems: 'center',
    backgroundColor: colors.surface,
    borderTopColor: colors.outlineVariant,
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
    shadowOffset: { height: -2, width: 0 },
    shadowOpacity: 0.12,
    shadowRadius: 8,
  },
  navItemActive: {
    alignItems: 'center',
    backgroundColor: colors.secondaryContainer,
    borderRadius: 999,
    justifyContent: 'center',
    minWidth: 84,
    paddingHorizontal: 16,
    paddingVertical: 4,
    transform: [{ scale: 0.95 }],
  },
  navItem: {
    alignItems: 'center',
    justifyContent: 'center',
    minWidth: 72,
    paddingHorizontal: 16,
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
    color: colors.textMuted,
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
