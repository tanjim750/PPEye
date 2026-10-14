import { Href, useLocalSearchParams, useRouter } from 'expo-router';
import { Image, ImageSource } from 'expo-image';
import { Pressable, ScrollView, StyleSheet, Text, View } from 'react-native';
import { SafeAreaView } from 'react-native-safe-area-context';
import { useTranslation } from 'react-i18next';

import { Icon } from '@/components/ui/Icon';
import {
  formatWorkerCheckTime,
  getWorkerCheckById,
  resubmitWorkerCheck,
  WorkerIssue,
} from '@/features/submissions/services/workerChecks.service';

type WorkerStatus = 'safe' | 'unsafe';

type WorkerDetail = {
  back?: ImageSource;
  front?: ImageSource;
  issue?: string;
  name: string;
  role: string;
  sequenceNo: number;
  status: WorkerStatus;
  reviewerNote?: string;
  unsafeReasons?: string[];
};

type IssueDetail = {
  severityKey: 'critical' | 'missing';
  tags?: string[];
  title: string;
  tone: 'error' | 'warning';
  message: string;
};

const workerTwoFront =
  'https://lh3.googleusercontent.com/aida-public/AB6AXuDgQU9bHBVHLqpP5L7JengM95PotCLUMm0pYSa5LrM8Tak4Qv7ZN0RbNzGeW5mlq6MGCveBJQQDXEWtSxpzqpzEqzO73hM9VW3OgXi4AkyKod79xg_aPJ9wxOMTPTb6_qUd51H5P1DcSqqEAji7jg9I2Kg465f111W36y-82wOnClR_5LezGuCHcZ0pf1_OvuhGY7GpysiX6hZC7JVN63eZ_gNo4b6GLcrM8yI56LZdN8ToE9jQBAt0';

const workerTwoBack =
  'https://lh3.googleusercontent.com/aida-public/AB6AXuB-I5Gv4lteN5XsmAXE1_cDPtr_NEzL0F2CWVDwg-sZ1I-sHC0rbP0roxgmqczH7trvuE09iErv3qWPdaBHjcUMQoCkQorKdchMTpc_UUiogIYbMk6JgnOI5qH9IntEebdbZ_cummC-xp7OVKcew1zHrrSby1porfloCpEp9kvEmQQMPGtP2B7Vc8qebXWvsrsMUP_7BXNFUpp_KpYAP-6afKkjDLBTdOpvXOk1EfqXOSazVPOvAIwS';

const supportingPhoto =
  'https://lh3.googleusercontent.com/aida-public/AB6AXuDM1AWQuL-6QHryo-dNR2MVY1VYvY3vBWVMl7of8ulRF_ik6eL49ety5FWDvBUZTCEUXu5yqcULmP6KjjM7WkVrg2D_iRe77GvUJJWyGa7vb3--AiT1IptDJ_GzntaGXBLeV8LNfZlW1cURZlmWhEKS3kgK3eUaBUl4WA7KSfMK6QFLdKHkAaKzeDX885fiKX5ifvyiK0W3enHoDTU6R40023Kw1vsgBbYoVeToSPObjGcxCaRi_TFL';

const fallbackIssues: IssueDetail[] = [
  {
    message: 'detailScreen.issues.workerHarness.message',
    severityKey: 'critical',
    tags: ['detailScreen.tags.harness', 'detailScreen.tags.anchorage'],
    title: 'detailScreen.issues.workerHarness.title',
    tone: 'error',
  },
  {
    message: 'detailScreen.issues.firstAidMissing.message',
    severityKey: 'missing',
    tags: ['detailScreen.tags.firstAid'],
    title: 'detailScreen.issues.firstAidMissing.title',
    tone: 'warning',
  },
];

