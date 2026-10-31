import '@/i18n';

import React, { useEffect } from 'react';
import { Stack } from 'expo-router';
import { StatusBar } from 'expo-status-bar';
import { LogBox, Platform, StatusBar as NativeStatusBar, View } from 'react-native';
import * as SystemUI from 'expo-system-ui';
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

  useEffect(() => {
    // Forcefully set status bar to white background and black/dark content
    if (Platform.OS === 'android') {
      NativeStatusBar.setBackgroundColor('#FFFFFF', false);
      NativeStatusBar.setBarStyle('dark-content', false);
    }
    void SystemUI.setBackgroundColorAsync('#FFFFFF');
  }, []);

  return (
    <View key={language} style={{ flex: 1, backgroundColor: '#F7F9FC' }}>
      <NativeStatusBar
        backgroundColor="#FFFFFF"
        barStyle="dark-content"
        translucent={false}
      />
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
      <StatusBar style="dark" />
      <RealtimeNotificationBanner />
    </View>
  );
}

export default function RootLayout() {
  useEffect(() => {
    if (Platform.OS === 'android') {
      NativeStatusBar.setBackgroundColor('#FFFFFF', false);
      NativeStatusBar.setBarStyle('dark-content', false);
    }
    void SystemUI.setBackgroundColorAsync('#FFFFFF');

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
