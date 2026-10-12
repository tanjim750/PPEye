import '@/i18n';

import { Stack } from 'expo-router';
import { StatusBar } from 'expo-status-bar';
import { View } from 'react-native';

import { LanguageProvider, useLanguage } from '@/hooks/useLanguage';

export const unstable_settings = {
  initialRouteName: 'index',
};

function RootNavigator() {
  const { language } = useLanguage();

  return (
    <View key={language} style={{ flex: 1 }}>
      <Stack initialRouteName="index" screenOptions={{ headerShown: false }}>
        <Stack.Screen name="index" />
        <Stack.Screen name="(onboarding)" />
        <Stack.Screen name="(auth)" />
        <Stack.Screen name="(external)" />
        <Stack.Screen name="(internal)" />
        <Stack.Screen name="settings" />
      </Stack>
      <StatusBar style="auto" />
    </View>
  );
}

export default function RootLayout() {
  return (
    <LanguageProvider>
      <RootNavigator />
    </LanguageProvider>
  );
}
