import React, { useRef, useState, useEffect } from 'react';
import {
  Modal,
  PanResponder,
  Platform,
  Pressable,
  ScrollView,
  StyleSheet,
  Text,
  View,
} from 'react-native';
import { Image, ImageSource } from 'expo-image';
import { SafeAreaView } from 'react-native-safe-area-context';
import { Icon } from '@/components/ui/Icon';

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
  const [scale, setScale] = useState(1);
  const [pan, setPan] = useState({ x: 0, y: 0 });

  // Refs for tracking touch gestures (Pan & Pinch)
  const baseScale = useRef(1);
  const currentScale = useRef(1);
  const initialTouchDistance = useRef<number | null>(null);
  const panStart = useRef({ x: 0, y: 0 });
  const lastPan = useRef({ x: 0, y: 0 });

  // Reset zoom state whenever modal opens or closes
  useEffect(() => {
    if (visible) {
      setScale(1);
      setPan({ x: 0, y: 0 });
      baseScale.current = 1;
      currentScale.current = 1;
      initialTouchDistance.current = null;
      lastPan.current = { x: 0, y: 0 };
    }
  }, [visible]);

  function getDistance(touches: any[]): number {
    const [t1, t2] = touches;
    const dx = t1.pageX - t2.pageX;
    const dy = t1.pageY - t2.pageY;
    return Math.sqrt(dx * dx + dy * dy);
  }

  // Cross-platform PanResponder for both 2-finger Pinch-to-zoom and Pan dragging
  const panResponder = useRef(
    PanResponder.create({
      onStartShouldSetPanResponder: () => true,
      onMoveShouldSetPanResponder: (_, gestureState) =>
        gestureState.numberActiveTouches === 2 || currentScale.current > 1,
      onPanResponderGrant: (evt, gestureState) => {
        if (evt.nativeEvent.touches.length === 2) {
          initialTouchDistance.current = getDistance(evt.nativeEvent.touches);
          baseScale.current = currentScale.current;
        } else {
          panStart.current = { ...lastPan.current };
        }
      },
      onPanResponderMove: (evt, gestureState) => {
        const touches = evt.nativeEvent.touches;
        if (touches.length === 2) {
          // Pinch gesture (2 fingers)
          const dist = getDistance(touches);
          if (initialTouchDistance.current && initialTouchDistance.current > 0) {
            const rawScale = (dist / initialTouchDistance.current) * baseScale.current;
            const clampedScale = Math.min(Math.max(rawScale, 1), 4);
            currentScale.current = clampedScale;
            setScale(clampedScale);
          }
        } else if (touches.length === 1 && currentScale.current > 1) {
          // Pan drag when zoomed in (1 finger)
          const maxPan = (currentScale.current - 1) * 160;
          const nextX = Math.min(Math.max(panStart.current.x + gestureState.dx, -maxPan), maxPan);
          const nextY = Math.min(Math.max(panStart.current.y + gestureState.dy, -maxPan), maxPan);
          lastPan.current = { x: nextX, y: nextY };
          setPan({ x: nextX, y: nextY });
        }
      },
      onPanResponderRelease: (evt) => {
        if (evt.nativeEvent.touches.length < 2) {
          initialTouchDistance.current = null;
          baseScale.current = currentScale.current;
        }
        if (currentScale.current <= 1) {
          lastPan.current = { x: 0, y: 0 };
          setPan({ x: 0, y: 0 });
        }
      },
    })
  ).current;

  function handleZoomIn() {
    const next = Math.min(Number((currentScale.current + 0.5).toFixed(1)), 4);
    currentScale.current = next;
    baseScale.current = next;
    setScale(next);
  }

  function handleZoomOut() {
    const next = Math.max(Number((currentScale.current - 0.5).toFixed(1)), 1);
    currentScale.current = next;
    baseScale.current = next;
    setScale(next);
    if (next <= 1) {
      lastPan.current = { x: 0, y: 0 };
      setPan({ x: 0, y: 0 });
    }
  }

  function handleReset() {
    currentScale.current = 1;
    baseScale.current = 1;
    lastPan.current = { x: 0, y: 0 };
    setScale(1);
    setPan({ x: 0, y: 0 });
  }

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
        {/* Header */}
        <SafeAreaView edges={['top']} style={styles.safeHeader}>
          <View style={styles.header}>
            <View style={styles.headerTitleContainer}>
              <Text numberOfLines={1} style={styles.headerTitle}>
                {title || 'Inspect Image'}
              </Text>
              <Text style={styles.headerSubtitle}>Pinch or double tap to zoom</Text>
            </View>
            <Pressable
              accessibilityLabel="Close image viewer"
              accessibilityRole="button"
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

        {/* Zoom Area */}
        <View style={styles.zoomContainer} {...panResponder.panHandlers}>
          <ScrollView
            bounces={false}
            centerContent
            contentContainerStyle={styles.scrollContent}
            maximumZoomScale={4}
            minimumZoomScale={1}
            scrollEnabled={scale === 1}
            showsHorizontalScrollIndicator={false}
            showsVerticalScrollIndicator={false}
            style={styles.scrollArea}>
            <View
              style={{
                alignItems: 'center',
                justifyContent: 'center',
                transform: [
                  { scale },
                  { translateX: pan.x / scale },
                  { translateY: pan.y / scale },
                ],
              }}>
              <Image
                cachePolicy="memory-disk"
                contentFit="contain"
                source={imageSource}
                style={styles.image}
              />
            </View>
          </ScrollView>
        </View>

        {/* Floating Zoom Controls Bar */}
        <SafeAreaView edges={['bottom']} style={styles.safeFooter}>
          <View style={styles.controlsBar}>
            <Pressable
              accessibilityLabel="Zoom Out"
              accessibilityRole="button"
              disabled={scale <= 1}
              onPress={handleZoomOut}
              style={({ pressed }) => [
                styles.controlBtn,
                scale <= 1 && styles.controlBtnDisabled,
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
              onPress={handleReset}
              style={({ pressed }) => [styles.resetBtn, pressed && styles.pressed]}>
              <Text style={styles.resetText}>{Math.round(scale * 100)}% • Reset</Text>
            </Pressable>

            <Pressable
              accessibilityLabel="Zoom In"
              accessibilityRole="button"
              disabled={scale >= 4}
              onPress={handleZoomIn}
              style={({ pressed }) => [
                styles.controlBtn,
                scale >= 4 && styles.controlBtnDisabled,
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
    flex: 1,
  },
  scrollArea: {
    flex: 1,
  },
  scrollContent: {
    alignItems: 'center',
    flexGrow: 1,
    justifyContent: 'center',
  },
  image: {
    height: '100%',
    maxHeight: 700,
    maxWidth: 500,
    minHeight: 320,
    width: '100%',
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
