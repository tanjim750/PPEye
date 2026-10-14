import { CameraView, FlashMode, useCameraPermissions } from 'expo-camera';
import { Image } from 'expo-image';
import { Href, useRouter } from 'expo-router';
import { StatusBar } from 'expo-status-bar';
import { useEffect, useRef, useState } from 'react';
import {
  ActivityIndicator,
  Platform,
  Pressable,
  ScrollView,
  StyleSheet,
  StatusBar as NativeStatusBar,
  Text,
  View,
} from 'react-native';
import { SafeAreaView } from 'react-native-safe-area-context';
import { useTranslation } from 'react-i18next';

import { Icon } from '@/components/ui/Icon';
import { useContinuousOthersCapture } from '@/features/capture/hooks/useContinuousOthersCapture';
import {
  getPendingSubmissionReviewOtherPhotos,
  setPendingSubmissionReviewOtherPhotos,
} from '@/features/submissions/services/pendingSubmissionReview.service';

function getInstructionKey(photoNumber: number) {
  switch (photoNumber) {
    case 1:
      return 'accessId';
    case 2:
      return 'roofTop';
    case 3:
      return 'safetyBanners';
    case 4:
      return 'firstAidBox';
    default:
      return 'additional';
  }
}

const requiredInstructionKeys = ['accessId', 'roofTop', 'safetyBanners', 'firstAidBox'] as const;

