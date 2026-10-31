import React, { useEffect, useState } from 'react';
import {
  Modal,
  Platform,
  Pressable,
  ScrollView,
  StyleSheet,
  Text,
  View,
} from 'react-native';
import { SafeAreaView } from 'react-native-safe-area-context';
import { Icon } from '@/components/ui/Icon';
import { useNavigate } from '@/hooks/useNavigate';
import { useLanguage } from '@/hooks/useLanguage';
import {
  AppNotification,
  getNotifications,
  subscribeNotifications,
  useNotifications,
  VendorFilter,
} from '@/services/notifications/notification.service';
import { hapticLight, hapticSelection } from '@/utils/haptics';

interface NotificationCenterModalProps {
  visible: boolean;
  onClose: () => void;
  role?: 'vendor' | 'reviewer';
  vendorFilter?: VendorFilter;
}

function formatRelativeTime(ts: number, isBn: boolean): string {
  const diffSec = Math.max(0, Math.floor((Date.now() - ts) / 1000));
  if (diffSec < 60) {
    return isBn ? 'এখনই' : 'Just now';
  }
  const diffMin = Math.floor(diffSec / 60);
  if (diffMin < 60) {
    return isBn ? `${diffMin} মিনিট আগে` : `${diffMin}m ago`;
  }
  const diffHours = Math.floor(diffMin / 60);
  if (diffHours < 24) {
    return isBn ? `${diffHours} ঘণ্টা আগে` : `${diffHours}h ago`;
  }
  const diffDays = Math.floor(diffHours / 24);
  if (diffDays < 7) {
    return isBn ? `${diffDays} দিন আগে` : `${diffDays}d ago`;
  }
  const date = new Date(ts);
  return date.toLocaleDateString(isBn ? 'bn-BD' : 'en-US', {
    month: 'short',
    day: 'numeric',
  });
}

