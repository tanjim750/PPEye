import { useLocalSearchParams, useRouter } from 'expo-router';
import { Image } from 'expo-image';
import { useEffect, useRef, useState } from 'react';
import {
  ActivityIndicator,
  Alert,
  Animated,
  BackHandler,
  Dimensions,
  Modal,
  PanResponder,
  Platform,
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
import {
  completeSubmissionReview,
  formatReviewDateTime,
  saveDraftSubmissionReview,
  markReviewReviewed,
  markReviewUnsafe,
  useReviews,
  WorkerReviewVerdict,
} from '@/features/reviews/services/reviews.service';
import { supabase } from '@/services/supabase/client';
import { getCachedImageUri, getImageUri } from '@/utils/image';
import { getValidAccessToken } from '@/services/google-drive/auth';

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

const sampleWorkerPhotos: Record<number, { front: any; back: any }> = {
  1: { front: assets.fieldSafeCheck, back: assets.captureRecentPhoto },
  2: { front: assets.fieldUnsafeCheck, back: assets.captureRecentPhoto },
  3: { front: assets.fieldSafeCheck, back: assets.captureRecentPhoto },
  4: { front: assets.fieldUnsafeCheck, back: assets.captureRecentPhoto },
};

const { width: SCREEN_WIDTH, height: SCREEN_HEIGHT } = Dimensions.get('window');

export function ReviewDetailScreen() {
  const router = useRouter();
  const insets = useSafeAreaInsets();
  const params = useLocalSearchParams<{ id?: string; submissionId?: string }>();
  const submissionId = params.id || params.submissionId;
  const { allReviews, inProgressCount } = useReviews();

  const currentReview = allReviews.find((r) => r.id === submissionId);

  useEffect(() => {
    if (inProgressCount >= 3 && currentReview && !currentReview.isDraft) {
      Alert.alert(
        'In-Progress Limit Reached',
        'Maximum 3 in-progress reviews allowed. Please complete your existing in-progress reviews before starting a new review.',
        [{ text: 'Cancel', onPress: () => router.back() }]
      );
    }
  }, [inProgressCount, currentReview, router]);

  // Dynamic context with requested defaults
  const vendorName = currentReview?.vendor || 'ABC Telecom';
  const workerName = currentReview?.teamLead
    ? currentReview.teamLead.split(' · ')[0]
    : 'Rahim Mia';
  const locationName = currentReview?.location || 'Gazipur-ER-102';
  const timeName = currentReview
    ? formatReviewDateTime(currentReview)
    : '10:42 AM';

  const totalWorkers = currentReview?.workers || 1;
  const [workerVerdicts, setWorkerVerdicts] = useState<Record<number, WorkerReviewVerdict>>(() => {
    if (currentReview?.workerReviews && currentReview.workerReviews.length > 0) {
      const map: Record<number, WorkerReviewVerdict> = {};
      for (const v of currentReview.workerReviews) {
        map[v.sequenceNo] = v;
      }
      return map;
    }
    return {};
  });
  const [currentWorkerIndex, setCurrentWorkerIndex] = useState(() => {
    if (currentReview?.workerReviews && currentReview.workerReviews.length > 0) {
      const reviewedSeqs = new Set(currentReview.workerReviews.map((w) => w.sequenceNo));
      for (let i = 1; i <= (currentReview.workers || 1); i++) {
        if (!reviewedSeqs.has(i)) return i;
      }
    }
    return 1;
  });
  const verdictsRef = useRef<Record<number, WorkerReviewVerdict>>(workerVerdicts);
  const isCompletedRef = useRef(false);
  const [isExitConfirmVisible, setIsExitConfirmVisible] = useState(false);

  useEffect(() => {
    // When reviewer enters, immediately mark as in-progress draft
    if (submissionId && (!currentReview || currentReview.status === 'waiting')) {
      saveDraftSubmissionReview(submissionId, Object.values(verdictsRef.current));
    }

    return () => {
      // If reviewer leaves screen without completing review, ensure it's saved as in-progress draft!
      if (!isCompletedRef.current && submissionId) {
        saveDraftSubmissionReview(submissionId, Object.values(verdictsRef.current));
      }
    };
  }, [submissionId]);

  useEffect(() => {
    const onBackPress = () => {
      handleRequestBack();
      return true;
    };
    const sub = BackHandler.addEventListener('hardwareBackPress', onBackPress);
    return () => sub.remove();
  }, []);

  // Unsafe Bottom Sheet States
  const [isUnsafeModalVisible, setIsUnsafeModalVisible] = useState(false);
  const [selectedReasons, setSelectedReasons] = useState<string[]>([]);
  const [otherReasonText, setOtherReasonText] = useState('');

  // Full-screen image zoom modal states & handlers
  const [zoomModalVisible, setZoomModalVisible] = useState(false);
  const [zoomedImage, setZoomedImage] = useState<{ source: any; title: string } | null>(null);
  const [zoomScale, setZoomScale] = useState(1);

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

  function handleZoomIn() {
    setZoomScale((prev) => Math.min(Number((prev + 0.5).toFixed(1)), 4));
  }

  function handleZoomOut() {
    setZoomScale((prev) => Math.max(Number((prev - 0.5).toFixed(1)), 1));
  }

  function handleResetZoom() {
    setZoomScale(1);
  }

type AuthImageSource = {
  uri: string;
  headers?: Record<string, string>;
};

async function buildImageSourceCandidates(
  fileIdOrUri?: string | null,
  forceRefreshAuth?: boolean
): Promise<AuthImageSource[]> {
  if (!fileIdOrUri || !fileIdOrUri.trim()) return [];
  const clean = fileIdOrUri.trim();
  if (
    clean.startsWith('file://') ||
    clean.startsWith('ph://') ||
    clean.startsWith('content://')
  ) {
    return [{ uri: clean }];
  }

  let driveId = clean;
  if (clean.startsWith('http://') || clean.startsWith('https://')) {
    const match =
      clean.match(/\/d\/([a-zA-Z0-9_-]+)/) || clean.match(/[?&]id=([a-zA-Z0-9_-]+)/);
    if (match && match[1]) {
      driveId = match[1];
    } else {
      return [{ uri: clean }];
    }
  }

  const list: AuthImageSource[] = [];

  // 1. Check local disk cache first
  const localCached = await getCachedImageUri(driveId).catch(() => null);
  if (localCached) {
    list.push({ uri: localCached });
  }

  // 2. Primary authorized endpoint with Bearer token (bypasses Google login redirects)
  const token = await getValidAccessToken(
    forceRefreshAuth ? { forceRefresh: true } : undefined
  ).catch(() => null);

  if (token) {
    list.push({
      uri: `https://www.googleapis.com/drive/v3/files/${encodeURIComponent(driveId)}?alt=media`,
      headers: { Authorization: `Bearer ${token}` },
    });
  }

  // 3. Public candidate endpoints fallback
  list.push({
    uri: `https://drive.google.com/thumbnail?id=${driveId}&sz=w800`,
  });
  list.push({
    uri: `https://lh3.googleusercontent.com/d/${driveId}`,
  });
  list.push({
    uri: `https://drive.google.com/uc?export=view&id=${driveId}`,
  });

  return list;
}

  // Private authorized image previews for FRONT and BACK
  const [frontSource, setFrontSource] = useState<AuthImageSource | null>(null);
  const [backSource, setBackSource] = useState<AuthImageSource | null>(null);
  const frontUri = frontSource?.uri || null;
  const backUri = backSource?.uri || null;
  const [isLoadingImages, setIsLoadingImages] = useState(false);
  const [isFrontLoading, setIsFrontLoading] = useState(false);
  const [isBackLoading, setIsBackLoading] = useState(false);
  const [frontLoadError, setFrontLoadError] = useState(false);
  const [backLoadError, setBackLoadError] = useState(false);
  const [hasFrontRecord, setHasFrontRecord] = useState(true);
  const [hasBackRecord, setHasBackRecord] = useState(true);

  const frontCandidatesRef = useRef<AuthImageSource[]>([]);
  const frontCandidateIndexRef = useRef<number>(0);
  const backCandidatesRef = useRef<AuthImageSource[]>([]);
  const backCandidateIndexRef = useRef<number>(0);
  const frontDriveIdRef = useRef<string | null>(null);
  const backDriveIdRef = useRef<string | null>(null);

  const handleFrontImageError = async () => {
    const candidates = frontCandidatesRef.current;
    const nextIdx = frontCandidateIndexRef.current + 1;
    if (nextIdx < candidates.length) {
      console.log(`[ReviewDetail] Front photo fallback: trying candidate ${nextIdx + 1}/${candidates.length}`);
      frontCandidateIndexRef.current = nextIdx;
      setFrontSource(candidates[nextIdx]);
      setIsFrontLoading(true);
    } else {
      const driveId = frontDriveIdRef.current;
      if (driveId) {
        try {
          const freshToken = await getValidAccessToken({ forceRefresh: true });
          if (freshToken) {
            setFrontSource({
              uri: `https://www.googleapis.com/drive/v3/files/${encodeURIComponent(driveId)}?alt=media`,
              headers: { Authorization: `Bearer ${freshToken}` },
            });
            setIsFrontLoading(true);
            return;
          }
        } catch {}
      }
      console.warn('[ReviewDetail] All front image candidate URLs failed to load');
      setIsFrontLoading(false);
      setFrontLoadError(true);
    }
  };

  const handleBackImageError = async () => {
    const candidates = backCandidatesRef.current;
    const nextIdx = backCandidateIndexRef.current + 1;
    if (nextIdx < candidates.length) {
      console.log(`[ReviewDetail] Back photo fallback: trying candidate ${nextIdx + 1}/${candidates.length}`);
      backCandidateIndexRef.current = nextIdx;
      setBackSource(candidates[nextIdx]);
      setIsBackLoading(true);
    } else {
      const driveId = backDriveIdRef.current;
      if (driveId) {
        try {
          const freshToken = await getValidAccessToken({ forceRefresh: true });
          if (freshToken) {
            setBackSource({
              uri: `https://www.googleapis.com/drive/v3/files/${encodeURIComponent(driveId)}?alt=media`,
              headers: { Authorization: `Bearer ${freshToken}` },
            });
            setIsBackLoading(true);
            return;
          }
        } catch {}
      }
      console.warn('[ReviewDetail] All back image candidate URLs failed to load');
      setIsBackLoading(false);
      setBackLoadError(true);
    }
  };

  const retryFrontImage = async () => {
    setFrontLoadError(false);
    setIsFrontLoading(true);
    const driveId = frontDriveIdRef.current;
    if (driveId) {
      try {
        const local = await getImageUri(driveId, { forceRefresh: true });
        if (local) {
          setFrontSource({ uri: local });
          setIsFrontLoading(false);
          return;
        }
      } catch (err) {
        console.warn('[ReviewDetail] retryFrontImage getImageUri error:', err);
      }
    }
    const candidates = await buildImageSourceCandidates(driveId, true);
    frontCandidatesRef.current = candidates;
    frontCandidateIndexRef.current = 0;
    if (candidates.length > 0) {
      setFrontSource(candidates[0]);
    } else {
      setIsFrontLoading(false);
      setFrontLoadError(true);
    }
  };

  const retryBackImage = async () => {
    setBackLoadError(false);
    setIsBackLoading(true);
    const driveId = backDriveIdRef.current;
    if (driveId) {
      try {
        const local = await getImageUri(driveId, { forceRefresh: true });
        if (local) {
          setBackSource({ uri: local });
          setIsBackLoading(false);
          return;
        }
      } catch (err) {
        console.warn('[ReviewDetail] retryBackImage getImageUri error:', err);
      }
    }
    const candidates = await buildImageSourceCandidates(driveId, true);
    backCandidatesRef.current = candidates;
    backCandidateIndexRef.current = 0;
    if (candidates.length > 0) {
      setBackSource(candidates[0]);
    } else {
      setIsBackLoading(false);
      setBackLoadError(true);
    }
  };

  useEffect(() => {
    let isCancelled = false;
    setFrontSource(null);
    setBackSource(null);
    setFrontLoadError(false);
    setBackLoadError(false);
    setHasFrontRecord(true);
    setHasBackRecord(true);
    setIsFrontLoading(true);
    setIsBackLoading(true);

    async function loadWorkerImages() {
      const parsedSubId = Number(submissionId);
      if (!parsedSubId || isNaN(parsedSubId)) {
        setIsLoadingImages(false);
        setIsFrontLoading(false);
        setIsBackLoading(false);
        return;
      }

      setIsLoadingImages(true);
      try {
        const { data: instances, error: instError } = await supabase
          .from('ppe_worker_instances')
          .select(`
            id,
            sequence_no,
            ppe_images (
              id,
              side,
              file_id,
              files (
                id,
                file_name,
                provider_file_id
              )
            )
          `)
          .eq('submission_id', parsedSubId);

        const instList: any[] = (instances as any[]) || [];
        if (instError || instList.length === 0) {
          console.warn('[ReviewDetailScreen] No worker instances found for sub:', parsedSubId, instError);
          if (!isCancelled) {
            setIsLoadingImages(false);
            setIsFrontLoading(false);
            setIsBackLoading(false);
            setHasFrontRecord(false);
            setHasBackRecord(false);
          }
          return;
        }

        const worker =
          instList.find((w) => w.sequence_no === currentWorkerIndex) ||
          instList[currentWorkerIndex - 1] ||
          instList[0];

        if (worker && !isCancelled) {
          const images = (worker.ppe_images as any[]) || [];
          const frontImg = images.find((img) => img.side === 'FRONT');
          const backImg = images.find((img) => img.side === 'BACK');

          const frontRawFile = Array.isArray(frontImg?.files) ? frontImg.files[0] : frontImg?.files;
          let frontDriveId = frontRawFile?.provider_file_id || (frontRawFile as any)?.drive_id;
          if (!frontDriveId && frontImg?.file_id) {
            const { data: fRow } = await supabase
              .from('files')
              .select('provider_file_id')
              .eq('id', frontImg.file_id)
              .maybeSingle();
            frontDriveId = (fRow as any)?.provider_file_id;
          }
          frontDriveIdRef.current = frontDriveId || null;

          const backRawFile = Array.isArray(backImg?.files) ? backImg.files[0] : backImg?.files;
          let backDriveId = backRawFile?.provider_file_id || (backRawFile as any)?.drive_id;
          if (!backDriveId && backImg?.file_id) {
            const { data: bRow } = await supabase
              .from('files')
              .select('provider_file_id')
              .eq('id', backImg.file_id)
              .maybeSingle();
            backDriveId = (bRow as any)?.provider_file_id;
          }
          backDriveIdRef.current = backDriveId || null;

          if (frontDriveId && !isCancelled) {
            setHasFrontRecord(true);
            buildImageSourceCandidates(frontDriveId).then((candidates) => {
              if (isCancelled) return;
              frontCandidatesRef.current = candidates;
              frontCandidateIndexRef.current = 0;
              if (candidates.length > 0) {
                setFrontSource(candidates[0]);
              } else {
                setFrontLoadError(true);
                setIsFrontLoading(false);
              }
            });

            // Asynchronously download into local disk cache in background
            getImageUri(frontDriveId)
              .then((downloaded) => {
                if (!isCancelled && downloaded) {
                  setFrontSource({ uri: downloaded });
                  setFrontLoadError(false);
                  setIsFrontLoading(false);
                }
              })
              .catch((err) => {
                console.warn('[ReviewDetail] Background front image cache note:', err);
              });
          } else if (!isCancelled) {
            setHasFrontRecord(false);
            setIsFrontLoading(false);
          }

          if (backDriveId && !isCancelled) {
            setHasBackRecord(true);
            buildImageSourceCandidates(backDriveId).then((candidates) => {
              if (isCancelled) return;
              backCandidatesRef.current = candidates;
              backCandidateIndexRef.current = 0;
              if (candidates.length > 0) {
                setBackSource(candidates[0]);
              } else {
                setBackLoadError(true);
                setIsBackLoading(false);
              }
            });

            // Asynchronously download into local disk cache in background
            getImageUri(backDriveId)
              .then((downloaded) => {
                if (!isCancelled && downloaded) {
                  setBackSource({ uri: downloaded });
                  setBackLoadError(false);
                  setIsBackLoading(false);
                }
              })
              .catch((err) => {
                console.warn('[ReviewDetail] Background back image cache note:', err);
              });
          } else if (!isCancelled) {
            setHasBackRecord(false);
            setIsBackLoading(false);
          }
        }
      } catch (err) {
        console.warn('[ReviewDetailScreen] Error loading worker images from DB:', err);
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
    const updatedVerdicts = {
      ...workerVerdicts,
      [currentWorkerIndex]: {
        sequenceNo: currentWorkerIndex,
        workerName: `Worker ${currentWorkerIndex}`,
        status: 'safe' as const,
        frontUri,
        backUri,
        frontDriveId: frontDriveIdRef.current,
        backDriveId: backDriveIdRef.current,
        reviewedAt: Date.now(),
      },
    };
    setWorkerVerdicts(updatedVerdicts);
    verdictsRef.current = updatedVerdicts;

    // Immediately save draft in memory so pending/recent reflects this worker review instantaneously!
    if (submissionId) {
      saveDraftSubmissionReview(submissionId, Object.values(updatedVerdicts));
    }

    // Auto advance to next worker if not last worker
    if (currentWorkerIndex < totalWorkers) {
      setCurrentWorkerIndex((prev) => prev + 1);
    }
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
    const existing = workerVerdicts[currentWorkerIndex];
    if (existing && existing.status === 'unsafe') {
      setSelectedReasons(existing.unsafeReasons || []);
      setOtherReasonText(existing.otherReasonText || '');
    } else {
      setSelectedReasons([]);
      setOtherReasonText('');
    }
    translateY.setValue(0);
    setIsUnsafeModalVisible(true);
  }

  function handleConfirmUnsafe() {
    if (!isConfirmActive) return;

    const updatedVerdicts = {
      ...workerVerdicts,
      [currentWorkerIndex]: {
        sequenceNo: currentWorkerIndex,
        workerName: `Worker ${currentWorkerIndex}`,
        status: 'unsafe' as const,
        unsafeReasons: [...selectedReasons],
        otherReasonText: otherReasonText.trim() || undefined,
        frontUri,
        backUri,
        frontDriveId: frontDriveIdRef.current,
        backDriveId: backDriveIdRef.current,
        reviewedAt: Date.now(),
      },
    };
    setWorkerVerdicts(updatedVerdicts);
    verdictsRef.current = updatedVerdicts;

    // Immediately save draft in memory so pending/recent reflects this worker review instantaneously!
    if (submissionId) {
      saveDraftSubmissionReview(submissionId, Object.values(updatedVerdicts));
    }

    setIsUnsafeModalVisible(false);
    setSelectedReasons([]);
    setOtherReasonText('');

    // Auto advance to next worker if not last worker
    if (currentWorkerIndex < totalWorkers) {
      setCurrentWorkerIndex((prev) => prev + 1);
    }
  }

  function handleFinalConfirmReview(customVerdictsMap?: Record<number, WorkerReviewVerdict>) {
    const targetMap = { ...(customVerdictsMap || verdictsRef.current) };
    if (!targetMap[currentWorkerIndex] && workerVerdicts[currentWorkerIndex]) {
      targetMap[currentWorkerIndex] = workerVerdicts[currentWorkerIndex];
    }

    // Verify all workers from 1 to totalWorkers have been decided
    for (let i = 1; i <= totalWorkers; i++) {
      if (!targetMap[i]) {
        Alert.alert(
          'Decision Required',
          `Please select SAFE or UNSAFE for Worker ${i} before confirming the review.`
        );
        setCurrentWorkerIndex(i);
        return;
      }
    }

    isCompletedRef.current = true;
    const verdicts = Object.values(targetMap);
    completeSubmissionReview(
      submissionId || 'rev-01',
      verdicts
    );
    // Direct navigation to Pending reviews page
    router.replace('/(internal)/reviews');
  }

  function handleRequestBack() {
    setIsExitConfirmVisible(true);
  }

  function handleConfirmLeave() {
    setIsExitConfirmVisible(false);
    const verdicts = Object.values(verdictsRef.current);
    saveDraftSubmissionReview(
      submissionId || 'rev-01',
      verdicts
    );
    router.back();
  }

  function handlePrevious() {
    if (currentWorkerIndex > 1) {
      setCurrentWorkerIndex((prev) => prev - 1);
    } else {
      handleRequestBack();
    }
  }

  function handleNext() {
    if (currentWorkerIndex < totalWorkers) {
      setCurrentWorkerIndex((prev) => prev + 1);
    } else {
      if (workerVerdicts[currentWorkerIndex]) {
        handleFinalConfirmReview();
      } else {
        Alert.alert(
          'Decision Required',
          'Please select SAFE or UNSAFE before confirming the review.'
        );
      }
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
            onPress={handleRequestBack}
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

              {frontLoadError ? (
                <View style={styles.errorPhotoContainer}>
                  <Icon
                    color={colors.errorRed}
                    name={{ ios: 'exclamationmark.circle', android: 'error_outline', web: 'error_outline' }}
                    size={28}
                  />
                  <Text style={styles.errorPhotoTitle}>Failed to load</Text>
                  <Text style={styles.errorPhotoSubtitle}>Network or rate limit</Text>
                  <Pressable
                    accessibilityLabel="Retry loading front photo"
                    accessibilityRole="button"
                    onPress={retryFrontImage}
                    style={styles.retryButton}>
                    <Icon
                      color="#ffffff"
                      name={{ ios: 'arrow.clockwise', android: 'refresh', web: 'refresh' }}
                      size={13}
                      weight="bold"
                    />
                    <Text style={styles.retryButtonText}>Tap to Retry</Text>
                  </Pressable>
                </View>
              ) : !hasFrontRecord && !isNaN(Number(submissionId)) ? (
                <View style={styles.noPhotoContainer}>
                  <Icon
                    color={colors.textMuted}
                    name={{ ios: 'camera.badge.ellipsis', android: 'no_photography', web: 'no_photography' }}
                    size={28}
                  />
                  <Text style={styles.noPhotoTitle}>No Front View</Text>
                  <Text style={styles.noPhotoSubtitle}>Worker submitted without front photo</Text>
                </View>
              ) : frontSource ? (
                <>
                  <Image
                    contentFit="cover"
                    onError={handleFrontImageError}
                    onLoadEnd={() => setIsFrontLoading(false)}
                    onLoadStart={() => setIsFrontLoading(true)}
                    source={frontSource}
                    style={styles.imagePhoto}
                  />
                  {isFrontLoading && (
                    <View style={styles.loadingPhotoOverlay}>
                      <ActivityIndicator color={colors.primary} size="large" />
                    </View>
                  )}
                </>
              ) : !isNaN(Number(submissionId)) ? (
                <View style={styles.loadingPhotoContainer}>
                  <ActivityIndicator color={colors.primary} size="large" />
                </View>
              ) : (
                <Image
                  contentFit="cover"
                  source={sampleWorkerPhotos[currentWorkerIndex]?.front || assets.fieldSafeCheck}
                  style={styles.imagePhoto}
                />
              )}

              {/* Zoom Button on bottom right (only when image is valid) */}
              {Boolean(frontSource && !frontLoadError) && (
                <Pressable
                  accessibilityLabel="Zoom Front Image"
                  accessibilityRole="button"
                  onPress={() => {
                    const src = frontSource || (!isNaN(Number(submissionId)) ? null : (sampleWorkerPhotos[currentWorkerIndex]?.front || assets.fieldSafeCheck));
                    if (src) {
                      openZoomModal(src, `Worker ${currentWorkerIndex} • FRONT VIEW`);
                    }
                  }}
                  style={({ pressed }) => [
                    styles.zoomButton,
                    pressed && styles.pressedOpacity,
                  ]}>
                  <Icon
                    color="#ffffff"
                    name={{ ios: 'arrow.up.left.and.arrow.down.right', android: 'zoom_in', web: 'zoom_in' }}
                    size={16}
                    weight="bold"
                  />
                </Pressable>
              )}
            </View>

            {/* BACK Image Card */}
            <View style={styles.imageCard}>
              <View style={styles.badgeContainer}>
                <Text style={styles.badgeText}>BACK</Text>
              </View>

              {backLoadError ? (
                <View style={styles.errorPhotoContainer}>
                  <Icon
                    color={colors.errorRed}
                    name={{ ios: 'exclamationmark.circle', android: 'error_outline', web: 'error_outline' }}
                    size={28}
                  />
                  <Text style={styles.errorPhotoTitle}>Failed to load</Text>
                  <Text style={styles.errorPhotoSubtitle}>Network or rate limit</Text>
                  <Pressable
                    accessibilityLabel="Retry loading back photo"
                    accessibilityRole="button"
                    onPress={retryBackImage}
                    style={styles.retryButton}>
                    <Icon
                      color="#ffffff"
                      name={{ ios: 'arrow.clockwise', android: 'refresh', web: 'refresh' }}
                      size={13}
                      weight="bold"
                    />
                    <Text style={styles.retryButtonText}>Tap to Retry</Text>
                  </Pressable>
                </View>
              ) : !hasBackRecord && !isNaN(Number(submissionId)) ? (
                <View style={styles.noPhotoContainer}>
                  <Icon
                    color={colors.textMuted}
                    name={{ ios: 'camera.badge.ellipsis', android: 'no_photography', web: 'no_photography' }}
                    size={28}
                  />
                  <Text style={styles.noPhotoTitle}>No Back View</Text>
                  <Text style={styles.noPhotoSubtitle}>Worker submitted without back photo</Text>
                </View>
              ) : backSource ? (
                <>
                  <Image
                    contentFit="cover"
                    onError={handleBackImageError}
                    onLoadEnd={() => setIsBackLoading(false)}
                    onLoadStart={() => setIsBackLoading(true)}
                    source={backSource}
                    style={styles.imagePhoto}
                  />
                  {isBackLoading && (
                    <View style={styles.loadingPhotoOverlay}>
                      <ActivityIndicator color={colors.primary} size="large" />
                    </View>
                  )}
                </>
              ) : !isNaN(Number(submissionId)) ? (
                <View style={styles.loadingPhotoContainer}>
                  <ActivityIndicator color={colors.primary} size="large" />
                </View>
              ) : (
                <Image
                  contentFit="cover"
                  source={sampleWorkerPhotos[currentWorkerIndex]?.back || assets.captureRecentPhoto}
                  style={styles.imagePhoto}
                />
              )}

              {/* Zoom Button on bottom right (only when image is valid) */}
              {Boolean(backSource && !backLoadError) && (
                <Pressable
                  accessibilityLabel="Zoom Back Image"
                  accessibilityRole="button"
                  onPress={() => {
                    const src = backSource || (!isNaN(Number(submissionId)) ? null : (sampleWorkerPhotos[currentWorkerIndex]?.back || assets.captureRecentPhoto));
                    if (src) {
                      openZoomModal(src, `Worker ${currentWorkerIndex} • BACK VIEW`);
                    }
                  }}
                  style={({ pressed }) => [
                    styles.zoomButton,
                    pressed && styles.pressedOpacity,
                  ]}>
                  <Icon
                    color="#ffffff"
                    name={{ ios: 'arrow.up.left.and.arrow.down.right', android: 'zoom_in', web: 'zoom_in' }}
                    size={16}
                    weight="bold"
                  />
                </Pressable>
              )}
            </View>
          </View>

          {/* 5. Action Section */}
          <View style={styles.actionSection}>
            {/* Current Worker Verdict Banner (if previously reviewed and navigated back) */}
            {workerVerdicts[currentWorkerIndex] && (
              <View
                style={[
                  styles.currentVerdictBanner,
                  workerVerdicts[currentWorkerIndex]?.status === 'safe'
                    ? styles.currentVerdictSafe
                    : styles.currentVerdictUnsafe,
                ]}>
                <Icon
                  color={
                    workerVerdicts[currentWorkerIndex]?.status === 'safe'
                      ? colors.successGreen
                      : colors.errorRed
                  }
                  name={
                    workerVerdicts[currentWorkerIndex]?.status === 'safe'
                      ? { ios: 'checkmark.circle.fill', android: 'check_circle', web: 'check_circle' }
                      : { ios: 'xmark.circle.fill', android: 'cancel', web: 'cancel' }
                  }
                  size={15}
                />
                <Text
                  style={[
                    styles.currentVerdictText,
                    {
                      color:
                        workerVerdicts[currentWorkerIndex]?.status === 'safe'
                          ? colors.successGreen
                          : colors.errorRed,
                    },
                  ]}>
                  {workerVerdicts[currentWorkerIndex]?.status === 'safe'
                    ? 'Current decision: SAFE'
                    : 'Current decision: UNSAFE'}
                </Text>
              </View>
            )}

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

        {/* 6. Footer Navigation: Previous, Next Worker, or Confirm Review */}
        <View
          style={[
            styles.footerNav,
            {
              paddingBottom: Math.max(insets.bottom, 12),
              height: 56 + Math.max(insets.bottom, 12),
              justifyContent: totalWorkers > 1 ? 'space-between' : 'flex-end',
            },
          ]}>
          {totalWorkers > 1 && (
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
          )}

          <Pressable
            accessibilityRole="button"
            onPress={handleNext}
            style={({ pressed }) => [styles.navButton, pressed && styles.pressedOpacity]}>
            <Text style={[styles.navButtonText, styles.navButtonNextText]}>
              {currentWorkerIndex === totalWorkers ? 'Confirm Review' : 'Next Worker'}
            </Text>
            <Icon
              color={colors.primary}
              name={
                currentWorkerIndex === totalWorkers
                  ? { ios: 'checkmark', android: 'check', web: 'check' }
                  : { ios: 'chevron.right', android: 'chevron_right', web: 'chevron_right' }
              }
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

        {/* Exit Confirmation Modal */}
        <Modal
          animationType="fade"
          onRequestClose={() => setIsExitConfirmVisible(false)}
          transparent
          visible={isExitConfirmVisible}>
          <View style={confirmStyles.backdrop}>
            <Pressable
              accessibilityLabel="Dismiss dialog"
              accessibilityRole="button"
              onPress={() => setIsExitConfirmVisible(false)}
              style={[StyleSheet.absoluteFill, { backgroundColor: 'rgba(0, 0, 0, 0.45)' }]}
            />
            <View style={confirmStyles.card}>
              <View style={confirmStyles.iconBox}>
                <Icon
                  color={colors.errorRed}
                  name={{
                    ios: 'exclamationmark.triangle.fill',
                    android: 'warning',
                    web: 'warning',
                  }}
                  size={28}
                  weight="bold"
                />
              </View>
              <Text style={confirmStyles.title}>Leave Review?</Text>
              <Text style={confirmStyles.message}>
                Review is currently in progress. If you leave now, the reviews you have completed so far will be saved.
              </Text>
              <View style={confirmStyles.actions}>
                <Pressable
                  accessibilityRole="button"
                  onPress={() => setIsExitConfirmVisible(false)}
                  style={({ pressed }) => [confirmStyles.cancelButton, pressed && styles.pressedOpacity]}>
                  <Text style={confirmStyles.cancelText}>Keep Reviewing</Text>
                </Pressable>
                <Pressable
                  accessibilityRole="button"
                  onPress={handleConfirmLeave}
                  style={({ pressed }) => [confirmStyles.leaveButton, pressed && styles.pressedOpacity]}>
                  <Text style={confirmStyles.leaveText}>Leave</Text>
                </Pressable>
              </View>
            </View>
          </View>
        </Modal>

        {/* Full-Screen Image Zoom Inspection Modal */}
        <Modal
          animationType="fade"
          onRequestClose={closeZoomModal}
          transparent={true}
          visible={zoomModalVisible}>
          <View style={zoomModalStyles.overlay}>
            {/* Safe Header */}
            <SafeAreaView edges={['top']} style={zoomModalStyles.safeHeader}>
              <View style={zoomModalStyles.header}>
                <View style={zoomModalStyles.headerTitleContainer}>
                  <Text numberOfLines={1} style={zoomModalStyles.headerTitle}>
                    {zoomedImage?.title || 'Inspect Image'}
                  </Text>
                  <Text style={zoomModalStyles.headerSubtitle}>
                    Pinch or use buttons below to zoom
                  </Text>
                </View>
                <Pressable
                  accessibilityLabel="Close image view"
                  accessibilityRole="button"
                  hitSlop={{ top: 12, bottom: 12, left: 12, right: 12 }}
                  onPress={closeZoomModal}
                  style={({ pressed }) => [
                    zoomModalStyles.closeButton,
                    pressed && styles.pressedOpacity,
                  ]}>
                  <Icon
                    color="#ffffff"
                    name={{ ios: 'xmark', android: 'close', web: 'close' }}
                    size={20}
                    weight="bold"
                  />
                </Pressable>
              </View>
            </SafeAreaView>

            {/* Zoomable Image View */}
            <ScrollView
              centerContent
              contentContainerStyle={zoomModalStyles.scrollContent}
              maximumZoomScale={4.0}
              minimumZoomScale={1.0}
              showsHorizontalScrollIndicator={false}
              showsVerticalScrollIndicator={false}
              style={zoomModalStyles.scrollArea}>
              {zoomedImage?.source && (
                <Animated.View
                  style={{
                    transform: [{ scale: zoomScale }],
                    alignItems: 'center',
                    justifyContent: 'center',
                  }}>
                  <Image
                    contentFit="contain"
                    source={zoomedImage.source}
                    style={zoomModalStyles.zoomedImage}
                  />
                </Animated.View>
              )}
            </ScrollView>

            {/* Bottom Floating Zoom Controls */}
            <SafeAreaView edges={['bottom']} style={zoomModalStyles.safeFooter}>
              <View style={zoomModalStyles.zoomControlsBar}>
                <Pressable
                  accessibilityLabel="Zoom out"
                  accessibilityRole="button"
                  disabled={zoomScale <= 1}
                  onPress={handleZoomOut}
                  style={({ pressed }) => [
                    zoomModalStyles.controlBtn,
                    zoomScale <= 1 && zoomModalStyles.controlBtnDisabled,
                    pressed && styles.pressedOpacity,
                  ]}>
                  <Icon
                    color={zoomScale <= 1 ? 'rgba(255,255,255,0.4)' : '#ffffff'}
                    name={{ ios: 'minus', android: 'remove', web: 'remove' }}
                    size={20}
                    weight="bold"
                  />
                </Pressable>

                <Pressable
                  accessibilityLabel="Reset zoom"
                  accessibilityRole="button"
                  onPress={handleResetZoom}
                  style={({ pressed }) => [
                    zoomModalStyles.resetBtn,
                    pressed && styles.pressedOpacity,
                  ]}>
                  <Text style={zoomModalStyles.resetText}>
                    {zoomScale.toFixed(1)}x • Reset
                  </Text>
                </Pressable>

                <Pressable
                  accessibilityLabel="Zoom in"
                  accessibilityRole="button"
                  disabled={zoomScale >= 4}
                  onPress={handleZoomIn}
                  style={({ pressed }) => [
                    zoomModalStyles.controlBtn,
                    zoomScale >= 4 && zoomModalStyles.controlBtnDisabled,
                    pressed && styles.pressedOpacity,
                  ]}>
                  <Icon
                    color={zoomScale >= 4 ? 'rgba(255,255,255,0.4)' : '#ffffff'}
                    name={{ ios: 'plus', android: 'add', web: 'add' }}
                    size={20}
                    weight="bold"
                  />
                </Pressable>
              </View>
            </SafeAreaView>
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
  loadingPhotoContainer: {
    alignItems: 'center',
    backgroundColor: '#f1f5f9',
    flex: 1,
    justifyContent: 'center',
  },
  loadingPhotoOverlay: {
    ...StyleSheet.absoluteFill,
    alignItems: 'center',
    backgroundColor: 'rgba(241, 245, 249, 0.75)',
    justifyContent: 'center',
    zIndex: 5,
  },
  errorPhotoContainer: {
    alignItems: 'center',
    backgroundColor: '#fff5f5',
    flex: 1,
    justifyContent: 'center',
    padding: 16,
    gap: 4,
  },
  errorPhotoTitle: {
    color: colors.errorRed,
    fontSize: 13,
    fontWeight: '700',
    marginTop: 4,
    textAlign: 'center',
  },
  errorPhotoSubtitle: {
    color: colors.textMuted,
    fontSize: 11,
    textAlign: 'center',
    marginBottom: 6,
  },
  retryButton: {
    alignItems: 'center',
    backgroundColor: colors.primary,
    borderRadius: 8,
    flexDirection: 'row',
    gap: 6,
    paddingHorizontal: 12,
    paddingVertical: 7,
    marginTop: 2,
    shadowColor: '#000',
    shadowOffset: { width: 0, height: 1 },
    shadowOpacity: 0.15,
    shadowRadius: 2,
    elevation: 2,
  },
  retryButtonText: {
    color: '#ffffff',
    fontSize: 12,
    fontWeight: '600',
  },
  noPhotoContainer: {
    alignItems: 'center',
    backgroundColor: '#f8fafc',
    flex: 1,
    justifyContent: 'center',
    padding: 16,
    gap: 4,
  },
  noPhotoTitle: {
    color: colors.text,
    fontSize: 13,
    fontWeight: '700',
    marginTop: 4,
    textAlign: 'center',
  },
  noPhotoSubtitle: {
    color: colors.textMuted,
    fontSize: 11,
    textAlign: 'center',
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
  currentVerdictBanner: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'center',
    gap: 6,
    paddingVertical: 6,
    paddingHorizontal: 12,
    borderRadius: 8,
    marginBottom: 10,
    alignSelf: 'center',
  },
  currentVerdictSafe: {
    backgroundColor: '#ecfdf5',
    borderColor: 'rgba(22, 163, 74, 0.25)',
    borderWidth: 1,
  },
  currentVerdictUnsafe: {
    backgroundColor: '#fef2f2',
    borderColor: 'rgba(186, 26, 26, 0.25)',
    borderWidth: 1,
  },
  currentVerdictText: {
    fontSize: 12,
    fontWeight: '700',
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
  navButtonComplete: {
    backgroundColor: colors.primary,
    borderRadius: 8,
    paddingHorizontal: 12,
    paddingVertical: 6,
  },
  navButtonCompleteText: {
    color: colors.white,
    fontWeight: '700',
  },
  zoomButton: {
    alignItems: 'center',
    backgroundColor: 'rgba(24, 28, 34, 0.75)',
    borderRadius: 6,
    bottom: 8,
    elevation: 4,
    height: 32,
    justifyContent: 'center',
    position: 'absolute',
    right: 8,
    shadowColor: '#000',
    shadowOffset: { width: 0, height: 1 },
    shadowOpacity: 0.25,
    shadowRadius: 2,
    width: 32,
    zIndex: 10,
  },
  confirmReviewButton: {
    alignItems: 'center',
    backgroundColor: colors.primary,
    borderRadius: 10,
    flexDirection: 'row',
    gap: 8,
    height: 48,
    justifyContent: 'center',
    marginTop: 14,
    shadowColor: colors.primary,
    shadowOffset: { width: 0, height: 2 },
    shadowOpacity: 0.25,
    shadowRadius: 4,
    elevation: 3,
    width: '100%',
  },
  confirmReviewButtonText: {
    color: colors.white,
    fontSize: 16,
    fontWeight: '700',
    letterSpacing: 0.3,
  },
  nextWorkerActionButton: {
    alignItems: 'center',
    backgroundColor: colors.primary,
    borderRadius: 10,
    flexDirection: 'row',
    gap: 8,
    height: 48,
    justifyContent: 'center',
    marginTop: 14,
    shadowColor: colors.primary,
    shadowOffset: { width: 0, height: 2 },
    shadowOpacity: 0.25,
    shadowRadius: 4,
    elevation: 3,
    width: '100%',
  },
  nextWorkerActionButtonText: {
    color: colors.white,
    fontSize: 16,
    fontWeight: '700',
    letterSpacing: 0.3,
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

const confirmStyles = StyleSheet.create({
  backdrop: {
    alignItems: 'center',
    backgroundColor: 'rgba(0, 0, 0, 0.45)',
    flex: 1,
    justifyContent: 'center',
    padding: 24,
  },
  card: {
    alignItems: 'center',
    backgroundColor: colors.white,
    borderColor: '#e5e7eb',
    borderRadius: 16,
    borderWidth: 1,
    elevation: 20,
    gap: 12,
    maxWidth: 360,
    padding: 22,
    shadowColor: '#000000',
    shadowOffset: { height: 10, width: 0 },
    shadowOpacity: 0.25,
    shadowRadius: 20,
    width: '100%',
  },
  iconBox: {
    alignItems: 'center',
    backgroundColor: 'rgba(186, 26, 26, 0.1)',
    borderRadius: 999,
    height: 54,
    justifyContent: 'center',
    width: 54,
  },
  title: {
    color: colors.text,
    fontSize: 20,
    fontWeight: '800',
    lineHeight: 26,
    textAlign: 'center',
  },
  message: {
    color: colors.textMuted,
    fontSize: 14,
    fontWeight: '500',
    lineHeight: 21,
    textAlign: 'center',
  },
  actions: {
    flexDirection: 'row',
    gap: 10,
    marginTop: 8,
    width: '100%',
  },
  cancelButton: {
    alignItems: 'center',
    backgroundColor: '#f3f4f6',
    borderColor: '#e5e7eb',
    borderRadius: 10,
    borderWidth: 1,
    flex: 1,
    justifyContent: 'center',
    minHeight: 44,
    paddingHorizontal: 10,
  },
  cancelText: {
    color: '#374151',
    fontSize: 14,
    fontWeight: '600',
  },
  leaveButton: {
    alignItems: 'center',
    backgroundColor: colors.errorRed,
    borderRadius: 10,
    flex: 1,
    justifyContent: 'center',
    minHeight: 44,
    paddingHorizontal: 10,
  },
  leaveText: {
    color: colors.white,
    fontSize: 14,
    fontWeight: '700',
  },
});

const zoomModalStyles = StyleSheet.create({
  overlay: {
    backgroundColor: '#000000',
    flex: 1,
  },
  safeHeader: {
    backgroundColor: 'rgba(0, 0, 0, 0.85)',
    zIndex: 20,
  },
  header: {
    alignItems: 'center',
    flexDirection: 'row',
    justifyContent: 'space-between',
    paddingHorizontal: 20,
    paddingVertical: 12,
  },
  headerTitleContainer: {
    flex: 1,
    paddingRight: 12,
  },
  headerTitle: {
    color: '#ffffff',
    fontSize: 16,
    fontWeight: '700',
  },
  headerSubtitle: {
    color: 'rgba(255, 255, 255, 0.65)',
    fontSize: 12,
    marginTop: 2,
  },
  closeButton: {
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
    height: SCREEN_HEIGHT * 0.72,
    width: SCREEN_WIDTH,
  },
  safeFooter: {
    backgroundColor: 'rgba(0, 0, 0, 0.85)',
  },
  zoomControlsBar: {
    alignItems: 'center',
    alignSelf: 'center',
    backgroundColor: 'rgba(30, 30, 30, 0.9)',
    borderColor: 'rgba(255, 255, 255, 0.2)',
    borderRadius: 24,
    borderWidth: 1,
    flexDirection: 'row',
    gap: 8,
    marginBottom: 16,
    marginTop: 8,
    paddingHorizontal: 16,
    paddingVertical: 6,
  },
  controlBtn: {
    alignItems: 'center',
    borderRadius: 16,
    height: 34,
    justifyContent: 'center',
    width: 34,
  },
  controlBtnDisabled: {
    opacity: 0.35,
  },
  resetBtn: {
    alignItems: 'center',
    paddingHorizontal: 10,
    paddingVertical: 4,
  },
  resetText: {
    color: '#ffffff',
    fontSize: 13,
    fontWeight: '600',
  },
});

export default ReviewDetailScreen;
