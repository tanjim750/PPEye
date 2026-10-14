import { useRouter } from 'expo-router';
import { Image } from 'expo-image';
import { useRef, useState } from 'react';
import {
  Animated,
  Modal,
  PanResponder,
  Pressable,
  ScrollView,
  StyleSheet,
  Text,
  View,
} from 'react-native';
import { SafeAreaView, useSafeAreaInsets } from 'react-native-safe-area-context';
import { useTranslation } from 'react-i18next';

import { Icon } from '@/components/ui/Icon';
import { assets } from '@/constants/assets';
import {
  formatReviewTime,
  ReviewItem,
  unsafeReasonLabels,
  useReviews,
} from '@/features/reviews/services/reviews.service';

const reviewerColors = {
  background: '#f9f9ff',
  card: '#ffffff',
  chipGreen: 'rgba(22, 163, 74, 0.1)',
  chipRed: 'rgba(186, 26, 26, 0.1)',
  errorRed: '#ba1a1a',
  outlineVariant: '#c0c7d5',
  primary: '#005cad',
  primaryFixed: '#d5e3ff',
  successGreen: '#16A34A',
  surface: '#ffffff',
  surfaceContainerHigh: '#e5e8f1',
  text: '#181c22',
  textMuted: '#404753',
  white: '#ffffff',
};

const reasonIcons: Record<string, { ios: string; android: string; web: string }> = {
  anchorage: { ios: 'anchor', android: 'anchor', web: 'anchor' },
  harness: { ios: 'figure.stand', android: 'accessibility_new', web: 'accessibility_new' },
  helmet: { ios: 'wrench.and.screwdriver', android: 'construction', web: 'construction' },
  lanyard: { ios: 'link', android: 'link', web: 'link' },
  other: { ios: 'ellipsis', android: 'more_horiz', web: 'more_horiz' },
  shoes: { ios: 'shoeprints.fill', android: 'directions_walk', web: 'directions_walk' },
};

