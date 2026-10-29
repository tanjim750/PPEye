import { useRouter } from 'expo-router';
import { useEffect, useState } from 'react';
import { useTranslation } from 'react-i18next';
import { Pressable, ScrollView, StyleSheet, Switch, Text, View } from 'react-native';
import { SafeAreaView } from 'react-native-safe-area-context';

import { Icon } from '@/components/ui/Icon';
import { useNotifications } from '@/services/notifications/notification.service';

export function NotificationsScreen() {
  const router = useRouter();
  const { t } = useTranslation('settings');
  const { preferences, updatePreferences, requestPermission } = useNotifications();

  // Local state for instant zero-latency UI toggle feedback
  const [localPrefs, setLocalPrefs] = useState({
    newSubmissions: preferences.newSubmissions,
    reviewUpdates: preferences.reviewUpdates,
    accountUpdates: preferences.accountUpdates,
  });

  useEffect(() => {
    setLocalPrefs({
      newSubmissions: preferences.newSubmissions,
      reviewUpdates: preferences.reviewUpdates,
      accountUpdates: preferences.accountUpdates,
    });
  }, [preferences.newSubmissions, preferences.reviewUpdates, preferences.accountUpdates]);

  const handleToggle = (key: 'newSubmissions' | 'reviewUpdates' | 'accountUpdates', value: boolean) => {
    // 1. Instant optimistic state update
    setLocalPrefs((prev) => ({ ...prev, [key]: value }));

    // 2. Persist & sync in background without blocking UI render
    void (async () => {
      try {
        if (value) {
          void requestPermission();
        }
        await updatePreferences({ [key]: value });
      } catch (err) {
        console.warn('[NotificationsScreen] Toggle update error:', err);
      }
    })();
  };

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
              color={colors.primary}
              name={{ ios: 'arrow.left', android: 'arrow_back', web: 'arrow_back' }}
              size={22}
            />
          </Pressable>
          <Text style={styles.headerTitle}>{t('notificationsScreen.title')}</Text>
          <View style={styles.headerPlaceholder} />
        </View>

        <ScrollView
          contentContainerStyle={styles.scrollContent}
          showsVerticalScrollIndicator={false}
          style={styles.scroll}>
          {/* Subtitle */}
          <Text style={styles.pageSubtitle}>{t('notificationsScreen.subtitle')}</Text>

          {/* REVIEWS Section */}
          <View style={styles.section}>
            <Text style={styles.sectionHeader}>{t('notificationsScreen.reviewsSection')}</Text>
            <View style={styles.sectionGroup}>
              {/* Item 1 */}
              <View style={[styles.toggleRow, styles.rowDivider]}>
                <View style={styles.toggleCopy}>
                  <Text style={styles.toggleTitle}>{t('notificationsScreen.newSubmissions')}</Text>
                  <Text style={styles.toggleDescription}>
                    {t('notificationsScreen.newSubmissionsSub')}
                  </Text>
                </View>
                <Switch
                  // @ts-ignore
                  activeThumbColor="#ffffff"
                  onValueChange={(val) => handleToggle('newSubmissions', val)}
                  thumbColor="#ffffff"
                  trackColor={{ false: '#e0e2ec', true: '#0082F0' }}
                  value={localPrefs.newSubmissions}
                />
              </View>

              {/* Item 2 */}
              <View style={styles.toggleRow}>
                <View style={styles.toggleCopy}>
                  <Text style={styles.toggleTitle}>{t('notificationsScreen.reviewUpdates')}</Text>
                  <Text style={styles.toggleDescription}>
                    {t('notificationsScreen.reviewUpdatesSub')}
                  </Text>
                </View>
                <Switch
                  // @ts-ignore
                  activeThumbColor="#ffffff"
                  onValueChange={(val) => handleToggle('reviewUpdates', val)}
                  thumbColor="#ffffff"
                  trackColor={{ false: '#e0e2ec', true: '#0082F0' }}
                  value={localPrefs.reviewUpdates}
                />
              </View>
            </View>
          </View>

          {/* ACCOUNT Section */}
          <View style={styles.section}>
            <Text style={styles.sectionHeader}>{t('notificationsScreen.accountSection')}</Text>
            <View style={styles.sectionGroup}>
              {/* Item 1 */}
              <View style={styles.toggleRow}>
                <View style={styles.toggleCopy}>
                  <Text style={styles.toggleTitle}>{t('notificationsScreen.accountUpdates')}</Text>
                  <Text style={styles.toggleDescription}>
                    {t('notificationsScreen.accountUpdatesSub')}
                  </Text>
                </View>
                <Switch
                  // @ts-ignore
                  activeThumbColor="#ffffff"
                  onValueChange={(val) => handleToggle('accountUpdates', val)}
                  thumbColor="#ffffff"
                  trackColor={{ false: '#e0e2ec', true: '#0082F0' }}
                  value={localPrefs.accountUpdates}
                />
              </View>
            </View>
          </View>
        </ScrollView>
      </View>
    </SafeAreaView>
  );
}

const colors = {
  background: '#f9f9ff',
  outline: '#717785',
  outlineVariant: '#c0c7d5',
  primary: '#005cad',
  surface: '#ffffff',
  switchOff: '#e0e2ec',
  text: '#181c22',
  textMuted: '#404753',
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
    backgroundColor: colors.surface,
    borderBottomColor: colors.outlineVariant,
    borderBottomWidth: 1,
    flexDirection: 'row',
    justifyContent: 'space-between',
    paddingHorizontal: 16,
    paddingVertical: 12,
  },
  backButton: {
    alignItems: 'center',
    height: 40,
    justifyContent: 'center',
    width: 40,
  },
  headerTitle: {
    color: colors.primary,
    fontSize: 20,
    fontWeight: '700',
    textAlign: 'center',
  },
  headerPlaceholder: {
    height: 40,
    width: 40,
  },
  scroll: {
    flex: 1,
  },
  scrollContent: {
    paddingHorizontal: 20,
    paddingVertical: 24,
  },
  pageSubtitle: {
    color: colors.textMuted,
    fontSize: 16,
    lineHeight: 22,
    marginBottom: 28,
  },
  section: {
    marginBottom: 32,
  },
  sectionHeader: {
    color: colors.primary,
    fontSize: 12,
    fontWeight: '700',
    letterSpacing: 1.2,
    marginBottom: 8,
    textTransform: 'uppercase',
  },
  sectionGroup: {
    borderTopColor: colors.outlineVariant,
    borderTopWidth: 1,
  },
  toggleRow: {
    alignItems: 'center',
    borderBottomColor: colors.outlineVariant,
    borderBottomWidth: 1,
    flexDirection: 'row',
    justifyContent: 'space-between',
    minHeight: 64,
    paddingVertical: 16,
  },
  rowDivider: {
    borderBottomColor: colors.outlineVariant,
    borderBottomWidth: 1,
  },
  toggleCopy: {
    flex: 1,
    paddingRight: 16,
  },
  toggleTitle: {
    color: colors.text,
    fontSize: 16,
    fontWeight: '600',
    lineHeight: 22,
  },
  toggleDescription: {
    color: colors.textMuted,
    fontSize: 13,
    lineHeight: 18,
    marginTop: 4,
  },
  pressedOpacity: {
    opacity: 0.7,
  },
});

export default NotificationsScreen;
