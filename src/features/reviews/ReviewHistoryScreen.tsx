import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { useFocusEffect, useLocalSearchParams, useRouter } from 'expo-router';
import { Image } from 'expo-image';
import {
  ActivityIndicator,
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

import { Icon } from '@/components/ui/Icon';
import { assets } from '@/constants/assets';
import {
  formatReviewDateTime,
  formatReviewTime,
  ReviewItem,
  sortReviewsChronologically,
  unsafeReasonLabels,
  useReviews,
} from '@/features/reviews/services/reviews.service';
import { supabase } from '@/services/supabase/client';
import { getCachedImageUri, getImageUri } from '@/utils/image';
import { getValidAccessToken } from '@/services/google-drive/auth';

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

const sampleWorkerPhotos: Record<number, { front: any; back: any }> = {
  1: { front: assets.fieldSafeCheck, back: assets.captureRecentPhoto },
  2: { front: assets.fieldUnsafeCheck, back: assets.captureRecentPhoto },
  3: { front: assets.fieldSafeCheck, back: assets.captureRecentPhoto },
  4: { front: assets.fieldUnsafeCheck, back: assets.captureRecentPhoto },
};

const { width: SCREEN_WIDTH, height: SCREEN_HEIGHT } = Dimensions.get('window');

function extractDriveId(fileIdOrUri?: string | null): string | null {
  if (!fileIdOrUri || !fileIdOrUri.trim()) return null;
  const clean = fileIdOrUri.trim();
  if (
    clean.startsWith('file://') ||
    clean.startsWith('ph://') ||
    clean.startsWith('content://')
  ) {
    return null;
  }
  if (clean.startsWith('http://') || clean.startsWith('https://')) {
    const match =
      clean.match(/\/files\/([a-zA-Z0-9_-]+)/) ||
      clean.match(/\/d\/([a-zA-Z0-9_-]+)/) ||
      clean.match(/[?&]id=([a-zA-Z0-9_-]+)/);
    if (match && match[1]) {
      return match[1];
    }
    return null;
  }
  if (/^[a-zA-Z0-9_-]{15,}$/.test(clean)) {
    return clean;
  }
  return null;
}

interface HistoryInspectionPhotoProps {
  badgeLabel: 'FRONT' | 'BACK';
  fileIdOrUri?: string | null;
  driveId?: string | null;
  submissionId?: string;
  workerSequenceNo: number;
  fallbackAsset: any;
  workerTitle: string;
  onPressZoom?: (source: any, title: string) => void;
}

function HistoryInspectionPhoto({
  badgeLabel,
  fileIdOrUri,
  driveId: directDriveId,
  submissionId,
  workerSequenceNo,
  fallbackAsset,
  workerTitle,
  onPressZoom,
}: HistoryInspectionPhotoProps) {
  const [photoSource, setPhotoSource] = useState<any>(null);
  const [isLoading, setIsLoading] = useState(true);
  const [hasError, setHasError] = useState(false);
  const retryCountRef = useRef(0);

  useEffect(() => {
    let isCancelled = false;
    setIsLoading(true);
    setHasError(false);

    async function resolveSource() {
      // 1. Direct local file URI
      if (
        fileIdOrUri &&
        (fileIdOrUri.startsWith('file://') ||
          fileIdOrUri.startsWith('ph://') ||
          fileIdOrUri.startsWith('content://'))
      ) {
        if (!isCancelled) {
          setPhotoSource({ uri: fileIdOrUri });
          setIsLoading(false);
        }
        return;
      }

      // 2. Resolve Drive File ID
      let resolvedDriveId = directDriveId || extractDriveId(fileIdOrUri);

      // If no drive ID from URL and submissionId is a database numeric ID, fetch from Supabase
      const parsedSubId = Number(submissionId);
      let resolvedFileProvider: string | null = null;
      if (!resolvedDriveId && !isNaN(parsedSubId) && parsedSubId > 0) {
        try {
          const { data: instances } = await supabase
            .from('ppe_worker_instances')
            .select(`
              sequence_no,
              ppe_images (
                side,
                files ( provider_file_id, storage_provider )
              )
            `)
            .eq('submission_id', parsedSubId);

          const inst = (instances || []).find((w: any) => w.sequence_no === workerSequenceNo) || instances?.[0];
          if (inst) {
            const img = ((inst as any).ppe_images || []).find((im: any) => im.side === badgeLabel);
            const rawFile = Array.isArray(img?.files) ? img.files[0] : img?.files;
            resolvedDriveId = rawFile?.provider_file_id || null;
            resolvedFileProvider = rawFile?.storage_provider || null;
          }
        } catch (err) {
          console.warn('[ReviewHistory] Error resolving worker photo from DB:', err);
        }
      }

      if (resolvedDriveId) {
        const isSupabase =
          resolvedFileProvider === 'SUPABASE' ||
          resolvedDriveId.startsWith('submissions/') ||
          resolvedDriveId.startsWith('users/') ||
          (resolvedDriveId.includes('/') && !resolvedDriveId.startsWith('http://') && !resolvedDriveId.startsWith('https://'));

        // Check disk cache first
        const cached = await getCachedImageUri(resolvedDriveId).catch(() => null);
        if (cached && !isCancelled) {
          setPhotoSource({ uri: cached });
          setIsLoading(false);
          return;
        }

        if (isSupabase) {
          try {
            const { supabaseStorageService } = require('@/services/storage/supabase-storage.client');
            const bucket = resolvedDriveId.startsWith('users/') ? 'avatars' : 'evidence';
            const signedUrl = await supabaseStorageService.createSignedUrl(bucket, resolvedDriveId, 3600);
            if (signedUrl && !isCancelled) {
              setPhotoSource({ uri: signedUrl });
              setIsLoading(false);
              getImageUri(resolvedDriveId, { storageProvider: 'SUPABASE' })
                .then((localPath) => {
                  if (!isCancelled && localPath) {
                    setPhotoSource({ uri: localPath });
                  }
                })
                .catch(() => {});
              return;
            }
          } catch (supErr) {
            console.warn('[ReviewHistory] Error creating signed URL for:', resolvedDriveId, supErr);
          }
        }

        // Get authenticated Bearer token
        const token = await getValidAccessToken().catch(() => null);
        if (token && !isCancelled) {
          setPhotoSource({
            uri: `https://www.googleapis.com/drive/v3/files/${encodeURIComponent(resolvedDriveId)}?alt=media`,
            headers: { Authorization: `Bearer ${token}` },
          });
          // Cache in background to local disk
          getImageUri(resolvedDriveId)
            .then((localPath) => {
              if (!isCancelled && localPath) {
                setPhotoSource({ uri: localPath });
              }
            })
            .catch(() => {});
          return;
        }

        // Fallback thumbnail
        if (!isCancelled) {
          setPhotoSource({
            uri: `https://drive.google.com/thumbnail?id=${resolvedDriveId}&sz=w800`,
          });
        }
        return;
      }

      // Fallback for sample/mock reviews
      if (!isCancelled) {
        if (!isNaN(parsedSubId) && parsedSubId > 0) {
          setPhotoSource(null);
          setIsLoading(false);
        } else {
          setPhotoSource(fallbackAsset);
          setIsLoading(false);
        }
      }
    }

    resolveSource();

    return () => {
      isCancelled = true;
    };
  }, [fileIdOrUri, directDriveId, submissionId, workerSequenceNo, badgeLabel, fallbackAsset]);

  const handleError = async () => {
    if (retryCountRef.current === 0) {
      retryCountRef.current += 1;
      const driveId = directDriveId || extractDriveId(fileIdOrUri);
      if (driveId) {
        const freshToken = await getValidAccessToken({ forceRefresh: true }).catch(() => null);
        if (freshToken) {
          setPhotoSource({
            uri: `https://www.googleapis.com/drive/v3/files/${encodeURIComponent(driveId)}?alt=media`,
            headers: { Authorization: `Bearer ${freshToken}` },
          });
          return;
        }
      }
    }
    setIsLoading(false);
    setHasError(true);
  };

  return (
    <Pressable
      accessibilityLabel={`Inspect ${badgeLabel} photo`}
      accessibilityRole="button"
      disabled={!photoSource || hasError}
      onPress={() => {
        if (photoSource && !hasError && onPressZoom) {
          onPressZoom(photoSource, `${workerTitle} • ${badgeLabel} VIEW`);
        }
      }}
      style={detailsStyles.photoCard}>
      <View style={detailsStyles.photoBadge}>
        <Text style={detailsStyles.photoBadgeText}>{badgeLabel}</Text>
      </View>

      {photoSource ? (
        <Image
          contentFit="cover"
          onError={handleError}
          onLoadEnd={() => setIsLoading(false)}
          onLoadStart={() => setIsLoading(true)}
          source={photoSource}
          style={detailsStyles.photoImg}
        />
      ) : hasError ? (
        <View style={detailsStyles.photoPlaceholder}>
          <Icon
            color={reviewerColors.errorRed}
            name={{ ios: 'exclamationmark.triangle', android: 'warning', web: 'warning' }}
            size={22}
          />
          <Text style={detailsStyles.photoPlaceholderText}>Failed to load</Text>
        </View>
      ) : !isLoading ? (
        <View style={detailsStyles.photoPlaceholder}>
          <Icon
            color={reviewerColors.outlineVariant}
            name={{ ios: 'camera.fill', android: 'photo_camera', web: 'photo_camera' }}
            size={22}
          />
          <Text style={detailsStyles.photoPlaceholderText}>No photo</Text>
        </View>
      ) : null}

      {isLoading && (
        <View style={detailsStyles.photoLoadingOverlay}>
          <ActivityIndicator color={reviewerColors.primary} size="small" />
        </View>
      )}

      {Boolean(photoSource && !hasError && !isLoading) && (
        <View style={detailsStyles.photoZoomBadge}>
          <Icon
            color="#ffffff"
            name={{ ios: 'arrow.up.left.and.arrow.down.right', android: 'zoom_in', web: 'zoom_in' }}
            size={13}
            weight="bold"
          />
        </View>
      )}
    </Pressable>
  );
}

export function ReviewHistoryScreen() {
  const router = useRouter();
  const insets = useSafeAreaInsets();
  const { t } = useTranslation('home');
  const { safeReviews, unsafeReviews, syncReviewsFromSupabase } = useReviews();

  useFocusEffect(
    useCallback(() => {
      syncReviewsFromSupabase();
    }, [syncReviewsFromSupabase])
  );

  // 2 Tabs: "Safe reviewed" and "Unsafe reviewed"
  const params = useLocalSearchParams<{ tab?: 'safe' | 'unsafe' }>();
  const [activeTab, setActiveTab] = useState<'safe' | 'unsafe'>(
    params.tab === 'unsafe' ? 'unsafe' : 'safe'
  );

  useEffect(() => {
    if (params.tab === 'unsafe' || params.tab === 'safe') {
      setActiveTab(params.tab);
    }
  }, [params.tab]);
  const [selectedUnsafeItem, setSelectedUnsafeItem] = useState<ReviewItem | null>(null);

  const translateY = useRef(new Animated.Value(0)).current;

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

  const displayedList = useMemo(() => {
    const list = activeTab === 'safe' ? safeReviews : unsafeReviews;
    return sortReviewsChronologically(list);
  }, [activeTab, safeReviews, unsafeReviews]);

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
          <Text style={styles.headerTitle}>Reviews History</Text>
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
                const isUnsafe = activeTab === 'unsafe';
                return (
                  <Pressable
                    accessibilityRole="button"
                    key={item.id}
                    onPress={() => {
                      openUnsafeModal(item);
                    }}
                    style={({ pressed }) => [
                      styles.feedRow,
                      index < displayedList.length - 1 && styles.feedDivider,
                      pressed && styles.feedRowPressed,
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
                        {isUnsafe && item.workerReviews && item.workerReviews.some((w) => w.status === 'unsafe')
                          ? `${item.workerReviews.filter((w) => w.status === 'unsafe').length} of ${item.workers} workers unsafe`
                          : !isUnsafe && item.workerReviews && item.workerReviews.some((w) => w.status === 'safe')
                          ? `${item.workerReviews.filter((w) => w.status === 'safe').length} of ${item.workers} workers safe`
                          : t('internal.reviewItems.workersPhotos', {
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
                          {isUnsafe
                            ? item.workerReviews && item.workerReviews.some((w) => w.status === 'unsafe')
                              ? `${item.workerReviews.filter((w) => w.status === 'unsafe').length} Unsafe`
                              : 'Unsafe'
                            : item.workerReviews && item.workerReviews.some((w) => w.status === 'safe')
                            ? `${item.workerReviews.filter((w) => w.status === 'safe').length} Safe`
                            : 'Reviewed'}
                        </Text>
                      </View>

                      {/* Violation Badges for Unsafe Tab */}
                      {isUnsafe && (
                        <View style={styles.reasonsListRow}>
                          {(item.unsafeReasons && item.unsafeReasons.length > 0
                            ? item.unsafeReasons
                            : Array.from(
                                new Set(
                                  (item.workerReviews || [])
                                    .filter((w) => w.status === 'unsafe')
                                    .flatMap((w) => w.unsafeReasons || [])
                                )
                              )
                          ).map((r) => (
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
                  <Text style={detailsStyles.modalTitle}>
                    {selectedUnsafeItem?.status === 'unsafe' ? 'Unsafe Review Details' : 'Safe Review Details'}
                  </Text>
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
                {selectedUnsafeItem?.status === 'unsafe' ? (
                  <View style={detailsStyles.alertBanner}>
                    <Icon
                      color={reviewerColors.errorRed}
                      name={{ ios: 'exclamationmark.triangle.fill', android: 'warning', web: 'warning' }}
                      size={20}
                    />
                    <View style={detailsStyles.alertTextContainer}>
                      <Text style={detailsStyles.alertTitle}>Marked as UNSAFE by Reviewer</Text>
                      <Text style={detailsStyles.alertLocation}>
                        {selectedUnsafeItem?.location} • {selectedUnsafeItem ? formatReviewDateTime(selectedUnsafeItem) : ''}
                      </Text>
                    </View>
                  </View>
                ) : (
                  <View style={[detailsStyles.alertBanner, { backgroundColor: 'rgba(35, 134, 54, 0.1)', borderColor: 'rgba(35, 134, 54, 0.25)' }]}>
                    <Icon
                      color="#238636"
                      name={{ ios: 'checkmark.seal.fill', android: 'check_circle', web: 'check_circle' }}
                      size={20}
                    />
                    <View style={detailsStyles.alertTextContainer}>
                      <Text style={[detailsStyles.alertTitle, { color: '#238636' }]}>Marked as SAFE by Reviewer</Text>
                      <Text style={detailsStyles.alertLocation}>
                        {selectedUnsafeItem?.location} • {selectedUnsafeItem ? formatReviewDateTime(selectedUnsafeItem) : ''}
                      </Text>
                    </View>
                  </View>
                )}

                {/* Multiple Workers Stacking with Scroll */}
                {(() => {
                  const workersToDisplay =
                    selectedUnsafeItem?.workerReviews && selectedUnsafeItem.workerReviews.length > 0
                      ? (selectedUnsafeItem.status === 'unsafe'
                          ? selectedUnsafeItem.workerReviews.filter((w) => w.status === 'unsafe')
                          : selectedUnsafeItem.workerReviews)
                      : [
                          {
                            sequenceNo: 1,
                            workerName: 'Worker 1',
                            status: (selectedUnsafeItem?.status === 'unsafe' ? 'unsafe' : 'safe') as any,
                            unsafeReasons: selectedUnsafeItem?.unsafeReasons || (selectedUnsafeItem?.status === 'unsafe' ? ['helmet'] : []),
                            otherReasonText: selectedUnsafeItem?.otherReasonText,
                            frontUri: null,
                            backUri: null,
                            frontDriveId: null,
                            backDriveId: null,
                          },
                        ];

                  return (
                    <View style={{ gap: 16 }}>
                      {workersToDisplay.map((worker, wIdx) => {
                        const isWorkerUnsafe = worker.status === 'unsafe';
                        const workerTitle = `${selectedUnsafeItem?.vendor || 'Vendor'} • Worker #${worker.sequenceNo}`;

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
                              <View style={[
                                detailsStyles.workerVerdictChip,
                                !isWorkerUnsafe && { backgroundColor: 'rgba(35, 134, 54, 0.1)' }
                              ]}>
                                <Icon
                                  color={isWorkerUnsafe ? reviewerColors.errorRed : '#238636'}
                                  name={
                                    isWorkerUnsafe
                                      ? { ios: 'xmark.circle.fill', android: 'cancel', web: 'cancel' }
                                      : { ios: 'checkmark.circle.fill', android: 'check_circle', web: 'check_circle' }
                                  }
                                  size={14}
                                />
                                <Text style={[
                                  detailsStyles.workerVerdictText,
                                  !isWorkerUnsafe && { color: '#238636' }
                                ]}>
                                  {isWorkerUnsafe ? 'UNSAFE' : 'SAFE'}
                                </Text>
                              </View>
                            </View>

                            {/* Reasons Section if unsafe */}
                            {isWorkerUnsafe && (
                              <View style={detailsStyles.section}>
                                <Text style={detailsStyles.sectionTitle}>
                                  IDENTIFIED PPE VIOLATIONS
                                </Text>
                                <View style={detailsStyles.reasonsGrid}>
                                  {worker.unsafeReasons && worker.unsafeReasons.length > 0 ? (
                                    worker.unsafeReasons.map((r) => {
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
                            )}

                            {/* Other reason note if present */}
                            {isWorkerUnsafe && worker.otherReasonText ? (
                              <View style={detailsStyles.section}>
                                <Text style={detailsStyles.sectionTitle}>
                                  REVIEWER NOTE / DESCRIPTION
                                </Text>
                                <View style={detailsStyles.notesBox}>
                                  <Text style={detailsStyles.notesText}>
                                    "{worker.otherReasonText}"
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
                                  fileIdOrUri={worker.frontUri}
                                  driveId={worker.frontDriveId}
                                  submissionId={selectedUnsafeItem?.id}
                                  workerSequenceNo={worker.sequenceNo}
                                  fallbackAsset={sampleWorkerPhotos[worker.sequenceNo]?.front || (isWorkerUnsafe ? assets.fieldUnsafeCheck : assets.fieldSafeCheck)}
                                  workerTitle={workerTitle}
                                  onPressZoom={openZoomModal}
                                />
                                <HistoryInspectionPhoto
                                  badgeLabel="BACK"
                                  fileIdOrUri={worker.backUri}
                                  driveId={worker.backDriveId}
                                  submissionId={selectedUnsafeItem?.id}
                                  workerSequenceNo={worker.sequenceNo}
                                  fallbackAsset={sampleWorkerPhotos[worker.sequenceNo]?.back || assets.captureRecentPhoto}
                                  workerTitle={workerTitle}
                                  onPressZoom={openZoomModal}
                                />
                              </View>
                            </View>
                          </View>
                        );
                      })}
                    </View>
                  );
                })()}
              </ScrollView>
            </Animated.View>
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
              bounces={false}
              contentContainerStyle={zoomModalStyles.scrollContent}
              maximumZoomScale={4}
              minimumZoomScale={1}
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

            {/* Bottom Controls Bar */}
            <SafeAreaView edges={['bottom']} style={zoomModalStyles.safeFooter}>
              <View style={zoomModalStyles.zoomControlsBar}>
                <Pressable
                  accessibilityLabel="Zoom Out"
                  accessibilityRole="button"
                  disabled={zoomScale <= 1}
                  onPress={handleZoomOut}
                  style={({ pressed }) => [
                    zoomModalStyles.controlBtn,
                    zoomScale <= 1 && zoomModalStyles.controlBtnDisabled,
                    pressed && styles.pressedOpacity,
                  ]}>
                  <Icon
                    color="#ffffff"
                    name={{ ios: 'minus.magnifyingglass', android: 'zoom_out', web: 'zoom_out' }}
                    size={20}
                  />
                </Pressable>

                <Pressable
                  accessibilityLabel="Reset Zoom"
                  accessibilityRole="button"
                  onPress={handleResetZoom}
                  style={({ pressed }) => [
                    zoomModalStyles.resetBtn,
                    pressed && styles.pressedOpacity,
                  ]}>
                  <Text style={zoomModalStyles.resetText}>
                    {Math.round(zoomScale * 100)}%
                  </Text>
                </Pressable>

                <Pressable
                  accessibilityLabel="Zoom In"
                  accessibilityRole="button"
                  disabled={zoomScale >= 4}
                  onPress={handleZoomIn}
                  style={({ pressed }) => [
                    zoomModalStyles.controlBtn,
                    zoomScale >= 4 && zoomModalStyles.controlBtnDisabled,
                    pressed && styles.pressedOpacity,
                  ]}>
                  <Icon
                    color="#ffffff"
                    name={{ ios: 'plus.magnifyingglass', android: 'zoom_in', web: 'zoom_in' }}
                    size={20}
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
    backgroundColor: '#fef2f2',
    paddingHorizontal: 8,
    paddingVertical: 4,
    borderRadius: 6,
  },
  workerVerdictText: {
    fontSize: 11,
    fontWeight: '800',
    color: '#ba1a1a',
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
  photoPlaceholder: {
    alignItems: 'center',
    flex: 1,
    justifyContent: 'center',
    gap: 4,
  },
  photoPlaceholderText: {
    color: '#6b7280',
    fontSize: 11,
    fontWeight: '600',
  },
  photoLoadingOverlay: {
    ...StyleSheet.absoluteFill,
    alignItems: 'center',
    backgroundColor: 'rgba(243, 244, 246, 0.7)',
    justifyContent: 'center',
  },
  photoZoomBadge: {
    alignItems: 'center',
    backgroundColor: 'rgba(0, 0, 0, 0.55)',
    borderRadius: 12,
    bottom: 6,
    height: 24,
    justifyContent: 'center',
    position: 'absolute',
    right: 6,
    width: 24,
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

export default ReviewHistoryScreen;
