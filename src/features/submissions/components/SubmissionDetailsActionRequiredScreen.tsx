import { Href, useLocalSearchParams, useRouter } from 'expo-router';
import { Image, ImageSource } from 'expo-image';
import { useState } from 'react';
import {
  Alert,
  Modal,
  Pressable,
  ScrollView,
  StyleSheet,
  Text,
  View,
} from 'react-native';
import { SafeAreaView } from 'react-native-safe-area-context';
import { useTranslation } from 'react-i18next';

import { Icon } from '@/components/ui/Icon';
import { assets } from '@/constants/assets';
import {
  reasonIcons,
  unsafeReasonLabels,
} from '@/features/reviews/services/reviews.service';
import {
  formatWorkerCheckTime,
  getWorkerCheckById,
  resubmitWorkerCheck,
  WorkerIssue,
} from '@/features/submissions/services/workerChecks.service';
import {
  setPendingSubmissionReviewSite,
  setPendingSubmissionReviewTarget,
} from '@/features/submissions/services/pendingSubmissionReview.service';

const workerTwoFront =
  'https://lh3.googleusercontent.com/aida-public/AB6AXuDgQU9bHBVHLqpP5L7JengM95PotCLUMm0pYSa5LrM8Tak4Qv7ZN0RbNzGeW5mlq6MGCveBJQQDXEWtSxpzqpzEqzO73hM9VW3OgXi4AkyKod79xg_aPJ9wxOMTPTb6_qUd51H5P1DcSqqEAji7jg9I2Kg465f111W36y-82wOnClR_5LezGuCHcZ0pf1_OvuhGY7GpysiX6hZC7JVN63eZ_gNo4b6GLcrM8yI56LZdN8ToE9jQBAt0';

const workerTwoBack =
  'https://lh3.googleusercontent.com/aida-public/AB6AXuB-I5Gv4lteN5XsmAXE1_cDPtr_NEzL0F2CWVDwg-sZ1I-sHC0rbP0roxgmqczH7trvuE09iErv3qWPdaBHjcUMQoCkQorKdchMTpc_UUiogIYbMk6JgnOI5qH9IntEebdbZ_cummC-xp7OVKcew1zHrrSby1porfloCpEp9kvEmQQMPGtP2B7Vc8qebXWvsrsMUP_7BXNFUpp_KpYAP-6afKkjDLBTdOpvXOk1EfqXOSazVPOvAIwS';

const colors = {
  background: '#f9f9ff',
  border: '#c0c7d5',
  error: '#ba1a1a',
  errorContainer: '#ffdad6',
  errorLight: '#fef2f2',
  errorBorder: 'rgba(186, 26, 26, 0.2)',
  primary: '#005cad',
  primaryContainer: '#0075d8',
  success: '#16A34A',
  surface: '#ffffff',
  surfaceContainer: '#ebedf7',
  surfaceContainerLow: '#f1f3fd',
  text: '#181c22',
  textMuted: '#404753',
  textSubtle: '#717785',
  warning: '#984300',
  warningContainer: '#ffdbca',
  white: '#ffffff',
};

