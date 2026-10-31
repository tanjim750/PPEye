import '@/i18n';

import React, { useEffect } from 'react';
import { Stack } from 'expo-router';
import { StatusBar } from 'expo-status-bar';
import { LogBox, View } from 'react-native';
import { SafeAreaProvider } from 'react-native-safe-area-context';

import { LanguageProvider, useLanguage } from '@/hooks/useLanguage';
import { RealtimeNotificationBanner } from '@/components/common/RealtimeNotificationBanner';
import {
  initializeRealtimeNotifications,
  requestNotificationPermission,
} from '@/services/notifications/notification.service';

LogBox.ignoreLogs([
  "Response.blob() is using React Native's Blob",
  "[expo-notifications] Push notifications (remote notifications) are unavailable in Expo Go",
]);

export const unstable_settings = {
  initialRouteName: 'index',
};

function RootNavigator() {
  const { language } = useLanguage();

  return (
    <View key={language} style={{ flex: 1, backgroundColor: '#F7F9FC' }}>
      <Stack
        initialRouteName="index"
        screenOptions={{
          headerShown: false,
          contentStyle: { backgroundColor: '#F7F9FC' },
        }}>
        <Stack.Screen name="index" />
        <Stack.Screen name="(onboarding)" />
        <Stack.Screen name="(auth)" />
        <Stack.Screen name="(external)" />
        <Stack.Screen name="(internal)" />
        <Stack.Screen name="settings" />
      </Stack>
      <StatusBar style="light" />
      <RealtimeNotificationBanner />
    </View>
  );
}

export default function RootLayout() {
  useEffect(() => {
    // Request system / browser notification permission on initial load for OS popup support
    void requestNotificationPermission();
    void initializeRealtimeNotifications();
  }, []);

  return (
    <SafeAreaProvider>
      <LanguageProvider>
        <RootNavigator />
      </LanguageProvider>
    </SafeAreaProvider>
  );
}
