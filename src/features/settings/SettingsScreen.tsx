import { Href, useRouter } from 'expo-router';
import { Image } from 'expo-image';
import { useState } from 'react';
import { Pressable, ScrollView, StyleSheet, Text, View } from 'react-native';
import { SafeAreaView } from 'react-native-safe-area-context';

import { useTranslation } from 'react-i18next';

import { Icon } from '@/components/ui/Icon';
import { assets } from '@/constants/assets';
import { useAuth } from '@/hooks/useAuth';
import { useLanguage } from '@/hooks/useLanguage';
import { logout } from '@/features/auth/services/auth.service';
import { authStore } from '@/stores/auth.store';
import { storeLanguagePreference } from '@/services/onboarding/languagePreference';

// Lucide-style Icon Components using the project's native symbol system
const ArrowLeft = ({ color = colors.primary, size = 22 }: { color?: string; size?: number }) => (
  <Icon color={color} name={{ ios: 'arrow.left', android: 'arrow_back', web: 'arrow_back' }} size={size} />
);

const ChevronRight = ({ color = colors.outlineVariant, size = 20 }: { color?: string; size?: number }) => (
  <Icon color={color} name={{ ios: 'chevron.right', android: 'chevron_right', web: 'chevron_right' }} size={size} />
);

const User = ({ color = colors.outline, size = 20 }: { color?: string; size?: number }) => (
  <Icon color={color} name={{ ios: 'person.fill', android: 'person', web: 'person' }} size={size} />
);

const Lock = ({ color = colors.outline, size = 20 }: { color?: string; size?: number }) => (
  <Icon color={color} name={{ ios: 'lock.fill', android: 'lock', web: 'lock' }} size={size} />
);

const Bell = ({ color = colors.outline, size = 20 }: { color?: string; size?: number }) => (
  <Icon color={color} name={{ ios: 'bell.fill', android: 'notifications', web: 'notifications' }} size={size} />
);

const Globe = ({ color = colors.outline, size = 20 }: { color?: string; size?: number }) => (
  <Icon color={color} name={{ ios: 'globe', android: 'language', web: 'language' }} size={size} />
);

const HelpCircle = ({ color = colors.outline, size = 20 }: { color?: string; size?: number }) => (
  <Icon color={color} name={{ ios: 'questionmark.circle.fill', android: 'help', web: 'help' }} size={size} />
);

const Info = ({ color = colors.outline, size = 20 }: { color?: string; size?: number }) => (
  <Icon color={color} name={{ ios: 'info.circle.fill', android: 'info', web: 'info' }} size={size} />
);

const LogOut = ({ color = colors.error, size = 20 }: { color?: string; size?: number }) => (
  <Icon color={color} name={{ ios: 'rectangle.portrait.and.arrow.right', android: 'logout', web: 'logout' }} size={size} />
);