export function ReviewHistoryScreen() {
  const router = useRouter();
  const insets = useSafeAreaInsets();
  const { t } = useTranslation('home');
  const { safeReviews, unsafeReviews } = useReviews();

  // 2 Tabs: "Safe reviewed" and "Unsafe reviewed"
  const [activeTab, setActiveTab] = useState<'safe' | 'unsafe'>('safe');
  const [selectedUnsafeItem, setSelectedUnsafeItem] = useState<ReviewItem | null>(null);

  const translateY = useRef(new Animated.Value(0)).current;

  function closeModal() {
    Animated.timing(translateY, {
      toValue: 600,
      duration: 180,
      useNativeDriver: true,
    }).start(() => {
      setSelectedUnsafeItem(null);
    });
  }

  const panResponder = useRef(
    PanResponder.create({
      onStartShouldSetPanResponder: () => true,
      onStartShouldSetPanResponderCapture: () => false,
      onMoveShouldSetPanResponder: (_, gestureState) => gestureState.dy > 1,
      onMoveShouldSetPanResponderCapture: (_, gestureState) => gestureState.dy > 1,
      onPanResponderMove: (_, gestureState) => {
        if (gestureState.dy > 0) {
          translateY.setValue(gestureState.dy);
        }
      },
      onPanResponderRelease: (_, gestureState) => {
        // Any downward drag or tap slides down and closes. NEVER bounce back!
        if (gestureState.dy >= 0 || gestureState.vy >= 0) {
          closeModal();
        } else {
          Animated.timing(translateY, {
            toValue: 0,
            duration: 80,
            useNativeDriver: true,
          }).start();
        }
      },
      onPanResponderTerminate: () => {
        closeModal();
      },
    })
  ).current;

  function openUnsafeModal(item: ReviewItem) {
    translateY.setValue(0);
    setSelectedUnsafeItem(item);
  }

  const displayedList = activeTab === 'safe' ? safeReviews : unsafeReviews;

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
          <Text style={styles.headerTitle}>Reviewes History</Text>
          <View style={styles.headerPlaceholder} />
        </View>

        {/* 2 Tabs Segment Controls: "Safe reviewed" and "Unsafe reviewed" */}
        <View style={styles.tabContainer}>
          <Pressable
            accessibilityRole="button"
            onPress={() => setActiveTab('safe')}
            style={[styles.tabButton, activeTab === 'safe' && styles.tabButtonActive]}>
            <Text style={[styles.tabButtonText, activeTab === 'safe' && styles.tabButtonTextActive]}>
              Safe reviewed
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
              Unsafe reviewed
            </Text>
          </Pressable>
        </View>

        {/* Reviews Feed List */}
        <ScrollView
          contentContainerStyle={styles.scrollContent}
          showsVerticalScrollIndicator={false}
          style={styles.scroll}>
          {displayedList.length === 0 ? (
            <View style={styles.emptyState}>
              <Icon
                color={reviewerColors.outlineVariant}
                name={{ ios: 'clock.arrow.circlepath', android: 'history', web: 'history' }}
                size={48}
              />
              <Text style={styles.emptyTitle}>
                {activeTab === 'safe' ? 'No Safe Reviews' : 'No Unsafe Reviews'}
              </Text>
              <Text style={styles.emptySubtitle}>
                {activeTab === 'safe'
                  ? 'Approved compliant submissions will appear here.'
                  : 'Submissions marked unsafe will appear here.'}
              </Text>
            </View>
          ) : (
            <View style={styles.feed}>
              {displayedList.map((item, index) => {
                const isUnsafe = item.status === 'unsafe';
                return (
                  <Pressable
                    accessibilityRole={isUnsafe ? 'button' : 'none'}
                    key={item.id}
                    onPress={() => {
                      if (isUnsafe) {
                        openUnsafeModal(item);
                      }
                    }}
                    style={({ pressed }) => [
                      styles.feedRow,
                      index < displayedList.length - 1 && styles.feedDivider,
                      isUnsafe && pressed && styles.feedRowPressed,
                    ]}>
                    <View style={styles.rowHeader}>
                      <View style={styles.identityRow}>
                        {item.avatar ? (
                          <View
                            style={[
                              styles.avatarPhoto,
                              isUnsafe && { backgroundColor: 'rgba(186, 26, 26, 0.15)' },
                            ]}>
                            <Text
                              style={[
                                styles.avatarPhotoText,
                                isUnsafe && { color: reviewerColors.errorRed },
                              ]}>
                              {item.avatar}
                            </Text>
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

                      {/* Status Chip */}
                      <View
                        style={[
                          styles.statusChip,
                          isUnsafe ? styles.unsafeChip : styles.reviewedChip,
                        ]}>
                        <Icon
                          color={isUnsafe ? reviewerColors.errorRed : reviewerColors.successGreen}
                          name={
                            isUnsafe
                              ? { ios: 'xmark.circle.fill', android: 'cancel', web: 'cancel' }
                              : {
                                  ios: 'checkmark.circle.fill',
                                  android: 'check_circle',
                                  web: 'check_circle',
                                }
                          }
                          size={14}
                        />
                        <Text
                          style={[
                            styles.statusText,
                            isUnsafe ? styles.unsafeText : styles.reviewedText,
                          ]}>
                          {isUnsafe ? 'Unsafe' : 'Reviewed'}
                        </Text>
                      </View>

                      {/* Violation Badges for Unsafe Tab */}
                      {isUnsafe && item.unsafeReasons && item.unsafeReasons.length > 0 && (
                        <View style={styles.reasonsListRow}>
                          {item.unsafeReasons.map((r) => (
                            <View key={r} style={styles.reasonTag}>
                              <Text style={styles.reasonTagText}>
                                {unsafeReasonLabels[r] || r}
                              </Text>
                            </View>
                          ))}
                          <Text style={styles.viewDetailsPrompt}>Tap to view details ›</Text>
                        </View>
                      )}
                    </View>
                  </Pressable>
                );
              })}
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
          <Pressable
            accessibilityRole="button"
            onPress={() => router.push('/reviews' as any)}
            style={({ pressed }) => [styles.navItem, pressed && styles.navPressed]}>
            <Icon
              color={reviewerColors.textMuted}
              name={{ ios: 'clock', android: 'schedule', web: 'schedule' }}
              size={20}
            />
            <Text style={styles.navText}>
              {t('internal.bottomNav.reviews', { defaultValue: 'Pendings' })}
            </Text>
          </Pressable>
          <Pressable accessibilityRole="button" style={styles.navItemActive}>
            <Icon
              color="#00376f"
              name={{ ios: 'checklist', android: 'checklist', web: 'checklist' }}
              size={20}
              weight="bold"
            />
            <Text style={styles.navTextActive}>
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

        {/* Unsafe Details Modal: Shows why reviewer marked it unsafe */}
        <Modal
          animationType="slide"
          onRequestClose={closeModal}
          transparent={true}
          visible={selectedUnsafeItem !== null}>
          <View style={detailsStyles.overlay}>
            <Pressable
              onPress={closeModal}
              style={detailsStyles.backdrop}
            />

            <Animated.View
              style={[
                detailsStyles.container,
                { transform: [{ translateY }] },
              ]}>
              {/* Drag Handle with PanResponder to pull down and dismiss */}
              <View
                {...panResponder.panHandlers}
                style={detailsStyles.dragHandleContainer}>
                <View style={detailsStyles.dragHandle} />
              </View>

              {/* Modal Header with PanResponder */}
              <View
                {...panResponder.panHandlers}
                style={detailsStyles.modalHeader}>
                <View>
                  <Text style={detailsStyles.modalTitle}>Unsafe Review Details</Text>
                  <Text style={detailsStyles.modalSubtitle}>
                    {selectedUnsafeItem?.vendor} • {selectedUnsafeItem?.teamLead}
                  </Text>
                </View>
                <Pressable
                  accessibilityLabel="Close"
                  accessibilityRole="button"
                  onPress={closeModal}
                  style={detailsStyles.closeButton}>
                  <Icon
                    color={reviewerColors.textMuted}
                    name={{ ios: 'xmark', android: 'close', web: 'close' }}
                    size={20}
                  />
                </Pressable>
              </View>

              <ScrollView
                contentContainerStyle={detailsStyles.scrollContent}
                showsVerticalScrollIndicator={false}>
                {/* Alert Badge */}
                <View style={detailsStyles.alertBanner}>
                  <Icon
                    color={reviewerColors.errorRed}
                    name={{ ios: 'exclamationmark.triangle.fill', android: 'warning', web: 'warning' }}
                    size={20}
                  />
                  <View style={detailsStyles.alertTextContainer}>
                    <Text style={detailsStyles.alertTitle}>Marked as UNSAFE by Reviewer</Text>
                    <Text style={detailsStyles.alertLocation}>
                      {selectedUnsafeItem?.location} • {selectedUnsafeItem ? formatReviewTime(selectedUnsafeItem) : ''}
                    </Text>
                  </View>
                </View>

                {/* Reasons Section */}
                <View style={detailsStyles.section}>
                  <Text style={detailsStyles.sectionTitle}>IDENTIFIED PPE VIOLATIONS</Text>
                  <View style={detailsStyles.reasonsGrid}>
                    {selectedUnsafeItem?.unsafeReasons &&
                    selectedUnsafeItem.unsafeReasons.length > 0 ? (
                      selectedUnsafeItem.unsafeReasons.map((r) => {
                        const iconConfig = reasonIcons[r] || reasonIcons.other;
                        return (
                          <View key={r} style={detailsStyles.reasonItem}>
                            <View style={detailsStyles.reasonIconBox}>
                              <Icon
                                color={reviewerColors.errorRed}
                                name={iconConfig as any}
                                size={18}
                              />
                            </View>
                            <Text style={detailsStyles.reasonItemText}>
                              {unsafeReasonLabels[r] || r}
                            </Text>
                          </View>
                        );
                      })
                    ) : (
                      <Text style={detailsStyles.noReasonsText}>
                        PPE non-compliance identified during visual inspection.
                      </Text>
                    )}
                  </View>
                </View>

                {/* Other reason note if present */}
                {selectedUnsafeItem?.otherReasonText ? (
                  <View style={detailsStyles.section}>
                    <Text style={detailsStyles.sectionTitle}>REVIEWER NOTE / DESCRIPTION</Text>
                    <View style={detailsStyles.notesBox}>
                      <Text style={detailsStyles.notesText}>
                        "{selectedUnsafeItem.otherReasonText}"
                      </Text>
                    </View>
                  </View>
                ) : null}

                {/* Inspection Photos Preview */}
                <View style={detailsStyles.section}>
                  <Text style={detailsStyles.sectionTitle}>INSPECTION PHOTOS</Text>
                  <View style={detailsStyles.photosRow}>
                    <View style={detailsStyles.photoCard}>
                      <View style={detailsStyles.photoBadge}>
                        <Text style={detailsStyles.photoBadgeText}>FRONT</Text>
                      </View>
                      <Image
                        contentFit="cover"
                        source={assets.fieldUnsafeCheck}
                        style={detailsStyles.photoImg}
                      />
                    </View>
                    <View style={detailsStyles.photoCard}>
                      <View style={detailsStyles.photoBadge}>
                        <Text style={detailsStyles.photoBadgeText}>BACK</Text>
                      </View>
                      <Image
                        contentFit="cover"
                        source={assets.captureRecentPhoto}
                        style={detailsStyles.photoImg}
                      />
                    </View>
                  </View>
                </View>
              </ScrollView>
            </Animated.View>
          </View>
        </Modal>
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
  // Tab Controls (Segmented pill style matching Vendor History)
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
    gap: 8,
    justifyContent: 'center',
    paddingVertical: 10,
  },
  tabButtonActive: {
    backgroundColor: reviewerColors.primary,
    shadowColor: '#000000',
    shadowOffset: { height: 1, width: 0 },
    shadowOpacity: 0.1,
    shadowRadius: 3,
    elevation: 2,
  },
  tabButtonText: {
    color: reviewerColors.textMuted,
    fontSize: 14,
    fontWeight: '700',
    letterSpacing: 0.2,
  },
  tabButtonTextActive: {
    color: '#ffffff',
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
  feedRowPressed: {
    backgroundColor: '#fff1f1',
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
  reviewedChip: {
    backgroundColor: reviewerColors.chipGreen,
  },
  unsafeChip: {
    backgroundColor: reviewerColors.chipRed,
  },
  statusText: {
    fontSize: 11,
    fontWeight: '500',
    lineHeight: 14,
  },
  reviewedText: {
    color: reviewerColors.successGreen,
  },
  unsafeText: {
    color: reviewerColors.errorRed,
  },
  reasonsListRow: {
    flexDirection: 'row',
    flexWrap: 'wrap',
    gap: 6,
    marginTop: 8,
    alignItems: 'center',
  },
  reasonTag: {
    backgroundColor: 'rgba(186, 26, 26, 0.08)',
    borderColor: 'rgba(186, 26, 26, 0.2)',
    borderRadius: 6,
    borderWidth: 1,
    paddingHorizontal: 8,
    paddingVertical: 2,
  },
  reasonTagText: {
    color: reviewerColors.errorRed,
    fontSize: 11,
    fontWeight: '600',
  },
  viewDetailsPrompt: {
    color: reviewerColors.primary,
    fontSize: 12,
    fontWeight: '600',
    marginLeft: 4,
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

const detailsStyles = StyleSheet.create({
  overlay: {
    backgroundColor: 'transparent',
    flex: 1,
    justifyContent: 'flex-end',
  },
  backdrop: {
    ...StyleSheet.absoluteFill,
    backgroundColor: 'transparent',
  },
  container: {
    alignSelf: 'center',
    backgroundColor: '#ffffff',
    borderColor: '#e5e7eb',
    borderTopLeftRadius: 24,
    borderTopRightRadius: 24,
    borderWidth: 1,
    borderBottomWidth: 0,
    elevation: 20,
    maxHeight: '80%',
    maxWidth: 448,
    paddingBottom: 24,
    shadowColor: '#000000',
    shadowOffset: { width: 0, height: -4 },
    shadowOpacity: 0.15,
    shadowRadius: 12,
    width: '100%',
  },
  dragHandleContainer: {
    alignItems: 'center',
    justifyContent: 'center',
    paddingVertical: 14,
    width: '100%',
  },
  dragHandle: {
    backgroundColor: '#cbd5e1',
    borderRadius: 999,
    height: 5,
    width: 48,
  },
  modalHeader: {
    borderBottomColor: '#f3f4f6',
    borderBottomWidth: 1,
    flexDirection: 'row',
    justifyContent: 'space-between',
    alignItems: 'flex-start',
    paddingHorizontal: 20,
    paddingBottom: 12,
  },
  modalTitle: {
    color: '#111827',
    fontSize: 18,
    fontWeight: '700',
  },
  modalSubtitle: {
    color: '#6b7280',
    fontSize: 13,
    marginTop: 2,
  },
  closeButton: {
    padding: 4,
  },
  scrollContent: {
    padding: 20,
    gap: 16,
  },
  alertBanner: {
    alignItems: 'center',
    backgroundColor: 'rgba(186, 26, 26, 0.08)',
    borderColor: 'rgba(186, 26, 26, 0.25)',
    borderRadius: 10,
    borderWidth: 1,
    flexDirection: 'row',
    gap: 12,
    padding: 12,
  },
  alertTextContainer: {
    flex: 1,
  },
  alertTitle: {
    color: '#ba1a1a',
    fontSize: 14,
    fontWeight: '700',
  },
  alertLocation: {
    color: '#7f1d1d',
    fontSize: 12,
    marginTop: 2,
  },
  section: {
    gap: 8,
  },
  sectionTitle: {
    color: '#6b7280',
    fontSize: 11,
    fontWeight: '700',
    letterSpacing: 0.8,
  },
  reasonsGrid: {
    gap: 8,
  },
  reasonItem: {
    alignItems: 'center',
    backgroundColor: '#fef2f2',
    borderColor: 'rgba(186, 26, 26, 0.2)',
    borderRadius: 8,
    borderWidth: 1,
    flexDirection: 'row',
    gap: 10,
    paddingHorizontal: 12,
    paddingVertical: 10,
  },
  reasonIconBox: {
    alignItems: 'center',
    justifyContent: 'center',
    width: 24,
  },
  reasonItemText: {
    color: '#991b1b',
    fontSize: 14,
    fontWeight: '600',
  },
  noReasonsText: {
    color: '#6b7280',
    fontSize: 13,
    fontStyle: 'italic',
  },
  notesBox: {
    backgroundColor: '#f9fafb',
    borderColor: '#e5e7eb',
    borderRadius: 8,
    borderWidth: 1,
    padding: 12,
  },
  notesText: {
    color: '#1f2937',
    fontSize: 14,
    fontStyle: 'italic',
    lineHeight: 20,
  },
  photosRow: {
    flexDirection: 'row',
    gap: 12,
  },
  photoCard: {
    backgroundColor: '#f3f4f6',
    borderRadius: 10,
    flex: 1,
    height: 140,
    overflow: 'hidden',
    position: 'relative',
  },
  photoBadge: {
    backgroundColor: 'rgba(255, 255, 255, 0.95)',
    borderRadius: 4,
    left: 8,
    paddingHorizontal: 6,
    paddingVertical: 2,
    position: 'absolute',
    top: 8,
    zIndex: 2,
  },
  photoBadgeText: {
    color: '#111827',
    fontSize: 10,
    fontWeight: '700',
  },
  photoImg: {
    height: '100%',
    width: '100%',
  },
});

export default ReviewHistoryScreen;