export function SubmissionDetailsActionRequiredScreen() {
  const router = useRouter();
  const params = useLocalSearchParams<{ id?: string; workerNumber?: string }>();
  const { t } = useTranslation('submission');

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
    const idToFix = currentWorker?.id || workerId || 'w135';
    resubmitWorkerCheck(idToFix);
    router.replace('/history?filter=pending' as Href);
  }

  const displayIssues: IssueDetail[] =
    currentWorker?.issues && currentWorker.issues.length > 0
      ? currentWorker.issues
      : fallbackIssues;

  const reviewerInitials = currentWorker?.reviewerName
    ? currentWorker.reviewerName
        .split(' ')
        .slice(0, 2)
        .map((n) => n[0])
        .join('')
    : 'MH';

  return (
    <SafeAreaView style={styles.safeArea}>
      <View style={styles.shell}>
        <View style={styles.header}>
          <Pressable
            accessibilityLabel={t('detailScreen.back')}
            accessibilityRole="button"
            onPress={goBack}
            style={({ pressed }) => [styles.headerButton, pressed && styles.pressed]}>
            <Icon
              color={colors.text}
              name={{ ios: 'arrow.left', android: 'arrow_back', web: 'arrow_back' }}
              size={23}
              weight="semibold"
            />
          </Pressable>
          <View style={styles.headerCopy}>
            <Text style={styles.headerEyebrow}>
              {currentWorker?.workerNumber ? `SUBMISSION #GAZ-${currentWorker.workerNumber}` : t('detailScreen.eyebrow')}
            </Text>
            <Text style={styles.headerTitle}>{t('detailScreen.title')}</Text>
          </View>
          <Pressable
            accessibilityLabel={t('detailScreen.help')}
            accessibilityRole="button"
            style={({ pressed }) => [styles.headerButton, pressed && styles.pressed]}>
            <Icon
              color={colors.textMuted}
              name={{ ios: 'questionmark.circle', android: 'help_outline', web: 'help_outline' }}
              size={23}
            />
          </Pressable>
        </View>

        <ScrollView
          contentContainerStyle={styles.content}
          showsVerticalScrollIndicator={false}
          style={styles.scroll}>
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
                  size={17}
                />
                <Text numberOfLines={1} style={styles.metaTitle}>
                  {currentWorker?.siteName || t('detailScreen.site')}
                </Text>
              </View>
              <Text style={styles.idChip}>
                {`Worker #${currentWorker?.workerNumber || '135'}`}
              </Text>
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
                  {t('detailScreen.submittedBy')}
                </Text>
              </View>
              <Text style={styles.metaTime}>
                {formatWorkerCheckTime(currentWorker?.timeKey || 'time0945', t)}
              </Text>
            </View>
          </View>

          <View style={styles.statusBanner}>
            <View style={styles.statusIcon}>
              <Icon
                color={colors.warning}
                name={{
                  ios: 'exclamationmark.triangle.fill',
                  android: 'warning',
                  web: 'warning',
                }}
                size={27}
                weight="bold"
              />
            </View>
            <View style={styles.statusCopy}>
              <Text style={styles.statusTitle}>
                {`Worker #${currentWorker?.workerNumber || '135'} Non-Compliant`}
              </Text>
              <Text style={styles.statusMessage}>{t('detailScreen.actionRequiredBody')}</Text>
            </View>
          </View>

          <View style={styles.card}>
            <View style={styles.cardHeader}>
              <View style={styles.titleRow}>
                <Icon
                  color={colors.warning}
                  name={{ ios: 'checklist', android: 'checklist_rtl', web: 'checklist_rtl' }}
                  size={21}
                />
                <Text style={styles.sectionTitle}>{t('detailScreen.itemsToCorrect')}</Text>
              </View>
              <Text style={styles.issueCount}>
                {`${displayIssues.length} ${displayIssues.length === 1 ? 'issue' : 'issues'}`}
              </Text>
            </View>
            <View style={styles.issueList}>
              {displayIssues.map((issue, index) => {
                const issueTitle = issue.title.startsWith('detailScreen.') ? t(issue.title) : issue.title;
                const issueMessage = issue.message.startsWith('detailScreen.') ? t(issue.message) : issue.message;

                return (
                  <View key={issue.title + index} style={styles.issueItem}>
                    <View
                      style={[
                        styles.issueNumber,
                        issue.tone === 'error' ? styles.issueNumberError : styles.issueNumberWarning,
                      ]}>
                      <Text
                        style={[
                          styles.issueNumberText,
                          issue.tone === 'error'
                            ? styles.issueNumberTextError
                            : styles.issueNumberTextWarning,
                        ]}>
                        {index + 1}
                      </Text>
                    </View>
                    <View style={styles.issueCopy}>
                      <View style={styles.issueTitleRow}>
                        <Text numberOfLines={1} style={styles.issueTitle}>
                          {issueTitle}
                        </Text>
                        <Text
                          style={[
                            styles.severity,
                            issue.tone === 'error' ? styles.errorText : styles.warningText,
                          ]}>
                          {t(`detailScreen.severity.${issue.severityKey}`, { defaultValue: issue.severityKey.toUpperCase() })}
                        </Text>
                      </View>
                      <Text style={styles.issueMessage}>{issueMessage}</Text>
                      {issue.tags && issue.tags.length > 0 ? (
                        <View style={styles.tagRow}>
                          {issue.tags.map((tag) => (
                            <Text key={tag} style={styles.tag}>
                              {tag.startsWith('detailScreen.') ? t(tag) : tag}
                            </Text>
                          ))}
                        </View>
                      ) : null}
                    </View>
                  </View>
                );
              })}
            </View>
          </View>

          <View style={styles.workerSection}>
            <View style={styles.sectionHeaderInline}>
              <View style={styles.workerTitleWrap}>
                <Text style={styles.sectionTitle}>{t('detailScreen.workerPpe')}</Text>
                <Text style={styles.inlineSubtext}>
                  {`Worker #${currentWorker?.workerNumber || '135'}`}
                </Text>
              </View>
            </View>
            <View style={styles.workerList}>
              <UnsafeWorkerCard
                worker={{
                  back: { uri: workerTwoBack },
                  front: { uri: workerTwoFront },
                  issue: currentWorker?.unsafeReasons?.join(' · ') || 'detailScreen.workers.worker2.issue',
                  name: `Worker #${currentWorker?.workerNumber || '135'}`,
                  role: t('detailScreen.workers.worker2.role'),
                  sequenceNo: currentWorker?.workerNumber || 135,
                  status: 'unsafe',
                  reviewerNote: currentWorker?.reviewerNote,
                  unsafeReasons: currentWorker?.unsafeReasons,
                }}
              />
            </View>
          </View>

          <View style={styles.card}>
            <View style={styles.evidenceHeader}>
              <View>
                <Text style={styles.sectionTitle}>{t('detailScreen.supportingEvidence')}</Text>
                <Text style={styles.inlineSubtext}>{t('detailScreen.evidenceSummary')}</Text>
              </View>
              <Text style={styles.needsAttentionChip}>{t('detailScreen.needsAttention')}</Text>
            </View>
            <View style={styles.evidenceGrid}>
              <View style={styles.evidencePhoto}>
                <Image contentFit="cover" source={{ uri: supportingPhoto }} style={styles.fullImage} />
                <View style={styles.imageShade} />
                <View style={styles.evidenceLabel}>
                  <Icon
                    color={colors.success}
                    name={{
                      ios: 'checkmark.circle.fill',
                      android: 'check_circle',
                      web: 'check_circle',
                    }}
                    size={13}
                    weight="bold"
                  />
                  <Text style={styles.evidenceLabelText}>{t('detailScreen.toolboxTalk')}</Text>
                </View>
              </View>
              <View style={styles.missingEvidence}>
                <View style={styles.missingIcon}>
                  <Icon
                    color={colors.warning}
                    name={{ ios: 'camera.fill', android: 'add_a_photo', web: 'add_a_photo' }}
                    size={18}
                    weight="bold"
                  />
                </View>
                <Text style={styles.missingTitle}>{t('detailScreen.firstAidBox')}</Text>
                <Text style={styles.missingText}>{t('detailScreen.missing')}</Text>
              </View>
            </View>
            <View style={styles.infoCallout}>
              <Icon
                color={colors.warning}
                name={{ ios: 'info.circle.fill', android: 'info', web: 'info' }}
                size={18}
                weight="bold"
              />
              <Text style={styles.infoText}>{t('detailScreen.evidenceNote')}</Text>
            </View>
          </View>

          <View style={styles.decisionCard}>
            <Text style={styles.decisionLabel}>{t('detailScreen.decisionLabel')}</Text>
            <Text style={styles.decisionQuote}>
              "{currentWorker?.reviewerNote || t('detailScreen.decisionQuote')}"
            </Text>
            <View style={styles.reviewerRow}>
              <View style={styles.reviewerAvatar}>
                <Text style={styles.reviewerInitials}>{reviewerInitials}</Text>
              </View>
              <View style={styles.reviewerCopy}>
                <Text style={styles.reviewerName}>
                  {currentWorker?.reviewerName || t('detailScreen.reviewerName')}
                </Text>
                <Text style={styles.reviewerRole}>{t('detailScreen.reviewerRole')}</Text>
              </View>
              <Text style={styles.reviewerTime}>
                {formatWorkerCheckTime(currentWorker?.timeKey || 'time0945', t)}
              </Text>
            </View>
          </View>
        </ScrollView>

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
            <Text style={styles.primaryButtonText}>{t('detailScreen.fixAndResubmit')}</Text>
          </Pressable>
          <Pressable
            accessibilityRole="button"
            style={({ pressed }) => [styles.secondaryButton, pressed && styles.textPressed]}>
            <Text style={styles.secondaryButtonText}>{t('detailScreen.viewOriginal')}</Text>
          </Pressable>
        </View>
      </View>
    </SafeAreaView>
  );
}

