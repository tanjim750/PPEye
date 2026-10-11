import '@/i18n';

import { Stack } from 'expo-router';
import { StatusBar } from 'expo-status-bar';
import { useEffect } from 'react';

import { useLanguage } from '@/hooks/useLanguage';
import { getLanguagePreference } from '@/services/onboarding/languagePreference';

export const unstable_settings = {
  initialRouteName: 'index',
};

export default function RootLayout() {
  const { setLanguage } = useLanguage();

  useEffect(() => {
    let isMounted = true;

    async function applyStoredLanguage() {
      const preferredLanguage = await getLanguagePreference();

      if (isMounted && preferredLanguage) {
        setLanguage(preferredLanguage);
      }
    }

    applyStoredLanguage();

    return () => {
      isMounted = false;
    };
  }, [setLanguage]);

  return (
    <>
      <Stack initialRouteName="index" screenOptions={{ headerShown: false }}>
        <Stack.Screen name="index" />
        <Stack.Screen name="(onboarding)" />
        <Stack.Screen name="(auth)" />
        <Stack.Screen name="(external)" />
        <Stack.Screen name="(internal)" />
        <Stack.Screen name="settings" />
      </Stack>
      <StatusBar style="auto" />
    </>
  );
}
