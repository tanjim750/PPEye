import { useRouter } from 'expo-router';
import { Image } from 'expo-image';
import { useTranslation } from 'react-i18next';
import { Pressable, ScrollView, StyleSheet, Text, View } from 'react-native';
import { SafeAreaView } from 'react-native-safe-area-context';

import { Icon } from '@/components/ui/Icon';
import { assets } from '@/constants/assets';

export function AboutScreen() {
  const router = useRouter();
  const { t } = useTranslation('settings');

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
          <Text style={styles.headerTitle}>{t('aboutScreen.title')}</Text>
          <View style={styles.headerPlaceholder} />
        </View>

        <ScrollView
          contentContainerStyle={styles.scrollContent}
          showsVerticalScrollIndicator={false}
          style={styles.scroll}>
          {/* App Info Section */}
          <View style={styles.appInfoSection}>
            <View style={styles.logoFrame}>
              <Image contentFit="contain" source={assets.logo} style={styles.logo} />
            </View>
            <Text style={styles.appName}>{t('aboutScreen.appName')}</Text>
            <View style={styles.versionPill}>
              <Text style={styles.versionPillText}>{t('aboutScreen.version')}</Text>
            </View>
            <Text style={styles.appDescription}>{t('aboutScreen.appDesc')}</Text>
          </View>

          {/* Group 1: Technical Details Card */}
          <View style={styles.cardGroup}>
            <View style={[styles.cardRow, styles.cardDivider]}>
              <Text style={styles.rowLabel}>{t('aboutScreen.versionLabel')}</Text>
              <Text style={styles.rowValue}>1.0.0</Text>
            </View>
            <View style={styles.cardRow}>
              <Text style={styles.rowLabel}>{t('aboutScreen.buildLabel')}</Text>
              <Text style={styles.rowValue}>100</Text>
            </View>
          </View>

          {/* Group 2: Legal Links Card */}
          <View style={styles.cardGroup}>
            <Pressable
              accessibilityRole="button"
              style={({ pressed }) => [
                styles.cardRow,
                styles.cardDivider,
                pressed && styles.rowPressed,
              ]}>
              <Text style={styles.rowLabel}>{t('aboutScreen.privacyPolicy')}</Text>
              <Icon
                color={colors.outlineVariant}
                name={{ ios: 'chevron.right', android: 'chevron_right', web: 'chevron_right' }}
                size={20}
              />
            </Pressable>
            <Pressable
              accessibilityRole="button"
              style={({ pressed }) => [
                styles.cardRow,
                styles.cardDivider,
                pressed && styles.rowPressed,
              ]}>
              <Text style={styles.rowLabel}>{t('aboutScreen.termsOfUse')}</Text>
              <Icon
                color={colors.outlineVariant}
                name={{ ios: 'chevron.right', android: 'chevron_right', web: 'chevron_right' }}
                size={20}
              />
            </Pressable>
            <Pressable
              accessibilityRole="button"
              style={({ pressed }) => [styles.cardRow, pressed && styles.rowPressed]}>
              <Text style={styles.rowLabel}>{t('aboutScreen.licenses')}</Text>
              <Icon
                color={colors.outlineVariant}
                name={{ ios: 'chevron.right', android: 'chevron_right', web: 'chevron_right' }}
                size={20}
              />
            </Pressable>
          </View>

          {/* Footer */}
          <View style={styles.footer}>
            <Text style={styles.footerText}>{t('aboutScreen.footer')}</Text>
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
  surfaceContainerHigh: '#e5e8f1',
  surfaceContainerLow: '#f1f3fd',
  text: '#181c22',
  textMuted: '#404753',
};

const styles = StyleSheet.create({
  safeArea: {
    backgroundColor: colors.background,
    flex: 1,
  },
  shell: {
    backgroundColor: colors.background,
    flex: 1,
    maxWidth: 448,
    width: '100%',
    alignSelf: 'center',
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
    color: colors.text,
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
  appInfoSection: {
    alignItems: 'center',
    paddingBottom: 28,
  },
  logoFrame: {
    alignItems: 'center',
    backgroundColor: colors.surfaceContainerHigh,
    borderColor: colors.outlineVariant,
    borderRadius: 24,
    borderWidth: 1,
    height: 88,
    justifyContent: 'center',
    marginBottom: 16,
    shadowColor: '#000000',
    shadowOffset: { height: 2, width: 0 },
    shadowOpacity: 0.06,
    shadowRadius: 8,
    width: 88,
  },
  logo: {
    height: 56,
    width: 56,
  },
  appName: {
    color: colors.text,
    fontSize: 22,
    fontWeight: '700',
    marginBottom: 8,
  },
  versionPill: {
    backgroundColor: colors.surfaceContainerLow,
    borderRadius: 999,
    marginBottom: 16,
    paddingHorizontal: 14,
    paddingVertical: 4,
  },
  versionPillText: {
    color: colors.textMuted,
    fontSize: 12,
    fontWeight: '600',
  },
  appDescription: {
    color: colors.textMuted,
    fontSize: 14,
    lineHeight: 20,
    maxWidth: 300,
    textAlign: 'center',
  },
  cardGroup: {
    backgroundColor: colors.surface,
    borderColor: colors.outlineVariant,
    borderRadius: 12,
    borderWidth: 1,
    marginBottom: 16,
    overflow: 'hidden',
  },
  cardRow: {
    alignItems: 'center',
    flexDirection: 'row',
    justifyContent: 'space-between',
    minHeight: 48,
    paddingHorizontal: 16,
    paddingVertical: 12,
  },
  cardDivider: {
    borderBottomColor: colors.outlineVariant,
    borderBottomWidth: 1,
  },
  rowLabel: {
    color: colors.text,
    fontSize: 15,
    fontWeight: '500',
  },
  rowValue: {
    color: colors.textMuted,
    fontSize: 15,
  },
  rowPressed: {
    backgroundColor: 'rgba(224, 226, 236, 0.4)',
  },
  footer: {
    alignItems: 'center',
    marginTop: 24,
    paddingBottom: 20,
  },
  footerText: {
    color: colors.outline,
    fontSize: 12,
    fontWeight: '500',
  },
  pressedOpacity: {
    opacity: 0.7,
  },
});

export default AboutScreen;
