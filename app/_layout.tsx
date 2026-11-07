import "@/i18n";

import { Href, Stack, useRouter, useSegments } from "expo-router";
import { StatusBar } from "expo-status-bar";
import * as SystemUI from "expo-system-ui";
import { useEffect, useRef } from "react";
import { LogBox, View } from "react-native";
import { SafeAreaProvider } from "react-native-safe-area-context";

import { NoInternetScreen } from "@/components/common/NoInternetScreen";
import { RealtimeNotificationBanner } from "@/components/common/RealtimeNotificationBanner";
import { useNetworkConnectivity } from "@/hooks/useNetworkConnectivity";
import { LanguageProvider, useLanguage } from "@/hooks/useLanguage";
import {
  initializeRealtimeNotifications,
  requestNotificationPermission,
} from "@/services/notifications/notification.service";
import {
  bindPushDeepLinkNavigation,
  flushPendingPushDeepLink,
  initializePushNotificationLifecycle,
} from "@/services/notifications/pushNotification.service";

LogBox.ignoreLogs([
  "Response.blob() is using React Native's Blob",
  "[expo-notifications] Push notifications (remote notifications) are unavailable in Expo Go",
]);

export const unstable_settings = {
  initialRouteName: "index",
};

function RootNavigator() {
  const { language } = useLanguage();
  const router = useRouter();
  const segments = useSegments();
  const isAuthenticatedShellReadyRef = useRef(false);

  const topGroup = segments[0];
  isAuthenticatedShellReadyRef.current =
    topGroup === "(external)" || topGroup === "(internal)" || topGroup === "settings";

  useEffect(() => {
    void SystemUI.setBackgroundColorAsync("#FFFFFF");
  }, []);

  useEffect(() => {
    return bindPushDeepLinkNavigation(
      (href) => {
        router.push(href as Href);
      },
      () => isAuthenticatedShellReadyRef.current
    );
  }, [router]);

  useEffect(() => {
    if (isAuthenticatedShellReadyRef.current) {
      flushPendingPushDeepLink();
    }
  }, [topGroup]);

  return (
    <View key={language} style={{ flex: 1, backgroundColor: "#F7F9FC" }}>
      <StatusBar style="dark" />
      <Stack
        screenOptions={{
          headerShown: false,
          contentStyle: { backgroundColor: "#F7F9FC" },
        }}
      >
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
  const { isOnline, status, retry } = useNetworkConnectivity();
  const hasBeenOnline = useRef(false);
  if (isOnline) hasBeenOnline.current = true;

  useEffect(() => {
    void SystemUI.setBackgroundColorAsync("#FFFFFF");

    // Request system / browser notification permission on initial load for OS popup support
    void requestNotificationPermission();
    void initializeRealtimeNotifications();
    initializePushNotificationLifecycle();
  }, []);

  return (
    <SafeAreaProvider>
      <LanguageProvider>
        {/* Cold start: don't mount the app (auth redirects, Supabase queries) until online once. */}
        {hasBeenOnline.current ? <RootNavigator /> : <View style={{ flex: 1, backgroundColor: "#1E293B" }} />}
        <NoInternetScreen visible={isOnline === false} status={status} onRetry={retry} />
      </LanguageProvider>
    </SafeAreaProvider>
  );
}
