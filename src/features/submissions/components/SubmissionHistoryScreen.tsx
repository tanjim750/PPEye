import { useLocalSearchParams, useRouter } from 'expo-router';
import { Image } from 'expo-image';
import { useEffect, useState } from 'react';
import { Pressable, ScrollView, StyleSheet, Text, View } from 'react-native';
import { SafeAreaView } from 'react-native-safe-area-context';
import { useTranslation } from 'react-i18next';

import { Icon } from '@/components/ui/Icon';
import { formatWorkerCheckTime, useWorkerChecks } from '@/features/submissions/services/workerChecks.service';

type HistoryTab = 'all' | 'pending' | 'unsafe';

export function SubmissionHistoryScreen() {
  const router = useRouter();
  const params = useLocalSearchParams<{ filter?: string }>();
  const { t } = useTranslation('home');
  const { safeChecks, pendingChecks, unsafeChecks, resubmitWorkerCheck } = useWorkerChecks();

  // Tabs: "all" (safe workers), "pending" (awaiting review), "unsafe" (action required)
  const initialTab: HistoryTab =
    params.filter === 'pending'
      ? 'pending'
      : params.filter === 'unsafe'
        ? 'unsafe'
        : 'all';
  const [activeTab, setActiveTab] = useState<HistoryTab>(initialTab);

  useEffect(() => {
    if (params.filter === 'pending') {
      setActiveTab('pending');
    } else if (params.filter === 'unsafe') {
      setActiveTab('unsafe');
    } else {
      setActiveTab('all');
    }
  }, [params.filter]);

  // Both lists are sorted chronologically (latest time first)
  const displayedList =
    activeTab === 'all'
      ? safeChecks
      : activeTab === 'pending'
        ? pendingChecks
        : unsafeChecks;

  return (
    <SafeAreaView style={styles.safeArea}>
      <View style={styles.shell}>
        {/* Header */}
        <View style={styles.header}>
          <Pressable
            accessibilityLabel="Go back"
            accessibilityRole="button"
            onPress={() => router.back()}
            style={({ pressed }) => [styles.backButton, pressed && styles.pressedOpacity]}>
            <Icon
              color={colors.primary}
              name={{ ios: 'arrow.left', android: 'arrow_back', web: 'arrow_back' }}
              size={22}
            />
          </Pressable>
          <Text style={styles.headerTitle}>{t('external.history.title', { defaultValue: 'History' })}</Text>
          <View style={styles.headerPlaceholder} />
        </View>

        {/* Tab Segment Controls: "All History", "All pending", and "All Unsafe" */}
        <View style={styles.tabContainer}>
          <Pressable
            accessibilityRole="button"
            onPress={() => setActiveTab('all')}
            style={[styles.tabButton, activeTab === 'all' && styles.tabButtonActive]}>
            <Text style={[styles.tabButtonText, activeTab === 'all' && styles.tabButtonTextActive]}>
              {t('external.history.allTab', { defaultValue: 'All History' })}
            </Text>
          </Pressable>

          <Pressable
            accessibilityRole="button"
            onPress={() => setActiveTab('pending')}
            style={[styles.tabButton, activeTab === 'pending' && styles.tabButtonActive]}>
            <Text
              style={[
                styles.tabButtonText,
                activeTab === 'pending' && styles.tabButtonTextActive,
              ]}>
              {t('external.history.pendingTab', { defaultValue: 'All pending' })}
            </Text>
          </Pressable>

          <Pressable
            accessibilityRole="button"
            onPress={() => setActiveTab('unsafe')}
            style={[styles.tabButton, activeTab === 'unsafe' && styles.tabButtonActive]}>
            <Text
              style={[
                styles.tabButtonText,
                activeTab === 'unsafe' && styles.tabButtonTextActive,
              ]}>
              {t('external.history.unsafeTab', { defaultValue: 'All Unsafe' })}
            </Text>
          </Pressable>
        </View>

        {/* Floating Counter Badge for Pending Checks (matches Reviewer floating pill) */}
        {activeTab === 'pending' && pendingChecks.length > 0 && (
          <View style={styles.floatingBadgeContainer}>
            <View style={styles.floatingBadge}>
              <Icon
                color="#f59e0b"
                name={{ ios: 'clock.fill', android: 'schedule', web: 'schedule' }}
                size={14}
                weight="bold"
              />
              <Text style={styles.floatingBadgeText}>
                {t('external.history.waitingCount', {
                  count: pendingChecks.length,
                  defaultValue: `${pendingChecks.length} waiting for review`,
                })}
              </Text>
            </View>
          </View>
        )}

        {/* Worker Cards Feed (Sorted chronologically by time) */}
        <ScrollView
          contentContainerStyle={styles.scrollContent}
          showsVerticalScrollIndicator={false}
          style={styles.scroll}>
          {displayedList.length === 0 ? (
            <View style={styles.emptyContainer}>
              <Icon
                color={colors.outlineVariant}
                name={{ ios: 'tray', android: 'inbox', web: 'inbox' }}
                size={42}
              />
              <Text style={styles.emptyText}>
                {activeTab === 'all'
                  ? t('external.history.noSafe', { defaultValue: 'No safe records found' })
                  : activeTab === 'pending'
                    ? t('external.history.noPending', { defaultValue: 'No pending submissions' })
                    : t('external.history.noUnsafe', { defaultValue: 'No unsafe records found' })}
              </Text>
            </View>
          ) : (
            <View style={styles.feed}>
              {displayedList.map((item, index) => {
                const isSafe = item.status === 'safe';
                const statusLabel = t(`external.statuses.${item.status}`);

                return (
                  <Pressable
                    accessibilityRole="button"
                    accessibilityState={{ disabled: isSafe }}
                    disabled={isSafe}
                    key={item.id}
                    onPress={
                      !isSafe && item.status === 'unsafe'
                        ? () => router.push(`/submission-details?id=${item.id}` as any)
                        : undefined
                    }
                    style={({ pressed }) => [
                      styles.feedRow,
                      index < displayedList.length - 1 && styles.feedDivider,
                      pressed && !isSafe && styles.pressed,
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
                          {t(`external.recent.${item.titleKey}`, {
                            defaultValue: `Worker #${item.workerNumber}`,
                          })}
                        </Text>
                        <Text style={styles.time}>
                          {formatWorkerCheckTime(item.timeKey, t)}
                        </Text>
                      </View>

                      <View style={styles.metaRow}>
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

                        {isSafe ? (
                          <Text style={styles.badgeHint}>
                            {t('external.history.approvedByEhs')}
                          </Text>
                        ) : null}
                      </View>
                    </View>
                  </Pressable>
                );
              })}
            </View>
          )}
        </ScrollView>

        {/* Bottom Navigation */}
        <View style={styles.bottomNav}>
          <Pressable
            accessibilityRole="button"
            onPress={() => router.replace('/' as any)}
            style={({ pressed }) => [styles.navItem, pressed && styles.navPressed]}>
            <Icon
              color={colors.textMuted}
              name={{ ios: 'house', android: 'home', web: 'home' }}
              size={20}
            />
            <Text style={styles.navText}>{t('external.bottomNav.home')}</Text>
          </Pressable>

          <Pressable accessibilityRole="button" style={styles.navItemActive}>
            <Icon
              color="#00376f"
              name={{ ios: 'clock.arrow.circlepath', android: 'history', web: 'history' }}
              size={20}
              weight="bold"
            />
            <Text style={styles.navTextActive}>{t('external.bottomNav.history')}</Text>
          </Pressable>

          <Pressable
            accessibilityRole="button"
            onPress={() => router.push('/settings' as any)}
            style={({ pressed }) => [styles.navItem, pressed && styles.navPressed]}>
            <Icon
              color={colors.textMuted}
              name={{ ios: 'gear', android: 'settings', web: 'settings' }}
              size={20}
            />
            <Text style={styles.navText}>{t('external.bottomNav.settings')}</Text>
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
  surface: '#ffffff',
  surfaceContainer: '#ebedf7',
  tertiaryContainer: '#be5600',
  text: '#181c22',
  textMuted: '#555e6d',
  white: '#ffffff',
};

const styles = StyleSheet.create({
  safeArea: {
    backgroundColor: colors.background,
    flex: 1,
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
    alignItems: 'center',
    backgroundColor: colors.surface,
    borderBottomColor: colors.outlineVariant,
    borderBottomWidth: 1,
    flexDirection: 'row',
    height: 56,
    justifyContent: 'space-between',
    paddingHorizontal: 16,
  },
  backButton: {
    alignItems: 'center',
    height: 40,
    justifyContent: 'center',
    width: 40,
  },
  headerTitle: {
    color: colors.text,
    fontSize: 18,
    fontWeight: '700',
    textAlign: 'center',
  },
  headerPlaceholder: {
    height: 40,
    width: 40,
  },
  tabContainer: {
    backgroundColor: '#ebedf7',
    borderColor: '#d8dce6',
    borderRadius: 12,
    borderWidth: 1,
    flexDirection: 'row',
    gap: 6,
    marginHorizontal: 16,
    marginTop: 12,
    marginBottom: 8,
    padding: 4,
  },
  tabButton: {
    alignItems: 'center',
    borderRadius: 8,
    flex: 1,
    flexDirection: 'row',
    justifyContent: 'center',
    paddingVertical: 10,
  },
  tabButtonActive: {
    backgroundColor: colors.primary,
    shadowColor: '#000000',
    shadowOffset: { height: 1, width: 0 },
    shadowOpacity: 0.1,
    shadowRadius: 3,
  },
  tabButtonText: {
    color: colors.textMuted,
    fontSize: 13,
    fontWeight: '700',
    letterSpacing: 0.1,
  },
  tabButtonTextActive: {
    color: colors.white,
  },
  floatingBadgeContainer: {
    alignItems: 'center',
    marginHorizontal: 16,
    marginTop: 2,
    marginBottom: 8,
  },
  floatingBadge: {
    alignItems: 'center',
    backgroundColor: '#fffbeb',
    borderColor: '#fde68a',
    borderRadius: 20,
    borderWidth: 1,
    flexDirection: 'row',
    gap: 6,
    paddingHorizontal: 12,
    paddingVertical: 5,
    shadowColor: '#000000',
    shadowOffset: { height: 1, width: 0 },
    shadowOpacity: 0.08,
    shadowRadius: 3,
    elevation: 2,
  },
  floatingBadgeText: {
    color: '#b45309',
    fontSize: 12,
    fontWeight: '700',
  },
  resubmitButton: {
    alignItems: 'center',
    backgroundColor: '#ebedf7',
    borderColor: '#c0c7d5',
    borderRadius: 14,
    borderWidth: 1,
    flexDirection: 'row',
    gap: 4,
    marginLeft: 'auto',
    paddingHorizontal: 10,
    paddingVertical: 4,
  },
  resubmitButtonText: {
    color: '#00376f',
    fontSize: 11,
    fontWeight: '700',
  },
  scroll: {
    flex: 1,
  },
  scrollContent: {
    paddingBottom: 24,
    paddingHorizontal: 16,
    paddingTop: 8,
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
    gap: 6,
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
    fontWeight: '600',
    lineHeight: 22,
  },
  time: {
    color: colors.textMuted,
    fontSize: 12,
    fontWeight: '500',
    lineHeight: 16,
  },
  metaRow: {
    alignItems: 'center',
    flexDirection: 'row',
    gap: 8,
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
    fontWeight: '600',
    lineHeight: 16,
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
  badgeHint: {
    color: colors.textMuted,
    fontSize: 11,
    fontWeight: '500',
  },
  emptyContainer: {
    alignItems: 'center',
    justifyContent: 'center',
    paddingVertical: 64,
  },
  emptyText: {
    color: colors.textMuted,
    fontSize: 14,
    marginTop: 12,
  },
  bottomNav: {
    alignItems: 'center',
    backgroundColor: '#ffffff',
    borderTopColor: colors.outlineVariant,
    borderTopWidth: 1,
    flexDirection: 'row',
    height: 70,
    justifyContent: 'space-around',
    paddingHorizontal: 12,
    shadowColor: '#000000',
    shadowOffset: { height: -2, width: 0 },
    shadowOpacity: 0.12,
    shadowRadius: 8,
    elevation: 8,
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
    paddingHorizontal: 12,
    paddingVertical: 6,
  },
  navText: {
    color: colors.textMuted,
    fontSize: 10,
    fontWeight: '700',
    marginTop: 2,
  },
  navTextActive: {
    color: '#00376f',
    fontSize: 10,
    fontWeight: '700',
    marginTop: 2,
  },
  navPressed: {
    opacity: 0.7,
  },
  pressed: {
    backgroundColor: 'rgba(0, 0, 0, 0.04)',
  },
  pressedOpacity: {
    opacity: 0.7,
  },
});

export default SubmissionHistoryScreen;
