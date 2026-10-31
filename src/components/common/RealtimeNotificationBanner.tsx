import React from 'react';
import { Modal, Platform, Pressable, StyleSheet, Text, View } from 'react-native';
import { SafeAreaView } from 'react-native-safe-area-context';
import { Icon } from '@/components/ui/Icon';
import { useNavigate } from '@/hooks/useNavigate';
import { useLanguage } from '@/hooks/useLanguage';
import { authStore } from '@/stores/auth.store';
import { useAuth } from '@/hooks/useAuth';
import {
  AppNotification,
  useNotifications,
} from '@/services/notifications/notification.service';
import { hapticSelection } from '@/utils/haptics';

interface RealtimeNotificationBannerProps {
  role?: 'vendor' | 'reviewer';
}

export function RealtimeNotificationBanner({
  role: propRole,
}: RealtimeNotificationBannerProps) {
  const navigate = useNavigate();
  const { user } = useAuth();
  const { language } = useLanguage();
  const isBn = language === 'bn';
  const activeUser = user || authStore.user;
  const isInternal =
    activeUser?.category === 'INTERNAL' ||
    activeUser?.role === 'reviewer' ||
    activeUser?.role === 'internal';
  const resolvedRole = propRole || (isInternal ? 'reviewer' : 'vendor');
  const { banner, dismissBanner, markAsRead } = useNotifications(resolvedRole);

  const isVisible = Boolean(banner && banner.recipientRole === resolvedRole);
  if (!isVisible || !banner) return null;

  function handleView() {
    hapticSelection();
    if (banner) {
      void markAsRead(banner.id);
      dismissBanner();
      if (resolvedRole === 'reviewer') {
        if (banner.submissionId) {
          navigate(`/review/${banner.submissionId}`);
        } else {
          navigate('/reviews');
        }
      } else {
        const isUnsafe = banner.type === 'REVIEW_UNSAFE';
        const isSafe = banner.type === 'REVIEW_SAFE';
        const filter = isUnsafe ? 'unsafe' : isSafe ? 'all' : 'pending';
        const subIdQuery = banner.submissionId ? `&submissionId=${banner.submissionId}` : '';
        navigate(`/history?filter=${filter}${subIdQuery}`);
      }
    }
  }

  const isSafe = banner.type === 'REVIEW_SAFE';
  const isUnsafe = banner.type === 'REVIEW_UNSAFE';
  const iconColor = isSafe ? '#16a34a' : isUnsafe ? '#dc2626' : '#ca8a04';
  const iconName = isSafe
    ? { ios: 'checkmark.seal.fill', android: 'check_circle', web: 'check_circle' }
    : isUnsafe
      ? { ios: 'exclamationmark.triangle.fill', android: 'warning', web: 'warning' }
      : { ios: 'clock.fill', android: 'schedule', web: 'schedule' };

  return (
    <View pointerEvents="box-none" style={styles.bannerContainer}>
      <SafeAreaView edges={['top']} pointerEvents="box-none">
        <Pressable
          accessibilityRole="button"
          onPress={handleView}
          {...(Platform.OS === 'web' ? ({ onClick: handleView, cursor: 'pointer' } as any) : {})}
          style={styles.bannerCard}>
          {/* Red / Green Glow Left Strip */}
          <View style={[styles.redStrip, isSafe && styles.greenStrip]} />

          {/* Icon */}
          <View style={[styles.iconCircle, isSafe && styles.greenIconCircle]}>
            <Icon color={iconColor} name={iconName as any} size={20} />
          </View>

          {/* Body Copy */}
          <View style={styles.copyContainer}>
            <View style={styles.topRow}>
              <View style={[styles.redBadge, isSafe && styles.greenBadge]}>
                <Text style={styles.redBadgeText}>{isBn ? 'নতুন' : 'NEW'}</Text>
              </View>
              <Text numberOfLines={1} style={styles.title}>
                {isBn && banner.titleBn ? banner.titleBn : banner.title}
              </Text>
            </View>
            <Text numberOfLines={2} style={styles.body}>
              {isBn && banner.bodyBn ? banner.bodyBn : banner.body}
            </Text>
          </View>

          {/* Action Button */}
          <Pressable
            accessibilityRole="button"
            onPress={handleView}
            {...(Platform.OS === 'web' ? ({ onClick: handleView, cursor: 'pointer' } as any) : {})}
            style={styles.viewBtn}>
            <Text style={styles.viewBtnText}>{isBn ? 'দেখুন' : 'View'}</Text>
          </Pressable>

          {/* Close Button */}
          <Pressable
            accessibilityLabel="Dismiss banner"
            accessibilityRole="button"
            onPress={dismissBanner}
            {...(Platform.OS === 'web' ? ({ onClick: dismissBanner, cursor: 'pointer' } as any) : {})}
            style={styles.closeBtn}>
            <Icon color="#717785" name={{ ios: 'xmark', android: 'close', web: 'close' }} size={16} />
          </Pressable>
        </Pressable>
      </SafeAreaView>
    </View>
  );
}

