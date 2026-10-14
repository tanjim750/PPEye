import { useLocalSearchParams, useRouter } from 'expo-router';
import { Image } from 'expo-image';
import { useEffect, useState } from 'react';
import { Pressable, ScrollView, StyleSheet, Text, View } from 'react-native';
import { SafeAreaView } from 'react-native-safe-area-context';
import { useTranslation } from 'react-i18next';

import { Icon } from '@/components/ui/Icon';
import { useWorkerChecks } from '@/features/submissions/services/workerChecks.service';

export function SubmissionHistoryScreen() {
  const router = useRouter();
  const params = useLocalSearchParams<{ filter?: string }>();
  const { t } = useTranslation('home');
  const { safeChecks, pendingChecks } = useWorkerChecks();

  // "ALL" tab shows safe workers; "Pending" tab shows pending review workers
  const initialTab = params.filter === 'pending' ? 'pending' : 'all';
  const [activeTab, setActiveTab] = useState<'all' | 'pending'>(initialTab);

  useEffect(() => {
    if (params.filter === 'pending') {
      setActiveTab('pending');
    } else {
      setActiveTab('all');
    }
  }, [params.filter]);

  // Both lists are sorted chronologically (latest time first)
  const displayedList = activeTab === 'all' ? safeChecks : pendingChecks;

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

        {/* Tab Segment Controls: "All History" and "All pending" */}
        <View style={styles.tabContainer}>
          <Pressable
            accessibilityRole="button"
            onPress={() => setActiveTab('all')}
            style={[styles.tabButton, activeTab === 'all' && styles.tabButtonActive]}>
            <Text style={[styles.tabButtonText, activeTab === 'all' && styles.tabButtonTextActive]}>
              {t('external.history.allTab', { defaultValue: 'All History' })}
            </Text>
            <View style={[styles.tabBadge, activeTab === 'all' && styles.tabBadgeActive]}>
              <Text
                style={[
                  styles.tabBadgeText,
                  activeTab === 'all' && styles.tabBadgeTextActive,
                ]}>
                {safeChecks.length}
              </Text>
            </View>
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
            <View style={[styles.tabBadge, activeTab === 'pending' && styles.tabBadgeActive]}>
              <Text
                style={[
                  styles.tabBadgeText,
                  activeTab === 'pending' && styles.tabBadgeTextActive,
                ]}>
                {pendingChecks.length}
              </Text>
            </View>
          </Pressable>
        </View>

        {/* Info & Sorting Subtitle */}
        <View style={styles.infoBanner}>
          <Icon
            color={colors.textMuted}
            name={{ ios: 'arrow.up.arrow.down', android: 'sort', web: 'sort' }}
            size={14}
          />
          <Text style={styles.infoText}>
            {activeTab === 'all'
              ? t('external.history.safeSub')
              : t('external.history.pendingSub')}
          </Text>
        </View>

        {/* Worker Cards Feed (Sorted by time) */}
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
                  ? t('external.history.noSafe')
                  : t('external.history.noPending')}
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
                        ? () => router.push('/submission-details')
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
                          {t(`external.recent.${item.timeKey}`, { defaultValue: item.timeKey })}
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
    padding: 4,
  },
  tabButton: {
    alignItems: 'center',
    borderRadius: 8,
    flex: 1,
    flexDirection: 'row',
    gap: 8,
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
    fontSize: 14,
    fontWeight: '700',
    letterSpacing: 0.2,
  },
  tabButtonTextActive: {
    color: colors.white,
  },
  tabBadge: {
    backgroundColor: '#dbe0ea',
    borderRadius: 10,
    paddingHorizontal: 8,
    paddingVertical: 2,
  },
  tabBadgeActive: {
    backgroundColor: 'rgba(255, 255, 255, 0.25)',
  },
  tabBadgeText: {
    color: colors.textMuted,
    fontSize: 12,
    fontWeight: '700',
  },
  tabBadgeTextActive: {
    color: colors.white,
  },
  infoBanner: {
    alignItems: 'center',
    flexDirection: 'row',
    gap: 6,
    marginHorizontal: 16,
    marginTop: 10,
    marginBottom: 4,
  },
  infoText: {
    color: colors.textMuted,
    fontSize: 12,
    fontWeight: '500',
    lineHeight: 16,
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
    backgroundColor: colors.surface,
    borderTopColor: colors.outlineVariant,
    borderTopWidth: 1,
    flexDirection: 'row',
    height: 70,
    justifyContent: 'space-around',
    paddingBottom: 8,
    paddingTop: 8,
  },
  navItem: {
    alignItems: 'center',
    flex: 1,
    gap: 4,
    justifyContent: 'center',
    paddingVertical: 4,
  },
  navItemActive: {
    alignItems: 'center',
    flex: 1,
    gap: 4,
    justifyContent: 'center',
    paddingVertical: 4,
  },
  navText: {
    color: colors.textMuted,
    fontSize: 12,
    fontWeight: '500',
  },
  navTextActive: {
    color: '#00376f',
    fontSize: 12,
    fontWeight: '700',
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
