import React, { useRef, useState, useEffect } from 'react';
import {
  ActivityIndicator,
  Animated,
  Dimensions,
  Modal,
  PanResponder,
  Pressable,
  StyleSheet,
  Text,
  View,
} from 'react-native';
import { Image, ImageSource } from 'expo-image';
import { SafeAreaView } from 'react-native-safe-area-context';
import { Icon } from '@/components/ui/Icon';

const { width: SCREEN_WIDTH, height: SCREEN_HEIGHT } = Dimensions.get('window');

export interface FullscreenImageViewerProps {
  visible: boolean;
  source: ImageSource | string | number | null;
  title?: string;
  onClose: () => void;
}

export function FullscreenImageViewer({
  visible,
  source,
  title,
  onClose,
}: FullscreenImageViewerProps) {
  // Animated values running on Native Driver for 60fps responsiveness on Android
  const scale = useRef(new Animated.Value(1)).current;
  const pan = useRef(new Animated.ValueXY({ x: 0, y: 0 })).current;

  // Track raw numerical values in refs for instant math without state lag
  const currentScale = useRef(1);
  const baseScale = useRef(1);
  const currentPan = useRef({ x: 0, y: 0 });
  const panStart = useRef({ x: 0, y: 0 });
  const initialDistance = useRef<number | null>(null);
  const lastTapTime = useRef<number>(0);

  const [displayScale, setDisplayScale] = useState(1);
  const [isLoading, setIsLoading] = useState(true);
  const [hasError, setHasError] = useState(false);

  // Sync listener to update footer text only when scale changes
  useEffect(() => {
    const id = scale.addListener(({ value }) => {
      currentScale.current = value;
      setDisplayScale(value);
    });
    return () => scale.removeListener(id);
  }, []);

  useEffect(() => {
    const id = pan.addListener((value) => {
      currentPan.current = value;
    });
    return () => pan.removeListener(id);
  }, []);

  // Reset transforms whenever viewer opens
  useEffect(() => {
    if (visible) {
      scale.setValue(1);
      pan.setValue({ x: 0, y: 0 });
      currentScale.current = 1;
      baseScale.current = 1;
      currentPan.current = { x: 0, y: 0 };
      panStart.current = { x: 0, y: 0 };
      initialDistance.current = null;
      lastTapTime.current = 0;
      setIsLoading(true);
      setHasError(false);
      setDisplayScale(1);
    }
  }, [visible, source]);

  function getDistance(t1: any, t2: any): number {
    const dx = t1.pageX - t2.pageX;
    const dy = t1.pageY - t2.pageY;
    return Math.sqrt(dx * dx + dy * dy);
  }

  function animateTo(targetScale: number, targetX = 0, targetY = 0) {
    const clampedScale = Math.min(Math.max(targetScale, 1), 4);
    Animated.parallel([
      Animated.timing(scale, {
        toValue: clampedScale,
        duration: 200,
        useNativeDriver: true,
      }),
      Animated.timing(pan, {
        toValue: clampedScale <= 1 ? { x: 0, y: 0 } : { x: targetX, y: targetY },
        duration: 200,
        useNativeDriver: true,
      }),
    ]).start(() => {
      baseScale.current = clampedScale;
      currentScale.current = clampedScale;
    });
  }

  // Pure Android-optimized PanResponder capturing 100% of touches without ScrollView interference
  const panResponder = useRef(
    PanResponder.create({
      onStartShouldSetPanResponder: () => true,
      onStartShouldSetPanResponderCapture: () => true,
      onMoveShouldSetPanResponder: () => true,
      onMoveShouldSetPanResponderCapture: () => true,

      onPanResponderGrant: (evt) => {
        const touches = evt.nativeEvent.touches;
        if (touches.length >= 2) {
          // 2-finger Pinch started
          initialDistance.current = getDistance(touches[0], touches[1]);
          baseScale.current = currentScale.current;
        } else if (touches.length === 1) {
          // Double-tap detection (< 300ms between taps)
          const now = Date.now();
          if (now - lastTapTime.current < 300) {
            lastTapTime.current = 0;
            if (currentScale.current > 1.2) {
              animateTo(1, 0, 0);
            } else {
              animateTo(2.5, 0, 0);
            }
            return;
          }
          lastTapTime.current = now;
          panStart.current = { ...currentPan.current };
        }
      },

      onPanResponderMove: (evt, gestureState) => {
        const touches = evt.nativeEvent.touches;
        if (touches.length >= 2) {
          // Instant 2-finger Pinch Zoom (direct 60fps calculation)
          const dist = getDistance(touches[0], touches[1]);
          if (initialDistance.current && initialDistance.current > 0) {
            const rawScale = (dist / initialDistance.current) * baseScale.current;
            const clampedScale = Math.min(Math.max(rawScale, 0.9), 4.2);
            scale.setValue(clampedScale);
          }
        } else if (touches.length === 1 && currentScale.current > 1.05) {
          // 1-finger Pan drag across zoomed photo
          const maxPanX = ((currentScale.current - 1) * SCREEN_WIDTH) / 2;
          const maxPanY = ((currentScale.current - 1) * (SCREEN_HEIGHT * 0.72)) / 2;
          const nextX = Math.min(Math.max(panStart.current.x + gestureState.dx, -maxPanX), maxPanX);
          const nextY = Math.min(Math.max(panStart.current.y + gestureState.dy, -maxPanY), maxPanY);
          pan.setValue({ x: nextX, y: nextY });
        }
      },

      onPanResponderRelease: (evt) => {
        const touches = evt.nativeEvent.touches;
        if (touches.length < 2) {
          initialDistance.current = null;
          baseScale.current = currentScale.current;
        }
        if (currentScale.current < 1) {
          animateTo(1, 0, 0);
        } else if (currentScale.current > 4) {
          animateTo(4, currentPan.current.x, currentPan.current.y);
        }
      },

      onPanResponderTerminationRequest: () => false,
    })
  ).current;

  if (!visible || !source) return null;

  const imageSource = typeof source === 'string' ? { uri: source } : source;

  return (
    <Modal
      animationType="fade"
      hardwareAccelerated
      onRequestClose={onClose}
      statusBarTranslucent
      transparent
      visible={visible}>
      <View style={styles.overlay}>
        {/* Safe Top Header */}
        <SafeAreaView edges={['top']} style={styles.safeHeader}>
          <View style={styles.header}>
            <View style={styles.headerTitleContainer}>
              <Text numberOfLines={1} style={styles.headerTitle}>
                {title || 'Inspect Image'}
              </Text>
              <Text style={styles.headerSubtitle}>
                Double tap or pinch with 2 fingers to zoom
              </Text>
            </View>
            <Pressable
              accessibilityLabel="Close image viewer"
              accessibilityRole="button"
              hitSlop={12}
              onPress={onClose}
              style={({ pressed }) => [styles.closeButton, pressed && styles.pressed]}>
              <Icon
                color="#ffffff"
                name={{ ios: 'xmark', android: 'close', web: 'close' }}
                size={22}
                weight="bold"
              />
            </Pressable>
          </View>
        </SafeAreaView>

        {/* Dedicated Android Pinch & Pan Container with Native Driver Transforms */}
        <View style={styles.zoomContainer} {...panResponder.panHandlers}>
          <Animated.View
            style={[
              styles.imageWrapper,
              {
                transform: [
                  { translateX: pan.x },
                  { translateY: pan.y },
                  { scale: scale },
                ],
              },
            ]}>
            <Image
              cachePolicy="memory-disk"
              contentFit="contain"
              onError={() => {
                setIsLoading(false);
                setHasError(true);
              }}
              onLoadEnd={() => setIsLoading(false)}
              onLoadStart={() => setIsLoading(true)}
              source={imageSource}
              style={styles.image}
            />
          </Animated.View>

          {isLoading && (
            <View pointerEvents="none" style={styles.centerOverlay}>
              <ActivityIndicator color="#38bdf8" size="large" />
            </View>
          )}

          {hasError && (
            <View pointerEvents="none" style={styles.centerOverlay}>
              <Icon
                color="#ef4444"
                name={{ ios: 'exclamationmark.circle', android: 'error_outline', web: 'error_outline' }}
                size={36}
              />
              <Text style={styles.errorText}>Failed to load photo</Text>
            </View>
          )}
        </View>

        {/* Floating Zoom Control Bar */}
        <SafeAreaView edges={['bottom']} style={styles.safeFooter}>
          <View style={styles.controlsBar}>
            <Pressable
              accessibilityLabel="Zoom Out"
              accessibilityRole="button"
              disabled={displayScale <= 1}
              onPress={() => animateTo(currentScale.current - 0.5)}
              style={({ pressed }) => [
                styles.controlBtn,
                displayScale <= 1 && styles.controlBtnDisabled,
                pressed && styles.pressed,
              ]}>
              <Icon
                color="#ffffff"
                name={{ ios: 'minus.magnifyingglass', android: 'zoom_out', web: 'zoom_out' }}
                size={18}
                weight="bold"
              />
            </Pressable>

            <Pressable
              accessibilityLabel="Reset Zoom"
              accessibilityRole="button"
              onPress={() => animateTo(1, 0, 0)}
              style={({ pressed }) => [styles.resetBtn, pressed && styles.pressed]}>
              <Text style={styles.resetText}>{Math.round(displayScale * 100)}% • Reset</Text>
            </Pressable>

            <Pressable
              accessibilityLabel="Zoom In"
              accessibilityRole="button"
              disabled={displayScale >= 4}
              onPress={() => animateTo(currentScale.current + 0.5)}
              style={({ pressed }) => [
                styles.controlBtn,
                displayScale >= 4 && styles.controlBtnDisabled,
                pressed && styles.pressed,
              ]}>
              <Icon
                color="#ffffff"
                name={{ ios: 'plus.magnifyingglass', android: 'zoom_in', web: 'zoom_in' }}
                size={18}
                weight="bold"
              />
            </Pressable>
          </View>
        </SafeAreaView>
      </View>
    </Modal>
  );
}