function CompactWorkerRow({ worker }: { worker: WorkerDetail }) {
  const { t } = useTranslation('submission');

  return (
    <View style={styles.workerRow}>
      <View style={styles.workerAvatar}>
        <Text style={styles.workerAvatarText}>W{worker.sequenceNo}</Text>
      </View>
      <View style={styles.workerCopy}>
        <Text style={styles.workerName}>{t(worker.name)}</Text>
        <Text numberOfLines={1} style={styles.workerMeta}>
          {t('detailScreen.frontBackVerified')} - {t(worker.role)}
        </Text>
      </View>
      <StatusPill status={worker.status} />
    </View>
  );
}

function UnsafeWorkerCard({ worker }: { worker: WorkerDetail }) {
  const { t } = useTranslation('submission');

  const issueText = worker.issue
    ? worker.issue.startsWith('detailScreen.')
      ? t(worker.issue)
      : worker.issue
    : null;

  return (
    <View style={styles.unsafeWorkerCard}>
      <View style={styles.unsafeWorkerHeader}>
        <View style={styles.workerIdentity}>
          <View style={styles.workerAvatarWarning}>
            <Text style={styles.workerAvatarWarningText}>W{worker.sequenceNo}</Text>
          </View>
          <View style={styles.workerCopy}>
            <Text style={styles.workerName}>
              {worker.name.startsWith('detailScreen.') ? t(worker.name) : worker.name}
            </Text>
            {issueText ? (
              <Text numberOfLines={1} style={styles.workerIssue}>
                {issueText}
              </Text>
            ) : null}
          </View>
        </View>
        <StatusPill status={worker.status} />
      </View>

      <View style={styles.photoGrid}>
        <EvidencePhoto label="FRONT" source={worker.front} />
        <EvidencePhoto flagged label="BACK - FLAG" source={worker.back} />
      </View>

      <View style={styles.reviewerNote}>
        <View style={styles.reviewerNoteTitleRow}>
          <Icon
            color={colors.warning}
            name={{ ios: 'text.bubble.fill', android: 'rate_review', web: 'rate_review' }}
            size={16}
            weight="bold"
          />
          <Text style={styles.reviewerNoteTitle}>{t('detailScreen.reviewerNote')}</Text>
        </View>
        <Text style={styles.reviewerNoteText}>
          {worker.reviewerNote || t('detailScreen.reviewerNoteBody')}
        </Text>
        {worker.unsafeReasons && worker.unsafeReasons.length > 0 ? (
          <Text style={styles.noteTags}>{worker.unsafeReasons.join(' · ')}</Text>
        ) : (
          <Text style={styles.noteTags}>{t('detailScreen.noteTags')}</Text>
        )}
      </View>
    </View>
  );
}