export function NotificationCenterModal({
  visible,
  onClose,
  role,
  vendorFilter,
}: NotificationCenterModalProps) {
  const navigate = useNavigate();
  const { language } = useLanguage();
  const isBn = language === 'bn';
  const { markAsRead, markAllAsRead, clearAll } = useNotifications(role, vendorFilter);

  // Maintain local reactive items state so bottom sheet reflects actions with 0ms latency
  const [items, setItems] = useState<AppNotification[]>(() => getNotifications(role, vendorFilter));

  // Sync state whenever modal opens or filter props change
  useEffect(() => {
    if (visible) {
      setItems(getNotifications(role, vendorFilter));
    }
  }, [visible, role, vendorFilter?.vendorName, vendorFilter?.vendorProfileId]);

  // Subscribe to notification event bus for real-time reactivity
  useEffect(() => {
    const unsubscribe = subscribeNotifications(() => {
      setItems(getNotifications(role, vendorFilter));
    });
    return unsubscribe;
  }, [role, vendorFilter?.vendorName, vendorFilter?.vendorProfileId]);

  const unreadCount = items.filter((n) => !n.read).length;

  function handleNotificationPress(item: AppNotification) {
    hapticSelection();
    setItems((prev) => prev.map((n) => (n.id === item.id ? { ...n, read: true } : n)));
    void markAsRead(item.id);
    onClose();

    if (item.recipientRole === 'reviewer') {
      if (item.submissionId) {
        navigate(`/review/${item.submissionId}`);
      } else {
        navigate('/reviews');
      }
    } else {
      // Vendor
      const isUnsafe = item.type === 'REVIEW_UNSAFE';
      const isSafe = item.type === 'REVIEW_SAFE';
      const filter = isUnsafe ? 'unsafe' : isSafe ? 'all' : 'pending';
      const subIdQuery = item.submissionId ? `&submissionId=${item.submissionId}` : '';
      navigate(`/history?filter=${filter}${subIdQuery}`);
    }
  }

  function handleMarkAllRead() {
    hapticLight();
    setItems((prev) => prev.map((n) => ({ ...n, read: true })));
    void markAllAsRead();
  }

  function handleClearAll() {
    hapticLight();
    setItems([]);
    void clearAll();
  }

  return (
    <Modal
      animationType="slide"
      onRequestClose={onClose}
      transparent
      visible={visible}>
      <View style={styles.backdrop}>
        <SafeAreaView style={styles.sheetContainer}>
          {/* Header */}
          <View style={styles.header}>
            <View style={styles.titleRow}>
              <View style={styles.headerIconCircle}>
                <Icon
                  color="#005cad"
                  name={{ ios: 'bell.fill', android: 'notifications', web: 'notifications' }}
                  size={20}
                />
              </View>
              <Text style={styles.headerTitle}>
                {isBn ? 'বিজ্ঞপ্তি ও নোটিফিকেশন' : 'Notifications'}
              </Text>
              {unreadCount > 0 && (
                <View style={styles.unreadPill}>
                  <Text style={styles.unreadPillText}>
                    {unreadCount} {isBn ? 'নতুন' : 'new'}
                  </Text>
                </View>
              )}
            </View>

            <Pressable
              accessibilityLabel="Close notifications"
              accessibilityRole="button"
              hitSlop={{ top: 8, bottom: 8, left: 8, right: 8 }}
              onPress={onClose}
              {...(Platform.OS === 'web' ? ({ onClick: onClose, cursor: 'pointer' } as any) : {})}
              style={({ pressed }) => [styles.closeBtn, pressed && styles.pressedOpacity]}>
              <Icon
                color="#717785"
                name={{ ios: 'xmark', android: 'close', web: 'close' }}
                size={22}
              />
            </Pressable>
          </View>

          {/* Action Bar (Mark All as Read & Clear All) */}
          {items.length > 0 && (
            <View style={styles.actionBar}>
              <View style={styles.actionBarLeft}>
                <Text style={styles.subtext}>
                  {isBn
                    ? `সর্বমোট ${items.length}টি বিজ্ঞপ্তি`
                    : `All notifications (${items.length})`}
                </Text>
              </View>

              <View style={styles.actionButtonsGroup}>
                <Pressable
                  accessibilityRole="button"
                  accessibilityState={{ disabled: unreadCount === 0 }}
                  disabled={unreadCount === 0}
                  hitSlop={{ top: 6, bottom: 6, left: 6, right: 6 }}
                  onPress={handleMarkAllRead}
                  {...(Platform.OS === 'web' && unreadCount > 0
                    ? ({ onClick: handleMarkAllRead } as any)
                    : {})}
                  style={({ pressed }) => [
                    styles.actionBtn,
                    unreadCount > 0 ? styles.actionBtnPrimary : styles.actionBtnDisabled,
                    pressed && unreadCount > 0 && styles.pressedOpacity,
                  ]}>
                  <Icon
                    color={unreadCount > 0 ? '#005cad' : '#94a3b8'}
                    name={{ ios: 'checkmark.circle', android: 'done_all', web: 'done_all' }}
                    size={14}
                  />
                  <Text
                    style={[
                      styles.actionBtnText,
                      unreadCount > 0 ? styles.actionBtnPrimaryText : styles.actionBtnDisabledText,
                    ]}>
                    {unreadCount > 0
                      ? (isBn ? 'সব পড়া হয়েছে' : 'Mark all read')
                      : (isBn ? 'সব পড়া সম্পন্ন' : 'All read')}
                  </Text>
                </Pressable>

                <Pressable
                  accessibilityRole="button"
                  hitSlop={{ top: 6, bottom: 6, left: 6, right: 6 }}
                  onPress={handleClearAll}
                  {...(Platform.OS === 'web' ? ({ onClick: handleClearAll } as any) : {})}
                  style={({ pressed }) => [
                    styles.actionBtn,
                    styles.actionBtnDanger,
                    pressed && styles.pressedOpacity,
                  ]}>
                  <Icon
                    color="#ba1a1a"
                    name={{ ios: 'trash', android: 'delete', web: 'delete' }}
                    size={14}
                  />
                  <Text style={[styles.actionBtnText, styles.actionBtnDangerText]}>
                    {isBn ? 'সব মুছুন' : 'Clear all'}
                  </Text>
                </Pressable>
              </View>
            </View>
          )}

          {/* List of Notifications */}
          <ScrollView
            contentContainerStyle={styles.listContent}
            showsVerticalScrollIndicator={false}
            style={styles.scroll}>
            {items.length === 0 ? (
              <View style={styles.emptyContainer}>
                <View style={styles.emptyIconCircle}>
                  <Icon
                    color="#a0aab8"
                    name={{ ios: 'bell.slash', android: 'notifications_off', web: 'notifications_off' }}
                    size={36}
                  />
                </View>
                <Text style={styles.emptyTitle}>
                  {isBn ? 'কোনো নোটিফিকেশন নেই' : 'No notifications'}
                </Text>
                <Text style={styles.emptySubtitle}>
                  {isBn
                    ? 'নতুন কোনো সাবমিশন বা পিপিই রিভিউ সম্পন্ন হলে এখানে দেখতে পাবেন।'
                    : 'When new submissions or reviews occur, they will appear here in real time.'}
                </Text>
              </View>
            ) : (
              items.map((item) => {
                const isUnread = !item.read;
                const isSafe = item.verdict === 'safe' || item.type === 'REVIEW_SAFE';
                const isUnsafe = item.verdict === 'unsafe' || item.type === 'REVIEW_UNSAFE';
                const isNew = item.type === 'NEW_SUBMISSION';

                // Standard Color Rules: Safe = Green (#16A34A), Unsafe = Red (#ba1a1a / #dc2626), Pending/New = Yellow (#CA8A04)
                const iconColor = isSafe
                  ? '#16a34a'
                  : isUnsafe
                    ? '#dc2626'
                    : '#ca8a04';
                const iconBg = isSafe
                  ? 'rgba(22, 163, 74, 0.12)'
                  : isUnsafe
                    ? 'rgba(220, 38, 38, 0.12)'
                    : 'rgba(202, 138, 4, 0.12)';

                const iconName = isSafe
                  ? { ios: 'checkmark.seal.fill', android: 'check_circle', web: 'check_circle' }
                  : isUnsafe
                    ? { ios: 'exclamationmark.triangle.fill', android: 'warning', web: 'warning' }
                    : { ios: 'clock.fill', android: 'schedule', web: 'schedule' };

                return (
                  <Pressable
                    key={item.id}
                    accessibilityRole="button"
                    onPress={() => handleNotificationPress(item)}
                    {...(Platform.OS === 'web'
                      ? ({ onClick: () => handleNotificationPress(item) } as any)
                      : {})}
                    style={({ pressed }) => [
                      styles.itemCard,
                      isUnread && styles.itemCardUnread,
                      pressed && styles.pressedOpacity,
                    ]}>
                    {/* Red Indicator Dot for unread */}
                    {isUnread && <View style={styles.redDot} />}

                    {/* Category Icon */}
                    <View style={[styles.itemIconCircle, { backgroundColor: iconBg }]}>
                      <Icon color={iconColor} name={iconName as any} size={20} />
                    </View>

                    {/* Content */}
                    <View style={styles.itemContent}>
                      <View style={styles.itemHeaderRow}>
                        <Text
                          numberOfLines={1}
                          style={[styles.itemTitle, isUnread && styles.itemTitleUnread]}>
                          {isBn && item.titleBn ? item.titleBn : item.title}
                        </Text>
                        <Text style={styles.itemTime}>
                          {formatRelativeTime(item.createdAt, isBn)}
                        </Text>
                      </View>

                      <Text numberOfLines={2} style={styles.itemBody}>
                        {isBn && item.bodyBn ? item.bodyBn : item.body}
                      </Text>

                      {/* Badges Row: Site, Verdict Pill (Safe/Unsafe), Worker */}
                      <View style={styles.badgeRow}>
                        {item.siteName && (
                          <View style={styles.siteBadge}>
                            <Icon
                              color="#555f71"
                              name={{ ios: 'mappin', android: 'place', web: 'place' }}
                              size={11}
                            />
                            <Text style={styles.siteBadgeText}>{item.siteName}</Text>
                          </View>
                        )}
                        {isSafe && (
                          <View style={styles.safeBadge}>
                            <Icon
                              color="#16a34a"
                              name={{ ios: 'checkmark.seal.fill', android: 'check_circle', web: 'check_circle' }}
                              size={11}
                            />
                            <Text style={styles.safeBadgeText}>
                              {isBn ? 'নিরাপদ' : 'Safe'}
                            </Text>
                          </View>
                        )}
                        {isUnsafe && (
                          <View style={styles.unsafeBadge}>
                            <Icon
                              color="#dc2626"
                              name={{ ios: 'exclamationmark.triangle.fill', android: 'warning', web: 'warning' }}
                              size={11}
                            />
                            <Text style={styles.unsafeBadgeText}>
                              {isBn ? 'অনিরাপদ' : 'Unsafe'}
                            </Text>
                          </View>
                        )}
                        {item.workerSummary && (
                          <View style={styles.workerBadge}>
                            <Text numberOfLines={1} style={styles.workerBadgeText}>
                              {item.workerSummary}
                            </Text>
                          </View>
                        )}
                      </View>
                    </View>
                  </Pressable>
                );
              })
            )}
          </ScrollView>
        </SafeAreaView>
      </View>
    </Modal>
  );
}

