import { Href, useRouter } from 'expo-router';
import { Image } from 'expo-image';
import { useEffect, useMemo, useState } from 'react';
import { Pressable, ScrollView, StyleSheet, Text, View } from 'react-native';
import { SafeAreaView } from 'react-native-safe-area-context';
import { useTranslation } from 'react-i18next';

import { Icon } from '@/components/ui/Icon';
import { assets } from '@/constants/assets';
import { SupportedLanguage } from '@/i18n/types';
import { useLanguage } from '@/hooks/useLanguage';
import {
  getLanguagePreference,
  storeLanguagePreference,
} from '@/services/onboarding/languagePreference';

export function LanguageScreen() {
  const { language, setLanguage } = useLanguage();
  const router = useRouter();
  const { t } = useTranslation('common');
  const [isCheckingPreference, setIsCheckingPreference] = useState(true);
  const [isSavingPreference, setIsSavingPreference] = useState(false);
  const languages = useMemo(
    () => [
      {
        code: 'en' as const,
        label: t('language.options.en.label'),
        name: t('language.options.en.name'),
      },
      {
        code: 'bn' as const,
        label: t('language.options.bn.label'),
        name: t('language.options.bn.name'),
      },
    ],
    [t],
  );

  useEffect(() => {
    let isMounted = true;

    async function checkStoredLanguage() {
      const preferredLanguage = await getLanguagePreference();

      if (!isMounted) {
        return;
      }

      if (preferredLanguage) {
        setLanguage(preferredLanguage);
        router.replace('/login' as Href);
        return;
      }

      setIsCheckingPreference(false);
    }

    checkStoredLanguage();

    return () => {
      isMounted = false;
    };
  }, [router, setLanguage]);

  function handleLanguageSelect(nextLanguage: SupportedLanguage) {
    setLanguage(nextLanguage);
  }

  async function handleContinue() {
    setIsSavingPreference(true);
    await storeLanguagePreference(language);
    router.replace('/login' as Href);
  }

  if (isCheckingPreference) {
    return <SafeAreaView style={styles.safeArea} />;
  }

  return (
    <SafeAreaView style={styles.safeArea}>
      <View style={styles.container}>
        <ScrollView
          contentContainerStyle={styles.scrollContent}
          keyboardShouldPersistTaps="handled"
          showsVerticalScrollIndicator={false}>
          <View style={styles.header}>
            <View style={styles.brandRow}>
              <View style={styles.brandIcon}>
                <Image source={assets.logo} style={styles.logo} />
              </View>
              <Text style={styles.brandName}>{t('appName')}</Text>
            </View>

            <View style={styles.copy}>
              <Text style={styles.title}>{t('language.title')}</Text>
              <Text style={styles.description}>{t('language.description')}</Text>
            </View>
          </View>

          <View style={styles.options}>
            {languages.map((item) => {
              const selected = item.code === language;

              return (
                <Pressable
                  accessibilityRole="radio"
                  accessibilityState={{ checked: selected }}
                  key={item.code}
                  onPress={() => handleLanguageSelect(item.code)}
                  style={({ pressed }) => [
                    styles.option,
                    selected && styles.optionSelected,
                    pressed && styles.pressed,
                  ]}>
                  <View style={styles.optionCopy}>
                    <Text style={styles.optionLabel}>{item.label}</Text>
                    <Text style={styles.optionName}>{item.name}</Text>
                  </View>
                  <View style={[styles.radio, selected ? styles.radioSelected : styles.radioIdle]}>
                    {selected ? (
                      <Icon
                        color={colors.white}
                        name={{ ios: 'checkmark', android: 'check', web: 'check' }}
                        size={14}
                        weight="bold"
                      />
                    ) : null}
                  </View>
                </Pressable>
              );
            })}
          </View>

          <View style={styles.footer}>
            <Pressable
              accessibilityRole="button"
              disabled={isSavingPreference}
              onPress={handleContinue}
              style={({ pressed }) => [
                styles.continueButton,
                isSavingPreference && styles.saving,
                pressed && styles.pressed,
              ]}>
              <Text style={styles.continueText}>
                {isSavingPreference ? t('language.saving') : t('language.continue')}
              </Text>
              <Icon
                color={colors.white}
                name={{ ios: 'arrow.right', android: 'arrow_forward', web: 'arrow_forward' }}
                size={16}
                weight="semibold"
              />
            </Pressable>
            <Text style={styles.version}>{t('version', { version: '1.0.0' })}</Text>
          </View>
        </ScrollView>
      </View>
    </SafeAreaView>
  );
}

