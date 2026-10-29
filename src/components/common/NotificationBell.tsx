import React, { useState } from 'react';
import { Pressable, StyleSheet, Text, View } from 'react-native';
import { Icon } from '@/components/ui/Icon';
import { useNotifications } from '@/services/notifications/notification.service';
import { useReviews } from '@/features/reviews/services/reviews.service';
import { hapticSelection } from '@/utils/haptics';
import { NotificationCenterModal } from './NotificationCenterModal';

interface NotificationBellProps {
  role: 'vendor' | 'reviewer';
  color?: string;
  size?: number;
}

export function NotificationBell({
  role,
  color = '#404753',
  size = 22,
}: NotificationBellProps) {
  const { unreadCount, preferences } = useNotifications(role);
  const { pendingReviews } = useReviews(role === 'reviewer');
  const [modalVisible, setModalVisible] = useState(false);

  // If newSubmissions toggle is off for reviewer, suppress the notification count/badge
  const reviewerCount = preferences.newSubmissions ? pendingReviews.length : 0;
  const displayCount = role === 'reviewer' ? reviewerCount : unreadCount;

  function handlePress() {
    hapticSelection();
    setModalVisible(true);
  }

  return (
    <>
      <Pressable
        accessibilityLabel={`Notifications, ${displayCount} unread`}
        accessibilityRole="button"
        onPress={handlePress}
        style={({ pressed }) => [styles.container, pressed && styles.pressed]}>
        <View style={styles.iconWrapper}>
          <Icon
            color={displayCount > 0 ? '#181c22' : color}
            name={{ ios: 'bell.fill', android: 'notifications', web: 'notifications' }}
            size={size}
          />
          {displayCount > 0 && (
            <View style={styles.redBadge}>
              <Text numberOfLines={1} style={styles.badgeText}>
                {displayCount > 9 ? '9+' : displayCount}
              </Text>
            </View>
          )}
        </View>
      </Pressable>

      <NotificationCenterModal
        onClose={() => setModalVisible(false)}
        role={role}
        visible={modalVisible}
      />
    </>
  );
}

const styles = StyleSheet.create({
  container: {
    alignItems: 'center',
    height: 40,
    justifyContent: 'center',
    width: 40,
  },
  pressed: {
    opacity: 0.7,
    transform: [{ scale: 0.94 }],
  },
  iconWrapper: {
    alignItems: 'center',
    height: 32,
    justifyContent: 'center',
    position: 'relative',
    width: 32,
  },
  redBadge: {
    alignItems: 'center',
    backgroundColor: '#DC2626', // Vibrant Red
    borderColor: '#FFFFFF',
    borderRadius: 9,
    borderWidth: 1.5,
    height: 18,
    justifyContent: 'center',
    minWidth: 18,
    paddingHorizontal: 4,
    position: 'absolute',
    right: -4,
    top: -2,
    zIndex: 10,
    // Soft shadow for depth
    elevation: 3,
    shadowColor: '#DC2626',
    shadowOffset: { width: 0, height: 1 },
    shadowOpacity: 0.35,
    shadowRadius: 2,
  },
  badgeText: {
    color: '#FFFFFF',
    fontSize: 10,
    fontWeight: '700',
    includeFontPadding: false,
    lineHeight: 12,
    textAlign: 'center',
  },
});