export function SettingsScreen() {
  const router = useRouter();
  const { i18n, t } = useTranslation('settings');
  const { user } = useAuth();
  const { language, setLanguage } = useLanguage();
  const [isLoggingOut, setIsLoggingOut] = useState(false);

  const isVendor = user?.role === 'vendor' || user?.role === 'external';
  const fullName = user?.name || (isVendor ? 'Rahim Mia' : 'Mahmud Hasan');
  const roleName = isVendor ? t('fieldOperations') : t('ehsRepresentative');
  const email = user?.email || (isVendor ? 'rahim@example.com' : 'mahmud@example.com');
  const avatar = isVendor ? assets.fieldRahimAvatar : assets.ehsProfile;

  function handleLanguageToggle(nextLang: 'en' | 'bn') {
    setLanguage(nextLang);
    i18n.changeLanguage(nextLang);
    storeLanguagePreference(nextLang);
  }

  async function handleLogout() {
    if (isLoggingOut) return;
    setIsLoggingOut(true);
    authStore.user = null;
    try {
      await logout();
    } catch {
      // ignore
    }
    router.replace('/login' as Href);
  }

  return (
    <SafeAreaView className="flex-1 bg-[#f9f9ff]" style={styles.safeArea}>
      <View className="w-full max-w-md bg-surface h-full flex flex-col self-center" style={styles.shell}>
        {/* Header */}
        <View
          className="flex flex-row items-center justify-between px-5 py-3 border-b border-[#c0c7d5] bg-white/95"
          style={styles.header}>
          <Pressable
            accessibilityLabel="Go back"
            accessibilityRole="button"
            onPress={() => router.back()}
            style={({ pressed }) => [styles.backButton, pressed && styles.pressedOpacity]}>
            <ArrowLeft color={colors.primary} size={22} />
          </Pressable>
          <Text className="text-xl font-bold text-[#181c22]" style={styles.headerTitle}>
            {t('title')}
          </Text>
          <View style={styles.backButtonPlaceholder} />
        </View>

        <ScrollView
          className="flex-1 w-full"
          contentContainerStyle={styles.scrollContent}
          showsVerticalScrollIndicator={false}>
          {/* Top Profile Card */}
          <Pressable
            accessibilityLabel="View profile"
            accessibilityRole="button"
            className="flex flex-row items-center px-5 py-6 gap-4 border-b border-[#c0c7d5] active:scale-[0.98]"
            onPress={() => router.push('/profile' as Href)}
            style={({ pressed }) => [styles.profileCard, pressed && styles.pressedScale]}>
            <Image contentFit="cover" source={avatar} style={styles.avatar} />
            <View className="flex-1" style={styles.profileInfo}>
              <Text className="text-lg font-semibold text-[#181c22]" style={styles.profileName}>
                {fullName}
              </Text>
              <Text className="text-sm text-[#404753] mt-0.5" style={styles.profileRole}>
                {roleName}
              </Text>
              <Text className="text-xs text-[#717785] mt-0.5" style={styles.profileEmail}>
                {email}
              </Text>
            </View>
            <ChevronRight color={colors.outlineVariant} size={22} />
          </Pressable>

          {/* Settings Sections */}
          <View className="flex flex-col" style={styles.sectionsContainer}>
            {/* ACCOUNT Section */}
            <View className="pt-6" style={styles.section}>
              <Text className="px-5 text-xs font-semibold text-[#005cad] uppercase tracking-wider mb-2" style={styles.sectionHeader}>
                {t('accountSection')}
              </Text>
              <View className="border-t border-[#c0c7d5]" style={styles.sectionList}>
                {/* Item 1: Profile */}
                <Pressable
                  accessibilityRole="button"
                  className="flex flex-row items-center px-5 py-4 border-b border-[#c0c7d5]"
                  onPress={() => router.push('/profile' as Href)}
                  style={({ pressed }) => [styles.rowItem, pressed && styles.rowPressed]}>
                  <View style={styles.rowIcon}>
                    <User color={colors.outline} size={20} />
                  </View>
                  <View className="flex-1" style={styles.rowCopy}>
                    <Text className="text-base font-medium text-[#181c22]" style={styles.rowTitle}>
                      {t('profile')}
                    </Text>
                    <Text className="text-sm text-[#404753]" style={styles.rowSubtitle}>
                      {t('profileSub')}
                    </Text>
                  </View>
                  <ChevronRight color={colors.outlineVariant} size={20} />
                </Pressable>

                {/* Item 2: Change Password */}
                <Pressable
                  accessibilityRole="button"
                  className="flex flex-row items-center px-5 py-4 border-b border-[#c0c7d5]"
                  onPress={() => router.push('/settings/change-password' as Href)}
                  style={({ pressed }) => [styles.rowItem, pressed && styles.rowPressed]}>
                  <View style={styles.rowIcon}>
                    <Lock color={colors.outline} size={20} />
                  </View>
                  <View className="flex-1" style={styles.rowCopy}>
                    <Text className="text-base font-medium text-[#181c22]" style={styles.rowTitle}>
                      {t('changePassword')}
                    </Text>
                    <Text className="text-sm text-[#404753]" style={styles.rowSubtitle}>
                      {t('changePasswordSub')}
                    </Text>
                  </View>
                  <ChevronRight color={colors.outlineVariant} size={20} />
                </Pressable>
              </View>
            </View>

            {/* APP Section */}
            <View className="pt-6" style={styles.section}>
              <Text className="px-5 text-xs font-semibold text-[#005cad] uppercase tracking-wider mb-2" style={styles.sectionHeader}>
                {t('appSection')}
              </Text>
              <View className="border-t border-[#c0c7d5]" style={styles.sectionList}>
                {/* Item 1: Notifications */}
                <Pressable
                  accessibilityRole="button"
                  className="flex flex-row items-center px-5 py-4 border-b border-[#c0c7d5]"
                  onPress={() => router.push('/settings/notifications' as Href)}
                  style={({ pressed }) => [styles.rowItem, pressed && styles.rowPressed]}>
                  <View style={styles.rowIcon}>
                    <Bell color={colors.outline} size={20} />
                  </View>
                  <View className="flex-1" style={styles.rowCopy}>
                    <Text className="text-base font-medium text-[#181c22]" style={styles.rowTitle}>
                      {t('notifications')}
                    </Text>
                    <Text className="text-sm text-[#404753]" style={styles.rowSubtitle}>
                      {t('notificationsSub')}
                    </Text>
                  </View>
                  <ChevronRight color={colors.outlineVariant} size={20} />
                </Pressable>

                {/* Item 2 (NEW): Language */}
                <View
                  className="flex flex-row items-center px-5 py-4 border-b border-[#c0c7d5]"
                  style={styles.rowItem}>
                  <View style={styles.rowIcon}>
                    <Globe color={colors.outline} size={20} />
                  </View>
                  <View className="flex-1" style={styles.rowCopy}>
                    <Text className="text-base font-medium text-[#181c22]" style={styles.rowTitle}>
                      {t('language')}
                    </Text>
                    <Text className="text-sm text-[#404753]" style={styles.rowSubtitle}>
                      {t('languageSub')}
                    </Text>
                  </View>
                  {/* Toggle / Selection between English and Bangla */}
                  <View
                    className="relative flex flex-row bg-[#e5e8f1] rounded-full p-1 overflow-hidden transition-all duration-300 ease-in-out"
                    style={styles.languageToggle}>
                    {/* Animated Sliding Pill */}
                    <View
                      className={`absolute top-1 bottom-1 w-[68px] bg-[#005cad] rounded-full transition-all transform duration-300 ease-in-out ${
                        language === 'bn' ? 'translate-x-[68px]' : 'translate-x-0'
                      }`}
                      style={[
                        styles.slidingPill,
                        language === 'bn' ? styles.slidingPillBn : styles.slidingPillEn,
                      ]}
                    />
                    <Pressable
                      accessibilityRole="button"
                      className="flex-1 items-center justify-center py-1.5 px-3 rounded-full z-10 transition-all transform duration-300 ease-in-out"
                      onPress={() => handleLanguageToggle('en')}
                      style={styles.langButton}>
                      <Text
                        className="transition-colors duration-300 ease-in-out"
                        style={[
                          styles.langText,
                          language === 'en' && styles.langTextActive,
                        ]}>
                        English
                      </Text>
                    </Pressable>
                    <Pressable
                      accessibilityRole="button"
                      className="flex-1 items-center justify-center py-1.5 px-3 rounded-full z-10 transition-all transform duration-300 ease-in-out"
                      onPress={() => handleLanguageToggle('bn')}
                      style={styles.langButton}>
                      <Text
                        className="transition-colors duration-300 ease-in-out"
                        style={[
                          styles.langText,
                          language === 'bn' && styles.langTextActive,
                        ]}>
                        বাংলা
                      </Text>
                    </Pressable>
                  </View>
                </View>
              </View>
            </View>

            {/* SUPPORT Section */}
            <View className="pt-6" style={styles.section}>
              <Text className="px-5 text-xs font-semibold text-[#005cad] uppercase tracking-wider mb-2" style={styles.sectionHeader}>
                {t('supportSection')}
              </Text>
              <View className="border-t border-[#c0c7d5]" style={styles.sectionList}>
                {/* Item 1: Help & Support */}
                <Pressable
                  accessibilityRole="button"
                  className="flex flex-row items-center px-5 py-4 border-b border-[#c0c7d5]"
                  onPress={() => router.push('/settings/help' as Href)}
                  style={({ pressed }) => [styles.rowItem, pressed && styles.rowPressed]}>
                  <View style={styles.rowIcon}>
                    <HelpCircle color={colors.outline} size={20} />
                  </View>
                  <View className="flex-1" style={styles.rowCopy}>
                    <Text className="text-base font-medium text-[#181c22]" style={styles.rowTitle}>
                      {t('helpSupport')}
                    </Text>
                  </View>
                  <ChevronRight color={colors.outlineVariant} size={20} />
                </Pressable>

                {/* Item 2: About */}
                <Pressable
                  accessibilityRole="button"
                  className="flex flex-row items-center px-5 py-4 border-b border-[#c0c7d5]"
                  onPress={() => router.push('/settings/about' as Href)}
                  style={({ pressed }) => [styles.rowItem, pressed && styles.rowPressed]}>
                  <View style={styles.rowIcon}>
                    <Info color={colors.outline} size={20} />
                  </View>
                  <View className="flex-1" style={styles.rowCopy}>
                    <Text className="text-base font-medium text-[#181c22]" style={styles.rowTitle}>
                      {t('about')}
                    </Text>
                  </View>
                  <Text className="text-sm text-[#404753] font-medium" style={styles.versionBadge}>
                    v1.0.0
                  </Text>
                </Pressable>
              </View>
            </View>

            {/* SESSION Section */}
            <View className="pt-6 pb-12" style={styles.section}>
              <Text className="px-5 text-xs font-semibold text-[#005cad] uppercase tracking-wider mb-2" style={styles.sectionHeader}>
                {t('sessionSection')}
              </Text>
              <View className="border-t border-b border-[#c0c7d5]" style={styles.sectionList}>
                {/* Item 1: Log out */}
                <Pressable
                  accessibilityRole="button"
                  className="flex flex-row items-center px-5 py-4"
                  onPress={handleLogout}
                  style={({ pressed }) => [styles.rowItem, pressed && styles.rowPressed]}>
                  <View style={styles.rowIcon}>
                    <LogOut color={colors.error} size={20} />
                  </View>
                  <View className="flex-1" style={styles.rowCopy}>
                    <Text className="text-base font-semibold text-[#ba1a1a]" style={styles.logoutText}>
                      {t('logout')}
                    </Text>
                  </View>
                </Pressable>
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
  error: '#ba1a1a',
  outline: '#717785',
  outlineVariant: '#c0c7d5',
  primary: '#005cad',
  surface: '#f9f9ff',
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
    backgroundColor: colors.surface,
    flex: 1,
    maxWidth: 448,
    width: '100%',
  },
  header: {
    alignItems: 'center',
    backgroundColor: 'rgba(255, 255, 255, 0.95)',
    borderBottomColor: colors.outlineVariant,
    borderBottomWidth: 1,
    flexDirection: 'row',
    justifyContent: 'space-between',
    paddingHorizontal: 20,
    paddingVertical: 12,
  },
  backButton: {
    alignItems: 'center',
    height: 40,
    justifyContent: 'center',
    width: 40,
  },
  headerTitle: {
    color: colors.text,
    fontSize: 20,
    fontWeight: '700',
    textAlign: 'center',
  },
  backButtonPlaceholder: {
    height: 40,
    width: 40,
  },
  scrollContent: {
    paddingBottom: 40,
  },
  profileCard: {
    alignItems: 'center',
    backgroundColor: colors.surface,
    borderBottomColor: colors.outlineVariant,
    borderBottomWidth: 1,
    flexDirection: 'row',
    gap: 16,
    paddingHorizontal: 20,
    paddingVertical: 20,
  },
  avatar: {
    borderColor: colors.white,
    borderRadius: 36,
    borderWidth: 2,
    height: 72,
    width: 72,
  },
  profileInfo: {
    flex: 1,
  },
  profileName: {
    color: colors.text,
    fontSize: 18,
    fontWeight: '600',
    lineHeight: 24,
  },
  profileRole: {
    color: colors.textMuted,
    fontSize: 14,
    lineHeight: 20,
    marginTop: 2,
  },
  profileEmail: {
    color: colors.outline,
    fontSize: 12,
    lineHeight: 16,
    marginTop: 2,
  },
  sectionsContainer: {
    flexDirection: 'column',
  },
  section: {
    paddingTop: 24,
  },
  sectionHeader: {
    color: colors.primary,
    fontSize: 12,
    fontWeight: '700',
    letterSpacing: 0.6,
    marginBottom: 8,
    paddingHorizontal: 20,
    textTransform: 'uppercase',
  },
  sectionList: {
    borderTopColor: colors.outlineVariant,
    borderTopWidth: 1,
  },
  rowItem: {
    alignItems: 'center',
    backgroundColor: colors.surface,
    borderBottomColor: colors.outlineVariant,
    borderBottomWidth: 1,
    flexDirection: 'row',
    paddingHorizontal: 20,
    paddingVertical: 14,
  },
  rowIcon: {
    alignItems: 'center',
    height: 24,
    justifyContent: 'center',
    marginRight: 16,
    width: 24,
  },
  rowCopy: {
    flex: 1,
  },
  rowTitle: {
    color: colors.text,
    fontSize: 16,
    fontWeight: '500',
    lineHeight: 22,
  },
  rowSubtitle: {
    color: colors.textMuted,
    fontSize: 13,
    lineHeight: 18,
    marginTop: 1,
  },
  languageToggle: {
    backgroundColor: '#e5e8f1',
    borderRadius: 999,
    flexDirection: 'row',
    overflow: 'hidden',
    padding: 3,
    position: 'relative',
    width: 142,
  },
  slidingPill: {
    backgroundColor: colors.primary,
    borderRadius: 999,
    bottom: 3,
    position: 'absolute',
    top: 3,
    width: 68,
  },
  slidingPillEn: {
    left: 3,
  },
  slidingPillBn: {
    left: 71,
  },
  langButton: {
    alignItems: 'center',
    borderRadius: 999,
    flex: 1,
    justifyContent: 'center',
    paddingVertical: 5,
    zIndex: 1,
  },
  langText: {
    color: colors.textMuted,
    fontSize: 12,
    fontWeight: '600',
  },
  langTextActive: {
    color: colors.white,
  },
  versionBadge: {
    color: colors.textMuted,
    fontSize: 14,
    fontWeight: '500',
  },
  logoutText: {
    color: colors.error,
    fontSize: 16,
    fontWeight: '600',
    lineHeight: 22,
  },
  rowPressed: {
    backgroundColor: 'rgba(224, 226, 236, 0.4)',
  },
  pressedOpacity: {
    opacity: 0.7,
  },
  pressedScale: {
    transform: [{ scale: 0.98 }],
  },
});

export default SettingsScreen;
