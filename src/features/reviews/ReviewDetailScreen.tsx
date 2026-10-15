import { useLocalSearchParams, useRouter } from 'expo-router';
import { Image } from 'expo-image';
import { useEffect, useRef, useState } from 'react';
import {
  Alert,
  Animated,
  Modal,
  PanResponder,
  Pressable,
  ScrollView,
  StyleSheet,
  Text,
  TextInput,
  View,
} from 'react-native';
import { SafeAreaView, useSafeAreaInsets } from 'react-native-safe-area-context';

import { Icon } from '@/components/ui/Icon';
import { assets } from '@/constants/assets';
import { markWorkerSafe, markWorkerUnsafe } from '@/features/submissions/services/workerChecks.service';
import {
  markReviewReviewed,
  markReviewUnsafe,
  useReviews,
} from '@/features/reviews/services/reviews.service';
import { getImageUri, getSubmissionImages } from '@/services/storage';

const colors = {
  background: '#f9f9ff',
  border: '#c0c7d5',
  card: '#ffffff',
  errorRed: '#ba1a1a',
  outlineVariant: 'rgba(192, 199, 213, 0.4)',
  primary: '#005cad',
  progressBg: '#e0e2ec',
  successGreen: '#16A34A',
  text: '#181c22',
  textMuted: '#404753',
  white: '#ffffff',
};

const unsafeReasons = [
  {
    id: 'helmet',
    label: 'Helmet',
    icon: { ios: 'wrench.and.screwdriver', android: 'construction', web: 'construction' } as const,
  },
  {
    id: 'harness',
    label: 'Full-body harness',
    icon: { ios: 'figure.stand', android: 'accessibility_new', web: 'accessibility_new' } as const,
  },
  {
    id: 'lanyard',
    label: 'Lanyard',
    icon: { ios: 'link', android: 'link', web: 'link' } as const,
  },
  {
    id: 'anchorage',
    label: 'Anchorage / connection',
    icon: { ios: 'anchor', android: 'anchor', web: 'anchor' } as const,
  },
  {
    id: 'shoes',
    label: 'Safety shoes',
    icon: { ios: 'shoeprints.fill', android: 'directions_walk', web: 'directions_walk' } as const,
  },
  {
    id: 'other',
    label: 'Other',
    icon: { ios: 'ellipsis', android: 'more_horiz', web: 'more_horiz' } as const,
  },
];

