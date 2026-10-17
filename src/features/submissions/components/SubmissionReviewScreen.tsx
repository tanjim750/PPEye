import { Href, Stack, useFocusEffect, useNavigation, useRouter } from 'expo-router';
import { Image, ImageSource } from 'expo-image';
import { useCallback, useEffect, useRef, useState } from 'react';
import {
  Alert,
  BackHandler,
  Modal,
  Pressable,
  ScrollView,
  StyleSheet,
  Text,
  TextInput,
  useWindowDimensions,
  View,
} from 'react-native';
import { SafeAreaView, useSafeAreaInsets } from 'react-native-safe-area-context';
import { useTranslation } from 'react-i18next';

import { Icon } from '@/components/ui/Icon';
import { OtherCapturePhoto, PPEWorkerCapture } from '@/features/capture/types';
import {
  clearPendingSubmissionReviewCaptures,
  getPendingResubmissionContext,
  getPendingSubmissionReviewCaptures,
  getPendingSubmissionReviewOtherPhotos,
  getPendingSubmissionReviewSite,
  setPendingSubmissionReviewCaptures,
  setPendingSubmissionReviewOtherPhotos,
  setPendingSubmissionReviewSite,
  setPendingSubmissionReviewTarget,
} from '@/features/submissions/services/pendingSubmissionReview.service';
import { resubmitWorkerCheck } from '@/features/submissions/services/workerChecks.service';
import { createOrUpdatePendingReview } from '@/features/reviews/services/reviews.service';
import {
  attachPhotosToPPESubmission,
  createPPESubmission,
  createPPESubmissionHeader,
} from '@/services/supabase/ppeyeDb.service';
import { uploadSubmissionPhotosToDrive } from '@/services/google-drive';
import { uploadSubmissionImages, validateSubmissionImages } from '@/services/storage';
import {
  resubmitUnsafeWorker,
  saveDraftSubmission,
} from '@/services/vendor/vendorSubmissions.service';
import { useAuth } from '@/hooks/useAuth';
import { locationService } from '@/services/location';

import {
  getSubmissionWeatherMetadata,
  SubmissionWeatherMetadata,
} from '@/services/weather';

type WorkerReviewPhoto = {
  back: ImageSource;
  backUri: string;
  front: ImageSource;
  frontUri: string;
  sequenceNo: number;
  capturedAt?: number;
};

function formatCaptureTime(timestamp?: number): string {
  if (!timestamp) return '';
  const date = new Date(timestamp);
  let hours = date.getHours();
  const minutes = date.getMinutes().toString().padStart(2, '0');
  const ampm = hours >= 12 ? 'PM' : 'AM';
  hours = hours % 12;
  hours = hours ? hours : 12;
  const formattedHours = hours < 10 ? `0${hours}` : `${hours}`;
  return `${formattedHours}:${minutes} ${ampm}`;
}

type OtherReviewPhoto = {
  id: string;
  source: ImageSource;
  uri: string;
};

type SubmissionReviewMetadata = {
  capturedAt: string;
  location?: {
    accuracy_m?: number;
    latitude: number;
    longitude: number;
  };
  weather: SubmissionWeatherMetadata | null;
};

const sampleWorkerPhotos: WorkerReviewPhoto[] = [
  {
    sequenceNo: 1,
    front: { uri: 'https://lh3.googleusercontent.com/aida/AEtjO1U7K_FAZ2HeXCCuL2GQebrq1USmx1KtyBTKUh84qCcposq_rfrMO_mGEt5NKO_tE0vD_1YOU7KmDn5OKbRgdPKBlaDDg_N_qlBu6Q7nyji0utCKG1CwE_luLM5-0Dj5Ymhp8yHlplc6Hwc_85tfJxvub3rfYZypubfAXG06ivU3WmhMIqCx-fgeN0WTm-oHDpqIITmW0HF-yRkRSG5MFJlfIiKHtfRhlADTEVgkHnPj7fst2ftVOLRAkC0' },
    frontUri: 'https://lh3.googleusercontent.com/aida/AEtjO1U7K_FAZ2HeXCCuL2GQebrq1USmx1KtyBTKUh84qCcposq_rfrMO_mGEt5NKO_tE0vD_1YOU7KmDn5OKbRgdPKBlaDDg_N_qlBu6Q7nyji0utCKG1CwE_luLM5-0Dj5Ymhp8yHlplc6Hwc_85tfJxvub3rfYZypubfAXG06ivU3WmhMIqCx-fgeN0WTm-oHDpqIITmW0HF-yRkRSG5MFJlfIiKHtfRhlADTEVgkHnPj7fst2ftVOLRAkC0',
    back: { uri: 'https://lh3.googleusercontent.com/aida-public/AB6AXuDCACqY_pWKKerdF_sB7Hn1kXmpmze_vsM9Q87ByZ-aJv5Ha2Z8QuMUb576RhSLwX7QvXn-YSAcbFDbABHSu8qOec2YFZd_GCjCigDQbej6SFNFFDIryMUYL-MYdfm0Y230WrZ3wggUC3108k7xbp3bJZGgDQa0Rvzy-WEpHRk4zzqFsWYytmrt5Sw_SRZ8sceBzy8HuLNjeuQVk1kJ4qaxQa28BcIR8WAfC8uvlL0bazXbfTuf9vHI' },
    backUri: 'https://lh3.googleusercontent.com/aida-public/AB6AXuDCACqY_pWKKerdF_sB7Hn1kXmpmze_vsM9Q87ByZ-aJv5Ha2Z8QuMUb576RhSLwX7QvXn-YSAcbFDbABHSu8qOec2YFZd_GCjCigDQbej6SFNFFDIryMUYL-MYdfm0Y230WrZ3wggUC3108k7xbp3bJZGgDQa0Rvzy-WEpHRk4zzqFsWYytmrt5Sw_SRZ8sceBzy8HuLNjeuQVk1kJ4qaxQa28BcIR8WAfC8uvlL0bazXbfTuf9vHI',
  },
  {
    sequenceNo: 2,
    front: { uri: 'https://lh3.googleusercontent.com/aida-public/AB6AXuCuZxy0Q311kBgLiTS7t5-_L7uaLXsi9HlYUAmSZQECsMALWF-aLrkfYbyn8kf4UqSt_uHq1IhY8uCvjb2N6NKBXCHkv98ED-ffl-lpbEV6W-L7WM-Hn-2dQ5-7tNlgN_hkH0oMEIeKREYM68xHcjdLHd-ikZQWrKvONiJk3x11DK7eJwD75uhgkoHLY6ckPThpYZCuk2t4FRVyenFpUB89i-0dsc5xiJv4TOclt_-JhmesV6uugg9W' },
    frontUri: 'https://lh3.googleusercontent.com/aida-public/AB6AXuCuZxy0Q311kBgLiTS7t5-_L7uaLXsi9HlYUAmSZQECsMALWF-aLrkfYbyn8kf4UqSt_uHq1IhY8uCvjb2N6NKBXCHkv98ED-ffl-lpbEV6W-L7WM-Hn-2dQ5-7tNlgN_hkH0oMEIeKREYM68xHcjdLHd-ikZQWrKvONiJk3x11DK7eJwD75uhgkoHLY6ckPThpYZCuk2t4FRVyenFpUB89i-0dsc5xiJv4TOclt_-JhmesV6uugg9W',
    back: { uri: 'https://lh3.googleusercontent.com/aida-public/AB6AXuCUqFlp6mW8hgXcWvLNWmYC53C2Er97cazwOTfMvEVNUPj6DbE4oykqDPIG8kxu5qmgT4jU46fu4-sbK6yhZ4aqJJGehkIqDsjLECr4q10RMx_XWtnU1v1SiRnghGvBFu_XkZeP9Pb5vXuMNyVRNM4Q0vtx2WzUIZIhl9oCSkdsGHyRcQsFAysgEyq5Hifp7mFEpEUhT2rl5_E2rsxArAgkPyJF7xj0A8DOrTPfxUEvUfcAr4sdSOWz' },
    backUri: 'https://lh3.googleusercontent.com/aida-public/AB6AXuCUqFlp6mW8hgXcWvLNWmYC53C2Er97cazwOTfMvEVNUPj6DbE4oykqDPIG8kxu5qmgT4jU46fu4-sbK6yhZ4aqJJGehkIqDsjLECr4q10RMx_XWtnU1v1SiRnghGvBFu_XkZeP9Pb5vXuMNyVRNM4Q0vtx2WzUIZIhl9oCSkdsGHyRcQsFAysgEyq5Hifp7mFEpEUhT2rl5_E2rsxArAgkPyJF7xj0A8DOrTPfxUEvUfcAr4sdSOWz',
  },
];