const styles = StyleSheet.create({
  modalBackdrop: {
    flex: 1,
    pointerEvents: 'box-none',
  },
  bannerContainer: {
    elevation: 9999,
    left: 0,
    pointerEvents: 'box-none',
    position: 'absolute',
    right: 0,
    top: 0,
    zIndex: 99999,
  },
  bannerCard: {
    alignItems: 'center',
    alignSelf: 'center',
    backgroundColor: '#FFFFFF',
    borderColor: '#fed7d7',
    borderRadius: 16,
    borderWidth: 1.5,
    elevation: 8,
    flexDirection: 'row',
    gap: 10,
    marginHorizontal: 16,
    marginTop: 8,
    maxWidth: 448,
    overflow: 'hidden',
    paddingHorizontal: 12,
    paddingVertical: 12,
    shadowColor: '#DC2626',
    shadowOffset: { width: 0, height: 4 },
    shadowOpacity: 0.18,
    shadowRadius: 10,
    width: '92%',
  },
  redStrip: {
    backgroundColor: '#DC2626',
    bottom: 0,
    left: 0,
    position: 'absolute',
    top: 0,
    width: 4,
  },
  greenStrip: {
    backgroundColor: '#16a34a',
  },
  iconCircle: {
    alignItems: 'center',
    backgroundColor: '#fff5f5',
    borderRadius: 18,
    height: 36,
    justifyContent: 'center',
    marginLeft: 4,
    width: 36,
  },
  greenIconCircle: {
    backgroundColor: '#f0fdf4',
  },
  copyContainer: {
    flex: 1,
    justifyContent: 'center',
  },
  topRow: {
    alignItems: 'center',
    flexDirection: 'row',
    gap: 6,
    marginBottom: 2,
  },
  redBadge: {
    backgroundColor: '#DC2626',
    borderRadius: 4,
    paddingHorizontal: 5,
    paddingVertical: 1,
  },
  greenBadge: {
    backgroundColor: '#16a34a',
  },
  redBadgeText: {
    color: '#FFFFFF',
    fontSize: 9,
    fontWeight: '800',
    letterSpacing: 0.5,
  },
  title: {
    color: '#181c22',
    flex: 1,
    fontSize: 14,
    fontWeight: '700',
  },
  body: {
    color: '#404753',
    fontSize: 12,
    lineHeight: 16,
  },
  viewBtn: {
    backgroundColor: '#005cad',
    borderRadius: 8,
    paddingHorizontal: 10,
    paddingVertical: 6,
  },
  viewBtnText: {
    color: '#FFFFFF',
    fontSize: 12,
    fontWeight: '700',
  },
  closeBtn: {
    alignItems: 'center',
    borderRadius: 12,
    height: 24,
    justifyContent: 'center',
    width: 24,
  },
});