const styles = StyleSheet.create({
  overlay: {
    backgroundColor: '#0a0d14',
    flex: 1,
  },
  safeHeader: {
    backgroundColor: 'rgba(10, 13, 20, 0.85)',
    zIndex: 10,
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
    paddingRight: 16,
  },
  headerTitle: {
    color: '#ffffff',
    fontSize: 16,
    fontWeight: '700',
    letterSpacing: 0.3,
  },
  headerSubtitle: {
    color: '#94a3b8',
    fontSize: 12,
    marginTop: 2,
  },
  closeButton: {
    alignItems: 'center',
    backgroundColor: 'rgba(255, 255, 255, 0.15)',
    borderRadius: 20,
    height: 40,
    justifyContent: 'center',
    width: 40,
  },
  zoomContainer: {
    alignItems: 'center',
    flex: 1,
    justifyContent: 'center',
    overflow: 'hidden',
  },
  imageWrapper: {
    alignItems: 'center',
    height: SCREEN_HEIGHT * 0.72,
    justifyContent: 'center',
    width: SCREEN_WIDTH,
  },
  image: {
    height: '100%',
    width: '100%',
  },
  centerOverlay: {
    alignItems: 'center',
    bottom: 0,
    justifyContent: 'center',
    left: 0,
    position: 'absolute',
    right: 0,
    top: 0,
  },
  errorText: {
    color: '#ef4444',
    fontSize: 13,
    marginTop: 8,
  },
  safeFooter: {
    backgroundColor: 'rgba(10, 13, 20, 0.85)',
    zIndex: 10,
  },
  controlsBar: {
    alignItems: 'center',
    alignSelf: 'center',
    backgroundColor: 'rgba(30, 41, 59, 0.9)',
    borderColor: 'rgba(255, 255, 255, 0.1)',
    borderRadius: 28,
    borderWidth: 1,
    flexDirection: 'row',
    gap: 16,
    marginBottom: 8,
    paddingHorizontal: 16,
    paddingVertical: 8,
  },
  controlBtn: {
    alignItems: 'center',
    backgroundColor: 'rgba(255, 255, 255, 0.12)',
    borderRadius: 18,
    height: 36,
    justifyContent: 'center',
    width: 36,
  },
  controlBtnDisabled: {
    opacity: 0.35,
  },
  resetBtn: {
    alignItems: 'center',
    justifyContent: 'center',
    paddingHorizontal: 10,
  },
  resetText: {
    color: '#38bdf8',
    fontSize: 13,
    fontWeight: '700',
  },
  pressed: {
    opacity: 0.7,
  },
});