function EvidencePhoto({
  flagged,
  label,
  source,
}: {
  flagged?: boolean;
  label: string;
  source?: ImageSource;
}) {
  return (
    <View style={[styles.photoBox, flagged && styles.photoBoxFlagged]}>
      {source ? <Image contentFit="cover" source={source} style={styles.fullImage} /> : null}
      <View style={[styles.imageShade, flagged && styles.flagShade]} />
      <Text style={[styles.photoBadge, flagged && styles.photoBadgeFlagged]}>{label}</Text>
      <View style={styles.zoomButton}>
        <Icon
          color={colors.white}
          name={{ ios: 'arrow.up.left.and.arrow.down.right', android: 'fullscreen', web: 'fullscreen' }}
          size={15}
        />
      </View>
      {flagged ? (
        <View style={styles.inspectBadge}>
          <Icon
            color={colors.errorContainer}
            name={{
              ios: 'exclamationmark.triangle.fill',
              android: 'warning',
              web: 'warning',
            }}
            size={14}
            weight="bold"
          />
          <Text style={styles.inspectText}>Inspect D-ring</Text>
        </View>
      ) : null}
    </View>
  );
}

function StatusPill({ status }: { status: WorkerStatus }) {
  const { t } = useTranslation('submission');
  const isSafe = status === 'safe';

  return (
    <View style={[styles.statusPill, isSafe ? styles.safePill : styles.unsafePill]}>
      <Icon
        color={isSafe ? colors.success : colors.error}
        name={
          isSafe
            ? { ios: 'checkmark.circle.fill', android: 'check_circle', web: 'check_circle' }
            : { ios: 'exclamationmark.triangle.fill', android: 'error', web: 'error' }
        }
        size={14}
        weight="bold"
      />
      <Text style={[styles.statusPillText, isSafe ? styles.safeText : styles.errorText]}>
        {t(`detailScreen.status.${status}`)}
      </Text>
    </View>
  );
}

