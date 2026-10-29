import '@/i18n';

import { Stack } from 'expo-router';
import { StatusBar } from 'expo-status-bar';
import { LogBox, View } from 'react-native';
import { SafeAreaProvider } from 'react-native-safe-area-context';

import { LanguageProvider, useLanguage } from '@/hooks/useLanguage';

LogBox.ignoreLogs([
  "Response.blob() is using React Native's Blob",
]);

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
    <SafeAreaProvider>
      <LanguageProvider>
        <RootNavigator />
      </LanguageProvider>
    </SafeAreaProvider>
  );
}