export function SubmissionDetailsActionRequiredScreen() {
  const router = useRouter();
  const params = useLocalSearchParams<{ id?: string; workerNumber?: string }>();
  const { t } = useTranslation('submission');
  const [selectedPhoto, setSelectedPhoto] = useState<{ uri: string; label: string } | null>(null);

  const workerId = params.id || params.workerNumber || 'w135';
  const currentWorker = getWorkerCheckById(workerId) || getWorkerCheckById('w135');

  function goBack() {
    if (router.canGoBack()) {
      router.back();
      return;
    }
    router.replace('/(external)' as Href);
  }

  function fixAndResubmit() {
    const workerNum = currentWorker?.workerNumber || 135;

    // Set target so camera opens directly on this worker
    setPendingSubmissionReviewTarget({
      workerNumber: workerNum,
      side: 'FRONT',
    });
    setPendingSubmissionReviewSite(currentWorker?.siteName || 'Gazipur-ER-102 - Tower Sector 3');

    // Navigate directly to camera capture screen
    router.push('/continuous-ppe-capture' as Href);
  }

  const rawReasons: string[] =
    currentWorker?.unsafeReasons && currentWorker.unsafeReasons.length > 0
      ? currentWorker.unsafeReasons
      : ['helmet', 'lanyard'];

  const reviewerName = currentWorker?.reviewerName || 'Mahmudul Hasan · EHS Representative';
  const reviewerInitials = reviewerName
    .split(' ')
    .slice(0, 2)
    .map((w) => w[0]?.toUpperCase() || '')
    .join('') || 'MH';

  const timeDisplay = formatWorkerCheckTime(currentWorker || 'time0945', t);

  return (
    <SafeAreaView style={styles.safeArea}>
      <View style={styles.shell}>
        {/* Navigation Header */}
        <View style={styles.header}>
          <Pressable
            accessibilityLabel={t('detailScreen.back', { defaultValue: 'Back' })}
            accessibilityRole="button"
            onPress={goBack}
            style={({ pressed }) => [styles.headerButton, pressed && styles.pressed]}>
            <Icon
              color={colors.text}
              name={{ ios: 'arrow.left', android: 'arrow_back', web: 'arrow_back' }}
              size={22}
              weight="semibold"
            />
          </Pressable>
          <View style={styles.headerCopy}>
            <Text style={styles.headerEyebrow}>
              {`SUBMISSION #GAZ-${currentWorker?.workerNumber || '135'}`}
            </Text>
            <Text style={styles.headerTitle}>
              {`Worker #${currentWorker?.workerNumber || '135'} Details`}
            </Text>
          </View>
          <Pressable
            accessibilityLabel={t('detailScreen.help', { defaultValue: 'Help' })}
            accessibilityRole="button"
            onPress={() =>
              Alert.alert(
                'Safety Review Details',
                'This screen displays the visual PPE inspection feedback provided by the EHS Reviewer. Tap "Fix & Resubmit" after correcting the flagged items.'
              )
            }
            style={({ pressed }) => [styles.headerButton, pressed && styles.pressed]}>
            <Icon
              color={colors.textMuted}
              name={{ ios: 'questionmark.circle', android: 'help_outline', web: 'help_outline' }}
              size={22}
            />
          </Pressable>
        </View>

        {/* Scrollable Content */}
        <ScrollView
          contentContainerStyle={styles.content}
          showsVerticalScrollIndicator={false}
          style={styles.scroll}>
          {/* Metadata Card */}
          <View style={styles.metaCard}>
            <View style={styles.metaTopRow}>
              <View style={styles.metaSite}>
                <Icon
                  color={colors.primary}
                  name={{
                    ios: 'antenna.radiowaves.left.and.right',
                    android: 'cell_tower',
                    web: 'cell_tower',
                  }}
                  size={16}
                />
                <Text numberOfLines={1} style={styles.metaTitle}>
                  {currentWorker?.siteName || 'Gazipur-ER-102 - Tower Sector 3'}
                </Text>
              </View>
            </View>
            <View style={styles.metaDivider} />
            <View style={styles.metaBottomRow}>
              <View style={styles.submittedBy}>
                <Icon
                  color={colors.textMuted}
                  name={{ ios: 'person', android: 'person', web: 'person' }}
                  size={14}
                />
                <Text numberOfLines={1} style={styles.metaSubtext}>
                  {t('detailScreen.submittedBy', { defaultValue: 'Submitted by Field Team Lead' })}
                </Text>
              </View>
              <Text style={styles.metaTime}>{timeDisplay}</Text>
            </View>
          </View>

          {/* Alert Banner: Marked as UNSAFE by Reviewer (Matching Reviewer Unsafe Modal) */}
          <View style={styles.alertBanner}>
            <View style={styles.alertIconCircle}>
              <Icon
                color={colors.error}
                name={{ ios: 'exclamationmark.triangle.fill', android: 'warning', web: 'warning' }}
                size={22}
                weight="bold"
              />
            </View>
            <View style={styles.alertTextContainer}>
              <Text style={styles.alertTitle}>Marked as UNSAFE by Reviewer</Text>
              <Text style={styles.alertLocation}>
                {`${currentWorker?.siteName || 'Gazipur-ER-102'} • ${timeDisplay}`}
              </Text>
            </View>
          </View>

          {/* Section: IDENTIFIED PPE VIOLATIONS */}
          <View style={styles.sectionCard}>
            <Text style={styles.sectionTitle}>IDENTIFIED PPE VIOLATIONS</Text>

            <View style={styles.reasonsGrid}>
              {rawReasons.map((r) => {
                const normalized = r.toLowerCase().replace(/[^a-z]/g, '');
                let matchedKey = 'other';
                if (normalized.includes('helmet')) matchedKey = 'helmet';
                else if (normalized.includes('harness')) matchedKey = 'harness';
                else if (normalized.includes('lanyard')) matchedKey = 'lanyard';
                else if (normalized.includes('anchor')) matchedKey = 'anchorage';
                else if (normalized.includes('shoe') || normalized.includes('boot')) matchedKey = 'shoes';

                const iconConfig = reasonIcons[matchedKey] || reasonIcons.other;
                const label = unsafeReasonLabels[matchedKey] || r;

                return (
                  <View key={r} style={styles.reasonItem}>
                    <View style={styles.reasonIconBox}>
                      <Icon
                        color={colors.error}
                        name={iconConfig as any}
                        size={18}
                        weight="semibold"
                      />
                    </View>
                    <View style={styles.reasonCopy}>
                      <Text style={styles.reasonItemText}>{label}</Text>
                      <Text style={styles.reasonStatusTag}>Non-compliant</Text>
                    </View>
                  </View>
                );
              })}
            </View>

            {/* If structured issues list exists for this worker, render each item */}
            {currentWorker?.issues && currentWorker.issues.length > 0 && (
              <View style={styles.detailedIssuesList}>
                {currentWorker.issues.map((issue, idx) => (
                  <View key={issue.title + idx} style={styles.issueItem}>
                    <View style={styles.issueNumber}>
                      <Icon
                        color={colors.error}
                        name={{ ios: 'exclamationmark', android: 'priority_high', web: 'priority_high' }}
                        size={12}
                        weight="bold"
                      />
                    </View>
                    <View style={styles.issueBody}>
                      <View style={styles.issueTitleRow}>
                        <Text style={styles.issueTitle}>{issue.title}</Text>
                        <View style={styles.criticalChip}>
                          <Text style={styles.criticalChipText}>CRITICAL</Text>
                        </View>
                      </View>
                      <Text style={styles.issueMessage}>{issue.message}</Text>
                      {issue.tags && issue.tags.length > 0 && (
                        <View style={styles.tagRow}>
                          {issue.tags.map((tag) => (
                            <View key={tag} style={styles.tag}>
                              <Text style={styles.tagText}>{tag}</Text>
                            </View>
                          ))}
                        </View>
                      )}
                    </View>
                  </View>
                ))}
              </View>
            )}
          </View>

          {/* Section: REVIEWER NOTE / DESCRIPTION */}
          <View style={styles.sectionCard}>
            <Text style={styles.sectionTitle}>REVIEWER NOTE / DESCRIPTION</Text>
            <View style={styles.notesBox}>
              <View style={styles.quoteIconWrap}>
                <Icon
                  color={colors.error}
                  name={{ ios: 'quote.opening', android: 'format_quote', web: 'format_quote' }}
                  size={20}
                />
              </View>
              <Text style={styles.notesText}>
                "{currentWorker?.reviewerNote || 'Worker was observed without required PPE gear properly fastened during inspection.'}"
              </Text>
            </View>
          </View>

          {/* Section: INSPECTION PHOTOS */}
          <View style={styles.sectionCard}>
            <Text style={styles.sectionTitle}>INSPECTION PHOTOS</Text>

            <View style={styles.photosRow}>
              {/* Front Photo */}
              <Pressable
                accessibilityLabel="View Front Inspection Photo"
                accessibilityRole="button"
                onPress={() => setSelectedPhoto({ uri: workerTwoFront, label: 'FRONT INSPECTION' })}
                style={({ pressed }) => [styles.photoCard, pressed && styles.pressed]}>
                <View style={styles.photoBadge}>
                  <Text style={styles.photoBadgeText}>FRONT</Text>
                </View>
                <Image
                  contentFit="cover"
                  source={{ uri: workerTwoFront }}
                  style={styles.photoImg}
                />
                <View style={styles.zoomButton}>
                  <Icon
                    color={colors.white}
                    name={{
                      ios: 'arrow.up.left.and.arrow.down.right',
                      android: 'fullscreen',
                      web: 'fullscreen',
                    }}
                    size={14}
                  />
                </View>
              </Pressable>

              {/* Back Photo - Flagged */}
              <Pressable
                accessibilityLabel="View Back Inspection Photo Flagged"
                accessibilityRole="button"
                onPress={() => setSelectedPhoto({ uri: workerTwoBack, label: 'BACK - VIOLATION FLAGGED' })}
                style={({ pressed }) => [styles.photoCard, styles.photoCardFlagged, pressed && styles.pressed]}>
                <View style={[styles.photoBadge, styles.photoBadgeFlagged]}>
                  <Text style={[styles.photoBadgeText, styles.photoBadgeTextFlagged]}>
                    BACK - FLAG
                  </Text>
                </View>
                <Image
                  contentFit="cover"
                  source={{ uri: workerTwoBack }}
                  style={styles.photoImg}
                />
                <View style={styles.flagShade} />
                <View style={styles.inspectBadge}>
                  <Icon
                    color={colors.error}
                    name={{
                      ios: 'exclamationmark.triangle.fill',
                      android: 'warning',
                      web: 'warning',
                    }}
                    size={13}
                    weight="bold"
                  />
                  <Text style={styles.inspectBadgeText}>Violation Area</Text>
                </View>
                <View style={styles.zoomButton}>
                  <Icon
                    color={colors.white}
                    name={{
                      ios: 'arrow.up.left.and.arrow.down.right',
                      android: 'fullscreen',
                      web: 'fullscreen',
                    }}
                    size={14}
                  />
                </View>
              </Pressable>
            </View>
          </View>

          {/* Section: REVIEWED BY (Reviewer Info) */}
          <View style={styles.reviewerCard}>
            <View style={styles.reviewerAvatar}>
              <Text style={styles.reviewerInitials}>{reviewerInitials}</Text>
            </View>
            <View style={styles.reviewerInfo}>
              <Text style={styles.reviewerLabel}>REVIEWED BY</Text>
              <Text style={styles.reviewerName}>{reviewerName}</Text>
              <Text style={styles.reviewerTime}>{timeDisplay}</Text>
            </View>
          </View>
        </ScrollView>

        {/* Bottom Action Bar */}
        <View style={styles.actionBar}>
          <Pressable
            accessibilityRole="button"
            onPress={fixAndResubmit}
            style={({ pressed }) => [styles.primaryButton, pressed && styles.pressed]}>
            <Icon
              color={colors.white}
              name={{ ios: 'arrow.clockwise', android: 'refresh', web: 'refresh' }}
              size={18}
              weight="bold"
            />
            <Text style={styles.primaryButtonText}>
              {t('detailScreen.fixAndResubmit', { defaultValue: 'Fix & Resubmit' })}
            </Text>
          </Pressable>
        </View>

        {/* Fullscreen Photo Modal */}
        <Modal
          animationType="fade"
          onRequestClose={() => setSelectedPhoto(null)}
          transparent={true}
          visible={selectedPhoto !== null}>
          <View style={styles.photoModalOverlay}>
            <Pressable
              onPress={() => setSelectedPhoto(null)}
              style={styles.photoModalBackdrop}
            />
            <View style={styles.photoModalContent}>
              <View style={styles.photoModalHeader}>
                <Text style={styles.photoModalTitle}>{selectedPhoto?.label}</Text>
                <Pressable
                  accessibilityLabel="Close photo"
                  accessibilityRole="button"
                  onPress={() => setSelectedPhoto(null)}
                  style={styles.photoModalCloseButton}>
                  <Icon
                    color={colors.white}
                    name={{ ios: 'xmark', android: 'close', web: 'close' }}
                    size={22}
                  />
                </Pressable>
              </View>
              {selectedPhoto ? (
                <Image
                  contentFit="contain"
                  source={{ uri: selectedPhoto.uri }}
                  style={styles.modalFullImage}
                />
              ) : null}
            </View>
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
    alignSelf: 'center',
    backgroundColor: colors.background,
    flex: 1,
    maxWidth: 448,
    width: '100%',
  },
  header: {
    alignItems: 'center',
    flexDirection: 'row',
    justifyContent: 'space-between',
    paddingHorizontal: 20,
    paddingTop: 8,
  },
  headerButton: {
    alignItems: 'center',
    backgroundColor: colors.surfaceContainerLow,
    borderRadius: 999,
    height: 44,
    justifyContent: 'center',
    width: 44,
  },
  headerCopy: {
    alignItems: 'center',
    flex: 1,
    minWidth: 0,
    paddingHorizontal: 8,
  },
  headerEyebrow: {
    color: colors.textSubtle,
    fontSize: 11,
    fontWeight: '700',
    letterSpacing: 0.5,
    textTransform: 'uppercase',
  },
  headerTitle: {
    color: colors.text,
    fontSize: 18,
    fontWeight: '700',
    lineHeight: 24,
  },
  scroll: {
    flex: 1,
  },
  content: {
    gap: 16,
    paddingBottom: 140,
    paddingHorizontal: 20,
    paddingTop: 12,
  },
  metaCard: {
    backgroundColor: colors.surface,
    borderColor: 'rgba(192, 199, 213, 0.4)',
    borderRadius: 14,
    borderWidth: 1,
    padding: 14,
    shadowColor: '#000000',
    shadowOffset: { height: 2, width: 0 },
    shadowOpacity: 0.05,
    shadowRadius: 6,
  },
  metaTopRow: {
    alignItems: 'center',
    flexDirection: 'row',
    gap: 8,
    justifyContent: 'space-between',
  },
  metaSite: {
    alignItems: 'center',
    flex: 1,
    flexDirection: 'row',
    gap: 7,
    minWidth: 0,
  },
  metaTitle: {
    color: colors.text,
    fontSize: 14,
    fontWeight: '700',
  },
  metaDivider: {
    backgroundColor: colors.surfaceContainer,
    height: 1,
    marginVertical: 10,
  },
  metaBottomRow: {
    alignItems: 'center',
    flexDirection: 'row',
    justifyContent: 'space-between',
  },
  submittedBy: {
    alignItems: 'center',
    flexDirection: 'row',
    gap: 6,
  },
  metaSubtext: {
    color: colors.textMuted,
    fontSize: 12,
  },
  metaTime: {
    color: colors.textMuted,
    fontSize: 12,
    fontWeight: '600',
  },
  alertBanner: {
    alignItems: 'center',
    backgroundColor: 'rgba(186, 26, 26, 0.08)',
    borderColor: 'rgba(186, 26, 26, 0.25)',
    borderRadius: 12,
    borderWidth: 1,
    flexDirection: 'row',
    gap: 12,
    padding: 14,
  },
  alertIconCircle: {
    alignItems: 'center',
    backgroundColor: 'rgba(186, 26, 26, 0.12)',
    borderRadius: 999,
    height: 38,
    justifyContent: 'center',
    width: 38,
  },
  alertTextContainer: {
    flex: 1,
  },
  alertTitle: {
    color: colors.error,
    fontSize: 15,
    fontWeight: '700',
  },
  alertLocation: {
    color: '#7f1d1d',
    fontSize: 12,
    marginTop: 2,
  },
  sectionCard: {
    backgroundColor: colors.surface,
    borderColor: 'rgba(192, 199, 213, 0.4)',
    borderRadius: 14,
    borderWidth: 1,
    gap: 12,
    padding: 16,
    shadowColor: '#000000',
    shadowOffset: { height: 2, width: 0 },
    shadowOpacity: 0.04,
    shadowRadius: 6,
  },
  sectionHeader: {
    alignItems: 'center',
    flexDirection: 'row',
    justifyContent: 'space-between',
  },
  sectionTitle: {
    color: colors.textSubtle,
    fontSize: 11,
    fontWeight: '700',
    letterSpacing: 0.8,
  },
  violationCountBadge: {
    color: colors.error,
    fontSize: 11,
    fontWeight: '700',
  },
  photoCountText: {
    color: colors.textSubtle,
    fontSize: 12,
  },
  reasonsGrid: {
    gap: 8,
  },
  reasonItem: {
    alignItems: 'center',
    backgroundColor: colors.errorLight,
    borderColor: colors.errorBorder,
    borderRadius: 10,
    borderWidth: 1,
    flexDirection: 'row',
    gap: 12,
    paddingHorizontal: 14,
    paddingVertical: 12,
  },
  reasonIconBox: {
    alignItems: 'center',
    backgroundColor: 'rgba(186, 26, 26, 0.12)',
    borderRadius: 8,
    height: 32,
    justifyContent: 'center',
    width: 32,
  },
  reasonCopy: {
    flex: 1,
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
  },
  reasonItemText: {
    color: '#991b1b',
    fontSize: 14,
    fontWeight: '700',
  },
  reasonStatusTag: {
    color: colors.error,
    fontSize: 11,
    fontWeight: '600',
  },
  detailedIssuesList: {
    borderTopColor: colors.surfaceContainer,
    borderTopWidth: 1,
    gap: 10,
    marginTop: 4,
    paddingTop: 12,
  },
  issueItem: {
    flexDirection: 'row',
    gap: 10,
  },
  issueNumber: {
    alignItems: 'center',
    backgroundColor: colors.errorContainer,
    borderRadius: 999,
    height: 22,
    justifyContent: 'center',
    width: 22,
  },
  issueNumberText: {
    color: colors.error,
    fontSize: 12,
    fontWeight: '700',
  },
  issueBody: {
    flex: 1,
    gap: 4,
  },
  issueTitleRow: {
    alignItems: 'center',
    flexDirection: 'row',
    justifyContent: 'space-between',
  },
  issueTitle: {
    color: colors.text,
    fontSize: 13,
    fontWeight: '700',
  },
  criticalChip: {
    backgroundColor: colors.errorContainer,
    borderRadius: 4,
    paddingHorizontal: 6,
    paddingVertical: 2,
  },
  criticalChipText: {
    color: colors.error,
    fontSize: 9,
    fontWeight: '700',
  },
  issueMessage: {
    color: colors.textMuted,
    fontSize: 12,
    lineHeight: 17,
  },
  tagRow: {
    flexDirection: 'row',
    flexWrap: 'wrap',
    gap: 6,
    marginTop: 2,
  },
  tag: {
    backgroundColor: colors.surfaceContainer,
    borderRadius: 4,
    paddingHorizontal: 6,
    paddingVertical: 2,
  },
  tagText: {
    color: colors.textMuted,
    fontSize: 10,
    fontWeight: '600',
  },
  notesBox: {
    backgroundColor: '#f9fafb',
    borderColor: '#e5e7eb',
    borderRadius: 10,
    borderWidth: 1,
    flexDirection: 'row',
    gap: 10,
    padding: 14,
  },
  quoteIconWrap: {
    marginTop: 2,
  },
  notesText: {
    color: '#1f2937',
    flex: 1,
    fontSize: 14,
    fontStyle: 'italic',
    lineHeight: 20,
  },
  photosRow: {
    flexDirection: 'row',
    gap: 12,
  },
  photoCard: {
    backgroundColor: colors.surfaceContainer,
    borderRadius: 12,
    flex: 1,
    height: 150,
    overflow: 'hidden',
    position: 'relative',
  },
  photoCardFlagged: {
    borderColor: colors.error,
    borderWidth: 1.5,
  },
  photoBadge: {
    backgroundColor: 'rgba(255, 255, 255, 0.95)',
    borderRadius: 4,
    left: 8,
    paddingHorizontal: 6,
    paddingVertical: 3,
    position: 'absolute',
    top: 8,
    zIndex: 2,
  },
  photoBadgeFlagged: {
    backgroundColor: colors.error,
  },
  photoBadgeText: {
    color: colors.text,
    fontSize: 10,
    fontWeight: '700',
  },
  photoBadgeTextFlagged: {
    color: colors.white,
  },
  photoImg: {
    height: '100%',
    width: '100%',
  },
  flagShade: {
    backgroundColor: 'rgba(186, 26, 26, 0.1)',
    bottom: 0,
    left: 0,
    position: 'absolute',
    right: 0,
    top: 0,
  },
  inspectBadge: {
    alignItems: 'center',
    backgroundColor: 'rgba(255, 255, 255, 0.95)',
    borderRadius: 6,
    bottom: 8,
    flexDirection: 'row',
    gap: 4,
    left: 8,
    paddingHorizontal: 6,
    paddingVertical: 3,
    position: 'absolute',
    zIndex: 2,
  },
  inspectBadgeText: {
    color: colors.error,
    fontSize: 10,
    fontWeight: '700',
  },
  zoomButton: {
    alignItems: 'center',
    backgroundColor: 'rgba(0, 0, 0, 0.5)',
    borderRadius: 999,
    bottom: 8,
    height: 24,
    justifyContent: 'center',
    position: 'absolute',
    right: 8,
    width: 24,
    zIndex: 2,
  },
  reviewerCard: {
    alignItems: 'center',
    backgroundColor: colors.surface,
    borderColor: 'rgba(192, 199, 213, 0.4)',
    borderRadius: 14,
    borderWidth: 1,
    flexDirection: 'row',
    gap: 12,
    padding: 14,
  },
  reviewerAvatar: {
    alignItems: 'center',
    backgroundColor: '#00376f',
    borderRadius: 999,
    height: 42,
    justifyContent: 'center',
    width: 42,
  },
  reviewerInitials: {
    color: colors.white,
    fontSize: 15,
    fontWeight: '700',
  },
  reviewerInfo: {
    flex: 1,
  },
  reviewerLabel: {
    color: colors.textSubtle,
    fontSize: 10,
    fontWeight: '700',
    letterSpacing: 0.5,
  },
  reviewerName: {
    color: colors.text,
    fontSize: 14,
    fontWeight: '700',
  },
  reviewerTime: {
    color: colors.textMuted,
    fontSize: 12,
    marginTop: 2,
  },
  actionBar: {
    backgroundColor: colors.surface,
    borderTopColor: colors.surfaceContainer,
    borderTopWidth: 1,
    bottom: 0,
    gap: 10,
    left: 0,
    maxWidth: 448,
    paddingBottom: 24,
    paddingHorizontal: 20,
    paddingTop: 12,
    position: 'absolute',
    right: 0,
  },
  primaryButton: {
    alignItems: 'center',
    backgroundColor: colors.primary,
    borderRadius: 12,
    flexDirection: 'row',
    gap: 8,
    height: 48,
    justifyContent: 'center',
    width: '100%',
  },
  primaryButtonText: {
    color: colors.white,
    fontSize: 15,
    fontWeight: '700',
  },
  photoModalOverlay: {
    backgroundColor: 'rgba(0, 0, 0, 0.85)',
    flex: 1,
    justifyContent: 'center',
    padding: 20,
  },
  photoModalBackdrop: {
    ...StyleSheet.absoluteFill,
  },
  photoModalContent: {
    backgroundColor: '#111827',
    borderRadius: 16,
    overflow: 'hidden',
    zIndex: 10,
  },
  photoModalHeader: {
    alignItems: 'center',
    borderBottomColor: '#1f2937',
    borderBottomWidth: 1,
    flexDirection: 'row',
    justifyContent: 'space-between',
    paddingHorizontal: 16,
    paddingVertical: 12,
  },
  photoModalTitle: {
    color: colors.white,
    fontSize: 14,
    fontWeight: '700',
  },
  photoModalCloseButton: {
    padding: 4,
  },
  modalFullImage: {
    height: 360,
    width: '100%',
  },
  pressed: {
    opacity: 0.85,
  },
  textPressed: {
    opacity: 0.6,
  },
});

export default SubmissionDetailsActionRequiredScreen;