export function SubmissionReviewScreen() {
  const router = useRouter();
  const navigation = useNavigation();
  const insets = useSafeAreaInsets();
  const { user } = useAuth();
  const isExitingToHomeRef = useRef(false);

  const isSubmittingRef = useRef(false);
  const carouselRef = useRef<ScrollView>(null);
  const [isVerticalScrollEnabled, setIsVerticalScrollEnabled] = useState(true);
  const { t } = useTranslation('submission');
  const [activeWorkerIndex, setActiveWorkerIndex] = useState(0);
  const [isExitConfirmVisible, setIsExitConfirmVisible] = useState(false);
  const [siteName, setSiteName] = useState(() => getPendingSubmissionReviewSite() || 'Site-01');
  const [siteDraft, setSiteDraft] = useState(() => getPendingSubmissionReviewSite() || 'Site-01');

  const [isEditingSite, setIsEditingSite] = useState(false);
  const [siteError, setSiteError] = useState<string | null>(null);
  const [isSubmitting, setIsSubmitting] = useState(false);
  const [isBuildingWeatherMetadata, setIsBuildingWeatherMetadata] = useState(false);
  const [isLocationServicesPromptVisible, setIsLocationServicesPromptVisible] = useState(false);
  const [submissionMetadata, setSubmissionMetadata] = useState<SubmissionReviewMetadata | null>(
    null,
  );
  const { width: windowWidth } = useWindowDimensions();
  const [workerPhotos, setWorkerPhotos] = useState<WorkerReviewPhoto[]>(() => {
    const pendingCaptures = getPendingSubmissionReviewCaptures();

    return pendingCaptures ? getWorkerPhotosFromCaptures(pendingCaptures) : sampleWorkerPhotos;
  });
  const [reviewOtherPhotos] = useState<OtherReviewPhoto[]>(() => {
    const pendingOtherPhotos = getPendingSubmissionReviewOtherPhotos();

    return pendingOtherPhotos
      ? getOtherReviewPhotosFromCaptures(pendingOtherPhotos)
      : [];
  });
  const workerCount = workerPhotos.length;
  const ppePhotoCount = workerPhotos.length * 2;
  const slideWidth = Math.min(windowWidth, 672);
  const hasLocalWorkerImages = workerPhotos.some((worker) => worker.frontUri || worker.backUri);
  const hasLocalOtherImages = reviewOtherPhotos.some((photo) => photo.uri);

  const buildWeatherMetadata = useCallback(async () => {
    setIsBuildingWeatherMetadata(true);

    try {
      const capturedAt = new Date().toISOString();
      const isLocationEnabled = await locationService.checkServicesEnabled();

      if (!isLocationEnabled) {
        const metadata = {
          capturedAt,
          weather: null,
        };

        setSubmissionMetadata(metadata);
        console.log('Submission metadata', JSON.stringify(metadata, null, 2));
        setIsLocationServicesPromptVisible(true);
        return;
      }

      const permission = await locationService.checkPermission();
      const location = permission.granted
        ? await locationService.getCurrentLocation()
        : await locationService.askPermissionAndGetCurrentLocation();
      const weather = await getSubmissionWeatherMetadata(location);
      const metadata: SubmissionReviewMetadata = {
        capturedAt,
        location: {
          accuracy_m: location.coords.accuracy ?? undefined,
          latitude: location.coords.latitude,
          longitude: location.coords.longitude,
        },
        weather,
      };

      setSubmissionMetadata(metadata);
      console.log('Submission metadata', JSON.stringify(metadata, null, 2));
      setIsLocationServicesPromptVisible(false);
    } catch (error) {
      const metadata = {
        capturedAt: new Date().toISOString(),
        weather: null,
      };

      setSubmissionMetadata(metadata);
      console.warn('Submission metadata unavailable.', error);
      console.log('Submission metadata', JSON.stringify(metadata, null, 2));
      setIsLocationServicesPromptVisible(true);
    } finally {
      setIsBuildingWeatherMetadata(false);
    }
  }, []);

  useEffect(() => {
    buildWeatherMetadata();
  }, [buildWeatherMetadata]);

  async function turnOnLocationAndBuildWeatherMetadata() {
    setIsBuildingWeatherMetadata(true);

    try {
      const isLocationEnabled = await locationService.askToTurnOnLocationServices();

      if (!isLocationEnabled) {
        setIsLocationServicesPromptVisible(true);
        return;
      }

      await buildWeatherMetadata();
    } finally {
      setIsBuildingWeatherMetadata(false);
    }
  }

  function continueCapture() {
    setPendingSubmissionReviewSite(siteName ?? '');
    setPendingSubmissionReviewCaptures(getCapturesFromWorkerPhotos(workerPhotos));
    setPendingSubmissionReviewOtherPhotos(getOtherCapturesFromReviewPhotos(reviewOtherPhotos));
    setPendingSubmissionReviewTarget(null);
    router.push('/continuous-ppe-capture' as Href);
  }

  function captureOtherPhotos() {
    setPendingSubmissionReviewSite(siteName ?? '');
    setPendingSubmissionReviewCaptures(getCapturesFromWorkerPhotos(workerPhotos));
    setPendingSubmissionReviewOtherPhotos(getOtherCapturesFromReviewPhotos(reviewOtherPhotos));
    setPendingSubmissionReviewTarget(null);
    router.push('/capture-others' as Href);
  }

  const exitToHome = useCallback(() => {
    if (isExitingToHomeRef.current) {
      return;
    }

    isExitingToHomeRef.current = true;
    clearPendingSubmissionReviewCaptures();
    router.replace('/(external)' as Href);
  }, [router]);

  const requestExitToHome = useCallback(() => {
    if (!hasLocalWorkerImages && !hasLocalOtherImages) {
      exitToHome();
      return;
    }

    if (isExitConfirmVisible) {
      return;
    }

    setIsExitConfirmVisible(true);
  }, [exitToHome, hasLocalOtherImages, hasLocalWorkerImages, isExitConfirmVisible]);

  useFocusEffect(
    useCallback(() => {
      const subscription = BackHandler.addEventListener('hardwareBackPress', () => {
        if (isSubmittingRef.current || isExitingToHomeRef.current) {
          return false;
        }
        requestExitToHome();
        return true;
      });

      return () => subscription.remove();
    }, [requestExitToHome]),
  );

  useFocusEffect(
    useCallback(() => {
      const unsubscribe = navigation.addListener('beforeRemove', (event) => {
        if (isExitingToHomeRef.current || isSubmittingRef.current) {
          return;
        }

        event.preventDefault();
        requestExitToHome();
      });

      return unsubscribe;
    }, [navigation, requestExitToHome]),
  );

  function retakeWorker(sequenceNo: number) {
    setPendingSubmissionReviewSite(siteName ?? '');
    setPendingSubmissionReviewCaptures(getCapturesFromWorkerPhotos(workerPhotos));
    setPendingSubmissionReviewOtherPhotos(getOtherCapturesFromReviewPhotos(reviewOtherPhotos));
    setPendingSubmissionReviewTarget({ side: 'FRONT', workerNumber: sequenceNo });
    router.push('/continuous-ppe-capture' as Href);
  }

  function removeWorker(sequenceNo: number) {
    setWorkerPhotos((currentWorkers) => {
      const nextWorkers = currentWorkers.filter((worker) => worker.sequenceNo !== sequenceNo);

      setPendingSubmissionReviewCaptures(getCapturesFromWorkerPhotos(nextWorkers));
      setPendingSubmissionReviewOtherPhotos(getOtherCapturesFromReviewPhotos(reviewOtherPhotos));
      setPendingSubmissionReviewTarget(null);
      setActiveWorkerIndex((currentIndex) =>
        Math.max(0, Math.min(currentIndex, nextWorkers.length - 1)),
      );

      return nextWorkers;
    });
  }

  async function submitForReview() {
    if (isSubmittingRef.current) return;
    isSubmittingRef.current = true;
    setIsSubmitting(true);

    // 1. Current Site Validation
    const trimmedSite = siteName?.trim();
    if (!trimmedSite) {
      isSubmittingRef.current = false;
      setIsSubmitting(false);
      setSiteError(t('reviewScreen.siteRequired'));
      setIsEditingSite(true);
      Alert.alert(
        t('reviewScreen.siteRequired'),
        t('reviewScreen.siteEmptyHint'),
      );
      return;
    }

    // 2. Location Services Validation
    const isLocationEnabled = await locationService.checkServicesEnabled();
    if (!isLocationEnabled) {
      isSubmittingRef.current = false;
      setIsSubmitting(false);
      setIsLocationServicesPromptVisible(true);
      Alert.alert(
        t('reviewScreen.locationServicesTitle'),
        t('reviewScreen.locationRequiredMessage'),
        [
          { text: t('reviewScreen.cancel'), style: 'cancel' },
          {
            text: t('reviewScreen.turnOnLocation'),
            onPress: turnOnLocationAndBuildWeatherMetadata,
          },
        ]
      );
      return;
    }

    if (!submissionMetadata?.location) {
      try {
        const permission = await locationService.checkPermission();
        const location = permission.granted
          ? await locationService.getCurrentLocation()
          : await locationService.askPermissionAndGetCurrentLocation();
        if (!location?.coords) {
          throw new Error('Location unavailable');
        }
        buildWeatherMetadata();
      } catch {
        isSubmittingRef.current = false;
        setIsSubmitting(false);
        setIsLocationServicesPromptVisible(true);
        Alert.alert(
          t('reviewScreen.locationServicesTitle'),
          t('reviewScreen.locationRequiredMessage'),
          [
            { text: t('reviewScreen.cancel'), style: 'cancel' },
            {
              text: t('reviewScreen.turnOnLocation'),
              onPress: turnOnLocationAndBuildWeatherMetadata,
            },
          ]
        );
        return;
      }
    }

    // Validate submission images against domain rules: require exactly one active FRONT and BACK per worker
    const validation = await validateSubmissionImages({
      workers: workerPhotos.map((w) => ({
        sequenceNo: w.sequenceNo,
        frontLocalUri: w.frontUri,
        backLocalUri: w.backUri,
      })),
      otherImages: reviewOtherPhotos.map((p) => p.uri),
    });

    if (!validation.isValid) {
      isSubmittingRef.current = false;
      setIsSubmitting(false);
      const errorMsg = validation.errors.map((e) => e.message).join('\n');
      Alert.alert(
        'Incomplete Photos',
        `Please ensure all worker inspection photos are complete:\n\n${errorMsg}`,
        [{ text: 'OK' }]
      );
      return;
    }

    isExitingToHomeRef.current = true;

    const finalSite = trimmedSite;
    setPendingSubmissionReviewSite(finalSite);

    // Register individual worker check profile for each worker with distinct capture time
    workerPhotos.forEach((worker, index) => {
      const workerTimestamp =
        worker.capturedAt || Date.now() - (workerPhotos.length - index) * 1000;

      resubmitWorkerCheck(worker.sequenceNo, {
        backUri: worker.backUri,
        frontUri: worker.frontUri,
        siteName: finalSite,
        capturedAt: workerTimestamp,
      });

      // Also register individual review profile in Reviewer queue
      createOrUpdatePendingReview({
        location: `${finalSite} • Worker ${worker.sequenceNo}`,
        photos: 2,
        workers: 1,
        teamLead: 'Rahim Mia · Team Leader',
        timestamp: workerTimestamp,
      });
    });

    const resubmissionCtx = getPendingResubmissionContext();
    // Immediately clear pending captures so returning to camera or start inspection is fresh
    clearPendingSubmissionReviewCaptures();

    // Background async pipeline: Supabase submission creation -> Storage upload & relationship persistence
    (async () => {
      try {
        if (resubmissionCtx?.submissionId && resubmissionCtx?.workerInstanceId) {
          // Legitimate Resubmission flow for an Unsafe worker
          const targetWorker =
            workerPhotos.find((w) => w.sequenceNo === resubmissionCtx.sequenceNo) ||
            workerPhotos[0];

          if (targetWorker?.frontUri) {
            await resubmitUnsafeWorker(
              resubmissionCtx.submissionId,
              resubmissionCtx.workerInstanceId,
              'FRONT',
              targetWorker.frontUri
            );
          }
          if (targetWorker?.backUri) {
            await resubmitUnsafeWorker(
              resubmissionCtx.submissionId,
              resubmissionCtx.workerInstanceId,
              'BACK',
              targetWorker.backUri
            );
          }
          clearPendingSubmissionReviewCaptures();
          return;
        }

        // Standard New Submission creation:
        // Process each worker as an individual submission in Google Drive and Database so each worker is counted separately!
        for (let i = 0; i < workerPhotos.length; i++) {
          const worker = workerPhotos[i];
          const workerTimestamp =
            worker.capturedAt || Date.now() - (workerPhotos.length - i) * 1000;

          try {
            // Step 1: Create distinct DB submission header to get official submission ID
            console.log(`[PPEye] Creating DB submission record for Worker ${worker.sequenceNo}...`);
            const subHeader = await createPPESubmissionHeader({
              vendorProfileId: user?.vendorProfileId || 1,
              submittedBy: typeof user?.id === 'number' ? user.id : undefined,
              siteName: finalSite,
              metadata: {
                latitude: submissionMetadata?.location?.latitude ?? null,
                longitude: submissionMetadata?.location?.longitude ?? null,
                weather: submissionMetadata?.weather ?? null,
                workerSequenceNo: worker.sequenceNo,
                capturedAt: workerTimestamp,
              },
            });

            if (!subHeader.success || !subHeader.submissionId) {
              console.warn(`[PPEye] Failed to create submission header for worker ${worker.sequenceNo}`);
              continue;
            }

            const currentSubId = subHeader.submissionId;
            const submittedBy = subHeader.submittedBy || 1;

            // Step 2: Upload this worker's inspection photos to Google Drive with submission ID in file name!
            console.log(`[PPEye] Uploading Worker ${worker.sequenceNo} photos to Google Drive (submission_${currentSubId})...`);
            const driveResult = await uploadSubmissionPhotosToDrive({
              submissionId: currentSubId,
              siteName: finalSite,
              workers: [
                {
                  sequenceNo: worker.sequenceNo,
                  frontUri: worker.frontUri,
                  backUri: worker.backUri,
                },
              ],
              otherPhotos: i === 0 ? reviewOtherPhotos.map((p) => p.uri) : [],
            });

            const uploadedWorker = driveResult.workers[0];
            const hasDriveFiles =
              Boolean(uploadedWorker?.frontDriveFileId) || Boolean(uploadedWorker?.backDriveFileId);

            if (!hasDriveFiles) {
              console.warn(`[PPEye] Google Drive upload failed for worker ${worker.sequenceNo}`);
              continue;
            }

            // Step 3: Link Drive file IDs with worker instances & files in Supabase
            console.log(`[PPEye] Attaching Drive IDs to DB submission ${currentSubId}...`);
            await attachPhotosToPPESubmission({
              submissionId: currentSubId,
              submittedBy,
              workers: [uploadedWorker],
              otherPhotos: i === 0 ? driveResult.otherPhotos : [],
            });
          } catch (workerErr) {
            console.error(`[PPEye] Error creating individual submission for worker ${worker.sequenceNo}:`, workerErr);
          }
        }
      } catch (err) {
        console.warn('[PPEye] Pipeline sync error (Drive -> Supabase):', err);
      }
    })();

    // Immediately navigate to history pending page
    router.replace('/history?filter=pending' as Href);
  }

  function updateActiveWorker(offsetX: number) {
    if (!slideWidth) {
      return;
    }

    const nextIndex = Math.round(offsetX / slideWidth);
    const boundedIndex = Math.max(0, Math.min(workerPhotos.length - 1, nextIndex));

    setActiveWorkerIndex((prevIndex) => (prevIndex === boundedIndex ? prevIndex : boundedIndex));
  }

  function startEditingSite() {
    setSiteDraft(siteName ?? '');
    setSiteError(null);
    setIsEditingSite(true);
  }

  function cancelEditingSite() {
    setSiteDraft(siteName ?? '');
    setSiteError(null);
    setIsEditingSite(false);
  }

  function saveSite() {
    const nextSite = siteDraft.trim();

    if (!nextSite) {
      setSiteError(t('reviewScreen.siteRequired'));
      return;
    }

    setSiteName(nextSite);
    setPendingSubmissionReviewSite(nextSite);
    setSiteError(null);
    setIsEditingSite(false);
  }

  return (
    <SafeAreaView style={styles.safeArea}>
      <Stack.Screen options={{ gestureEnabled: false }} />
      <View style={styles.shell}>
        <View style={styles.header}>
          <Pressable
            accessibilityLabel={t('reviewScreen.back')}
            accessibilityRole="button"
            onPress={requestExitToHome}
            style={({ pressed }) => [styles.headerIconButton, pressed && styles.pressed]}>
            <Icon
              color={colors.text}
              name={{ ios: 'arrow.left', android: 'arrow_back', web: 'arrow_back' }}
              size={24}
              weight="semibold"
            />
          </Pressable>
          <Text style={styles.headerTitle}>{t('reviewScreen.title')}</Text>
          <View style={styles.headerSpacer} />
        </View>

        <ScrollView
          contentContainerStyle={[styles.content, { paddingBottom: 80 + Math.max(insets.bottom, 16) }]}
          scrollEnabled={isVerticalScrollEnabled}
          showsVerticalScrollIndicator={false}
          style={styles.scroll}>
          <View style={[styles.siteCard, isEditingSite && styles.siteCardEditing]}>
            <View style={styles.siteTopRow}>
              <View style={styles.siteIcon}>
                <Icon
                  color={colors.primary}
                  name={{
                    ios: 'antenna.radiowaves.left.and.right',
                    android: 'cell_tower',
                    web: 'cell_tower',
                  }}
                  size={24}
                />
              </View>
              <View style={styles.siteCopy}>
                <Text style={styles.metaLabel}>{t('reviewScreen.currentSite')}</Text>
                {isEditingSite ? (
                  <TextInput
                    autoCapitalize="characters"
                    autoCorrect={false}
                    onChangeText={(value) => {
                      setSiteDraft(value);
                      setSiteError(null);
                    }}
                    onSubmitEditing={saveSite}
                    placeholder={t('reviewScreen.sitePlaceholder')}
                    placeholderTextColor={colors.textMuted}
                    returnKeyType="done"
                    style={[styles.siteInput, siteError && styles.siteInputError]}
                    value={siteDraft}
                  />
                ) : (
                  <>
                    <Text
                      numberOfLines={1}
                      style={[styles.siteName, !siteName?.trim() && styles.siteNameEmpty]}>
                      {siteName?.trim() || t('reviewScreen.noSiteSelected')}
                    </Text>
                    <Text numberOfLines={1} style={styles.siteHint}>
                      {siteName?.trim() ? t('reviewScreen.siteReadyHint') : t('reviewScreen.siteEmptyHint')}
                    </Text>
                  </>
                )}
              </View>
              {isEditingSite ? null : (
                <Pressable
                  accessibilityLabel={t('reviewScreen.change')}
                  accessibilityRole="button"
                  onPress={startEditingSite}
                  style={({ pressed }) => [styles.changeButton, pressed && styles.pressed]}>
                  <Icon
                    color={colors.primary}
                    name={{ ios: 'pencil', android: 'edit', web: 'edit' }}
                    size={18}
                    weight="semibold"
                  />
                </Pressable>
              )}
            </View>
            {isEditingSite ? (
              <View style={styles.siteEditFooter}>
                {siteError ? <Text style={styles.siteError}>{siteError}</Text> : null}
                <View style={styles.siteEditActions}>
                  <Pressable
                    accessibilityRole="button"
                    onPress={cancelEditingSite}
                    style={({ pressed }) => [styles.siteCancelButton, pressed && styles.pressed]}>
                    <Text style={styles.siteCancelText}>{t('reviewScreen.cancel')}</Text>
                  </Pressable>
                  <Pressable
                    accessibilityRole="button"
                    onPress={saveSite}
                    style={({ pressed }) => [styles.siteSaveButton, pressed && styles.pressed]}>
                    <Text style={styles.siteSaveText}>{t('reviewScreen.save')}</Text>
                  </Pressable>
                </View>
              </View>
            ) : null}
          </View>

          {isLocationServicesPromptVisible ? (
            <View style={styles.locationCard}>
              <View style={styles.locationIcon}>
                <Icon
                  color={colors.actionBlue}
                  name={{ ios: 'location.fill', android: 'location_on', web: 'location_on' }}
                  size={22}
                  weight="bold"
                />
              </View>
              <View style={styles.locationCopy}>
                <Text style={styles.locationTitle}>
                  {t('reviewScreen.locationServicesTitle')}
                </Text>
                <Text style={styles.locationMessage}>
                  {t('reviewScreen.locationServicesMessage')}
                </Text>
              </View>
              <Pressable
                accessibilityRole="button"
                disabled={isBuildingWeatherMetadata}
                onPress={turnOnLocationAndBuildWeatherMetadata}
                style={({ pressed }) => [
                  styles.locationButton,
                  isBuildingWeatherMetadata && styles.disabledButton,
                  pressed && styles.pressed,
                ]}>
                <Text style={styles.locationButtonText}>
                  {t('reviewScreen.turnOnLocation')}
                </Text>
              </Pressable>
            </View>
          ) : null}

          <View style={styles.section}>
            <View style={styles.sectionHeader}>
              <View>
                <Text style={styles.sectionTitle}>{t('reviewScreen.ppePhotos')}</Text>
                <Text style={styles.sectionSubtitle}>
                  {t('reviewScreen.ppeSummary', {
                    photos: ppePhotoCount,
                    workers: workerCount,
                  })}
                </Text>
              </View>
            </View>

            <View style={styles.workerMarkers}>
              {workerPhotos.map((worker, index) => (
                <Pressable
                  key={worker.sequenceNo}
                  accessibilityLabel={t('reviewScreen.worker', { number: worker.sequenceNo })}
                  accessibilityRole="button"
                  onPress={() => {
                    carouselRef.current?.scrollTo({ x: index * slideWidth, animated: true });
                    setActiveWorkerIndex(index);
                  }}
                  style={({ pressed }) => [
                    styles.workerMarker,
                    index === activeWorkerIndex && styles.workerMarkerActive,
                    pressed && styles.pressed,
                  ]}
                />
              ))}
            </View>

            <View style={styles.workerCarousel}>
              <ScrollView
                ref={carouselRef}
                contentContainerStyle={styles.workerTrack}
                decelerationRate="fast"
                directionalLockEnabled
                horizontal
                nestedScrollEnabled
                onMomentumScrollEnd={(event) => {
                  setIsVerticalScrollEnabled(true);
                  updateActiveWorker(event.nativeEvent.contentOffset.x);
                }}
                onScroll={(event) => {
                  updateActiveWorker(event.nativeEvent.contentOffset.x);
                }}
                onScrollBeginDrag={() => setIsVerticalScrollEnabled(false)}
                onScrollEndDrag={() => setIsVerticalScrollEnabled(true)}
                pagingEnabled
                scrollEventThrottle={16}
                showsHorizontalScrollIndicator={false}
                snapToInterval={slideWidth}
                snapToAlignment="start">
                {workerPhotos.map((worker) => (
                  <View
                    key={worker.sequenceNo}
                    style={[styles.workerSlide, { width: slideWidth }]}>
                    <View style={styles.workerCard}>
                      <View style={styles.workerCardHeader}>
                        <View style={styles.workerBadgeRow}>
                          <View style={styles.workerBadge}>
                            <Icon
                              color={colors.primary}
                              name={{ ios: 'person.fill', android: 'person', web: 'person' }}
                              size={14}
                              weight="bold"
                            />
                            <Text style={styles.workerBadgeText}>
                              {t('reviewScreen.worker', { number: worker.sequenceNo })}
                            </Text>
                          </View>
                          {worker.capturedAt ? (
                            <View style={styles.captureTimeBadge}>
                              <Icon
                                color={colors.primary}
                                name={{ ios: 'clock.fill', android: 'schedule', web: 'schedule' }}
                                size={12}
                              />
                              <Text style={styles.captureTimeText}>
                                {formatCaptureTime(worker.capturedAt)}
                              </Text>
                            </View>
                          ) : null}
                        </View>
                        <Text style={styles.workerPhotoCount}>
                          {t('reviewScreen.twoPhotos')}
                        </Text>
                      </View>

                      <View style={styles.photoGrid}>
                        <View style={styles.photoColumn}>
                          <ReviewPhoto
                            label={t('captureScreen.sides.FRONT')}
                            source={worker.front}
                          />
                        </View>
                        <View style={styles.photoColumn}>
                          <ReviewPhoto
                            label={t('captureScreen.sides.BACK')}
                            source={worker.back}
                          />
                        </View>
                      </View>

                      <View style={styles.cardStatus}>
                        <Icon
                          color={colors.safe}
                          name={{
                            ios: 'checkmark.circle.fill',
                            android: 'check_circle',
                            web: 'check_circle',
                          }}
                          size={18}
                          weight="bold"
                        />
                        <Text style={styles.cardStatusText}>{t('reviewScreen.photoPairReady')}</Text>
                      </View>

                      <View style={styles.workerActions}>
                        <Pressable
                          accessibilityRole="button"
                          onPress={() => retakeWorker(worker.sequenceNo)}
                          style={({ pressed }) => [
                            styles.workerActionButton,
                            styles.retakeButton,
                            pressed && styles.pressed,
                          ]}>
                          <Icon
                            color={colors.primary}
                            name={{
                              ios: 'camera.rotate.fill',
                              android: 'flip_camera_android',
                              web: 'flip_camera_android',
                            }}
                            size={18}
                            weight="bold"
                          />
                          <Text style={styles.retakeText}>{t('reviewScreen.retake')}</Text>
                        </Pressable>
                        <Pressable
                          accessibilityRole="button"
                          onPress={() => removeWorker(worker.sequenceNo)}
                          style={({ pressed }) => [
                            styles.workerActionButton,
                            styles.removeButton,
                            pressed && styles.pressed,
                          ]}>
                          <Icon
                            color={colors.danger}
                            name={{ ios: 'trash', android: 'delete', web: 'delete' }}
                            size={18}
                            weight="semibold"
                          />
                          <Text style={styles.removeText}>{t('reviewScreen.remove')}</Text>
                        </Pressable>
                      </View>
                    </View>
                  </View>
                ))}
              </ScrollView>
            </View>

            <Pressable
              accessibilityRole="button"
              onPress={continueCapture}
              style={({ pressed }) => [styles.continueButton, pressed && styles.pressed]}>
              <Icon
                color={colors.primary}
                name={{ ios: 'camera.fill', android: 'add_a_photo', web: 'add_a_photo' }}
                size={20}
                weight="bold"
              />
              <Text style={styles.continueText}>{t('reviewScreen.continueCapture')}</Text>
            </Pressable>
          </View>

          <View style={styles.section}>
            <View style={styles.sectionHeader}>
              <View>
                <Text style={styles.sectionTitle}>{t('reviewScreen.others')}</Text>
                <Text style={styles.sectionSubtitle}>
                  {t('reviewScreen.otherSummary', { photos: reviewOtherPhotos.length })}
                </Text>
              </View>
            </View>

            <ScrollView
              contentContainerStyle={styles.otherStrip}
              directionalLockEnabled
              horizontal
              nestedScrollEnabled
              onMomentumScrollEnd={() => setIsVerticalScrollEnabled(true)}
              onScrollBeginDrag={() => setIsVerticalScrollEnabled(false)}
              onScrollEndDrag={() => setIsVerticalScrollEnabled(true)}
              showsHorizontalScrollIndicator={false}>
              {reviewOtherPhotos.map((photo) => (
                <Image key={photo.id} contentFit="cover" source={photo.source} style={styles.otherPhoto} />
              ))}
              <Pressable
                accessibilityRole="button"
                onPress={captureOtherPhotos}
                style={({ pressed }) => [styles.addOtherButton, pressed && styles.pressed]}>
                <Icon
                  color={colors.textMuted}
                  name={{ ios: 'plus', android: 'add', web: 'add' }}
                  size={28}
                  weight="semibold"
                />
                <Text style={styles.addOtherText}>{t('reviewScreen.addPhoto')}</Text>
              </Pressable>
            </ScrollView>
          </View>
        </ScrollView>

        <View style={[styles.submitBar, { paddingBottom: Math.max(insets.bottom, 16) }]}>
          <Pressable
            accessibilityRole="button"
            disabled={isSubmitting}
            onPress={submitForReview}
            style={({ pressed }) => [styles.submitButton, (pressed || isSubmitting) && styles.pressed]}>
            <Text style={styles.submitText}>
              {isSubmitting ? 'Submitting...' : t('reviewScreen.submit')}
            </Text>
          </Pressable>
        </View>


        <Modal
          animationType="fade"
          onRequestClose={() => setIsExitConfirmVisible(false)}
          transparent
          visible={isExitConfirmVisible}>
          <View style={styles.confirmBackdrop}>
            <Pressable
              accessibilityLabel="Dismiss dialog"
              accessibilityRole="button"
              onPress={() => setIsExitConfirmVisible(false)}
              style={StyleSheet.absoluteFill}
            />
            <View style={styles.confirmCard}>
              <View style={styles.confirmIcon}>
                <Icon
                  color={colors.danger}
                  name={{
                    ios: 'exclamationmark.triangle.fill',
                    android: 'warning',
                    web: 'warning',
                  }}
                  size={26}
                  weight="bold"
                />
              </View>
              <Text style={styles.confirmTitle}>{t('reviewScreen.exitConfirmTitle')}</Text>
              <Text style={styles.confirmMessage}>{t('reviewScreen.exitConfirmMessage')}</Text>
              <View style={styles.confirmActions}>
                <Pressable
                  accessibilityRole="button"
                  onPress={() => setIsExitConfirmVisible(false)}
                  style={({ pressed }) => [styles.confirmCancelButton, pressed && styles.pressed]}>
                  <Text style={styles.confirmCancelText}>{t('reviewScreen.keepReviewing')}</Text>
                </Pressable>
                <Pressable
                  accessibilityRole="button"
                  onPress={exitToHome}
                  style={({ pressed }) => [styles.confirmLeaveButton, pressed && styles.pressed]}>
                  <Text style={styles.confirmLeaveText}>{t('reviewScreen.discardAndLeave')}</Text>
                </Pressable>
              </View>
            </View>
          </View>
        </Modal>
      </View>
    </SafeAreaView>
  );
}