const colors = {
  background: '#f9f9ff',
  border: '#c0c7d5',
  error: '#ba1a1a',
  errorContainer: '#ffdad6',
  primary: '#005cad',
  primaryContainer: '#0075d8',
  success: '#16A34A',
  surface: '#ffffff',
  surfaceContainer: '#ebedf7',
  surfaceContainerHigh: '#e5e8f1',
  surfaceContainerLow: '#f1f3fd',
  text: '#181c22',
  textMuted: '#404753',
  textSubtle: '#717785',
  warning: '#984300',
  warningContainer: '#ffdbca',
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
    height: 48,
    justifyContent: 'center',
    width: 48,
  },
  headerCopy: {
    alignItems: 'center',
    flex: 1,
    minWidth: 0,
  },
  headerEyebrow: {
    color: colors.textSubtle,
    fontSize: 11,
    fontWeight: '700',
    letterSpacing: 0,
    lineHeight: 14,
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
    paddingBottom: 128,
    paddingHorizontal: 20,
    paddingTop: 10,
  },
  metaCard: {
    backgroundColor: colors.surfaceContainerLow,
    borderRadius: 12,
    padding: 14,
    shadowColor: '#000000',
    shadowOffset: { height: 2, width: 0 },
    shadowOpacity: 0.06,
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
    flex: 1,
    fontSize: 13,
    fontWeight: '700',
    lineHeight: 18,
  },
  idChip: {
    backgroundColor: colors.surfaceContainerHigh,
    borderRadius: 999,
    color: colors.textMuted,
    fontSize: 11,
    fontWeight: '600',
    lineHeight: 14,
    overflow: 'hidden',
    paddingHorizontal: 8,
    paddingVertical: 3,
  },
  metaDivider: {
    backgroundColor: colors.surfaceContainer,
    height: 1,
    marginVertical: 8,
  },
  metaBottomRow: {
    alignItems: 'center',
    flexDirection: 'row',
    gap: 8,
    justifyContent: 'space-between',
  },
  submittedBy: {
    alignItems: 'center',
    flex: 1,
    flexDirection: 'row',
    gap: 5,
    minWidth: 0,
  },
  metaSubtext: {
    color: colors.textMuted,
    flex: 1,
    fontSize: 11,
    fontWeight: '600',
    lineHeight: 14,
  },
  metaTime: {
    color: colors.textSubtle,
    fontSize: 11,
    fontWeight: '500',
    lineHeight: 14,
  },
  statusBanner: {
    backgroundColor: colors.warningContainer,
    borderRadius: 12,
    flexDirection: 'row',
    gap: 12,
    padding: 16,
    shadowColor: '#984300',
    shadowOffset: { height: 3, width: 0 },
    shadowOpacity: 0.08,
    shadowRadius: 8,
  },
  statusIcon: {
    alignItems: 'center',
    backgroundColor: 'rgba(152, 67, 0, 0.14)',
    borderRadius: 999,
    height: 40,
    justifyContent: 'center',
    width: 40,
  },
  statusCopy: {
    flex: 1,
    minWidth: 0,
  },
  statusTitle: {
    color: '#331200',
    fontSize: 24,
    fontWeight: '800',
    lineHeight: 30,
  },
  statusMessage: {
    color: '#763300',
    fontSize: 14,
    lineHeight: 20,
    marginTop: 2,
  },
  card: {
    backgroundColor: colors.surface,
    borderRadius: 12,
    padding: 16,
    shadowColor: '#000000',
    shadowOffset: { height: 2, width: 0 },
    shadowOpacity: 0.05,
    shadowRadius: 7,
  },
  cardHeader: {
    alignItems: 'center',
    flexDirection: 'row',
    gap: 8,
    justifyContent: 'space-between',
    marginBottom: 12,
  },
  titleRow: {
    alignItems: 'center',
    flex: 1,
    flexDirection: 'row',
    gap: 8,
    minWidth: 0,
  },
  sectionTitle: {
    color: colors.text,
    fontSize: 18,
    fontWeight: '700',
    lineHeight: 24,
  },
  issueCount: {
    backgroundColor: colors.warningContainer,
    borderRadius: 999,
    color: '#763300',
    fontSize: 12,
    fontWeight: '700',
    lineHeight: 16,
    overflow: 'hidden',
    paddingHorizontal: 10,
    paddingVertical: 3,
  },
  issueList: {
    gap: 10,
  },
  issueItem: {
    backgroundColor: colors.surfaceContainerLow,
    borderRadius: 8,
    flexDirection: 'row',
    gap: 12,
    padding: 12,
  },
  issueNumber: {
    alignItems: 'center',
    borderRadius: 999,
    height: 24,
    justifyContent: 'center',
    marginTop: 2,
    width: 24,
  },
  issueNumberError: {
    backgroundColor: 'rgba(186, 26, 26, 0.14)',
  },
  issueNumberWarning: {
    backgroundColor: 'rgba(152, 67, 0, 0.14)',
  },
  issueNumberText: {
    fontSize: 11,
    fontWeight: '800',
    lineHeight: 14,
  },
  issueNumberTextError: {
    color: colors.error,
  },
  issueNumberTextWarning: {
    color: colors.warning,
  },
  issueCopy: {
    flex: 1,
    minWidth: 0,
  },
  issueTitleRow: {
    alignItems: 'center',
    flexDirection: 'row',
    gap: 8,
    justifyContent: 'space-between',
  },
  issueTitle: {
    color: colors.text,
    flex: 1,
    fontSize: 13,
    fontWeight: '800',
    lineHeight: 18,
  },
  severity: {
    fontSize: 11,
    fontWeight: '700',
    lineHeight: 14,
  },
  errorText: {
    color: colors.error,
  },
  safeText: {
    color: colors.success,
  },
  warningText: {
    color: colors.warning,
  },
  issueMessage: {
    color: colors.textMuted,
    fontSize: 14,
    lineHeight: 20,
    marginTop: 3,
  },
  tagRow: {
    flexDirection: 'row',
    flexWrap: 'wrap',
    gap: 6,
    marginTop: 8,
  },
  tag: {
    backgroundColor: colors.surfaceContainer,
    borderRadius: 999,
    color: colors.textMuted,
    fontSize: 11,
    fontWeight: '600',
    lineHeight: 14,
    overflow: 'hidden',
    paddingHorizontal: 8,
    paddingVertical: 3,
  },
  workerSection: {
    gap: 10,
  },
  sectionHeaderInline: {
    alignItems: 'center',
    flexDirection: 'row',
    justifyContent: 'space-between',
    paddingHorizontal: 2,
  },
  workerTitleWrap: {
    flex: 1,
    minWidth: 0,
  },
  inlineSubtext: {
    color: colors.textSubtle,
    fontSize: 11,
    fontWeight: '600',
    lineHeight: 14,
  },
  historyButton: {
    alignItems: 'center',
    flexDirection: 'row',
    gap: 2,
    paddingHorizontal: 6,
    paddingVertical: 4,
  },
  historyText: {
    color: colors.primary,
    fontSize: 12,
    fontWeight: '700',
    lineHeight: 16,
  },
  workerList: {
    gap: 10,
  },
  workerRow: {
    alignItems: 'center',
    backgroundColor: colors.surface,
    borderRadius: 12,
    flexDirection: 'row',
    gap: 12,
    justifyContent: 'space-between',
    padding: 14,
    shadowColor: '#000000',
    shadowOffset: { height: 2, width: 0 },
    shadowOpacity: 0.05,
    shadowRadius: 7,
  },
  workerAvatar: {
    alignItems: 'center',
    backgroundColor: '#d6e3ff',
    borderRadius: 999,
    height: 40,
    justifyContent: 'center',
    width: 40,
  },
  workerAvatarText: {
    color: '#001b3d',
    fontSize: 12,
    fontWeight: '800',
    lineHeight: 16,
  },
  workerCopy: {
    flex: 1,
    minWidth: 0,
  },
  workerName: {
    color: colors.text,
    fontSize: 13,
    fontWeight: '700',
    lineHeight: 18,
  },
  workerMeta: {
    color: colors.textSubtle,
    fontSize: 11,
    fontWeight: '500',
    lineHeight: 14,
  },
  statusPill: {
    alignItems: 'center',
    borderRadius: 999,
    flexDirection: 'row',
    gap: 5,
    paddingHorizontal: 9,
    paddingVertical: 5,
  },
  safePill: {
    backgroundColor: 'rgba(22, 163, 74, 0.1)',
  },
  unsafePill: {
    backgroundColor: 'rgba(186, 26, 26, 0.1)',
  },
  statusPillText: {
    fontSize: 11,
    fontWeight: '800',
    lineHeight: 14,
  },
  unsafeWorkerCard: {
    backgroundColor: colors.surface,
    borderRadius: 12,
    padding: 16,
    shadowColor: '#000000',
    shadowOffset: { height: 5, width: 0 },
    shadowOpacity: 0.09,
    shadowRadius: 11,
  },
  unsafeWorkerHeader: {
    alignItems: 'center',
    flexDirection: 'row',
    justifyContent: 'space-between',
    marginBottom: 12,
  },
  workerIdentity: {
    alignItems: 'center',
    flex: 1,
    flexDirection: 'row',
    gap: 12,
    minWidth: 0,
  },
  workerAvatarWarning: {
    alignItems: 'center',
    backgroundColor: colors.warningContainer,
    borderRadius: 999,
    height: 40,
    justifyContent: 'center',
    width: 40,
  },
  workerAvatarWarningText: {
    color: '#331200',
    fontSize: 12,
    fontWeight: '800',
    lineHeight: 16,
  },
  workerIssue: {
    color: colors.error,
    fontSize: 11,
    fontWeight: '700',
    lineHeight: 14,
  },
  photoGrid: {
    flexDirection: 'row',
    gap: 8,
    marginBottom: 14,
  },
  photoBox: {
    aspectRatio: 1,
    backgroundColor: colors.surfaceContainer,
    borderRadius: 8,
    flex: 1,
    overflow: 'hidden',
  },
  photoBoxFlagged: {
    borderColor: 'rgba(186, 26, 26, 0.42)',
    borderWidth: 2,
  },
  fullImage: {
    height: '100%',
    width: '100%',
  },
  imageShade: {
    backgroundColor: 'rgba(0, 0, 0, 0.14)',
    bottom: 0,
    left: 0,
    position: 'absolute',
    right: 0,
    top: 0,
  },
  flagShade: {
    backgroundColor: 'rgba(186, 26, 26, 0.22)',
  },
  photoBadge: {
    backgroundColor: 'rgba(0, 0, 0, 0.56)',
    borderRadius: 4,
    color: colors.white,
    fontSize: 11,
    fontWeight: '700',
    left: 8,
    lineHeight: 14,
    overflow: 'hidden',
    paddingHorizontal: 7,
    paddingVertical: 3,
    position: 'absolute',
    top: 8,
  },
  photoBadgeFlagged: {
    backgroundColor: colors.error,
  },
  zoomButton: {
    alignItems: 'center',
    backgroundColor: 'rgba(0, 0, 0, 0.5)',
    borderRadius: 999,
    bottom: 8,
    height: 28,
    justifyContent: 'center',
    position: 'absolute',
    right: 8,
    width: 28,
  },
  inspectBadge: {
    alignItems: 'center',
    bottom: 9,
    flexDirection: 'row',
    gap: 4,
    left: 8,
    position: 'absolute',
  },
  inspectText: {
    color: colors.white,
    fontSize: 11,
    fontWeight: '700',
    lineHeight: 14,
  },
  reviewerNote: {
    backgroundColor: colors.surfaceContainerLow,
    borderRadius: 8,
    gap: 6,
    padding: 12,
  },
  reviewerNoteTitleRow: {
    alignItems: 'center',
    flexDirection: 'row',
    gap: 6,
  },
  reviewerNoteTitle: {
    color: colors.warning,
    fontSize: 11,
    fontWeight: '800',
    lineHeight: 14,
  },
  reviewerNoteText: {
    color: colors.textMuted,
    fontSize: 14,
    lineHeight: 20,
  },
  noteTags: {
    color: colors.textSubtle,
    fontSize: 11,
    fontWeight: '600',
    lineHeight: 14,
  },
  evidenceHeader: {
    alignItems: 'flex-start',
    flexDirection: 'row',
    gap: 10,
    justifyContent: 'space-between',
    marginBottom: 12,
  },
  needsAttentionChip: {
    backgroundColor: colors.warningContainer,
    borderRadius: 999,
    color: '#331200',
    fontSize: 11,
    fontWeight: '800',
    lineHeight: 14,
    overflow: 'hidden',
    paddingHorizontal: 8,
    paddingVertical: 3,
  },
  evidenceGrid: {
    flexDirection: 'row',
    gap: 10,
    marginBottom: 12,
  },
  evidencePhoto: {
    aspectRatio: 1.56,
    backgroundColor: colors.surfaceContainer,
    borderRadius: 8,
    flex: 1,
    overflow: 'hidden',
  },
  evidenceLabel: {
    alignItems: 'center',
    bottom: 8,
    flexDirection: 'row',
    gap: 5,
    left: 8,
    position: 'absolute',
  },
  evidenceLabelText: {
    color: colors.white,
    fontSize: 11,
    fontWeight: '700',
    lineHeight: 14,
  },
  missingEvidence: {
    alignItems: 'center',
    aspectRatio: 1.56,
    backgroundColor: colors.surfaceContainerLow,
    borderRadius: 8,
    flex: 1,
    justifyContent: 'center',
    padding: 10,
  },
  missingIcon: {
    alignItems: 'center',
    backgroundColor: colors.warningContainer,
    borderRadius: 999,
    height: 30,
    justifyContent: 'center',
    marginBottom: 5,
    width: 30,
  },
  missingTitle: {
    color: colors.text,
    fontSize: 11,
    fontWeight: '800',
    lineHeight: 14,
    textAlign: 'center',
  },
  missingText: {
    color: colors.warning,
    fontSize: 11,
    fontWeight: '700',
    lineHeight: 14,
    textAlign: 'center',
  },
  infoCallout: {
    alignItems: 'flex-start',
    backgroundColor: 'rgba(255, 219, 202, 0.42)',
    borderRadius: 8,
    flexDirection: 'row',
    gap: 8,
    padding: 10,
  },
  infoText: {
    color: colors.textMuted,
    flex: 1,
    fontSize: 11,
    fontWeight: '600',
    lineHeight: 16,
  },
  decisionCard: {
    backgroundColor: colors.surfaceContainerLow,
    borderRadius: 12,
    padding: 16,
  },
  decisionLabel: {
    color: colors.textSubtle,
    fontSize: 11,
    fontWeight: '800',
    lineHeight: 14,
    textTransform: 'uppercase',
  },
  decisionQuote: {
    borderLeftColor: colors.primary,
    borderLeftWidth: 2,
    color: colors.text,
    fontSize: 14,
    fontStyle: 'italic',
    lineHeight: 20,
    marginBottom: 12,
    marginTop: 6,
    paddingLeft: 10,
  },
  reviewerRow: {
    alignItems: 'center',
    borderTopColor: colors.surfaceContainer,
    borderTopWidth: 1,
    flexDirection: 'row',
    gap: 10,
    paddingTop: 10,
  },
  reviewerAvatar: {
    alignItems: 'center',
    backgroundColor: '#d5e3ff',
    borderRadius: 999,
    height: 30,
    justifyContent: 'center',
    width: 30,
  },
  reviewerInitials: {
    color: '#001c3b',
    fontSize: 11,
    fontWeight: '900',
    lineHeight: 14,
  },
  reviewerCopy: {
    flex: 1,
    minWidth: 0,
  },
  reviewerName: {
    color: colors.text,
    fontSize: 12,
    fontWeight: '800',
    lineHeight: 16,
  },
  reviewerRole: {
    color: colors.textMuted,
    fontSize: 11,
    fontWeight: '500',
    lineHeight: 14,
  },
  reviewerTime: {
    color: colors.textSubtle,
    fontSize: 11,
    fontWeight: '500',
    lineHeight: 14,
  },
  actionBar: {
    backgroundColor: 'rgba(255, 255, 255, 0.96)',
    borderTopColor: 'rgba(192, 199, 213, 0.46)',
    borderTopWidth: 1,
    bottom: 0,
    gap: 6,
    left: 0,
    paddingBottom: 14,
    paddingHorizontal: 20,
    paddingTop: 12,
    position: 'absolute',
    right: 0,
    shadowColor: '#000000',
    shadowOffset: { height: -3, width: 0 },
    shadowOpacity: 0.08,
    shadowRadius: 10,
  },
  primaryButton: {
    alignItems: 'center',
    backgroundColor: colors.primary,
    borderRadius: 12,
    flexDirection: 'row',
    gap: 8,
    justifyContent: 'center',
    minHeight: 48,
    paddingHorizontal: 20,
  },
  primaryButtonText: {
    color: colors.white,
    fontSize: 13,
    fontWeight: '800',
    lineHeight: 18,
  },
  secondaryButton: {
    alignItems: 'center',
    minHeight: 28,
    justifyContent: 'center',
  },
  secondaryButtonText: {
    color: colors.primary,
    fontSize: 11,
    fontWeight: '700',
    lineHeight: 14,
  },
  pressed: {
    opacity: 0.76,
    transform: [{ scale: 0.98 }],
  },
  textPressed: {
    opacity: 0.62,
  },
});
