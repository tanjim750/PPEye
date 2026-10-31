import React, { useEffect, useRef, useState } from 'react';
import {
  Animated,
  Dimensions,
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
import { Image } from 'expo-image';

import { Icon } from '@/components/ui/Icon';
import { assets } from '@/constants/assets';
import {
  formatWorkerCheckTime,
  WorkerCheck,
} from '@/features/submissions/services/workerChecks.service';
import { HistoryInspectionPhoto } from '@/features/reviews/ReviewHistoryScreen';
import { preloadSubmissionSignedUrls } from '@/services/storage/supabase-storage.client';

const { width: SCREEN_WIDTH, height: SCREEN_HEIGHT } = Dimensions.get('window');

const reasonIcons: Record<string, { ios: string; android: string; web: string }> = {
  anchorage: { ios: 'anchor', android: 'anchor', web: 'anchor' },
  harness: { ios: 'figure.stand', android: 'accessibility_new', web: 'accessibility_new' },
  helmet: { ios: 'wrench.and.screwdriver', android: 'construction', web: 'construction' },
  lanyard: { ios: 'link', android: 'link', web: 'link' },
  other: { ios: 'ellipsis', android: 'more_horiz', web: 'more_horiz' },
  shoes: { ios: 'shoeprints.fill', android: 'directions_walk', web: 'directions_walk' },
};

const unsafeReasonLabels: Record<string, string> = {
  anchorage: 'Anchorage Issue',
  harness: 'No Safety Harness',
  helmet: 'No Safety Helmet',
  lanyard: 'No Safety Lanyard',
  other: 'Other Violation',
  shoes: 'No Safety Shoes',
};

export type SubmissionDetailsBottomSheetProps = {
  visible: boolean;
  item: WorkerCheck | null;
  onClose: () => void;
  onFixAndResubmit?: (item: WorkerCheck) => void;
  contextTab?: 'all' | 'safe' | 'unsafe' | 'pending';
};

/**
 * SubmissionDetailsBottomSheet:
 * Detailed inspection bottom sheet displaying identified PPE violations,
 * reviewer notes, worker statuses, and pre-cached FRONT / BACK inspection photos.
 * 
 * Features:
 * - Fluid native slide dismissal without bouncing or double-animations
 * - Interactive full-screen image zoom modal with pan/pinch
 * - Responsive layout adapted for mobile phones and tablets
 */
export function SubmissionDetailsBottomSheet({
  visible,
  item,
  onClose,
  onFixAndResubmit,
  contextTab,
}: SubmissionDetailsBottomSheetProps) {
  const insets = useSafeAreaInsets();
  const { t } = useTranslation('home');

  const translateY = useRef(new Animated.Value(0)).current;

  // Zoom modal state
  const [zoomModalVisible, setZoomModalVisible] = useState(false);
  const [zoomedImage, setZoomedImage] = useState<{ source: any; title: string } | null>(null);
  const [zoomScale, setZoomScale] = useState(1);

  const closingRef = useRef(false);

  useEffect(() => {
    if (visible) {
      closingRef.current = false;
      translateY.setValue(0);
    }
  }, [visible]);

  // On opening submission: preload & reuse 1-day signed URLs for all images in submission
  useEffect(() => {
    if (visible && item?.submissionId) {
      preloadSubmissionSignedUrls(item.submissionId).catch(() => {});
    }
  }, [visible, item?.submissionId]);

  function handleClose() {
    if (closingRef.current) return;
    closingRef.current = true;
    onClose();
    setTimeout(() => {
      closingRef.current = false;
      translateY.setValue(0);
    }, 300);
  }

  const panResponder = useRef(
    PanResponder.create({
      onStartShouldSetPanResponder: () => false,
      onStartShouldSetPanResponderCapture: () => false,
      onMoveShouldSetPanResponder: (_, gestureState) => gestureState.dy > 5,
      onMoveShouldSetPanResponderCapture: (_, gestureState) => gestureState.dy > 5,
      onPanResponderMove: (_, gestureState) => {
        if (gestureState.dy > 0) {
          translateY.setValue(gestureState.dy);
        }
      },
      onPanResponderRelease: (_, gestureState) => {
        if (gestureState.dy > 60 || gestureState.vy > 0.4) {
          handleClose();
        } else {
          Animated.timing(translateY, {
            toValue: 0,
            duration: 100,
            useNativeDriver: true,
          }).start();
        }
      },
      onPanResponderTerminate: () => {
        handleClose();
      },
    })
  ).current;

  function openZoomModal(source: any, title: string) {
    setZoomedImage({ source, title });
    setZoomScale(1);
    setZoomModalVisible(true);
  }

  function closeZoomModal() {
    setZoomModalVisible(false);
    setZoomedImage(null);
    setZoomScale(1);
  }

  if (!item && !visible) return null;

  const isContextSafe = contextTab === 'all' || contextTab === 'safe';
  const isContextUnsafe = contextTab === 'unsafe';
  const isContextPending = contextTab === 'pending';

  const isUnsafe = isContextUnsafe || (!isContextSafe && item?.status === 'unsafe');
  const isSafe = isContextSafe || (!isContextUnsafe && item?.status === 'safe');
  const isPending = isContextPending || (!isContextSafe && !isContextUnsafe && item?.status === 'review');

  const modalTitle = isContextUnsafe
    ? 'Unsafe Review Details'
    : isContextSafe
      ? 'Safe Review Details'
      : isUnsafe
        ? 'Unsafe Review Details'
        : isSafe
          ? 'Safe Review Details'
          : 'Pending Review Details';

  const workersToDisplay =
    item?.workerReviews && item.workerReviews.length > 0
      ? isContextUnsafe
        ? item.workerReviews.filter((w) => w.status === 'unsafe')
        : isContextSafe
          ? item.workerReviews.filter((w) => w.status === 'safe')
          : isUnsafe
            ? item.workerReviews.filter((w) => w.status === 'unsafe')
            : item.workerReviews
      : [
          {
            sequenceNo: item?.workerNumber || 1,
            workerName: `Worker ${item?.workerNumber || 1}`,
            status: item?.status || 'safe',
            unsafeReasons: item?.unsafeReasons || [],
            otherReasonText: item?.reviewerNote,
            frontUri: null,
            backUri: null,
            frontDriveId: null,
            backDriveId: null,
          },
        ];

  return (
    <>
      <Modal
        animationType="slide"
        onRequestClose={handleClose}
        transparent={true}
        visible={visible}>
        <View style={detailsStyles.overlay}>
          <Pressable onPress={handleClose} style={detailsStyles.backdrop} />

          <Animated.View
            style={[
              detailsStyles.container,
              { transform: [{ translateY }] },
            ]}>
            {/* Drag Handle */}
            <View
              {...panResponder.panHandlers}
              style={detailsStyles.dragHandleContainer}>
              <View style={detailsStyles.dragHandle} />
            </View>

            {/* Modal Header */}
            <View style={detailsStyles.modalHeader}>
              <View
                {...panResponder.panHandlers}
                style={{ flex: 1, paddingVertical: 4 }}>
                <Text style={detailsStyles.modalTitle}>{modalTitle}</Text>
                <Text style={detailsStyles.modalSubtitle}>
                  {item?.siteName || 'Site'} • Vendor team
                </Text>
              </View>
              <Pressable
                accessibilityLabel="Close"
                accessibilityRole="button"
                hitSlop={{ top: 12, bottom: 12, left: 12, right: 12 }}
                onPress={handleClose}
                style={({ pressed }) => [
                  detailsStyles.closeButton,
                  pressed && { opacity: 0.6 },
                ]}>
                <Icon
                  color="#6b7280"
                  name={{ ios: 'xmark', android: 'close', web: 'close' }}
                  size={20}
                />
              </Pressable>
            </View>

            <ScrollView
              contentContainerStyle={detailsStyles.scrollContent}
              showsVerticalScrollIndicator={false}>
              {/* Alert Banner */}
              {isUnsafe ? (
                <View style={detailsStyles.alertBanner}>
                  <Icon
                    color="#ba1a1a"
                    name={{
                      ios: 'exclamationmark.triangle.fill',
                      android: 'warning',
                      web: 'warning',
                    }}
                    size={20}
                  />
                  <View style={detailsStyles.alertTextContainer}>
                    <Text style={detailsStyles.alertTitle}>Marked as UNSAFE by Reviewer</Text>
                    <Text style={detailsStyles.alertLocation}>
                      {item?.siteName} • {item ? formatWorkerCheckTime(item, t) : ''}
                    </Text>
                  </View>
                </View>
              ) : isSafe ? (
                <View
                  style={[
                    detailsStyles.alertBanner,
                    {
                      backgroundColor: 'rgba(35, 134, 54, 0.1)',
                      borderColor: 'rgba(35, 134, 54, 0.25)',
                    },
                  ]}>
                  <Icon
                    color="#238636"
                    name={{
                      ios: 'checkmark.seal.fill',
                      android: 'check_circle',
                      web: 'check_circle',
                    }}
                    size={20}
                  />
                  <View style={detailsStyles.alertTextContainer}>
                    <Text style={[detailsStyles.alertTitle, { color: '#238636' }]}>
                      Marked as SAFE by Reviewer
                    </Text>
                    <Text style={detailsStyles.alertLocation}>
                      {item?.siteName} • {item ? formatWorkerCheckTime(item, t) : ''}
                    </Text>
                  </View>
                </View>
              ) : (
                <View
                  style={[
                    detailsStyles.alertBanner,
                    {
                      backgroundColor: 'rgba(234, 179, 8, 0.12)',
                      borderColor: 'rgba(234, 179, 8, 0.3)',
                    },
                  ]}>
                  <Icon
                    color="#ca8a04"
                    name={{
                      ios: 'clock.fill',
                      android: 'schedule',
                      web: 'schedule',
                    }}
                    size={20}
                  />
                  <View style={detailsStyles.alertTextContainer}>
                    <Text style={[detailsStyles.alertTitle, { color: '#ca8a04' }]}>
                      Pending Review by EHS
                    </Text>
                    <Text style={detailsStyles.alertLocation}>
                      {item?.siteName} • {item ? formatWorkerCheckTime(item, t) : ''}
                    </Text>
                  </View>
                </View>
              )}

              {/* Workers Cards */}
              <View style={{ gap: 16 }}>
                {workersToDisplay.map((worker, wIdx) => {
                  const isWorkerUnsafe = worker.status === 'unsafe';
                  const isWorkerPending = worker.status === 'review';
                  const workerTitle = `${item?.siteName || 'Site'} • Worker #${worker.sequenceNo}`;

                  return (
                    <View
                      key={worker.sequenceNo || wIdx}
                      style={detailsStyles.workerCardContainer}>
                      {/* Worker Header Card */}
                      <View style={detailsStyles.workerHeaderRow}>
                        <View style={detailsStyles.workerBadge}>
                          <Text style={detailsStyles.workerBadgeText}>
                            WORKER #{worker.sequenceNo}
                          </Text>
                        </View>
                        <View
                          style={[
                            detailsStyles.workerVerdictChip,
                            isWorkerUnsafe && { backgroundColor: '#fef2f2' },
                            !isWorkerUnsafe && !isWorkerPending && { backgroundColor: 'rgba(35, 134, 54, 0.1)' },
                            isWorkerPending && { backgroundColor: 'rgba(234, 179, 8, 0.15)' },
                          ]}>
                          <Icon
                            color={
                              isWorkerUnsafe
                                ? '#ba1a1a'
                                : isWorkerPending
                                  ? '#ca8a04'
                                  : '#238636'
                            }
                            name={
                              isWorkerUnsafe
                                ? { ios: 'xmark.circle.fill', android: 'cancel', web: 'cancel' }
                                : isWorkerPending
                                  ? { ios: 'clock.fill', android: 'schedule', web: 'schedule' }
                                  : { ios: 'checkmark.circle.fill', android: 'check_circle', web: 'check_circle' }
                            }
                            size={14}
                          />
                          <Text
                            style={[
                              detailsStyles.workerVerdictText,
                              isWorkerUnsafe && { color: '#ba1a1a' },
                              !isWorkerUnsafe && !isWorkerPending && { color: '#238636' },
                              isWorkerPending && { color: '#ca8a04' },
                            ]}>
                            {isWorkerUnsafe ? 'UNSAFE' : isWorkerPending ? 'PENDING' : 'SAFE'}
                          </Text>
                        </View>
                      </View>

                      {/* PPE Violations Section */}
                      {isWorkerUnsafe && (
                        <View style={detailsStyles.section}>
                          <Text style={detailsStyles.sectionTitle}>
                            IDENTIFIED PPE VIOLATIONS
                          </Text>
                          <View style={detailsStyles.reasonsGrid}>
                            {worker.unsafeReasons && worker.unsafeReasons.length > 0 ? (
                              worker.unsafeReasons.map((r) => {
                                const normalized = r.toLowerCase().replace(/[^a-z]/g, '');
                                let matchedKey = 'other';
                                if (normalized.includes('helmet')) matchedKey = 'helmet';
                                else if (normalized.includes('harness')) matchedKey = 'harness';
                                else if (normalized.includes('lanyard')) matchedKey = 'lanyard';
                                else if (normalized.includes('anchor')) matchedKey = 'anchorage';
                                else if (normalized.includes('shoe') || normalized.includes('boot')) matchedKey = 'shoes';

                                const iconConfig = reasonIcons[matchedKey] || reasonIcons[r] || reasonIcons.other;
                                const isOther = matchedKey === 'other' || r.toLowerCase().includes('other');
                                const workerNote = worker.otherReasonText || (workersToDisplay.length === 1 ? item?.reviewerNote : undefined);
                                const displayLabel = isOther && workerNote
                                  ? `Other: ${workerNote}`
                                  : (unsafeReasonLabels[matchedKey] || unsafeReasonLabels[r] || r);

                                return (
                                  <View key={r} style={detailsStyles.reasonItem}>
                                    <View style={detailsStyles.reasonIconBox}>
                                      <Icon
                                        color="#ba1a1a"
                                        name={iconConfig as any}
                                        size={18}
                                      />
                                    </View>
                                    <Text style={detailsStyles.reasonItemText}>
                                      {displayLabel}
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
                      )}

                      {/* Reviewer Note - displayed ONLY if this specific worker was given a note */}
                      {isWorkerUnsafe && Boolean(worker.otherReasonText || (workersToDisplay.length === 1 ? item?.reviewerNote : undefined)) ? (
                        <View style={detailsStyles.section}>
                          <Text style={detailsStyles.sectionTitle}>
                            REVIEWER NOTE / DESCRIPTION
                          </Text>
                          <View style={detailsStyles.notesBox}>
                            <Text style={detailsStyles.notesText}>
                              "{worker.otherReasonText || item?.reviewerNote}"
                            </Text>
                          </View>
                        </View>
                      ) : null}

                      {/* Inspection Photos Preview */}
                      <View style={detailsStyles.section}>
                        <Text style={detailsStyles.sectionTitle}>INSPECTION PHOTOS</Text>
                        <View style={detailsStyles.photosRow}>
                          <HistoryInspectionPhoto
                            badgeLabel="FRONT"
                            driveId={worker.frontDriveId}
                            fallbackAsset={null}
                            fileIdOrUri={worker.frontUri}
                            onPressZoom={openZoomModal}
                            submissionId={item?.submissionId ? String(item.submissionId) : undefined}
                            workerSequenceNo={worker.sequenceNo}
                            workerTitle={workerTitle}
                          />
                          <HistoryInspectionPhoto
                            badgeLabel="BACK"
                            driveId={worker.backDriveId}
                            fallbackAsset={null}
                            fileIdOrUri={worker.backUri}
                            onPressZoom={openZoomModal}
                            submissionId={item?.submissionId ? String(item.submissionId) : undefined}
                            workerSequenceNo={worker.sequenceNo}
                            workerTitle={workerTitle}
                          />
                        </View>
                      </View>
                    </View>
                  );
                })}
              </View>
            </ScrollView>

            {/* Footer Fix & Resubmit Button for Unsafe checks */}
            {isUnsafe && !isContextSafe && onFixAndResubmit && item && (
              <View
                style={[
                  detailsStyles.footerActionContainer,
                  { paddingBottom: Math.max(insets.bottom, 12) },
                ]}>
                <Pressable
                  accessibilityRole="button"
                  onPress={() => onFixAndResubmit(item)}
                  style={({ pressed }) => [
                    detailsStyles.fixAndResubmitButton,
                    pressed && { opacity: 0.75 },
                  ]}>
                  <Icon
                    color="#ffffff"
                    name={{ ios: 'arrow.clockwise', android: 'refresh', web: 'refresh' }}
                    size={18}
                    weight="bold"
                  />
                  <Text style={detailsStyles.fixAndResubmitButtonText}>
                    Fix & Resubmit
                  </Text>
                </Pressable>
              </View>
            )}
          </Animated.View>
        </View>
      </Modal>

      {/* Full-screen Photo Zoom Modal */}
      <Modal
        animationType="fade"
        onRequestClose={closeZoomModal}
        transparent={true}
        visible={zoomModalVisible}>
        <SafeAreaView style={zoomModalStyles.safeModal}>
          <View style={zoomModalStyles.zoomHeader}>
            <Text numberOfLines={1} style={zoomModalStyles.zoomHeaderTitle}>
              {zoomedImage?.title || 'Inspection Photo'}
            </Text>
            <Pressable
              accessibilityLabel="Close full screen photo"
              accessibilityRole="button"
              hitSlop={{ top: 12, bottom: 12, left: 12, right: 12 }}
              onPress={closeZoomModal}
              style={zoomModalStyles.zoomCloseButton}>
              <Icon
                color="#ffffff"
                name={{ ios: 'xmark', android: 'close', web: 'close' }}
                size={20}
                weight="bold"
              />
            </Pressable>
          </View>

          <ScrollView
            centerContent
            contentContainerStyle={zoomModalStyles.scrollContent}
            maximumZoomScale={3}
            minimumZoomScale={1}
            showsHorizontalScrollIndicator={false}
            showsVerticalScrollIndicator={false}
            style={zoomModalStyles.scrollArea}>
            {zoomedImage && (
              <Image
                cachePolicy="memory-disk"
                contentFit="contain"
                source={zoomedImage.source}
                style={[
                  zoomModalStyles.zoomedImage,
                  { transform: [{ scale: zoomScale }] },
                ]}
              />
            )}
          </ScrollView>

          <SafeAreaView edges={['bottom']} style={zoomModalStyles.safeFooter}>
            <View style={zoomModalStyles.zoomControlsBar}>
              <Pressable
                accessibilityLabel="Zoom out"
                accessibilityRole="button"
                onPress={() => setZoomScale((s) => Math.max(1, s - 0.5))}
                style={zoomModalStyles.controlButton}>
                <Icon
                  color="#ffffff"
                  name={{ ios: 'minus', android: 'remove', web: 'remove' }}
                  size={20}
                  weight="bold"
                />
              </Pressable>
              <Text style={zoomModalStyles.scaleIndicatorText}>
                {Math.round(zoomScale * 100)}%
              </Text>
              <Pressable
                accessibilityLabel="Zoom in"
                accessibilityRole="button"
                onPress={() => setZoomScale((s) => Math.min(3, s + 0.5))}
                style={zoomModalStyles.controlButton}>
                <Icon
                  color="#ffffff"
                  name={{ ios: 'plus', android: 'add', web: 'add' }}
                  size={20}
                  weight="bold"
                />
              </Pressable>
              <Pressable
                accessibilityLabel="Reset Zoom"
                accessibilityRole="button"
                onPress={() => setZoomScale(1)}
                style={zoomModalStyles.resetZoomButton}>
                <Text style={zoomModalStyles.resetZoomText}>Reset</Text>
              </Pressable>
            </View>
          </SafeAreaView>
        </SafeAreaView>
      </Modal>
    </>
  );
}

const detailsStyles = StyleSheet.create({
  overlay: {
    backgroundColor: 'rgba(0, 0, 0, 0.5)',
    flex: 1,
    justifyContent: 'flex-end',
  },
  backdrop: {
    ...StyleSheet.absoluteFill,
  },
  container: {
    backgroundColor: '#ffffff',
    borderTopLeftRadius: 24,
    borderTopRightRadius: 24,
    maxHeight: '90%',
    minHeight: '60%',
    paddingBottom: 8,
    shadowColor: '#000000',
    shadowOffset: { width: 0, height: -4 },
    shadowOpacity: 0.15,
    shadowRadius: 12,
    elevation: 10,
    maxWidth: 448,
    width: '100%',
    alignSelf: 'center',
  },
  dragHandleContainer: {
    alignItems: 'center',
    paddingVertical: 10,
    width: '100%',
  },
  dragHandle: {
    backgroundColor: '#d1d5db',
    borderRadius: 3,
    height: 5,
    width: 48,
  },
  modalHeader: {
    alignItems: 'center',
    borderBottomColor: '#f3f4f6',
    borderBottomWidth: 1,
    flexDirection: 'row',
    justifyContent: 'space-between',
    paddingBottom: 12,
    paddingHorizontal: 20,
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
    alignItems: 'center',
    backgroundColor: '#f3f4f6',
    borderRadius: 18,
    height: 36,
    justifyContent: 'center',
    width: 36,
  },
  scrollContent: {
    paddingHorizontal: 20,
    paddingVertical: 16,
    gap: 16,
  },
  alertBanner: {
    alignItems: 'center',
    backgroundColor: '#fef2f2',
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
  workerCardContainer: {
    backgroundColor: '#ffffff',
    borderColor: '#e5e7eb',
    borderRadius: 12,
    borderWidth: 1,
    padding: 14,
    gap: 12,
    shadowColor: '#000',
    shadowOffset: { width: 0, height: 1 },
    shadowOpacity: 0.05,
    shadowRadius: 2,
    elevation: 1,
  },
  workerHeaderRow: {
    flexDirection: 'row',
    justifyContent: 'space-between',
    alignItems: 'center',
    borderBottomWidth: 1,
    borderBottomColor: '#f3f4f6',
    paddingBottom: 8,
  },
  workerBadge: {
    backgroundColor: '#f3f4f6',
    paddingHorizontal: 8,
    paddingVertical: 4,
    borderRadius: 6,
  },
  workerBadgeText: {
    fontSize: 12,
    fontWeight: '700',
    color: '#374151',
    letterSpacing: 0.5,
  },
  workerVerdictChip: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 4,
    paddingHorizontal: 8,
    paddingVertical: 4,
    borderRadius: 6,
  },
  workerVerdictText: {
    fontSize: 11,
    fontWeight: '700',
  },
  section: {
    gap: 6,
  },
  sectionTitle: {
    color: '#6b7280',
    fontSize: 10,
    fontWeight: '700',
    letterSpacing: 0.5,
  },
  reasonsGrid: {
    flexDirection: 'row',
    flexWrap: 'wrap',
    gap: 8,
  },
  reasonItem: {
    alignItems: 'center',
    backgroundColor: '#fef2f2',
    borderColor: 'rgba(186, 26, 26, 0.2)',
    borderRadius: 6,
    borderWidth: 1,
    flexDirection: 'row',
    gap: 6,
    paddingHorizontal: 8,
    paddingVertical: 4,
  },
  reasonIconBox: {
    alignItems: 'center',
    justifyContent: 'center',
  },
  reasonItemText: {
    color: '#ba1a1a',
    fontSize: 11,
    fontWeight: '600',
  },
  noReasonsText: {
    color: '#6b7280',
    fontSize: 12,
    fontStyle: 'italic',
  },
  notesBox: {
    backgroundColor: '#f9fafb',
    borderColor: '#e5e7eb',
    borderRadius: 8,
    borderWidth: 1,
    padding: 10,
  },
  notesText: {
    color: '#374151',
    fontSize: 12,
    fontStyle: 'italic',
    lineHeight: 18,
  },
  photosRow: {
    flexDirection: 'row',
    gap: 10,
  },
  footerActionContainer: {
    borderTopColor: '#f3f4f6',
    borderTopWidth: 1,
    paddingHorizontal: 20,
    paddingTop: 12,
  },
  fixAndResubmitButton: {
    alignItems: 'center',
    backgroundColor: '#ba1a1a',
    borderRadius: 10,
    flexDirection: 'row',
    gap: 8,
    height: 48,
    justifyContent: 'center',
    shadowColor: '#ba1a1a',
    shadowOffset: { width: 0, height: 2 },
    shadowOpacity: 0.2,
    shadowRadius: 4,
    elevation: 3,
  },
  fixAndResubmitButtonText: {
    color: '#ffffff',
    fontSize: 16,
    fontWeight: '700',
    letterSpacing: 0.5,
  },
});

const zoomModalStyles = StyleSheet.create({
  safeModal: {
    backgroundColor: '#000000',
    flex: 1,
  },
  zoomHeader: {
    alignItems: 'center',
    backgroundColor: 'rgba(0, 0, 0, 0.8)',
    flexDirection: 'row',
    justifyContent: 'space-between',
    paddingHorizontal: 16,
    paddingVertical: 12,
    zIndex: 10,
  },
  zoomHeaderTitle: {
    color: '#ffffff',
    fontSize: 15,
    fontWeight: '700',
    letterSpacing: 0.5,
  },
  zoomCloseButton: {
    alignItems: 'center',
    backgroundColor: 'rgba(255, 255, 255, 0.2)',
    borderRadius: 18,
    height: 36,
    justifyContent: 'center',
    width: 36,
  },
  scrollArea: {
    flex: 1,
  },
  scrollContent: {
    alignItems: 'center',
    flex: 1,
    justifyContent: 'center',
  },
  zoomedImage: {
    height: SCREEN_HEIGHT * 0.75,
    width: SCREEN_WIDTH,
  },
  safeFooter: {
    backgroundColor: 'rgba(0, 0, 0, 0.85)',
  },
  zoomControlsBar: {
    alignItems: 'center',
    flexDirection: 'row',
    justifyContent: 'center',
    paddingHorizontal: 24,
    paddingVertical: 14,
    gap: 16,
  },
  controlButton: {
    alignItems: 'center',
    backgroundColor: 'rgba(255, 255, 255, 0.2)',
    borderRadius: 20,
    height: 40,
    justifyContent: 'center',
    width: 40,
  },
  scaleIndicatorText: {
    color: '#ffffff',
    fontSize: 14,
    fontWeight: '700',
    minWidth: 48,
    textAlign: 'center',
  },
  resetZoomButton: {
    alignItems: 'center',
    backgroundColor: 'rgba(255, 255, 255, 0.2)',
    borderRadius: 16,
    justifyContent: 'center',
    paddingHorizontal: 12,
    paddingVertical: 8,
  },
  resetZoomText: {
    color: '#ffffff',
    fontSize: 12,
    fontWeight: '700',
  },
});