const colors = {
  background: '#f9f9ff',
  outline: '#717785',
  primary: '#005cad',
  primaryFixed: '#d5e3ff',
  surfaceContainerLow: '#f1f3fd',
  text: '#181c22',
  textMuted: '#404753',
  white: '#ffffff',
};

const styles = StyleSheet.create({
  safeArea: {
    flex: 1,
    backgroundColor: colors.background,
  },
  container: {
    flex: 1,
    backgroundColor: colors.background,
    paddingHorizontal: 20,
  },
  scrollContent: {
    alignSelf: 'center',
    flexGrow: 1,
    gap: 32,
    justifyContent: 'space-between',
    paddingVertical: 24,
    width: '100%',
    maxWidth: 448,
  },
  header: {
    alignItems: 'center',
    gap: 16,
  },
  brandRow: {
    alignItems: 'center',
    flexDirection: 'row',
    gap: 8,
  },
  brandIcon: {
    alignItems: 'center',
    backgroundColor: colors.white,
    borderRadius: 12,
    height: 40,
    justifyContent: 'center',
    shadowColor: '#000000',
    shadowOpacity: 0.08,
    shadowRadius: 4,
    shadowOffset: { height: 1, width: 0 },
    width: 40,
  },
  logo: {
    borderRadius: 10,
    height: 40,
    width: 40,
  },
  brandName: {
    color: colors.text,
    fontSize: 24,
    fontWeight: '600',
    lineHeight: 32,
  },
  copy: {
    alignItems: 'center',
    gap: 4,
  },
  title: {
    color: colors.text,
    fontSize: 24,
    fontWeight: '600',
    lineHeight: 32,
    textAlign: 'center',
  },
  description: {
    color: colors.textMuted,
    fontSize: 14,
    lineHeight: 20,
    maxWidth: 340,
    textAlign: 'center',
  },
  options: {
    gap: 16,
  },
  option: {
    alignItems: 'center',
    backgroundColor: colors.surfaceContainerLow,
    borderColor: 'transparent',
    borderRadius: 12,
    borderWidth: 2,
    flexDirection: 'row',
    justifyContent: 'space-between',
    minHeight: 80,
    padding: 16,
  },
  optionSelected: {
    borderColor: colors.primary,
  },
  pressed: {
    transform: [{ scale: 0.98 }],
  },
  saving: {
    opacity: 0.72,
  },
  optionCopy: {
    gap: 2,
  },
  optionLabel: {
    color: colors.text,
    fontSize: 16,
    fontWeight: '600',
    lineHeight: 22,
  },
  optionName: {
    color: colors.textMuted,
    fontSize: 14,
    lineHeight: 20,
  },
  radio: {
    alignItems: 'center',
    borderRadius: 999,
    height: 24,
    justifyContent: 'center',
    width: 24,
  },
  radioIdle: {
    borderColor: colors.outline,
    borderWidth: 2,
  },
  radioSelected: {
    backgroundColor: colors.primary,
  },
  footer: {
    gap: 16,
  },
  continueButton: {
    alignItems: 'center',
    backgroundColor: colors.primary,
    borderRadius: 12,
    flexDirection: 'row',
    gap: 8,
    height: 48,
    justifyContent: 'center',
    paddingHorizontal: 24,
  },
  continueText: {
    color: colors.white,
    fontSize: 16,
    fontWeight: '600',
    lineHeight: 22,
  },
  version: {
    color: colors.outline,
    fontSize: 11,
    fontWeight: '500',
    lineHeight: 14,
    textAlign: 'center',
  },
});
