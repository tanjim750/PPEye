/** Demo fixtures and the login test shortcut are never enabled in release builds. */
const demoModeOverride = process.env.EXPO_PUBLIC_DEMO_MODE;

export const isDemoMode =
  typeof __DEV__ !== 'undefined' && __DEV__ && demoModeOverride !== 'false';

export const isLoginTestMode = isDemoMode;

