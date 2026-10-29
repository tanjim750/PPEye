import React, { useEffect, useState } from 'react';
import { Platform, Pressable, StyleSheet, Text, View } from 'react-native';
import { Icon } from '@/components/ui/Icon';
import {
  subscribeNotifications,
  useNotifications,
} from '@/services/notifications/notification.service';
import { useAuth } from '@/hooks/useAuth';
import { authStore } from '@/stores/auth.store';
import { hapticSelection } from '@/utils/haptics';
import { NotificationCenterModal } from './NotificationCenterModal';

interface NotificationBellProps {
  role: 'vendor' | 'reviewer';
  color?: string;
  size?: number;
}

export function NotificationBell({
  role,
  color = '#717785',
  size = 22,
}: NotificationBellProps) {
  const [, setTick] = useState(0);
  const { user } = useAuth();
  const activeUser = user || authStore.user;
  const vendorFilter =
    role === 'vendor'
      ? {
          vendorProfileId: activeUser?.vendorProfileId,
          vendorName: activeUser?.vendorName || activeUser?.projectName,
        }
      : undefined;

  // Directly subscribe to notification bus for instant re-render across any screen/modal event
  useEffect(() => {
    const unsubscribe = subscribeNotifications(() => {
      setTick((prev) => prev + 1);
    });
    return unsubscribe;
  }, []);

  const { unreadCount } = useNotifications(role, vendorFilter);
  const [modalVisible, setModalVisible] = useState(false);

  // The bell badge reflects actual unread notifications in real-time
  const displayCount = unreadCount;
  const isUnread = displayCount > 0;

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
        {...(Platform.OS === 'web' ? ({ onClick: handlePress, cursor: 'pointer' } as any) : {})}
        style={({ pressed }) => [styles.container, pressed && styles.pressed]}>
        <View style={styles.iconWrapper}>
          <Icon
            color={isUnread ? '#005cad' : color}
            name={
              isUnread
                ? { ios: 'bell.fill', android: 'notifications', web: 'notifications' }
                : { ios: 'bell', android: 'notifications_none', web: 'notifications_none' }
            }
            size={size}
          />
          {isUnread && (
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
        vendorFilter={vendorFilter}
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
    ...(Platform.OS === 'web' ? ({ cursor: 'pointer' } as any) : {}),
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