export function ReviewDetailScreen() {
  const router = useRouter();
  const insets = useSafeAreaInsets();
  const { submissionId } = useLocalSearchParams<{ submissionId: string }>();
  const { allReviews } = useReviews();

  const currentReview = allReviews.find((r) => r.id === submissionId);

  // Dynamic context with requested defaults
  const vendorName = currentReview?.vendor || 'ABC Telecom';
  const workerName = currentReview?.teamLead
    ? currentReview.teamLead.split(' · ')[0]
    : 'Rahim Mia';
  const locationName = currentReview?.location || 'Gazipur-ER-102';
  const timeName = currentReview?.timeDisplay
    ? `Today, ${currentReview.timeDisplay}`
    : 'Today, 10:42 AM';

  const totalWorkers = currentReview?.workers || 4;
  const [currentWorkerIndex, setCurrentWorkerIndex] = useState(2); // WORKER 2 OF 4

  // Unsafe Bottom Sheet States
  const [isUnsafeModalVisible, setIsUnsafeModalVisible] = useState(false);
  const [selectedReasons, setSelectedReasons] = useState<string[]>([]);
  const [otherReasonText, setOtherReasonText] = useState('');

  // Private authorized image previews for FRONT and BACK
  const [frontUri, setFrontUri] = useState<string | null>(null);
  const [backUri, setBackUri] = useState<string | null>(null);
  const [, setIsLoadingImages] = useState(false);

  useEffect(() => {
    let isCancelled = false;

    async function loadWorkerImages() {
      const parsedSubId = Number(submissionId);
      if (!parsedSubId || isNaN(parsedSubId)) {
        return;
      }

      setIsLoadingImages(true);
      try {
        const subData = await getSubmissionImages(parsedSubId);
        const worker =
          subData.workers.find((w) => w.sequenceNo === currentWorkerIndex) ||
          subData.workers[currentWorkerIndex - 1];

        if (worker && !isCancelled) {
          if (worker.front?.file?.id) {
            try {
              const uri = await getImageUri(String(worker.front.file.id), { isSensitive: true });
              if (!isCancelled) setFrontUri(uri);
            } catch {
              if (!isCancelled) setFrontUri(null);
            }
          } else {
            setFrontUri(null);
          }

          if (worker.back?.file?.id) {
            try {
              const uri = await getImageUri(String(worker.back.file.id), { isSensitive: true });
              if (!isCancelled) setBackUri(uri);
            } catch {
              if (!isCancelled) setBackUri(null);
            }
          } else {
            setBackUri(null);
          }
        }
      } catch {
        if (!isCancelled) {
          setFrontUri(null);
          setBackUri(null);
        }
      } finally {
        if (!isCancelled) {
          setIsLoadingImages(false);
        }
      }
    }

    loadWorkerImages();

    return () => {
      isCancelled = true;
    };
  }, [submissionId, currentWorkerIndex]);

  const progressPercent = Math.min(
    100,
    Math.max(10, Math.round((currentWorkerIndex / totalWorkers) * 100))
  );

  function toggleReason(id: string) {
    if (selectedReasons.includes(id)) {
      setSelectedReasons(selectedReasons.filter((r) => r !== id));
    } else {
      setSelectedReasons([...selectedReasons, id]);
    }
  }

  // Dynamic Validation:
  // Active if at least one regular option is selected OR 'other' is selected with non-empty text
  const isOtherSelected = selectedReasons.includes('other');
  const hasRegularSelected = selectedReasons.some((r) => r !== 'other');
  const isOtherValid = isOtherSelected && otherReasonText.trim().length > 0;
  const isConfirmActive = hasRegularSelected || isOtherValid;

  function handleSafe() {
    markWorkerSafe(submissionId || 'w131');
    markReviewReviewed(submissionId || 'rev-01');

    Alert.alert('Worker Approved', `Worker ${currentWorkerIndex} marked as SAFE!`, [
      {
        text: 'OK',
        onPress: () => {
          if (currentWorkerIndex < totalWorkers) {
            setCurrentWorkerIndex((prev) => prev + 1);
          } else {
            router.back();
          }
        },
      },
    ]);
  }

  const translateY = useRef(new Animated.Value(0)).current;

  function closeModal() {
    Animated.timing(translateY, {
      toValue: 600,
      duration: 180,
      useNativeDriver: true,
    }).start(() => {
      setIsUnsafeModalVisible(false);
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
        // Any downward drag or tap immediately slides down and closes. NEVER bounce back!
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

  function handleUnsafeClick() {
    translateY.setValue(0);
    setIsUnsafeModalVisible(true);
  }

  function handleConfirmUnsafe() {
    if (!isConfirmActive) return;

    markReviewUnsafe(submissionId || 'rev-01', selectedReasons, otherReasonText);
    markWorkerUnsafe(submissionId || 'w135', selectedReasons, otherReasonText, 'Sarah Jenkins');

    setIsUnsafeModalVisible(false);
    setSelectedReasons([]);
    setOtherReasonText('');

    Alert.alert(
      'Worker Marked Unsafe',
      `Worker ${currentWorkerIndex} marked as UNSAFE. Vendor has been notified for PPE violation.`,
      [
        {
          text: 'OK',
          onPress: () => {
            if (currentWorkerIndex < totalWorkers) {
              setCurrentWorkerIndex((prev) => prev + 1);
            } else {
              router.back();
            }
          },
        },
      ]
    );
  }

  function handlePrevious() {
    if (currentWorkerIndex > 1) {
      setCurrentWorkerIndex((prev) => prev - 1);
    } else {
      router.back();
    }
  }

  function handleNext() {
    if (currentWorkerIndex < totalWorkers) {
      setCurrentWorkerIndex((prev) => prev + 1);
    } else {
      Alert.alert('Inspection Complete', 'All workers for this submission have been reviewed.', [
        { text: 'Finish', onPress: () => router.back() },
      ]);
    }
  }

  return (
    <SafeAreaView style={styles.safeArea}>
      <View style={styles.shell}>
        {/* 1. Header: White top bar, Left Arrow, centered "PPE Review" in bold blue, subtle border */}
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
          <Text style={styles.headerTitle}>PPE Review</Text>
          <View style={styles.headerPlaceholder} />
        </View>

        <ScrollView
          contentContainerStyle={styles.scrollContent}
          showsVerticalScrollIndicator={false}
          style={styles.scroll}>
          {/* 2. Worker Information Section */}
          <View style={styles.workerInfoSection}>
            <Text style={styles.workerTitle}>
              {vendorName} <Text style={styles.bullet}>•</Text> {workerName}
            </Text>
            <View style={styles.locationRow}>
              <Icon
                color={colors.textMuted}
                name={{ ios: 'mappin.and.ellipse', android: 'location_on', web: 'location_on' }}
                size={16}
              />
              <Text style={styles.locationText}>
                {locationName} • {timeName}
              </Text>
            </View>
          </View>

          {/* 3. Progress Bar Section */}
          <View style={styles.progressSection}>
            <Text style={styles.progressText}>
              WORKER {currentWorkerIndex} OF {totalWorkers}
            </Text>
            <View style={styles.progressBarTrack}>
              <View style={[styles.progressBarFill, { width: `${progressPercent}%` }]} />
            </View>
          </View>

          {/* 4. Image Gallery Section */}
          <View style={styles.gallerySection}>
            {/* FRONT Image Card */}
            <View style={styles.imageCard}>
              <View style={styles.badgeContainer}>
                <Text style={styles.badgeText}>FRONT</Text>
              </View>
              <Image
                contentFit="cover"
                source={frontUri ? { uri: frontUri } : assets.fieldSafeCheck}
                style={styles.imagePhoto}
              />
            </View>

            {/* BACK Image Card */}
            <View style={styles.imageCard}>
              <View style={styles.badgeContainer}>
                <Text style={styles.badgeText}>BACK</Text>
              </View>
              <Image
                contentFit="cover"
                source={backUri ? { uri: backUri } : assets.captureRecentPhoto}
                style={styles.imagePhoto}
              />
            </View>
          </View>

          {/* 5. Action Section */}
          <View style={styles.actionSection}>
            <Text style={styles.actionQuestion}>Is this worker PPE safe?</Text>
            <View style={styles.actionButtonsRow}>
              {/* UNSAFE Button */}
              <Pressable
                accessibilityRole="button"
                onPress={handleUnsafeClick}
                style={({ pressed }) => [
                  styles.unsafeButton,
                  pressed && styles.buttonPressed,
                ]}>
                <Icon
                  color={colors.white}
                  name={{ ios: 'xmark', android: 'close', web: 'close' }}
                  size={20}
                  weight="bold"
                />
                <Text style={styles.actionButtonText}>UNSAFE</Text>
              </Pressable>

              {/* SAFE Button */}
              <Pressable
                accessibilityRole="button"
                onPress={handleSafe}
                style={({ pressed }) => [
                  styles.safeButton,
                  pressed && styles.buttonPressed,
                ]}>
                <Icon
                  color={colors.white}
                  name={{ ios: 'checkmark', android: 'check', web: 'check' }}
                  size={20}
                  weight="bold"
                />
                <Text style={styles.actionButtonText}>SAFE</Text>
              </Pressable>
            </View>
          </View>
        </ScrollView>

        {/* 6. Footer Navigation: Previous and Next Worker */}
        <View
          style={[
            styles.footerNav,
            {
              paddingBottom: Math.max(insets.bottom, 12),
              height: 56 + Math.max(insets.bottom, 12),
            },
          ]}>
          <Pressable
            accessibilityRole="button"
            onPress={handlePrevious}
            style={({ pressed }) => [styles.navButton, pressed && styles.pressedOpacity]}>
            <Icon
              color={colors.primary}
              name={{ ios: 'chevron.left', android: 'chevron_left', web: 'chevron_left' }}
              size={18}
            />
            <Text style={styles.navButtonText}>Previous</Text>
          </Pressable>

          <Pressable
            accessibilityRole="button"
            onPress={handleNext}
            style={({ pressed }) => [styles.navButton, pressed && styles.pressedOpacity]}>
            <Text style={[styles.navButtonText, styles.navButtonNextText]}>Next Worker</Text>
            <Icon
              color={colors.primary}
              name={{ ios: 'chevron.right', android: 'chevron_right', web: 'chevron_right' }}
              size={18}
            />
          </Pressable>
        </View>

        {/* Unsafe Reason Bottom Sheet Modal */}
        <Modal
          animationType="slide"
          onRequestClose={closeModal}
          transparent={true}
          visible={isUnsafeModalVisible}>
          <View style={modalStyles.overlay}>
            {/* Transparent backdrop - tapping outside dismisses */}
            <Pressable
              onPress={closeModal}
              style={modalStyles.backdrop}
            />

            {/* Bottom Sheet Container (covers ~70% of screen) */}
            <Animated.View
              style={[
                modalStyles.sheetContainer,
                { transform: [{ translateY }] },
              ]}>
              {/* Drag Handle with PanResponder to pull down and dismiss */}
              <View
                {...panResponder.panHandlers}
                style={modalStyles.dragHandleContainer}>
                <View style={modalStyles.dragHandle} />
              </View>

              {/* Header Section with PanResponder */}
              <View
                {...panResponder.panHandlers}
                style={modalStyles.header}>
                <Text style={modalStyles.title}>Why is this unsafe?</Text>
                <Text style={modalStyles.subtitle}>Select all that apply</Text>
              </View>

              {/* Options List */}
              <ScrollView
                contentContainerStyle={modalStyles.optionsList}
                keyboardShouldPersistTaps="handled"
                showsVerticalScrollIndicator={false}>
                {unsafeReasons.map((item) => {
                  const isSelected = selectedReasons.includes(item.id);
                  return (
                    <View key={item.id} style={modalStyles.optionWrapper}>
                      <Pressable
                        accessibilityRole="button"
                        onPress={() => toggleReason(item.id)}
                        style={[
                          modalStyles.optionCard,
                          isSelected && modalStyles.optionCardSelected,
                        ]}>
                        <View style={modalStyles.optionLeft}>
                          <Icon
                            color={isSelected ? '#0082F0' : '#6b7280'}
                            name={item.icon as any}
                            size={22}
                          />
                          <Text
                            style={[
                              modalStyles.optionText,
                              isSelected && modalStyles.optionTextSelected,
                            ]}>
                            {item.label}
                          </Text>
                        </View>
                        <View
                          style={[
                            modalStyles.checkbox,
                            isSelected && modalStyles.checkboxSelected,
                          ]}>
                          {isSelected && (
                            <Icon
                              color="#ffffff"
                              name={{ ios: 'checkmark', android: 'check', web: 'check' }}
                              size={14}
                              weight="bold"
                            />
                          )}
                        </View>
                      </Pressable>

                      {/* Conditional Render for 'Other' with smooth text input */}
                      {item.id === 'other' && isSelected && (
                        <View style={modalStyles.otherInputContainer}>
                          <TextInput
                            multiline
                            numberOfLines={2}
                            onChangeText={setOtherReasonText}
                            placeholder="Please specify the reason..."
                            placeholderTextColor="#9ca3af"
                            style={modalStyles.otherInput}
                            value={otherReasonText}
                          />
                        </View>
                      )}
                    </View>
                  );
                })}
              </ScrollView>

              {/* Sticky Action Button at Bottom */}
              <View style={modalStyles.actionContainer}>
                <Pressable
                  accessibilityRole="button"
                  disabled={!isConfirmActive}
                  onPress={handleConfirmUnsafe}
                  style={[
                    modalStyles.confirmButton,
                    isConfirmActive
                      ? modalStyles.confirmButtonActive
                      : modalStyles.confirmButtonDisabled,
                  ]}>
                  <Text
                    style={[
                      modalStyles.confirmButtonText,
                      isConfirmActive
                        ? modalStyles.confirmButtonTextActive
                        : modalStyles.confirmButtonTextDisabled,
                    ]}>
                    Confirm Unsafe
                  </Text>
                </Pressable>
              </View>
            </Animated.View>
          </View>
        </Modal>
      </View>
    </SafeAreaView>
  );
}

const styles = StyleSheet.create({
  safeArea: {
    backgroundColor: colors.background,
    flex: 1,
  },
  shell: {
    backgroundColor: colors.background,
    flex: 1,
    maxWidth: 448,
    width: '100%',
    alignSelf: 'center',
  },
  // 1. Header
  header: {
    alignItems: 'center',
    backgroundColor: colors.card,
    borderBottomColor: colors.outlineVariant,
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
    color: colors.primary,
    fontSize: 18,
    fontWeight: '700',
    textAlign: 'center',
  },
  headerPlaceholder: {
    width: 32,
  },
  scroll: {
    flex: 1,
  },
  scrollContent: {
    paddingHorizontal: 20,
    paddingTop: 16,
    paddingBottom: 24,
  },
  // 2. Worker Information Section
  workerInfoSection: {
    marginBottom: 16,
  },
  workerTitle: {
    color: colors.text,
    fontSize: 18,
    fontWeight: '700',
    marginBottom: 4,
  },
  bullet: {
    color: colors.border,
    fontWeight: '400',
  },
  locationRow: {
    alignItems: 'center',
    flexDirection: 'row',
    gap: 6,
  },
  locationText: {
    color: colors.textMuted,
    fontSize: 14,
  },
  // 3. Progress Bar Section
  progressSection: {
    marginBottom: 20,
  },
  progressText: {
    color: colors.primary,
    fontSize: 12,
    fontWeight: '700',
    letterSpacing: 0.8,
    marginBottom: 8,
    textTransform: 'uppercase',
  },
  progressBarTrack: {
    backgroundColor: colors.progressBg,
    borderRadius: 999,
    height: 5,
    overflow: 'hidden',
    width: '100%',
  },
  progressBarFill: {
    backgroundColor: colors.primary,
    borderRadius: 999,
    height: '100%',
  },
  // 4. Image Gallery Section
  gallerySection: {
    flexDirection: 'row',
    gap: 12,
    marginBottom: 28,
  },
  imageCard: {
    backgroundColor: colors.card,
    borderColor: colors.border,
    borderRadius: 12,
    borderWidth: 1,
    flex: 1,
    height: 280,
    overflow: 'hidden',
    position: 'relative',
  },
  badgeContainer: {
    backgroundColor: 'rgba(255, 255, 255, 0.95)',
    borderRadius: 6,
    elevation: 2,
    left: 8,
    paddingHorizontal: 8,
    paddingVertical: 4,
    position: 'absolute',
    shadowColor: '#000',
    shadowOffset: { width: 0, height: 1 },
    shadowOpacity: 0.1,
    shadowRadius: 2,
    top: 8,
    zIndex: 10,
  },
  badgeText: {
    color: colors.text,
    fontSize: 11,
    fontWeight: '700',
    letterSpacing: 1,
  },
  imagePhoto: {
    height: '100%',
    width: '100%',
  },
  // 5. Action Section
  actionSection: {
    marginBottom: 16,
  },
  actionQuestion: {
    color: colors.text,
    fontSize: 18,
    fontWeight: '700',
    marginBottom: 14,
    textAlign: 'center',
  },
  actionButtonsRow: {
    flexDirection: 'row',
    gap: 12,
  },
  unsafeButton: {
    alignItems: 'center',
    backgroundColor: colors.errorRed,
    borderRadius: 10,
    flex: 1,
    flexDirection: 'row',
    gap: 8,
    height: 48,
    justifyContent: 'center',
    shadowColor: colors.errorRed,
    shadowOffset: { width: 0, height: 2 },
    shadowOpacity: 0.2,
    shadowRadius: 4,
    elevation: 2,
  },
  safeButton: {
    alignItems: 'center',
    backgroundColor: colors.successGreen,
    borderRadius: 10,
    flex: 1,
    flexDirection: 'row',
    gap: 8,
    height: 48,
    justifyContent: 'center',
    shadowColor: colors.successGreen,
    shadowOffset: { width: 0, height: 2 },
    shadowOpacity: 0.2,
    shadowRadius: 4,
    elevation: 2,
  },
  buttonPressed: {
    opacity: 0.9,
    transform: [{ scale: 0.98 }],
  },
  actionButtonText: {
    color: colors.white,
    fontSize: 16,
    fontWeight: '700',
    letterSpacing: 0.5,
  },
  // 6. Footer Navigation
  footerNav: {
    alignItems: 'center',
    backgroundColor: 'rgba(255, 255, 255, 0.95)',
    borderTopColor: colors.outlineVariant,
    borderTopWidth: 1,
    flexDirection: 'row',
    height: 60,
    justifyContent: 'space-between',
    paddingHorizontal: 20,
  },
  navButton: {
    alignItems: 'center',
    flexDirection: 'row',
    gap: 6,
    paddingVertical: 8,
  },
  navButtonText: {
    color: colors.primary,
    fontSize: 15,
    fontWeight: '500',
  },
  navButtonNextText: {
    fontWeight: '700',
  },
});

const modalStyles = StyleSheet.create({
  overlay: {
    backgroundColor: 'transparent',
    flex: 1,
    justifyContent: 'flex-end',
  },
  backdrop: {
    ...StyleSheet.absoluteFill,
    backgroundColor: 'transparent',
  },
  sheetContainer: {
    alignSelf: 'center',
    backgroundColor: '#ffffff',
    borderColor: '#e5e7eb',
    borderTopLeftRadius: 24,
    borderTopRightRadius: 24,
    borderWidth: 1,
    borderBottomWidth: 0,
    elevation: 20,
    maxHeight: '75%',
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
  header: {
    paddingBottom: 12,
    paddingHorizontal: 20,
  },
  title: {
    color: '#111827',
    fontSize: 20,
    fontWeight: '700',
  },
  subtitle: {
    color: '#6b7280',
    fontSize: 13,
    marginTop: 2,
  },
  optionsList: {
    gap: 10,
    paddingBottom: 16,
    paddingHorizontal: 20,
  },
  optionWrapper: {
    gap: 8,
  },
  optionCard: {
    alignItems: 'center',
    backgroundColor: '#ffffff',
    borderColor: '#e5e7eb',
    borderRadius: 12,
    borderWidth: 1.5,
    flexDirection: 'row',
    justifyContent: 'space-between',
    paddingHorizontal: 16,
    paddingVertical: 13,
  },
  optionCardSelected: {
    backgroundColor: '#f0f7ff',
    borderColor: '#0082F0',
  },
  optionLeft: {
    alignItems: 'center',
    flexDirection: 'row',
    gap: 12,
  },
  optionText: {
    color: '#1f2937',
    fontSize: 15,
    fontWeight: '500',
  },
  optionTextSelected: {
    color: '#005cad',
    fontWeight: '600',
  },
  checkbox: {
    alignItems: 'center',
    borderColor: '#d1d5db',
    borderRadius: 12,
    borderWidth: 2,
    height: 22,
    justifyContent: 'center',
    width: 22,
  },
  checkboxSelected: {
    backgroundColor: '#0082F0',
    borderColor: '#0082F0',
  },
  otherInputContainer: {
    marginTop: 2,
  },
  otherInput: {
    backgroundColor: '#ffffff',
    borderColor: '#e5e7eb',
    borderRadius: 8,
    borderWidth: 1,
    color: '#111827',
    fontSize: 14,
    minHeight: 64,
    padding: 12,
    textAlignVertical: 'top',
  },
  actionContainer: {
    borderTopColor: '#f3f4f6',
    borderTopWidth: 1,
    paddingHorizontal: 20,
    paddingTop: 12,
  },
  confirmButton: {
    alignItems: 'center',
    borderRadius: 12,
    height: 48,
    justifyContent: 'center',
  },
  confirmButtonActive: {
    backgroundColor: '#0082F0',
  },
  confirmButtonDisabled: {
    backgroundColor: '#f3f4f6',
  },
  confirmButtonText: {
    fontSize: 16,
    fontWeight: '600',
  },
  confirmButtonTextActive: {
    color: '#ffffff',
  },
  confirmButtonTextDisabled: {
    color: '#9ca3af',
  },
});

export default ReviewDetailScreen;
