import { CameraView, FlashMode, useCameraPermissions } from "expo-camera";
import { Image } from "expo-image";
import { Href, useFocusEffect, useNavigation, useRouter } from "expo-router";
import { StatusBar } from "expo-status-bar";
import { useCallback, useEffect, useRef, useState } from "react";
import { useTranslation } from "react-i18next";
import {
  ActivityIndicator,
  BackHandler,
  StatusBar as NativeStatusBar,
  Platform,
  Pressable,
  ScrollView,
  StyleSheet,
  Text,
  View,
} from "react-native";
import { SafeAreaView } from "react-native-safe-area-context";

import { Icon } from "@/components/ui/Icon";
import { useContinuousPPECapture } from "@/features/capture/hooks/useContinuousPPECapture";
import {
  getPendingSubmissionReviewCaptures,
  getPendingSubmissionReviewTarget,
  setPendingSubmissionReviewCaptures,
  setPendingSubmissionReviewTarget,
} from "@/features/submissions/services/pendingSubmissionReview.service";

export function CaptureScreen() {
  const cameraRef = useRef<CameraView>(null);
  const navigation = useNavigation();
  const router = useRouter();
  const isExitingToHomeRef = useRef(false);
  const { t } = useTranslation("submission");
  const [permission, requestPermission] = useCameraPermissions();
  const [isCameraAvailable, setIsCameraAvailable] = useState<boolean | null>(
    null,
  );
  const [isCameraReady, setIsCameraReady] = useState(false);
  const [cameraError, setCameraError] = useState<string | null>(null);
  const [flashMode, setFlashMode] = useState<FlashMode>("off");
  const [isPreviewOpen, setIsPreviewOpen] = useState(false);
  const [initialCaptures] = useState(
    () => getPendingSubmissionReviewCaptures() ?? [],
  );
  const [initialCaptureTarget] = useState(() =>
    getPendingSubmissionReviewTarget(),
  );
  const capture = useContinuousPPECapture(
    initialCaptures,
    initialCaptureTarget,
  );

  const hasLocalWorkerImages = capture.selectableWorkers.some(
    (worker) => worker?.capture?.frontUri || worker?.capture?.backUri,
  );
  // console.log('CaptureScreen: hasLocalWorkerImages', hasLocalWorkerImages);
  const completeCapture = capture.completeCapture;  

  const handleDone = useCallback(() => {
    let completedCaptures = completeCapture();

    if (!completedCaptures || completedCaptures.length === 0) {
      if (capture.currentWorkerCapture?.frontUri || capture.currentWorkerCapture?.backUri) {
        completedCaptures = [
          {
            sequenceNo: capture.currentWorkerNumber,
            frontUri: capture.currentWorkerCapture.frontUri || capture.currentWorkerCapture.backUri,
            backUri: capture.currentWorkerCapture.backUri || capture.currentWorkerCapture.frontUri,
          },
        ];
      } else {
        return;
      }
    }

    setPendingSubmissionReviewCaptures(completedCaptures);
    router.push("/submission-review" as Href);
  }, [capture.currentWorkerCapture, capture.currentWorkerNumber, completeCapture, router]);

  const exitToHome = useCallback(() => {
    if (isExitingToHomeRef.current) {
      return;
    }

    isExitingToHomeRef.current = true;
    router.replace("/(external)" as Href);
  }, [router]);

  const requestExitToHome = useCallback(() => {
    if (!hasLocalWorkerImages) {
      exitToHome();
      return;
    }

    handleDone();
  }, [exitToHome, handleDone, hasLocalWorkerImages]);

  useFocusEffect(
    useCallback(() => {
      const subscription = BackHandler.addEventListener(
        "hardwareBackPress",
        () => {
          requestExitToHome();
          return true;
        },
      );

      return () => {
        subscription.remove();
      };
    }, [requestExitToHome]),
  );

  useFocusEffect(
    useCallback(() => {
      const unsubscribe = navigation.addListener("beforeRemove", (event) => {
        if (isExitingToHomeRef.current) {
          return;
        }

        event.preventDefault();
        requestExitToHome();
      });

      return unsubscribe;
    }, [navigation, requestExitToHome]),
  );

  useEffect(() => {
    setPendingSubmissionReviewTarget(null);
  }, []);

  useEffect(() => {
    let isMounted = true;

    async function checkCameraAvailability() {
      if (Platform.OS !== "web") {
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
        return capture.currentSide === "FRONT"
          ? "https://lh3.googleusercontent.com/aida-public/AB6AXuDgQU9bHBVHLqpP5L7JengM95PotCLUMm0pYSa5LrM8Tak4Qv7ZN0RbNzGeW5mlq6MGCveBJQQDXEWtSxpzqpzEqzO73hM9VW3OgXi4AkyKod79xg_aPJ9wxOMTPTb6_qUd51H5P1DcSqqEAji7jg9I2Kg465f111W36y-82wOnClR_5LezGuCHcZ0pf1_OvuhGY7GpysiX6hZC7JVN63eZ_gNo4b6GLcrM8yI56LZdN8ToE9jQBAt0"
          : "https://lh3.googleusercontent.com/aida-public/AB6AXuB-I5Gv4lteN5XsmAXE1_cDPtr_NEzL0F2CWVDwg-sZ1I-sHC0rbP0roxgmqczH7trvuE09iErv3qWPdaBHjcUMQoCkQorKdchMTpc_UUiogIYbMk6JgnOI5qH9IntEebdbZ_cummC-xp7OVKcew1zHrrSby1porfloCpEp9kvEmQQMPGtP2B7Vc8qebXWvsrsMUP_7BXNFUpp_KpYAP-6afKkjDLBTdOpvXOk1EfqXOSazVPOvAIwS";
      }

      const photo = await cameraRef.current.takePictureAsync({
        imageType: "jpg",
        quality: 0.9,
      });

      return photo.uri;
    });
    setIsPreviewOpen(false);
  }

  function toggleFlash() {
    setFlashMode((currentMode) => (currentMode === "off" ? "on" : "off"));
  }

  function handleRetake() {
    capture.retakeSelectedWorker();
    setIsPreviewOpen(false);
  }

  function handleSelectWorker(sequenceNo: number) {
    capture.selectWorker(sequenceNo);
    setIsPreviewOpen(false);
  }

  const captureDisabled =
    capture.isCapturing ||
    (Platform.OS !== "web" &&
      (!isCameraReady || !permission?.granted || isCameraAvailable !== true));
  const hasCurrentWorkerPreview = Boolean(
    capture.currentWorkerCapture?.frontUri ||
    capture.currentWorkerCapture?.backUri,
  );
  const canRetakeSelectedWorker = hasCurrentWorkerPreview;

  return (
    <SafeAreaView edges={["top", "bottom"]} style={styles.safeArea}>
      <StatusBar animated style="light" />
      <NativeStatusBar
        backgroundColor={colors.controlSurface}
        barStyle="light-content"
      />
      <View style={styles.shell}>
        <View style={styles.topBar}>
          <View style={styles.headerCopy}>
            <Text style={styles.headerEyebrow}>{t("captureScreen.title")}</Text>
            <View style={styles.headerDirectionRow}>
              <Text style={styles.headerWorker}>
                {t("captureScreen.worker", {
                  number: capture.currentWorkerNumber,
                })}
              </Text>
              <View style={styles.directionBadge}>
                <Text style={styles.directionBadgeText}>
                  {t(`captureScreen.sides.${capture.currentSide}`)}
                </Text>
              </View>
            </View>
          </View>
          <Pressable
            accessibilityRole="button"
            onPress={handleDone}
            style={({ pressed }) => [
              styles.doneButton,
              pressed && styles.textPressed,
            ]}
          >
            <Text style={styles.doneText}>{t("captureScreen.done")}</Text>
          </Pressable>
        </View>

        <View style={styles.cameraPane}>
          {permission === null || isCameraAvailable === null ? (
            <CameraStateMessage message={t("captureScreen.cameraLoading")} />
          ) : !permission.granted ? (
            <CameraStateMessage
              actionLabel={
                permission.canAskAgain
                  ? t("captureScreen.grantPermission")
                  : undefined
              }
              message={t("captureScreen.permissionDenied")}
              onAction={permission.canAskAgain ? requestPermission : undefined}
            />
          ) : isCameraAvailable === false ? (
            <CameraStateMessage
              message={t("captureScreen.cameraUnavailable")}
            />
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
          <View pointerEvents="none" style={styles.overlayCopy}>
            <Text style={styles.instruction}>
              {capture.currentSide === "FRONT"
                ? t("captureScreen.frontInstruction")
                : t("captureScreen.backInstruction")}
            </Text>
          </View>
        </View>

        <View style={styles.controlsPane}>
          <ScrollView
            contentContainerStyle={styles.progressStrip}
            horizontal
            showsHorizontalScrollIndicator={false}
          >
            {capture.selectableWorkers.map((worker) => (
              <Pressable
                accessibilityLabel={t("captureScreen.selectWorker", {
                  worker: worker.sequenceNo,
                })}
                accessibilityRole="button"
                accessibilityState={{ selected: worker.isCurrent }}
                key={worker.sequenceNo}
                onPress={() => handleSelectWorker(worker.sequenceNo)}
                style={({ pressed }) => [
                  worker.isCurrent ? styles.activeChip : styles.workerChip,
                  pressed && styles.pressed,
                ]}
              >
                <Text
                  style={
                    worker.isCurrent
                      ? styles.activeChipText
                      : styles.workerChipText
                  }
                >
                  {worker.isCurrent
                    ? t("captureScreen.workerSide", {
                        side: t(`captureScreen.sides.${capture.currentSide}`),
                        worker: worker.sequenceNo,
                      })
                    : t("captureScreen.completedWorker", {
                        number: worker.sequenceNo,
                      })}
                </Text>
                {worker.isComplete ? (
                  <Icon
                    color={colors.safe}
                    name={{ ios: "checkmark", android: "check", web: "check" }}
                    size={14}
                    weight="bold"
                  />
                ) : null}
              </Pressable>
            ))}
          </ScrollView>

          {capture.isBackPhotoRequired ? (
            <View style={styles.actionPanel}>
              <Text style={styles.actionTitle}>
                {t("captureScreen.backRequired", {
                  worker: capture.currentWorkerNumber,
                })}
              </Text>
              <View style={styles.actionRow}>
                <Pressable
                  accessibilityRole="button"
                  onPress={capture.takeBackPhoto}
                  style={({ pressed }) => [
                    styles.primaryAction,
                    pressed && styles.pressed,
                  ]}
                >
                  <Text style={styles.primaryActionText}>
                    {t("captureScreen.takeBackPhoto")}
                  </Text>
                </Pressable>
                <Pressable
                  accessibilityRole="button"
                  onPress={capture.removeCurrentWorker}
                  style={({ pressed }) => [
                    styles.secondaryAction,
                    pressed && styles.pressed,
                  ]}
                >
                  <Text style={styles.secondaryActionText}>
                    {t("captureScreen.removeCurrentWorker")}
                  </Text>
                </Pressable>
              </View>
            </View>
          ) : isPreviewOpen && capture.previewWorkerCapture ? (
            <View style={styles.previewPanel}>
              <View style={styles.previewPair}>
                <WorkerSidePreview
                  label={t("captureScreen.sides.FRONT")}
                  onPress={() => capture.selectPreviewSide("FRONT")}
                  selected={capture.selectedPreviewSide === "FRONT"}
                  uri={capture.previewWorkerCapture.frontUri}
                />
                <WorkerSidePreview
                  label={t("captureScreen.sides.BACK")}
                  onPress={() => capture.selectPreviewSide("BACK")}
                  selected={capture.selectedPreviewSide === "BACK"}
                  uri={capture.previewWorkerCapture.backUri}
                />
              </View>
              <View style={styles.actionRow}>
                <Pressable
                  accessibilityRole="button"
                  disabled={!canRetakeSelectedWorker}
                  onPress={handleRetake}
                  style={({ pressed }) => [
                    styles.primaryAction,
                    !canRetakeSelectedWorker && styles.disabledControl,
                    pressed && canRetakeSelectedWorker && styles.pressed,
                  ]}
                >
                  <Text style={styles.primaryActionText}>
                    {t("captureScreen.retake")}
                  </Text>
                </Pressable>
                <Pressable
                  accessibilityRole="button"
                  onPress={() => {
                    capture.keepSelectedWorkerPhoto();
                    setIsPreviewOpen(false);
                  }}
                  style={({ pressed }) => [
                    styles.secondaryAction,
                    pressed && styles.pressed,
                  ]}
                >
                  <Text style={styles.secondaryActionText}>
                    {t("captureScreen.keepPhoto")}
                  </Text>
                </Pressable>
              </View>
            </View>
          ) : null}

          <View style={styles.cameraControls}>
            <Pressable
              accessibilityLabel={t("captureScreen.recentPhoto")}
              accessibilityRole="button"
              disabled={!hasCurrentWorkerPreview}
              onPress={() => setIsPreviewOpen(true)}
              style={({ pressed }) => [
                styles.previewButton,
                !hasCurrentWorkerPreview && styles.disabledControl,
                pressed && styles.pressed,
              ]}
            >
              {capture.currentWorkerCapture?.frontUri ? (
                <Image
                  contentFit="cover"
                  source={{ uri: capture.currentWorkerCapture.frontUri }}
                  style={styles.previewImage}
                />
              ) : capture.currentWorkerCapture?.backUri ? (
                <Image
                  contentFit="cover"
                  source={{ uri: capture.currentWorkerCapture.backUri }}
                  style={styles.previewImage}
                />
              ) : (
                <Icon
                  color="rgba(255, 255, 255, 0.62)"
                  name={{ ios: "photo", android: "photo", web: "photo" }}
                  size={24}
                />
              )}
            </Pressable>

            <Pressable
              accessibilityLabel={t("captureScreen.takePhoto")}
              accessibilityRole="button"
              disabled={captureDisabled}
              onPress={handleCapture}
              style={({ pressed }) => [
                styles.shutterButton,
                captureDisabled && styles.disabledControl,
                pressed && !captureDisabled && styles.shutterPressed,
              ]}
            >
              {capture.isCapturing ? (
                <ActivityIndicator color={colors.white} />
              ) : (
                <View style={styles.shutterInner}>
                  <View style={styles.shutterCore} />
                </View>
              )}
            </Pressable>

            <Pressable
              accessibilityLabel={t("captureScreen.flash")}
              accessibilityRole="button"
              disabled={isCameraAvailable !== true}
              onPress={toggleFlash}
              style={({ pressed }) => [
                styles.flashButton,
                flashMode === "on" && styles.flashButtonActive,
                isCameraAvailable !== true && styles.disabledControl,
                pressed && styles.pressed,
              ]}
            >
              <Icon
                color={
                  flashMode === "on"
                    ? colors.primary
                    : "rgba(255, 255, 255, 0.85)"
                }
                name={{
                  ios: flashMode === "on" ? "bolt.fill" : "bolt.slash",
                  android: flashMode === "on" ? "flash_on" : "flash_off",
                  web: flashMode === "on" ? "flash_on" : "flash_off",
                }}
                size={28}
                weight="bold"
              />
            </Pressable>
          </View>
        </View>
      </View>
    </SafeAreaView>
  );
}

type WorkerSidePreviewProps = {
  label: string;
  onPress: () => void;
  selected: boolean;
  uri?: string;
};

function WorkerSidePreview({
  label,
  onPress,
  selected,
  uri,
}: WorkerSidePreviewProps) {
  return (
    <Pressable
      accessibilityRole="button"
      accessibilityState={{ selected }}
      onPress={onPress}
      style={({ pressed }) => [
        styles.sidePreview,
        selected && styles.sidePreviewSelected,
        pressed && styles.pressed,
      ]}
    >
      <Text style={styles.sidePreviewLabel}>{label}</Text>
      {uri ? (
        <Image
          contentFit="cover"
          source={{ uri }}
          style={styles.sidePreviewImage}
        />
      ) : (
        <View style={styles.emptySidePreview}>
          <Icon
            color="rgba(255, 255, 255, 0.62)"
            name={{ ios: "photo", android: "photo", web: "photo" }}
            size={24}
          />
        </View>
      )}
    </Pressable>
  );
}

type CameraStateMessageProps = {
  actionLabel?: string;
  message: string;
  onAction?: () => void;
};

function CameraStateMessage({
  actionLabel,
  message,
  onAction,
}: CameraStateMessageProps) {
  return (
    <View style={styles.stateMessage}>
      <Text style={styles.stateMessageText}>{message}</Text>
      {actionLabel && onAction ? (
        <Pressable
          accessibilityRole="button"
          onPress={onAction}
          style={({ pressed }) => [
            styles.permissionButton,
            pressed && styles.pressed,
          ]}
        >
          <Text style={styles.permissionButtonText}>{actionLabel}</Text>
        </Pressable>
      ) : null}
    </View>
  );
}

const colors = {
  background: "#101214",
  borderSubtle: "#E4E7EC",
  controlSurface: "#101214",
  primary: "#005cad",
  primaryContainer: "#0075d8",
  safe: "#16A34A",
  surface: "#fcf9f8",
  text: "#1c1b1b",
  textMuted: "#404753",
  white: "#ffffff",
};

const styles = StyleSheet.create({
  safeArea: {
    flex: 1,
    backgroundColor: colors.background,
  },
  shell: {
    alignSelf: "center",
    backgroundColor: colors.background,
    flex: 1,
    maxWidth: 448,
    overflow: "hidden",
    width: "100%",
  },
  topBar: {
    alignItems: "center",
    backgroundColor: colors.controlSurface,
    borderBottomColor: "rgba(255, 255, 255, 0.08)",
    borderBottomWidth: 1,
    flexDirection: "row",
    gap: 12,
    minHeight: 76,
    justifyContent: "space-between",
    paddingHorizontal: 18,
    paddingVertical: 12,
    shadowColor: "#000000",
    shadowOffset: { height: 3, width: 0 },
    shadowOpacity: 0.12,
    shadowRadius: 12,
    zIndex: 2,
  },
  headerCopy: {
    flex: 1,
    gap: 4,
    minWidth: 0,
  },
  headerEyebrow: {
    color: "rgba(255, 255, 255, 0.58)",
    fontSize: 11,
    fontWeight: "800",
    letterSpacing: 0,
    lineHeight: 14,
    textTransform: "uppercase",
  },
  headerDirectionRow: {
    alignItems: "center",
    flexDirection: "row",
    flexWrap: "wrap",
    gap: 8,
  },
  headerWorker: {
    color: colors.white,
    fontSize: 24,
    fontWeight: "800",
    letterSpacing: 0,
    lineHeight: 30,
  },
  directionBadge: {
    backgroundColor: "rgba(0, 117, 216, 0.28)",
    borderColor: "rgba(255, 255, 255, 0.18)",
    borderWidth: 1,
    borderRadius: 8,
    paddingHorizontal: 10,
    paddingVertical: 5,
  },
  directionBadgeText: {
    color: colors.white,
    fontSize: 12,
    fontWeight: "900",
    letterSpacing: 0,
    lineHeight: 16,
    textTransform: "uppercase",
  },
  doneButton: {
    alignItems: "center",
    backgroundColor: colors.white,
    borderRadius: 999,
    height: 40,
    justifyContent: "center",
    minWidth: 68,
    paddingHorizontal: 16,
  },
  doneText: {
    color: colors.background,
    fontSize: 14,
    fontWeight: "800",
    lineHeight: 20,
  },
  cameraPane: {
    backgroundColor: "#000000",
    flex: 1,
    minHeight: 360,
    overflow: "hidden",
    position: "relative",
  },
  cameraFeed: {
    bottom: 0,
    left: 0,
    position: "absolute",
    right: 0,
    top: 0,
  },
  cameraScrim: {
    backgroundColor: "rgba(0, 0, 0, 0.08)",
    bottom: 0,
    left: 0,
    position: "absolute",
    right: 0,
    top: 0,
  },
  overlayCopy: {
    alignItems: "center",
    left: 16,
    position: "absolute",
    right: 16,
    top: 24,
  },
  instruction: {
    backgroundColor: "rgba(0, 0, 0, 0.44)",
    borderRadius: 999,
    color: "rgba(255, 255, 255, 0.92)",
    fontSize: 16,
    fontWeight: "700",
    lineHeight: 24,
    marginTop: 4,
    overflow: "hidden",
    paddingHorizontal: 14,
    paddingVertical: 6,
    textAlign: "center",
    textShadowColor: "rgba(0, 0, 0, 0.7)",
    textShadowOffset: { height: 1, width: 0 },
    textShadowRadius: 2,
  },
  stateMessage: {
    alignItems: "center",
    bottom: 0,
    gap: 16,
    justifyContent: "center",
    left: 0,
    padding: 24,
    position: "absolute",
    right: 0,
    top: 0,
  },
  stateMessageText: {
    color: colors.white,
    fontSize: 16,
    lineHeight: 24,
    textAlign: "center",
  },
  permissionButton: {
    backgroundColor: colors.white,
    borderRadius: 8,
    justifyContent: "center",
    minHeight: 44,
    paddingHorizontal: 18,
  },
  permissionButtonText: {
    color: colors.primary,
    fontSize: 14,
    fontWeight: "700",
    lineHeight: 20,
  },
  controlsPane: {
    backgroundColor: colors.controlSurface,
    minHeight: 220,
    paddingBottom: 24,
  },
  progressStrip: {
    alignItems: "center",
    flexDirection: "row",
    gap: 8,
    paddingHorizontal: 16,
    paddingVertical: 16,
  },
  workerChip: {
    alignItems: "center",
    backgroundColor: "rgba(255, 255, 255, 0.1)",
    borderRadius: 999,
    flexDirection: "row",
    gap: 4,
    paddingHorizontal: 12,
    paddingVertical: 6,
  },
  workerChipText: {
    color: colors.white,
    fontSize: 12,
    fontWeight: "600",
    lineHeight: 16,
  },
  activeChip: {
    backgroundColor: colors.primary,
    borderColor: colors.primaryContainer,
    borderRadius: 999,
    borderWidth: 1,
    paddingHorizontal: 16,
    paddingVertical: 8,
  },
  activeChipText: {
    color: colors.white,
    fontSize: 12,
    fontWeight: "800",
    lineHeight: 16,
  },
  cameraControls: {
    alignItems: "center",
    flexDirection: "row",
    height: 96,
    justifyContent: "space-between",
    paddingHorizontal: 24,
  },
  previewButton: {
    alignItems: "center",
    backgroundColor: "rgba(255, 255, 255, 0.1)",
    borderColor: "rgba(255, 255, 255, 0.18)",
    borderRadius: 8,
    borderWidth: 1,
    height: 48,
    justifyContent: "center",
    overflow: "hidden",
    width: 48,
  },
  previewImage: {
    height: "100%",
    width: "100%",
  },
  shutterButton: {
    alignItems: "center",
    backgroundColor: colors.primary,
    borderColor: "rgba(0, 92, 173, 0.2)",
    borderRadius: 999,
    borderWidth: 8,
    height: 72,
    justifyContent: "center",
    width: 72,
  },
  shutterInner: {
    alignItems: "center",
    backgroundColor: colors.white,
    borderRadius: 999,
    height: 60,
    justifyContent: "center",
    width: 60,
  },
  shutterCore: {
    backgroundColor: colors.primary,
    borderColor: colors.white,
    borderRadius: 999,
    borderWidth: 2,
    height: 52,
    width: 52,
  },
  flashButton: {
    alignItems: "center",
    borderRadius: 999,
    height: 48,
    justifyContent: "center",
    width: 48,
  },
  flashButtonActive: {
    backgroundColor: colors.white,
  },
  actionPanel: {
    backgroundColor: "rgba(255, 255, 255, 0.1)",
    borderColor: "rgba(255, 255, 255, 0.16)",
    borderRadius: 12,
    borderWidth: 1,
    gap: 12,
    marginHorizontal: 16,
    padding: 12,
  },
  actionTitle: {
    color: colors.white,
    fontSize: 14,
    fontWeight: "700",
    lineHeight: 20,
  },
  actionRow: {
    flexDirection: "row",
    gap: 8,
  },
  primaryAction: {
    alignItems: "center",
    backgroundColor: colors.primary,
    borderRadius: 8,
    flex: 1,
    justifyContent: "center",
    minHeight: 44,
    paddingHorizontal: 12,
  },
  primaryActionText: {
    color: colors.white,
    fontSize: 12,
    fontWeight: "700",
    lineHeight: 16,
    textAlign: "center",
  },
  secondaryAction: {
    alignItems: "center",
    backgroundColor: colors.white,
    borderRadius: 8,
    flex: 1,
    justifyContent: "center",
    minHeight: 44,
    paddingHorizontal: 12,
  },
  secondaryActionText: {
    color: colors.primary,
    fontSize: 12,
    fontWeight: "700",
    lineHeight: 16,
    textAlign: "center",
  },
  previewPanel: {
    gap: 12,
    marginHorizontal: 16,
  },
  previewPair: {
    flexDirection: "row",
    gap: 12,
  },
  sidePreview: {
    borderColor: "transparent",
    borderRadius: 10,
    borderWidth: 2,
    flex: 1,
    gap: 6,
    padding: 4,
  },
  sidePreviewSelected: {
    borderColor: colors.primary,
  },
  sidePreviewLabel: {
    color: "rgba(255, 255, 255, 0.78)",
    fontSize: 11,
    fontWeight: "800",
    lineHeight: 14,
    textAlign: "center",
  },
  sidePreviewImage: {
    aspectRatio: 3 / 4,
    backgroundColor: "rgba(255, 255, 255, 0.1)",
    borderRadius: 8,
    width: "100%",
  },
  emptySidePreview: {
    alignItems: "center",
    aspectRatio: 3 / 4,
    backgroundColor: "rgba(255, 255, 255, 0.1)",
    borderColor: "rgba(255, 255, 255, 0.2)",
    borderRadius: 8,
    borderStyle: "dashed",
    borderWidth: 1,
    justifyContent: "center",
    width: "100%",
  },
  disabledControl: {
    opacity: 0.42,
  },
  pressed: {
    transform: [{ scale: 0.95 }],
  },
  shutterPressed: {
    backgroundColor: colors.primaryContainer,
    transform: [{ scale: 0.95 }],
  },
  textPressed: {
    opacity: 0.68,
  },
});
