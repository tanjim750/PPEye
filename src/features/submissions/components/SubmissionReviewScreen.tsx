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
import { SafeAreaView } from 'react-native-safe-area-context';
import { useTranslation } from 'react-i18next';

import { Icon } from '@/components/ui/Icon';
import { OtherCapturePhoto, PPEWorkerCapture } from '@/features/capture/types';
import {
  clearPendingSubmissionReviewCaptures,
  getPendingSubmissionReviewCaptures,
  getPendingSubmissionReviewOtherPhotos,
  getPendingSubmissionReviewSite,
  setPendingSubmissionReviewCaptures,
  setPendingSubmissionReviewOtherPhotos,
  setPendingSubmissionReviewSite,
  setPendingSubmissionReviewTarget,
} from '@/features/submissions/services/pendingSubmissionReview.service';
import { saveSubmittedWorkerChecks } from '@/features/submissions/services/submittedChecks.service';
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
};

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

export function SubmissionReviewScreen() {
  const router = useRouter();
  const navigation = useNavigation();
  const isExitingToHomeRef = useRef(false);
  const { t } = useTranslation('submission');
  const [activeWorkerIndex, setActiveWorkerIndex] = useState(0);
  const [isExitConfirmVisible, setIsExitConfirmVisible] = useState(false);
  const [siteName, setSiteName] = useState(() => getPendingSubmissionReviewSite());
  const [siteDraft, setSiteDraft] = useState(() => getPendingSubmissionReviewSite() ?? '');
  const [isEditingSite, setIsEditingSite] = useState(false);
  const [siteError, setSiteError] = useState<string | null>(null);
  const [isBuildingWeatherMetadata, setIsBuildingWeatherMetadata] = useState(false);
  const [isLocationServicesPromptVisible, setIsLocationServicesPromptVisible] = useState(false);
  const [submissionMetadata, setSubmissionMetadata] = useState<SubmissionReviewMetadata | null>(
    null,
  );
  const { width: windowWidth } = useWindowDimensions();
  const [workerPhotos, setWorkerPhotos] = useState<WorkerReviewPhoto[]>(() => {
    const pendingCaptures = getPendingSubmissionReviewCaptures();

    return pendingCaptures ? getWorkerPhotosFromCaptures(pendingCaptures) : [];
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
        requestExitToHome();
        return true;
      });

      return () => subscription.remove();
    }, [requestExitToHome]),
  );

  useFocusEffect(
    useCallback(() => {
      const unsubscribe = navigation.addListener('beforeRemove', (event) => {
        if (isExitingToHomeRef.current) {
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
    if (!siteName) {
      setSiteError(t('reviewScreen.siteRequired'));
      setIsEditingSite(true);
      return;
    }

    setPendingSubmissionReviewSite(siteName);
    const completeWorkers = workerPhotos.filter((worker) => worker.frontUri && worker.backUri);
    if (completeWorkers.length === 0) {
      Alert.alert(t('reviewScreen.workerPhotosRequired'));
      return;
    }
    const submissionId = `${Date.now()}`;
    const submittedAt = new Date().toISOString();
    await saveSubmittedWorkerChecks(completeWorkers.map((worker) => ({
      id: `${submissionId}-${worker.sequenceNo}`,
      submissionId,
      workerNumber: worker.sequenceNo,
      frontUri: worker.frontUri,
      backUri: worker.backUri,
      otherPhotoUris: reviewOtherPhotos.map((photo) => photo.uri),
      site: siteName,
      submittedAt,
      status: 'waiting',
    })));
    console.log(
      'Submission review state',
      JSON.stringify(
        {
          others: reviewOtherPhotos.map((photo) => photo.uri),
          metadata: submissionMetadata,
          site: siteName,
          workers: workerPhotos.map((worker) => ({
            backUri: worker.backUri,
            frontUri: worker.frontUri,
            sequenceNo: worker.sequenceNo,
          })),
        },
        null,
        2,
      ),
    );
    clearPendingSubmissionReviewCaptures();
    router.replace('/(external)' as Href);
  }

  function updateActiveWorker(offsetX: number) {
    if (!slideWidth) {
      return;
    }

    const nextIndex = Math.round(offsetX / slideWidth);
    const boundedIndex = Math.max(0, Math.min(workerPhotos.length - 1, nextIndex));

    setActiveWorkerIndex(boundedIndex);
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
          contentContainerStyle={styles.content}
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
                      style={[styles.siteName, !siteName && styles.siteNameEmpty]}>
                      {siteName ?? t('reviewScreen.noSiteSelected')}
                    </Text>
                    <Text numberOfLines={1} style={styles.siteHint}>
                      {siteName ? t('reviewScreen.siteReadyHint') : t('reviewScreen.siteEmptyHint')}
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
                <View
                  key={worker.sequenceNo}
                  style={[
                    styles.workerMarker,
                    index === activeWorkerIndex && styles.workerMarkerActive,
                  ]}
                />
              ))}
            </View>

            <View style={styles.workerCarousel}>
              <ScrollView
                contentContainerStyle={styles.workerTrack}
                decelerationRate="fast"
                horizontal
                onMomentumScrollEnd={(event) =>
                  updateActiveWorker(event.nativeEvent.contentOffset.x)
                }
                pagingEnabled
                showsHorizontalScrollIndicator={false}
                snapToInterval={slideWidth}
                snapToAlignment="start">
                {workerPhotos.map((worker) => (
                  <View
                    key={worker.sequenceNo}
                    style={[styles.workerSlide, { width: slideWidth }]}>
                    <View style={styles.workerCard}>
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
                          size={20}
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
                            color={colors.actionBlue}
                            name={{
                              ios: 'camera.rotate.fill',
                              android: 'flip_camera_android',
                              web: 'flip_camera_android',
                            }}
                            size={17}
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
                            size={17}
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
                color={colors.actionBlue}
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
              horizontal
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

        <View style={styles.submitBar}>
          <Pressable
            accessibilityRole="button"
            onPress={submitForReview}
            style={({ pressed }) => [styles.submitButton, pressed && styles.pressed]}>
            <Text style={styles.submitText}>{t('reviewScreen.submit')}</Text>
          </Pressable>
        </View>

        <Modal
          animationType="fade"
          onRequestClose={() => setIsExitConfirmVisible(false)}
          transparent
          visible={isExitConfirmVisible}>
          <View style={styles.confirmBackdrop}>
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
    }));
}

function getCapturesFromWorkerPhotos(workers: WorkerReviewPhoto[]): PPEWorkerCapture[] {
  return workers.map((worker) => ({
    backUri: worker.backUri,
    frontUri: worker.frontUri,
    sequenceNo: worker.sequenceNo,
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
    gap: 7,
    justifyContent: 'center',
    paddingBottom: 4,
    paddingTop: 2,
  },
  workerMarker: {
    backgroundColor: colors.borderStrong,
    borderRadius: 999,
    height: 3,
    width: 28,
  },
  workerMarkerActive: {
    backgroundColor: colors.actionBlue,
    height: 4,
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
    backgroundColor: colors.photoStage,
    borderColor: 'rgba(255, 255, 255, 0.12)',
    borderRadius: 12,
    borderWidth: 1,
    padding: 10,
    shadowColor: '#101214',
    shadowOffset: { height: 10, width: 0 },
    shadowOpacity: 0.16,
    shadowRadius: 18,
  },
  photoGrid: {
    flexDirection: 'row',
    justifyContent: 'space-between',
  },
  photoColumn: {
    width: '48.5%',
  },
  photoFrame: {
    aspectRatio: 9 / 16,
    backgroundColor: '#171b20',
    borderColor: 'rgba(255, 255, 255, 0.16)',
    borderRadius: 10,
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
    backgroundColor: 'rgba(0, 0, 0, 0.62)',
    borderColor: 'rgba(255, 255, 255, 0.18)',
    borderRadius: 999,
    borderWidth: 1,
    bottom: 10,
    left: 10,
    paddingHorizontal: 10,
    paddingVertical: 5,
    position: 'absolute',
  },
  photoLabelText: {
    color: colors.white,
    fontSize: 10,
    fontWeight: '700',
    lineHeight: 14,
  },
  cardStatus: {
    alignItems: 'center',
    backgroundColor: 'rgba(255, 255, 255, 0.08)',
    borderColor: 'rgba(255, 255, 255, 0.1)',
    borderRadius: 8,
    borderWidth: 1,
    flexDirection: 'row',
    gap: 8,
    justifyContent: 'center',
    marginTop: 10,
    minHeight: 38,
    paddingHorizontal: 12,
  },
  cardStatusText: {
    color: colors.white,
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
    borderRadius: 8,
    flex: 1,
    flexDirection: 'row',
    gap: 7,
    justifyContent: 'center',
    minHeight: 42,
    paddingHorizontal: 10,
  },
  retakeButton: {
    backgroundColor: colors.white,
  },
  removeButton: {
    backgroundColor: 'rgba(220, 38, 38, 0.12)',
    borderColor: 'rgba(248, 113, 113, 0.24)',
    borderWidth: 1,
  },
  retakeText: {
    color: colors.actionBlue,
    fontSize: 13,
    fontWeight: '800',
    lineHeight: 18,
  },
  removeText: {
    color: '#F87171',
    fontSize: 13,
    fontWeight: '800',
    lineHeight: 18,
  },
  continueButton: {
    alignItems: 'center',
    borderColor: colors.actionBlue,
    borderRadius: 8,
    borderWidth: 2,
    flexDirection: 'row',
    gap: 8,
    height: 48,
    justifyContent: 'center',
    marginTop: 8,
  },
  continueText: {
    color: colors.actionBlue,
    fontSize: 14,
    fontWeight: '600',
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
    backgroundColor: 'rgba(252, 249, 248, 0.94)',
    borderTopColor: colors.border,
    borderTopWidth: 1,
    bottom: 0,
    left: 0,
    padding: 16,
    position: 'absolute',
    right: 0,
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
    backgroundColor: 'rgba(16, 18, 20, 0.52)',
    flex: 1,
    justifyContent: 'center',
    padding: 24,
  },
  confirmCard: {
    alignItems: 'center',
    backgroundColor: colors.white,
    borderRadius: 14,
    gap: 12,
    maxWidth: 360,
    padding: 20,
    shadowColor: '#000000',
    shadowOffset: { height: 18, width: 0 },
    shadowOpacity: 0.24,
    shadowRadius: 28,
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
