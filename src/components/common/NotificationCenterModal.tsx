import React from 'react';
import {
  Modal,
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
  useNotifications,
} from '@/services/notifications/notification.service';
import { hapticLight, hapticSelection } from '@/utils/haptics';

interface NotificationCenterModalProps {
  visible: boolean;
  onClose: () => void;
  role?: 'vendor' | 'reviewer';
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
}: NotificationCenterModalProps) {
  const navigate = useNavigate();
  const { language } = useLanguage();
  const isBn = language === 'bn';
  const { notifications, unreadCount, markAsRead, markAllAsRead, clearAll } =
    useNotifications(role);

  function handleNotificationPress(item: AppNotification) {
    hapticSelection();
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
    void markAllAsRead();
  }

  function handleClearAll() {
    hapticLight();
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
              onPress={onClose}
              style={({ pressed }) => [styles.closeBtn, pressed && styles.pressedOpacity]}>
              <Icon
                color="#717785"
                name={{ ios: 'xmark', android: 'close', web: 'close' }}
                size={22}
              />
            </Pressable>
          </View>

          {/* Action Bar (Mark All as Read & Clear All) */}
          {notifications.length > 0 && (
            <View style={styles.actionBar}>
              <Text style={styles.subtext}>
                {isBn
                  ? `সর্বমোট ${notifications.length}টি বিজ্ঞপ্তি`
                  : `All notifications (${notifications.length})`}
              </Text>
              <View style={{ flexDirection: 'row', alignItems: 'center', gap: 12 }}>
                {unreadCount > 0 && (
                  <Pressable
                    accessibilityRole="button"
                    onPress={handleMarkAllRead}
                    style={({ pressed }) => [styles.actionBtn, pressed && styles.pressedOpacity]}>
                    <Icon
                      color="#005cad"
                      name={{ ios: 'checkmark.circle', android: 'done_all', web: 'done_all' }}
                      size={16}
                    />
                    <Text style={styles.actionBtnText}>
                      {isBn ? 'সব পড়া হয়েছে' : 'Mark all read'}
                    </Text>
                  </Pressable>
                )}
                <Pressable
                  accessibilityRole="button"
                  onPress={handleClearAll}
                  style={({ pressed }) => [styles.actionBtn, pressed && styles.pressedOpacity]}>
                  <Icon
                    color="#ba1a1a"
                    name={{ ios: 'trash', android: 'delete', web: 'delete' }}
                    size={16}
                  />
                  <Text style={[styles.actionBtnText, { color: '#ba1a1a' }]}>
                    {isBn ? 'সব মুছে ফেলুন' : 'Clear all'}
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
            {notifications.length === 0 ? (
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
              notifications.map((item) => {
                const isUnread = !item.read;
                const isSafe = item.type === 'REVIEW_SAFE';
                const isUnsafe = item.type === 'REVIEW_UNSAFE';
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

                      {item.siteName && (
                        <View style={styles.siteBadge}>
                          <Icon
                            color="#555f71"
                            name={{ ios: 'mappin', android: 'place', web: 'place' }}
                            size={12}
                          />
                          <Text style={styles.siteBadgeText}>{item.siteName}</Text>
                        </View>
                      )}
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
  },
  actionBar: {
    alignItems: 'center',
    backgroundColor: '#f8f9fc',
    borderBottomColor: '#edf0f7',
    borderBottomWidth: 1,
    flexDirection: 'row',
    justifyContent: 'space-between',
    paddingHorizontal: 20,
    paddingVertical: 10,
  },
  subtext: {
    color: '#717785',
    fontSize: 12,
    fontWeight: '500',
  },
  actionBtn: {
    alignItems: 'center',
    flexDirection: 'row',
    gap: 6,
    paddingHorizontal: 8,
    paddingVertical: 4,
  },
  actionBtnText: {
    color: '#005cad',
    fontSize: 13,
    fontWeight: '600',
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