export function OthersCaptureScreen() {
  const cameraRef = useRef<CameraView>(null);
  const router = useRouter();
  const { t } = useTranslation('submission');
  const [permission, requestPermission] = useCameraPermissions();
  const [isCameraAvailable, setIsCameraAvailable] = useState<boolean | null>(null);
  const [isCameraReady, setIsCameraReady] = useState(false);
  const [cameraError, setCameraError] = useState<string | null>(null);
  const [flashMode, setFlashMode] = useState<FlashMode>('off');
  const [isPreviewOpen, setIsPreviewOpen] = useState(false);
  const [initialPhotos] = useState(() => getPendingSubmissionReviewOtherPhotos() ?? []);
  const [isInstructionCardVisible, setIsInstructionCardVisible] = useState(
    () => initialPhotos.length === 0,
  );
  const capture = useContinuousOthersCapture(initialPhotos);

  useEffect(() => {
    let isMounted = true;

    async function checkCameraAvailability() {
      if (Platform.OS !== 'web') {
        setIsCameraAvailable(true);
        return;
      }

      try {
        const available = await CameraView.isAvailableAsync();

        if (isMounted) {
          setIsCameraAvailable(available);
        }
      } catch {
        if (isMounted) {
          setIsCameraAvailable(false);
        }
      }
    }

    checkCameraAvailability();

    return () => {
      isMounted = false;
    };
  }, []);

  async function handleCapture() {
    await capture.capturePhoto(async () => {
      if (!cameraRef.current || !isCameraReady) {
        return undefined;
      }

      const photo = await cameraRef.current.takePictureAsync({
        imageType: 'jpg',
        quality: 0.9,
      });

      return photo.uri;
    });
    setIsPreviewOpen(false);
  }

  function handleDone() {
    setPendingSubmissionReviewOtherPhotos(capture.photos);
    router.replace('/submission-review' as Href);
  }

  function toggleFlash() {
    setFlashMode((currentMode) => (currentMode === 'off' ? 'on' : 'off'));
  }

  const captureDisabled =
    capture.isCapturing || !isCameraReady || !permission?.granted || isCameraAvailable !== true;
  const instructionKey = getInstructionKey(capture.currentPhotoNumber);
  const shouldShowInstructionCard = capture.photos.length === 0 && isInstructionCardVisible;

  return (
    <SafeAreaView edges={['top', 'bottom']} style={styles.safeArea}>
      <StatusBar animated style="light" />
      <NativeStatusBar backgroundColor={colors.controlSurface} barStyle="light-content" />
      <View style={styles.shell}>
        <View style={styles.topBar}>
          <View style={styles.headerCopy}>
            <Text style={styles.headerEyebrow}>{t('othersCaptureScreen.title')}</Text>
            <Text style={styles.headerTitle}>
              {t('othersCaptureScreen.photo', { number: capture.currentPhotoNumber })}
            </Text>
          </View>
          <Pressable
            accessibilityRole="button"
            onPress={handleDone}
            style={({ pressed }) => [styles.doneButton, pressed && styles.textPressed]}>
            <Text style={styles.doneText}>{t('captureScreen.done')}</Text>
          </Pressable>
        </View>

        <View style={styles.cameraPane}>
          {permission === null || isCameraAvailable === null ? (
            <CameraStateMessage message={t('captureScreen.cameraLoading')} />
          ) : !permission.granted ? (
            <CameraStateMessage
              actionLabel={
                permission.canAskAgain ? t('captureScreen.grantPermission') : undefined
              }
              message={t('captureScreen.permissionDenied')}
              onAction={permission.canAskAgain ? requestPermission : undefined}
            />
          ) : isCameraAvailable === false ? (
            <CameraStateMessage message={t('captureScreen.cameraUnavailable')} />
          ) : cameraError ? (
            <CameraStateMessage message={cameraError} />
          ) : (
            <CameraView
              animateShutter
              facing="back"
              flash={flashMode}
              mode="picture"
              onCameraReady={() => {
                setCameraError(null);
                setIsCameraReady(true);
              }}
              onMountError={(event) => {
                setIsCameraReady(false);
                setCameraError(event.message);
              }}
              ref={cameraRef}
              style={styles.cameraFeed}
            />
          )}

          <View pointerEvents="none" style={styles.cameraScrim} />
          {shouldShowInstructionCard ? (
            <View style={styles.instructionCard}>
              <View style={styles.instructionCardHeader}>
                <Text style={styles.instructionCardTitle}>
                  {t('othersCaptureScreen.instructionChecklistTitle')}
                </Text>
                <Pressable
                  accessibilityLabel={t('othersCaptureScreen.instructionChecklistClose')}
                  accessibilityRole="button"
                  onPress={() => setIsInstructionCardVisible(false)}
                  style={({ pressed }) => [
                    styles.instructionCloseButton,
                    pressed && styles.pressed,
                  ]}>
                  <Icon
                    color="rgba(255, 255, 255, 0.88)"
                    name={{ ios: 'xmark', android: 'close', web: 'close' }}
                    size={18}
                    weight="bold"
                  />
                </Pressable>
              </View>
              <View style={styles.instructionList}>
                {requiredInstructionKeys.map((key, index) => (
                  <View key={key} style={styles.instructionItem}>
                    <View style={styles.instructionNumber}>
                      <Text style={styles.instructionNumberText}>{index + 1}</Text>
                    </View>
                    <Text style={styles.instructionItemText}>
                      {t(`othersCaptureScreen.instructions.${key}`)}
                    </Text>
                  </View>
                ))}
              </View>
            </View>
          ) : (
            <View pointerEvents="none" style={styles.overlayCopy}>
              <Text style={styles.instruction}>
                {t(`othersCaptureScreen.instructions.${instructionKey}`)}
              </Text>
            </View>
          )}
        </View>

        <View style={styles.controlsPane}>
          <ScrollView
            contentContainerStyle={styles.progressStrip}
            horizontal
            showsHorizontalScrollIndicator={false}>
            {capture.photos.map((photo) => (
              <Pressable
                accessibilityRole="button"
                accessibilityState={{ selected: capture.selectedPhotoNumber === photo.sequenceNo }}
                key={photo.sequenceNo}
                onPress={() => {
                  capture.selectPhoto(photo.sequenceNo);
                  setIsPreviewOpen(true);
                }}
                style={({ pressed }) => [
                  capture.selectedPhotoNumber === photo.sequenceNo
                    ? styles.activeChip
                    : styles.photoChip,
                  pressed && styles.pressed,
                ]}>
                <Text
                  style={
                    capture.selectedPhotoNumber === photo.sequenceNo
                      ? styles.activeChipText
                      : styles.photoChipText
                  }>
                  {t('othersCaptureScreen.photoChip', { number: photo.sequenceNo })}
                </Text>
                <Icon
                  color={colors.safe}
                  name={{ ios: 'checkmark', android: 'check', web: 'check' }}
                  size={14}
                  weight="bold"
                />
              </Pressable>
            ))}
          </ScrollView>

          {isPreviewOpen && capture.selectedPhoto ? (
            <View style={styles.previewPanel}>
              <Image
                contentFit="cover"
                source={{ uri: capture.selectedPhoto.uri }}
                style={styles.previewLarge}
              />
              <View style={styles.actionRow}>
                <Pressable
                  accessibilityRole="button"
                  onPress={() => {
                    capture.retakeSelectedPhoto();
                    setIsPreviewOpen(false);
                  }}
                  style={({ pressed }) => [styles.primaryAction, pressed && styles.pressed]}>
                  <Text style={styles.primaryActionText}>{t('captureScreen.retake')}</Text>
                </Pressable>
                <Pressable
                  accessibilityRole="button"
                  onPress={() => {
                    capture.removeSelectedPhoto();
                    setIsPreviewOpen(false);
                  }}
                  style={({ pressed }) => [styles.secondaryAction, pressed && styles.pressed]}>
                  <Text style={styles.secondaryActionText}>{t('reviewScreen.remove')}</Text>
                </Pressable>
              </View>
            </View>
          ) : null}

          <View style={styles.cameraControls}>
            <Pressable
              accessibilityLabel={t('captureScreen.recentPhoto')}
              accessibilityRole="button"
              disabled={!capture.selectedPhoto}
              onPress={() => setIsPreviewOpen(true)}
              style={({ pressed }) => [
                styles.previewButton,
                !capture.selectedPhoto && styles.disabledControl,
                pressed && styles.pressed,
              ]}>
              {capture.selectedPhoto ? (
                <Image
                  contentFit="cover"
                  source={{ uri: capture.selectedPhoto.uri }}
                  style={styles.previewImage}
                />
              ) : (
                <Icon
                  color="rgba(255, 255, 255, 0.62)"
                  name={{ ios: 'photo', android: 'photo', web: 'photo' }}
                  size={24}
                />
              )}
            </Pressable>

            <Pressable
              accessibilityLabel={t('captureScreen.takePhoto')}
              accessibilityRole="button"
              disabled={captureDisabled}
              onPress={handleCapture}
              style={({ pressed }) => [
                styles.shutterButton,
                captureDisabled && styles.disabledControl,
                pressed && !captureDisabled && styles.shutterPressed,
              ]}>
              {capture.isCapturing ? (
                <ActivityIndicator color={colors.white} />
              ) : (
                <View style={styles.shutterInner}>
                  <View style={styles.shutterCore} />
                </View>
              )}
            </Pressable>

            <Pressable
              accessibilityLabel={t('captureScreen.flash')}
              accessibilityRole="button"
              disabled={isCameraAvailable !== true}
              onPress={toggleFlash}
              style={({ pressed }) => [
                styles.flashButton,
                flashMode === 'on' && styles.flashButtonActive,
                isCameraAvailable !== true && styles.disabledControl,
                pressed && styles.pressed,
              ]}>
              <Icon
                color={flashMode === 'on' ? colors.primary : 'rgba(255, 255, 255, 0.85)'}
                name={{
                  ios: flashMode === 'on' ? 'bolt.fill' : 'bolt.slash',
                  android: flashMode === 'on' ? 'flash_on' : 'flash_off',
                  web: flashMode === 'on' ? 'flash_on' : 'flash_off',
                }}
                size={24}
                weight="bold"
              />
            </Pressable>
          </View>
        </View>
      </View>
    </SafeAreaView>
  );
}

