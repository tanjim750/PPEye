import { useCallback, useState } from 'react';
import { useFocusEffect, useRouter } from 'expo-router';
import { Pressable, RefreshControl, ScrollView, StyleSheet, Text, View } from 'react-native';
import { SafeAreaView, useSafeAreaInsets } from 'react-native-safe-area-context';
import { useTranslation } from 'react-i18next';

import { Icon } from '@/components/ui/Icon';
import { formatReviewTime, ReviewItem, useReviews } from '@/features/reviews/services/reviews.service';
import { InProgressLimitModal } from '@/features/reviews/components/InProgressLimitModal';

const reviewerColors = {
  background: '#f9f9ff',
  chipOrange: 'rgba(152, 67, 0, 0.1)',
  outlineVariant: '#c0c7d5',
  primary: '#005cad',
  primaryFixed: '#d5e3ff',
  surface: '#ffffff',
  surfaceContainerHigh: '#e5e8f1',
  text: '#181c22',
  textMuted: '#404753',
  warningOrange: '#984300',
  white: '#ffffff',
};

export function ReviewQueueScreen() {
  const router = useRouter();
  const insets = useSafeAreaInsets();
  const { t } = useTranslation('home');
  const { pendingReviews, inProgressCount, syncReviewsFromSupabase } = useReviews();
  const [isRefreshing, setIsRefreshing] = useState(false);
  const [isInProgressLimitModalVisible, setIsInProgressLimitModalVisible] = useState(false);

  const handleItemPress = useCallback(
    (item: ReviewItem) => {
      if (inProgressCount >= 3 && !item.isDraft) {
        setIsInProgressLimitModalVisible(true);
        return;
      }
      router.push(`/review/${item.id}` as any);
    },
    [inProgressCount, router]
  );

  useFocusEffect(
    useCallback(() => {
      syncReviewsFromSupabase();
    }, [syncReviewsFromSupabase])
  );

  const handleRefresh = useCallback(async () => {
    setIsRefreshing(true);
    await syncReviewsFromSupabase();
    setIsRefreshing(false);
  }, [syncReviewsFromSupabase]);

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
              color={reviewerColors.primary}
              name={{ ios: 'arrow.left', android: 'arrow_back', web: 'arrow_back' }}
              size={22}
            />
          </Pressable>
          <Text style={styles.headerTitle}>Reviewes Pending</Text>
          <View style={styles.headerPlaceholder} />
        </View>

        {/* Pending Reviews Feed with Floating Counter */}
        <ScrollView
          contentContainerStyle={styles.scrollContent}
          showsVerticalScrollIndicator={false}
          style={styles.scroll}
          refreshControl={
            <RefreshControl
              refreshing={isRefreshing}
              onRefresh={handleRefresh}
              tintColor="#005cad"
            />
          }>
          {/* Floating Pill Counter Badge */}
          {pendingReviews.length > 0 && (
            <View style={styles.floatingBadgeContainer}>
              <View style={styles.floatingBadge}>
                <Icon
                  color={reviewerColors.warningOrange}
                  name={{ ios: 'clock.fill', android: 'schedule', web: 'schedule' }}
                  size={14}
                />
                <Text style={styles.floatingBadgeText}>
                  {t('internal.waitingCount', {
                    count: pendingReviews.length,
                    defaultValue: `${pendingReviews.length} waiting for review`,
                  })}
                </Text>
              </View>
            </View>
          )}

          {pendingReviews.length === 0 ? (
            <View style={styles.emptyState}>
              <Icon
                color={reviewerColors.outlineVariant}
                name={{ ios: 'checkmark.circle', android: 'check_circle', web: 'check_circle' }}
                size={48}
              />
              <Text style={styles.emptyTitle}>All Caught Up!</Text>
              <Text style={styles.emptySubtitle}>No pending reviews in the queue.</Text>
            </View>
          ) : (
            <View style={styles.feed}>
              {pendingReviews.map((item, index) => (
                <Pressable
                  accessibilityRole="button"
                  key={item.id}
                  onPress={() => handleItemPress(item)}
                  style={({ pressed }) => [
                    styles.feedRow,
                    index < pendingReviews.length - 1 && styles.feedDivider,
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
                        <View style={{ flexDirection: 'row', alignItems: 'center', gap: 6 }}>
                          <Text style={styles.vendor}>{item.vendor}</Text>
                          {item.isDraft && (
                            <View style={styles.draftBadge}>
                              <Icon
                                color="#005cad"
                                name={{ ios: 'pencil', android: 'edit', web: 'edit' }}
                                size={10}
                              />
                              <Text style={styles.draftBadgeText}>In Progress</Text>
                            </View>
                          )}
                        </View>
                        <Text style={styles.teamLead}>
                          {item.teamLeadKey
                            ? t(`internal.reviewItems.${item.teamLeadKey}`, {
                                count: item.workers,
                                defaultValue: item.teamLead,
                              })
                            : item.teamLead}
                        </Text>
                      </View>
                    </View>
                    <Text style={styles.time}>
                      {formatReviewTime(item)}
                    </Text>
                  </View>

                  <View style={styles.detailBlock}>
                    <Text style={styles.location}>
                      {item.location} ·{' '}
                      {t('internal.reviewItems.workersPhotos', {
                        photos: item.workers * 2,
                        workers: item.workers,
                        defaultValue: `${item.workers} workers · ${item.workers * 2} PPE photos`,
                      })}
                    </Text>
                    {item.isDraft ? (
                      <View style={[styles.statusChip, styles.inProgressChip]}>
                        <Icon
                          color="#005cad"
                          name={{ ios: 'clock.arrow.circlepath', android: 'pending', web: 'pending' }}
                          size={14}
                        />
                        <Text style={[styles.statusText, styles.inProgressText]}>
                          {item.workerReviews && item.workerReviews.length > 0
                            ? `In Progress · ${item.workerReviews.length} of ${item.workers} reviewed`
                            : `Review Started · 0 of ${item.workers}`}
                        </Text>
                      </View>
                    ) : (
                      <View style={[styles.statusChip, styles.waitingChip]}>
                        <Icon
                          color={reviewerColors.warningOrange}
                          name={{ ios: 'clock', android: 'schedule', web: 'schedule' }}
                          size={14}
                        />
                        <Text style={[styles.statusText, styles.waitingText]}>
                          {t('internal.statuses.waiting', { defaultValue: 'Waiting for review' })}
                        </Text>
                      </View>
                    )}
                  </View>
                </Pressable>
              ))}
            </View>
          )}
        </ScrollView>

        {/* Bottom Navigation */}
        <View
          style={[
            styles.bottomNav,
            {
              paddingBottom: Math.max(insets.bottom, 10),
              height: 56 + Math.max(insets.bottom, 10),
            },
          ]}>
          <Pressable
            accessibilityRole="button"
            onPress={() => router.push('/' as any)}
            style={({ pressed }) => [styles.navItem, pressed && styles.navPressed]}>
            <Icon
              color={reviewerColors.textMuted}
              name={{ ios: 'house', android: 'home', web: 'home' }}
              size={20}
            />
            <Text style={styles.navText}>{t('internal.bottomNav.home', { defaultValue: 'Home' })}</Text>
          </Pressable>
          <Pressable accessibilityRole="button" style={styles.navItemActive}>
            <Icon
              color="#00376f"
              name={{ ios: 'clock.fill', android: 'schedule', web: 'schedule' }}
              size={20}
              weight="bold"
            />
            <Text style={styles.navTextActive}>
              {t('internal.bottomNav.reviews', { defaultValue: 'Pendings' })}
            </Text>
          </Pressable>
          <Pressable
            accessibilityRole="button"
            onPress={() => router.push('/history' as any)}
            style={({ pressed }) => [styles.navItem, pressed && styles.navPressed]}>
            <Icon
              color={reviewerColors.textMuted}
              name={{ ios: 'checklist', android: 'checklist', web: 'checklist' }}
              size={20}
            />
            <Text style={styles.navText}>
              {t('internal.bottomNav.history', { defaultValue: 'Reviews' })}
            </Text>
          </Pressable>
          <Pressable
            accessibilityRole="button"
            onPress={() => router.push('/settings?role=reviewer' as any)}
            style={({ pressed }) => [styles.navItem, pressed && styles.navPressed]}>
            <Icon
              color={reviewerColors.textMuted}
              name={{ ios: 'gear', android: 'settings', web: 'settings' }}
              size={20}
            />
            <Text style={styles.navText}>
              {t('internal.bottomNav.settings', { defaultValue: 'Settings' })}
            </Text>
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

const styles = StyleSheet.create({
  safeArea: {
    backgroundColor: reviewerColors.background,
    flex: 1,
  },
  shell: {
    backgroundColor: reviewerColors.background,
    flex: 1,
    maxWidth: 448,
    width: '100%',
    alignSelf: 'center',
  },
  header: {
    alignItems: 'center',
    backgroundColor: reviewerColors.surface,
    borderBottomColor: reviewerColors.outlineVariant,
    borderBottomWidth: 1,
    flexDirection: 'row',
    height: 56,
    justifyContent: 'space-between',
    paddingHorizontal: 16,
  },
  backButton: {
    padding: 6,
    marginLeft: -6,
  },
  pressedOpacity: {
    opacity: 0.7,
  },
  headerTitle: {
    color: reviewerColors.text,
    fontSize: 18,
    fontWeight: '700',
  },
  headerPlaceholder: {
    width: 32,
  },
  floatingBadgeContainer: {
    alignItems: 'center',
    marginBottom: 16,
  },
  floatingBadge: {
    alignItems: 'center',
    backgroundColor: '#ffffff',
    borderColor: 'rgba(152, 67, 0, 0.2)',
    borderRadius: 999,
    borderWidth: 1,
    elevation: 3,
    flexDirection: 'row',
    gap: 8,
    paddingHorizontal: 16,
    paddingVertical: 7,
    shadowColor: '#000',
    shadowOffset: { width: 0, height: 2 },
    shadowOpacity: 0.08,
    shadowRadius: 6,
  },
  floatingBadgeText: {
    color: reviewerColors.warningOrange,
    fontSize: 12,
    fontWeight: '600',
    letterSpacing: 0.2,
  },
  scroll: {
    flex: 1,
  },
  scrollContent: {
    padding: 20,
    paddingBottom: 80,
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
  pressed: {
    backgroundColor: '#f1f3fd',
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
  inProgressChip: {
    backgroundColor: '#eff6ff',
    borderColor: 'rgba(0, 92, 173, 0.25)',
    borderWidth: 1,
  },
  statusText: {
    fontSize: 11,
    fontWeight: '500',
    lineHeight: 14,
  },
  waitingText: {
    color: reviewerColors.warningOrange,
  },
  inProgressText: {
    color: '#005cad',
    fontWeight: '600',
  },
  draftBadge: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 3,
    backgroundColor: '#eff6ff',
    borderColor: 'rgba(0, 92, 173, 0.25)',
    borderWidth: 1,
    borderRadius: 6,
    paddingHorizontal: 6,
    paddingVertical: 2,
  },
  draftBadgeText: {
    color: '#005cad',
    fontSize: 10,
    fontWeight: '700',
  },
  emptyState: {
    alignItems: 'center',
    justifyContent: 'center',
    paddingVertical: 60,
  },
  emptyTitle: {
    color: reviewerColors.text,
    fontSize: 18,
    fontWeight: '700',
    marginTop: 12,
  },
  emptySubtitle: {
    color: reviewerColors.textMuted,
    fontSize: 14,
    marginTop: 4,
  },
  bottomNav: {
    backgroundColor: 'rgba(255, 255, 255, 0.95)',
    borderTopColor: reviewerColors.outlineVariant,
    borderTopWidth: 1,
    flexDirection: 'row',
    justifyContent: 'space-around',
    alignItems: 'center',
    paddingHorizontal: 8,
  },
  navItem: {
    alignItems: 'center',
    flex: 1,
    justifyContent: 'center',
    marginHorizontal: 2,
    paddingVertical: 4,
  },
  navPressed: {
    transform: [{ scale: 0.9 }],
  },
  navItemActive: {
    alignItems: 'center',
    backgroundColor: '#64a1fe',
    borderRadius: 999,
    flex: 1,
    justifyContent: 'center',
    marginHorizontal: 2,
    paddingVertical: 4,
  },
  navText: {
    color: reviewerColors.textMuted,
    fontSize: 12,
    fontWeight: '600',
    lineHeight: 16,
    marginTop: 2,
  },
  navTextActive: {
    color: '#00376f',
    fontSize: 12,
    fontWeight: '600',
    lineHeight: 16,
    marginTop: 2,
  },
});

export default ReviewQueueScreen;