const styles = StyleSheet.create({
  backdrop: {
    backgroundColor: 'rgba(0, 0, 0, 0.45)',
    flex: 1,
    justifyContent: 'flex-end',
  },
  sheetContainer: {
    backgroundColor: '#FFFFFF',
    borderTopLeftRadius: 24,
    borderTopRightRadius: 24,
    maxHeight: '85%',
    minHeight: '45%',
    maxWidth: 448,
    width: '100%',
    alignSelf: 'center',
    shadowColor: '#000',
    shadowOffset: { width: 0, height: -4 },
    shadowOpacity: 0.15,
    shadowRadius: 12,
  },
  header: {
    alignItems: 'center',
    borderBottomColor: '#edf0f7',
    borderBottomWidth: 1,
    flexDirection: 'row',
    justifyContent: 'space-between',
    paddingHorizontal: 20,
    paddingVertical: 16,
  },
  titleRow: {
    alignItems: 'center',
    flexDirection: 'row',
    gap: 10,
  },
  headerIconCircle: {
    alignItems: 'center',
    backgroundColor: '#e0f0ff',
    borderRadius: 18,
    height: 36,
    justifyContent: 'center',
    width: 36,
  },
  headerTitle: {
    color: '#181c22',
    fontSize: 18,
    fontWeight: '700',
  },
  unreadPill: {
    backgroundColor: '#DC2626', // Red
    borderRadius: 12,
    paddingHorizontal: 8,
    paddingVertical: 2,
  },
  unreadPillText: {
    color: '#FFFFFF',
    fontSize: 11,
    fontWeight: '700',
  },
  closeBtn: {
    alignItems: 'center',
    backgroundColor: '#f1f3f9',
    borderRadius: 16,
    height: 32,
    justifyContent: 'center',
    width: 32,
    ...(Platform.OS === 'web' ? ({ cursor: 'pointer' } as any) : {}),
  },
  actionBar: {
    alignItems: 'center',
    backgroundColor: '#f8fafc',
    borderBottomColor: '#edf2f7',
    borderBottomWidth: 1,
    flexDirection: 'row',
    justifyContent: 'space-between',
    paddingHorizontal: 16,
    paddingVertical: 10,
  },
  actionBarLeft: {
    alignItems: 'center',
    flexDirection: 'row',
  },
  subtext: {
    color: '#64748b',
    fontSize: 12,
    fontWeight: '600',
  },
  actionButtonsGroup: {
    alignItems: 'center',
    flexDirection: 'row',
    gap: 8,
  },
  actionBtn: {
    alignItems: 'center',
    borderRadius: 8,
    borderWidth: 1,
    flexDirection: 'row',
    gap: 5,
    paddingHorizontal: 9,
    paddingVertical: 5,
    ...(Platform.OS === 'web' ? ({ cursor: 'pointer' } as any) : {}),
  },
  actionBtnPrimary: {
    backgroundColor: '#eff6ff',
    borderColor: '#bfdbfe',
  },
  actionBtnPrimaryText: {
    color: '#005cad',
    fontSize: 12,
    fontWeight: '600',
  },
  actionBtnDisabled: {
    backgroundColor: '#f8fafc',
    borderColor: '#e2e8f0',
    opacity: 0.7,
    ...(Platform.OS === 'web' ? ({ cursor: 'default' } as any) : {}),
  },
  actionBtnDisabledText: {
    color: '#94a3b8',
    fontSize: 12,
    fontWeight: '500',
  },
  actionBtnDanger: {
    backgroundColor: '#fef2f2',
    borderColor: '#fecaca',
  },
  actionBtnDangerText: {
    color: '#dc2626',
    fontSize: 12,
    fontWeight: '600',
  },
  actionBtnText: {
    fontSize: 12,
  },
  scroll: {
    flex: 1,
  },
  listContent: {
    paddingBottom: 24,
    paddingHorizontal: 16,
    paddingTop: 12,
  },
  itemCard: {
    alignItems: 'flex-start',
    backgroundColor: '#FFFFFF',
    borderColor: '#e8edf5',
    borderRadius: 14,
    borderWidth: 1,
    flexDirection: 'row',
    gap: 12,
    marginBottom: 10,
    padding: 14,
    position: 'relative',
    ...(Platform.OS === 'web' ? ({ cursor: 'pointer' } as any) : {}),
  },
  itemCardUnread: {
    backgroundColor: '#fef7f7', // Subtle soft red highlight
    borderColor: '#fecaca',
  },
  redDot: {
    backgroundColor: '#DC2626', // Vibrant Red dot
    borderRadius: 4,
    height: 8,
    left: 8,
    position: 'absolute',
    top: 8,
    width: 8,
  },
  itemIconCircle: {
    alignItems: 'center',
    borderRadius: 20,
    height: 40,
    justifyContent: 'center',
    marginTop: 2,
    width: 40,
  },
  itemContent: {
    flex: 1,
  },
  itemHeaderRow: {
    alignItems: 'center',
    flexDirection: 'row',
    justifyContent: 'space-between',
    marginBottom: 4,
  },
  itemTitle: {
    color: '#181c22',
    flex: 1,
    fontSize: 15,
    fontWeight: '600',
    marginRight: 8,
  },
  itemTitleUnread: {
    color: '#991b1b', // Deeper red title for unread
    fontWeight: '700',
  },
  itemTime: {
    color: '#717785',
    fontSize: 11,
    fontWeight: '500',
  },
  itemBody: {
    color: '#404753',
    fontSize: 13,
    lineHeight: 18,
    marginBottom: 6,
  },
  siteBadge: {
    alignItems: 'center',
    alignSelf: 'flex-start',
    backgroundColor: '#eef2f8',
    borderRadius: 6,
    flexDirection: 'row',
    gap: 4,
    paddingHorizontal: 6,
    paddingVertical: 2,
  },
  siteBadgeText: {
    color: '#404753',
    fontSize: 11,
    fontWeight: '600',
  },
  badgeRow: {
    alignItems: 'center',
    flexDirection: 'row',
    flexWrap: 'wrap',
    gap: 6,
    marginTop: 4,
  },
  safeBadge: {
    alignItems: 'center',
    backgroundColor: '#dcfce7',
    borderColor: '#bbf7d0',
    borderRadius: 6,
    borderWidth: 1,
    flexDirection: 'row',
    gap: 3,
    paddingHorizontal: 6,
    paddingVertical: 2,
  },
  safeBadgeText: {
    color: '#15803d',
    fontSize: 11,
    fontWeight: '700',
  },
  unsafeBadge: {
    alignItems: 'center',
    backgroundColor: '#fee2e2',
    borderColor: '#fecaca',
    borderRadius: 6,
    borderWidth: 1,
    flexDirection: 'row',
    gap: 3,
    paddingHorizontal: 6,
    paddingVertical: 2,
  },
  unsafeBadgeText: {
    color: '#b91c1c',
    fontSize: 11,
    fontWeight: '700',
  },
  workerBadge: {
    alignItems: 'center',
    backgroundColor: '#f1f5f9',
    borderColor: '#e2e8f0',
    borderRadius: 6,
    borderWidth: 1,
    paddingHorizontal: 6,
    paddingVertical: 2,
  },
  workerBadgeText: {
    color: '#475569',
    fontSize: 11,
    fontWeight: '600',
  },
  emptyContainer: {
    alignItems: 'center',
    justifyContent: 'center',
    paddingVertical: 48,
  },
  emptyIconCircle: {
    alignItems: 'center',
    backgroundColor: '#f1f3f9',
    borderRadius: 36,
    height: 72,
    justifyContent: 'center',
    marginBottom: 14,
    width: 72,
  },
  emptyTitle: {
    color: '#181c22',
    fontSize: 16,
    fontWeight: '600',
    marginBottom: 6,
  },
  emptySubtitle: {
    color: '#717785',
    fontSize: 13,
    lineHeight: 18,
    paddingHorizontal: 32,
    textAlign: 'center',
  },
  pressedOpacity: {
    opacity: 0.75,
  },
});