type CameraStateMessageProps = {
  actionLabel?: string;
  message: string;
  onAction?: () => void;
};

function CameraStateMessage({ actionLabel, message, onAction }: CameraStateMessageProps) {
  return (
    <View style={styles.stateMessage}>
      <Text style={styles.stateMessageText}>{message}</Text>
      {actionLabel && onAction ? (
        <Pressable
          accessibilityRole="button"
          onPress={onAction}
          style={({ pressed }) => [styles.permissionButton, pressed && styles.pressed]}>
          <Text style={styles.permissionButtonText}>{actionLabel}</Text>
        </Pressable>
      ) : null}
    </View>
  );
}

const colors = {
  background: '#101214',
  controlSurface: '#101214',
  primary: '#005cad',
  primaryContainer: '#0075d8',
  safe: '#16A34A',
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
  topBar: {
    alignItems: 'center',
    backgroundColor: colors.controlSurface,
    borderBottomColor: 'rgba(255, 255, 255, 0.08)',
    borderBottomWidth: 1,
    flexDirection: 'row',
    gap: 12,
    justifyContent: 'space-between',
    minHeight: 76,
    paddingHorizontal: 18,
    paddingVertical: 12,
    zIndex: 2,
  },
  headerCopy: {
    flex: 1,
    gap: 4,
    minWidth: 0,
  },
  headerEyebrow: {
    color: 'rgba(255, 255, 255, 0.58)',
    fontSize: 11,
    fontWeight: '800',
    letterSpacing: 0,
    lineHeight: 14,
    textTransform: 'uppercase',
  },
  headerTitle: {
    color: colors.white,
    fontSize: 24,
    fontWeight: '800',
    letterSpacing: 0,
    lineHeight: 30,
  },
  doneButton: {
    alignItems: 'center',
    backgroundColor: colors.white,
    borderRadius: 999,
    height: 40,
    justifyContent: 'center',
    minWidth: 68,
    paddingHorizontal: 16,
  },
  doneText: {
    color: colors.background,
    fontSize: 14,
    fontWeight: '800',
    lineHeight: 20,
  },
  cameraPane: {
    backgroundColor: '#000000',
    flex: 1,
    minHeight: 360,
    overflow: 'hidden',
    position: 'relative',
  },
  cameraFeed: {
    bottom: 0,
    left: 0,
    position: 'absolute',
    right: 0,
    top: 0,
  },
  cameraScrim: {
    backgroundColor: 'rgba(0, 0, 0, 0.08)',
    bottom: 0,
    left: 0,
    position: 'absolute',
    right: 0,
    top: 0,
  },
  overlayCopy: {
    alignItems: 'center',
    left: 16,
    position: 'absolute',
    right: 16,
    top: 24,
  },
  instruction: {
    backgroundColor: 'rgba(0, 0, 0, 0.44)',
    borderRadius: 999,
    color: 'rgba(255, 255, 255, 0.92)',
    fontSize: 16,
    fontWeight: '700',
    lineHeight: 24,
    overflow: 'hidden',
    paddingHorizontal: 14,
    paddingVertical: 6,
    textAlign: 'center',
  },
  instructionCard: {
    backgroundColor: 'rgba(16, 18, 20, 0.62)',
    borderColor: 'rgba(255, 255, 255, 0.22)',
    borderRadius: 14,
    borderWidth: 1,
    left: 16,
    padding: 14,
    position: 'absolute',
    right: 16,
    shadowColor: '#000000',
    shadowOffset: { height: 10, width: 0 },
    shadowOpacity: 0.28,
    shadowRadius: 18,
    top: 20,
    zIndex: 3,
    elevation: 8,
  },
  instructionCardHeader: {
    alignItems: 'center',
    flexDirection: 'row',
    gap: 12,
    justifyContent: 'space-between',
    marginBottom: 12,
  },
  instructionCardTitle: {
    color: colors.white,
    flex: 1,
    fontSize: 15,
    fontWeight: '800',
    lineHeight: 20,
  },
  instructionCloseButton: {
    alignItems: 'center',
    backgroundColor: 'rgba(255, 255, 255, 0.12)',
    borderRadius: 999,
    height: 34,
    justifyContent: 'center',
    width: 34,
  },
  instructionList: {
    gap: 10,
  },
  instructionItem: {
    alignItems: 'center',
    flexDirection: 'row',
    gap: 10,
  },
  instructionNumber: {
    alignItems: 'center',
    backgroundColor: 'rgba(255, 255, 255, 0.16)',
    borderColor: 'rgba(255, 255, 255, 0.22)',
    borderRadius: 999,
    borderWidth: 1,
    height: 28,
    justifyContent: 'center',
    width: 28,
  },
  instructionNumberText: {
    color: colors.white,
    fontSize: 12,
    fontWeight: '800',
    lineHeight: 16,
  },
  instructionItemText: {
    color: 'rgba(255, 255, 255, 0.9)',
    flex: 1,
    fontSize: 14,
    fontWeight: '600',
    lineHeight: 20,
  },
  stateMessage: {
    alignItems: 'center',
    bottom: 0,
    gap: 16,
    justifyContent: 'center',
    left: 0,
    padding: 24,
    position: 'absolute',
    right: 0,
    top: 0,
  },
  stateMessageText: {
    color: colors.white,
    fontSize: 16,
    lineHeight: 24,
    textAlign: 'center',
  },
  permissionButton: {
    backgroundColor: colors.white,
    borderRadius: 8,
    justifyContent: 'center',
    minHeight: 44,
    paddingHorizontal: 18,
  },
  permissionButtonText: {
    color: colors.primary,
    fontSize: 14,
    fontWeight: '700',
    lineHeight: 20,
  },
  controlsPane: {
    backgroundColor: colors.controlSurface,
    minHeight: 220,
    paddingBottom: 24,
  },
  progressStrip: {
    alignItems: 'center',
    flexDirection: 'row',
    gap: 8,
    paddingHorizontal: 16,
    paddingVertical: 16,
  },
  photoChip: {
    alignItems: 'center',
    backgroundColor: 'rgba(255, 255, 255, 0.1)',
    borderRadius: 999,
    flexDirection: 'row',
    gap: 4,
    paddingHorizontal: 12,
    paddingVertical: 6,
  },
  photoChipText: {
    color: colors.white,
    fontSize: 12,
    fontWeight: '600',
    lineHeight: 16,
  },
  activeChip: {
    backgroundColor: colors.primary,
    borderColor: colors.primaryContainer,
    borderRadius: 999,
    borderWidth: 1,
    flexDirection: 'row',
    gap: 5,
    paddingHorizontal: 16,
    paddingVertical: 8,
  },
  activeChipText: {
    color: colors.white,
    fontSize: 12,
    fontWeight: '800',
    lineHeight: 16,
  },
  previewPanel: {
    gap: 12,
    marginHorizontal: 16,
  },
  previewLarge: {
    alignSelf: 'center',
    aspectRatio: 1,
    borderColor: 'rgba(255, 255, 255, 0.18)',
    borderRadius: 12,
    borderWidth: 1,
    maxHeight: 168,
    overflow: 'hidden',
    width: '52%',
  },
  actionRow: {
    flexDirection: 'row',
    gap: 12,
  },
  primaryAction: {
    alignItems: 'center',
    backgroundColor: colors.primary,
    borderRadius: 8,
    flex: 1,
    justifyContent: 'center',
    minHeight: 44,
    paddingHorizontal: 12,
  },
  primaryActionText: {
    color: colors.white,
    fontSize: 12,
    fontWeight: '700',
    lineHeight: 16,
    textAlign: 'center',
  },
  secondaryAction: {
    alignItems: 'center',
    backgroundColor: colors.white,
    borderRadius: 8,
    flex: 1,
    justifyContent: 'center',
    minHeight: 44,
    paddingHorizontal: 12,
  },
  secondaryActionText: {
    color: colors.primary,
    fontSize: 12,
    fontWeight: '700',
    lineHeight: 16,
    textAlign: 'center',
  },
  cameraControls: {
    alignItems: 'center',
    flexDirection: 'row',
    justifyContent: 'space-between',
    marginTop: 'auto',
    paddingHorizontal: 32,
    paddingTop: 18,
  },
  previewButton: {
    alignItems: 'center',
    backgroundColor: 'rgba(255, 255, 255, 0.12)',
    borderColor: 'rgba(255, 255, 255, 0.16)',
    borderRadius: 10,
    borderWidth: 1,
    height: 52,
    justifyContent: 'center',
    overflow: 'hidden',
    width: 52,
  },
  previewImage: {
    height: '100%',
    width: '100%',
  },
  shutterButton: {
    alignItems: 'center',
    backgroundColor: 'rgba(255, 255, 255, 0.18)',
    borderColor: colors.white,
    borderRadius: 999,
    borderWidth: 3,
    height: 76,
    justifyContent: 'center',
    width: 76,
  },
  shutterInner: {
    alignItems: 'center',
    backgroundColor: colors.white,
    borderRadius: 999,
    height: 58,
    justifyContent: 'center',
    width: 58,
  },
  shutterCore: {
    backgroundColor: colors.primary,
    borderRadius: 999,
    height: 44,
    width: 44,
  },
  shutterPressed: {
    transform: [{ scale: 0.94 }],
  },
  flashButton: {
    alignItems: 'center',
    backgroundColor: 'rgba(255, 255, 255, 0.12)',
    borderRadius: 999,
    height: 52,
    justifyContent: 'center',
    width: 52,
  },
  flashButtonActive: {
    backgroundColor: colors.white,
  },
  disabledControl: {
    opacity: 0.38,
  },
  pressed: {
    opacity: 0.72,
  },
  textPressed: {
    opacity: 0.62,
  },
});