function getWorkerPhotosFromCaptures(captures: PPEWorkerCapture[]) {
  return captures
    .filter((capture) => capture.frontUri && capture.backUri)
    .map((capture) => ({
      back: { uri: capture.backUri ?? '' },
      backUri: capture.backUri ?? '',
      front: { uri: capture.frontUri ?? '' },
      frontUri: capture.frontUri ?? '',
      sequenceNo: capture.sequenceNo,
      capturedAt: capture.capturedAt ?? Date.now(),
    }));
}

function getCapturesFromWorkerPhotos(workers: WorkerReviewPhoto[]): PPEWorkerCapture[] {
  return workers.map((worker) => ({
    backUri: worker.backUri,
    frontUri: worker.frontUri,
    sequenceNo: worker.sequenceNo,
    capturedAt: worker.capturedAt,
  }));
}

function getOtherReviewPhotosFromCaptures(photos: OtherCapturePhoto[]): OtherReviewPhoto[] {
  return photos.map((photo) => ({
    id: `other-${photo.sequenceNo}`,
    source: { uri: photo.uri },
    uri: photo.uri,
  }));
}

function getOtherCapturesFromReviewPhotos(photos: OtherReviewPhoto[]): OtherCapturePhoto[] {
  return photos.map((photo, index) => ({
    sequenceNo: index + 1,
    uri: photo.uri,
  }));
}

