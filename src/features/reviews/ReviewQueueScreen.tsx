import { useRouter } from 'expo-router';
import { Pressable, ScrollView, StyleSheet, Text, View } from 'react-native';
import { SafeAreaView } from 'react-native-safe-area-context';
import { useTranslation } from 'react-i18next';

import { Icon } from '@/components/ui/Icon';
import { formatReviewTime, useReviews } from '@/features/reviews/services/reviews.service';

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
  const { t } = useTranslation('home');
  const { pendingReviews } = useReviews();

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
          style={styles.scroll}>
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
                  onPress={() => router.push(`/review/${item.id}` as any)}
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
                        <Text style={styles.vendor}>{item.vendor}</Text>
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
                        photos: item.photos,
                        workers: item.workers,
                        defaultValue: `${item.workers} workers · ${item.photos} PPE photos`,
                      })}
                    </Text>
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
                  </View>
                </Pressable>
              ))}
            </View>
          )}
        </ScrollView>

        {/* Bottom Navigation */}
        <View style={styles.bottomNav}>
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
  statusText: {
    fontSize: 11,
    fontWeight: '500',
    lineHeight: 14,
  },
  waitingText: {
    color: reviewerColors.warningOrange,
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
    height: 64,
    justifyContent: 'space-around',
    alignItems: 'center',
    paddingHorizontal: 12,
  },
  navItem: {
    alignItems: 'center',
    justifyContent: 'center',
    paddingVertical: 4,
  },
  navPressed: {
    transform: [{ scale: 0.9 }],
  },
  navItemActive: {
    alignItems: 'center',
    backgroundColor: '#64a1fe',
    borderRadius: 999,
    justifyContent: 'center',
    paddingHorizontal: 20,
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