type ReviewPhotoProps = {
  label: string;
  source: ImageSource;
};

function ReviewPhoto({ label, source }: ReviewPhotoProps) {
  const [hasLoadError, setHasLoadError] = useState(false);
  const hasSource =
    typeof source === 'number' ||
    typeof source === 'string' ||
    (typeof source === 'object' && Boolean(source.uri));

  return (
    <View style={styles.photoFrame}>
      {hasSource && !hasLoadError ? (
        <Image
          contentFit="cover"
          onError={() => setHasLoadError(true)}
          source={source}
          style={styles.workerPhoto}
        />
      ) : (
        <View style={styles.photoFallback}>
          <Icon
            color={colors.textMuted}
            name={{ ios: 'photo', android: 'photo', web: 'photo' }}
            size={28}
          />
          <Text style={styles.photoFallbackText}>{label}</Text>
        </View>
      )}
      <View style={styles.photoLabel}>
        <Text style={styles.photoLabelText}>{label}</Text>
      </View>
    </View>
  );
}

const colors = {
  actionBlue: '#0082F0',
  background: '#F7F8FA',
  border: '#E4E7EC',
  borderStrong: '#c0c7d5',
  danger: '#DC2626',
  photoStage: '#101214',
  primary: '#005cad',
  safe: '#16A34A',
  siteSurface: '#E6F3FE',
  surface: '#fcf9f8',
  surfaceLow: '#f6f3f2',
  text: '#1c1b1b',
  textMuted: '#667085',
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
    maxWidth: 672,
    width: '100%',
  },
  header: {
    alignItems: 'center',
    backgroundColor: colors.surface,
    borderBottomColor: colors.border,
    borderBottomWidth: 1,
    flexDirection: 'row',
    height: 56,
    paddingHorizontal: 16,
  },
  headerIconButton: {
    alignItems: 'center',
    height: 48,
    justifyContent: 'center',
    marginLeft: -8,
    width: 48,
  },
  headerSpacer: {
    width: 40,
  },
  headerTitle: {
    color: colors.text,
    flex: 1,
    fontSize: 20,
    fontWeight: '600',
    lineHeight: 28,
    textAlign: 'center',
  },
  scroll: {
    flex: 1,
  },
  content: {
    gap: 24,
    paddingBottom: 104,
    paddingHorizontal: 16,
    paddingTop: 16,
  },
  siteCard: {
    backgroundColor: colors.white,
    borderColor: 'rgba(0, 92, 173, 0.12)',
    borderRadius: 12,
    borderWidth: 1,
    gap: 12,
    padding: 16,
    shadowColor: '#005cad',
    shadowOffset: { height: 8, width: 0 },
    shadowOpacity: 0.08,
    shadowRadius: 18,
  },
  siteCardEditing: {
    backgroundColor: '#F8FBFF',
    borderColor: 'rgba(0, 130, 240, 0.36)',
    shadowColor: colors.actionBlue,
    shadowOpacity: 0.14,
    shadowRadius: 20,
  },
  locationCard: {
    alignItems: 'center',
    backgroundColor: '#FFFFFF',
    borderColor: 'rgba(0, 130, 240, 0.16)',
    borderRadius: 12,
    borderWidth: 1,
    flexDirection: 'row',
    gap: 12,
    padding: 14,
    shadowColor: '#005cad',
    shadowOffset: { height: 8, width: 0 },
    shadowOpacity: 0.08,
    shadowRadius: 16,
  },
  locationIcon: {
    alignItems: 'center',
    backgroundColor: '#EAF5FF',
    borderRadius: 999,
    height: 42,
    justifyContent: 'center',
    width: 42,
  },
  locationCopy: {
    flex: 1,
    minWidth: 0,
  },
  locationTitle: {
    color: colors.text,
    fontSize: 14,
    fontWeight: '800',
    lineHeight: 20,
  },
  locationMessage: {
    color: colors.textMuted,
    fontSize: 12,
    fontWeight: '500',
    lineHeight: 17,
    marginTop: 2,
  },
  locationButton: {
    alignItems: 'center',
    backgroundColor: colors.actionBlue,
    borderRadius: 8,
    justifyContent: 'center',
    minHeight: 38,
    paddingHorizontal: 12,
  },
  locationButtonText: {
    color: colors.white,
    fontSize: 12,
    fontWeight: '800',
    lineHeight: 16,
    textAlign: 'center',
  },
  siteTopRow: {
    alignItems: 'center',
    flexDirection: 'row',
    gap: 12,
  },
  siteIcon: {
    alignItems: 'center',
    backgroundColor: colors.siteSurface,
    borderColor: 'rgba(0, 92, 173, 0.12)',
    borderRadius: 12,
    borderWidth: 1,
    height: 48,
    justifyContent: 'center',
    width: 48,
  },
  siteCopy: {
    flex: 1,
    minWidth: 0,
  },
  metaLabel: {
    color: colors.primary,
    fontSize: 12,
    fontWeight: '800',
    letterSpacing: 0,
    lineHeight: 16,
    textTransform: 'uppercase',
  },
  siteName: {
    color: colors.text,
    fontSize: 16,
    fontWeight: '700',
    lineHeight: 22,
  },
  siteNameEmpty: {
    color: colors.textMuted,
    fontWeight: '600',
  },
  siteHint: {
    color: colors.textMuted,
    fontSize: 12,
    fontWeight: '500',
    lineHeight: 16,
    marginTop: 2,
  },
  siteInput: {
    backgroundColor: colors.white,
    borderColor: 'rgba(0, 130, 240, 0.42)',
    borderRadius: 10,
    borderWidth: 2,
    color: colors.text,
    fontSize: 16,
    fontWeight: '700',
    minHeight: 48,
    paddingHorizontal: 14,
  },
  siteInputError: {
    borderColor: colors.danger,
  },
  changeButton: {
    alignItems: 'center',
    backgroundColor: colors.siteSurface,
    borderColor: 'rgba(0, 92, 173, 0.14)',
    borderRadius: 999,
    borderWidth: 1,
    height: 40,
    justifyContent: 'center',
    width: 40,
  },
  siteEditFooter: {
    gap: 10,
  },
  siteError: {
    color: colors.danger,
    fontSize: 12,
    fontWeight: '600',
    lineHeight: 16,
  },
  siteEditActions: {
    flexDirection: 'row',
    gap: 10,
  },
  siteCancelButton: {
    alignItems: 'center',
    backgroundColor: colors.white,
    borderColor: 'rgba(0, 92, 173, 0.12)',
    borderRadius: 8,
    borderWidth: 1,
    flex: 1,
    justifyContent: 'center',
    minHeight: 42,
  },
  siteCancelText: {
    color: colors.textMuted,
    fontSize: 14,
    fontWeight: '700',
    lineHeight: 20,
  },
  siteSaveButton: {
    alignItems: 'center',
    backgroundColor: colors.actionBlue,
    borderRadius: 8,
    flex: 1,
    justifyContent: 'center',
    minHeight: 42,
  },
  siteSaveText: {
    color: colors.white,
    fontSize: 14,
    fontWeight: '800',
    lineHeight: 20,
  },
  section: {
    gap: 8,
  },
  sectionHeader: {
    alignItems: 'flex-end',
    flexDirection: 'row',
    justifyContent: 'space-between',
  },
  sectionTitle: {
    color: colors.text,
    fontSize: 20,
    fontWeight: '600',
    lineHeight: 28,
  },
  sectionSubtitle: {
    color: colors.textMuted,
    fontSize: 12,
    fontWeight: '500',
    lineHeight: 16,
  },
  workerMarkers: {
    alignItems: 'center',
    flexDirection: 'row',
    gap: 8,
    justifyContent: 'center',
    paddingBottom: 6,
    paddingTop: 4,
  },
  workerMarker: {
    backgroundColor: '#D1D5DB',
    borderRadius: 999,
    height: 5,
    width: 24,
  },
  workerMarkerActive: {
    backgroundColor: colors.primary,
    height: 5,
    width: 36,
  },
  workerCarousel: {
    marginHorizontal: -16,
    overflow: 'hidden',
  },
  workerTrack: {
    alignItems: 'stretch',
  },
  workerSlide: {
    paddingHorizontal: 16,
  },
  workerCard: {
    backgroundColor: colors.white,
    borderColor: 'rgba(0, 92, 173, 0.12)',
    borderRadius: 16,
    borderWidth: 1,
    padding: 14,
    shadowColor: '#005cad',
    shadowOffset: { height: 4, width: 0 },
    shadowOpacity: 0.06,
    shadowRadius: 14,
    elevation: 2,
  },
  workerCardHeader: {
    alignItems: 'center',
    flexDirection: 'row',
    justifyContent: 'space-between',
    marginBottom: 12,
  },
  workerBadgeRow: {
    alignItems: 'center',
    flexDirection: 'row',
    gap: 8,
  },
  captureTimeBadge: {
    alignItems: 'center',
    backgroundColor: 'rgba(0, 92, 173, 0.06)',
    borderColor: 'rgba(0, 92, 173, 0.12)',
    borderRadius: 8,
    borderWidth: 1,
    flexDirection: 'row',
    gap: 4,
    paddingHorizontal: 8,
    paddingVertical: 4,
  },
  captureTimeText: {
    color: colors.primary,
    fontSize: 12,
    fontWeight: '700',
  },
  workerBadge: {
    alignItems: 'center',
    backgroundColor: colors.siteSurface,
    borderColor: 'rgba(0, 92, 173, 0.12)',
    borderRadius: 8,
    borderWidth: 1,
    flexDirection: 'row',
    gap: 6,
    paddingHorizontal: 10,
    paddingVertical: 4,
  },
  workerBadgeText: {
    color: colors.primary,
    fontSize: 13,
    fontWeight: '700',
  },
  workerPhotoCount: {
    color: colors.textMuted,
    fontSize: 12,
    fontWeight: '600',
  },
  photoGrid: {
    flexDirection: 'row',
    gap: 10,
  },
  photoColumn: {
    flex: 1,
  },
  photoFrame: {
    aspectRatio: 9 / 16,
    backgroundColor: colors.surfaceLow,
    borderColor: colors.border,
    borderRadius: 12,
    borderWidth: 1,
    overflow: 'hidden',
    position: 'relative',
  },
  workerPhoto: {
    height: '100%',
    width: '100%',
  },
  photoFallback: {
    alignItems: 'center',
    backgroundColor: colors.surfaceLow,
    gap: 8,
    height: '100%',
    justifyContent: 'center',
    padding: 12,
    width: '100%',
  },
  photoFallbackText: {
    color: colors.textMuted,
    fontSize: 12,
    fontWeight: '600',
    lineHeight: 16,
  },
  photoLabel: {
    alignItems: 'center',
    backgroundColor: 'rgba(16, 24, 40, 0.72)',
    borderColor: 'rgba(255, 255, 255, 0.24)',
    borderRadius: 999,
    borderWidth: 1,
    bottom: 8,
    left: 8,
    paddingHorizontal: 10,
    paddingVertical: 4,
    position: 'absolute',
  },
  photoLabelText: {
    color: colors.white,
    fontSize: 11,
    fontWeight: '700',
    letterSpacing: 0.3,
    lineHeight: 14,
  },
  cardStatus: {
    alignItems: 'center',
    backgroundColor: '#ECFDF5',
    borderColor: 'rgba(22, 163, 74, 0.24)',
    borderRadius: 10,
    borderWidth: 1,
    flexDirection: 'row',
    gap: 8,
    justifyContent: 'center',
    marginTop: 12,
    minHeight: 40,
    paddingHorizontal: 12,
  },
  cardStatusText: {
    color: '#15803D',
    fontSize: 13,
    fontWeight: '700',
    lineHeight: 18,
  },
  workerActions: {
    flexDirection: 'row',
    gap: 10,
    marginTop: 10,
  },
  workerActionButton: {
    alignItems: 'center',
    borderRadius: 10,
    borderWidth: 1,
    flex: 1,
    flexDirection: 'row',
    gap: 8,
    justifyContent: 'center',
    minHeight: 44,
    paddingHorizontal: 12,
  },
  retakeButton: {
    backgroundColor: colors.siteSurface,
    borderColor: 'rgba(0, 92, 173, 0.16)',
  },
  removeButton: {
    backgroundColor: '#FEF2F2',
    borderColor: 'rgba(220, 38, 38, 0.2)',
  },
  retakeText: {
    color: colors.primary,
    fontSize: 13,
    fontWeight: '700',
    lineHeight: 18,
  },
  removeText: {
    color: colors.danger,
    fontSize: 13,
    fontWeight: '700',
    lineHeight: 18,
  },
  continueButton: {
    alignItems: 'center',
    backgroundColor: colors.white,
    borderColor: 'rgba(0, 92, 173, 0.28)',
    borderRadius: 12,
    borderWidth: 1.5,
    flexDirection: 'row',
    gap: 8,
    height: 48,
    justifyContent: 'center',
    marginTop: 12,
    shadowColor: '#005cad',
    shadowOffset: { height: 2, width: 0 },
    shadowOpacity: 0.04,
    shadowRadius: 8,
  },
  continueText: {
    color: colors.primary,
    fontSize: 14,
    fontWeight: '700',
    lineHeight: 20,
  },
  otherStrip: {
    gap: 12,
    paddingBottom: 2,
  },
  otherPhoto: {
    aspectRatio: 1,
    backgroundColor: colors.surfaceLow,
    borderColor: colors.border,
    borderRadius: 8,
    borderWidth: 1,
    height: 120,
    overflow: 'hidden',
  },
  addOtherButton: {
    alignItems: 'center',
    aspectRatio: 1,
    backgroundColor: colors.surfaceLow,
    borderColor: colors.borderStrong,
    borderRadius: 8,
    borderStyle: 'dashed',
    borderWidth: 2,
    gap: 4,
    height: 120,
    justifyContent: 'center',
  },
  addOtherText: {
    color: colors.textMuted,
    fontSize: 12,
    fontWeight: '500',
    lineHeight: 16,
  },
  submitBar: {
    alignSelf: 'center',
    backgroundColor: 'rgba(252, 249, 248, 0.94)',
    borderTopColor: colors.border,
    borderTopWidth: 1,
    bottom: 0,
    left: 0,
    maxWidth: 448,
    paddingHorizontal: 16,
    paddingTop: 12,
    position: 'absolute',
    right: 0,
    width: '100%',
  },
  submitButton: {
    alignItems: 'center',
    backgroundColor: colors.actionBlue,
    borderRadius: 8,
    height: 48,
    justifyContent: 'center',
    shadowColor: '#1a1a1a',
    shadowOffset: { height: 2, width: 0 },
    shadowOpacity: 0.08,
    shadowRadius: 4,
  },
  submitText: {
    color: colors.white,
    fontSize: 14,
    fontWeight: '600',
    lineHeight: 20,
  },
  confirmBackdrop: {
    alignItems: 'center',
    backgroundColor: 'transparent',
    flex: 1,
    justifyContent: 'center',
    padding: 24,
  },
  confirmCard: {
    alignItems: 'center',
    backgroundColor: colors.white,
    borderColor: colors.border,
    borderRadius: 14,
    borderWidth: 1,
    elevation: 20,
    gap: 12,
    maxWidth: 360,
    padding: 20,
    shadowColor: '#000000',
    shadowOffset: { height: 10, width: 0 },
    shadowOpacity: 0.2,
    shadowRadius: 20,
    width: '100%',
  },
  confirmIcon: {
    alignItems: 'center',
    backgroundColor: 'rgba(220, 38, 38, 0.1)',
    borderRadius: 999,
    height: 52,
    justifyContent: 'center',
    width: 52,
  },
  confirmTitle: {
    color: colors.text,
    fontSize: 20,
    fontWeight: '800',
    lineHeight: 26,
    textAlign: 'center',
  },
  confirmMessage: {
    color: colors.textMuted,
    fontSize: 14,
    fontWeight: '500',
    lineHeight: 21,
    textAlign: 'center',
  },
  confirmActions: {
    flexDirection: 'row',
    gap: 10,
    marginTop: 6,
    width: '100%',
  },
  confirmCancelButton: {
    alignItems: 'center',
    backgroundColor: colors.surfaceLow,
    borderColor: colors.border,
    borderRadius: 8,
    borderWidth: 1,
    flex: 1,
    justifyContent: 'center',
    minHeight: 44,
    paddingHorizontal: 10,
  },
  confirmCancelText: {
    color: colors.text,
    fontSize: 13,
    fontWeight: '800',
    lineHeight: 18,
    textAlign: 'center',
  },
  confirmLeaveButton: {
    alignItems: 'center',
    backgroundColor: colors.danger,
    borderRadius: 8,
    flex: 1,
    justifyContent: 'center',
    minHeight: 44,
    paddingHorizontal: 10,
  },
  confirmLeaveText: {
    color: colors.white,
    fontSize: 13,
    fontWeight: '800',
    lineHeight: 18,
    textAlign: 'center',
  },
  pressed: {
    opacity: 0.72,
  },
  textPressed: {
    opacity: 0.62,
  },
  disabledButton: {
    opacity: 0.5,
  },
});
