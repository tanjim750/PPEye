import { Platform, Vibration } from 'react-native';

let hapticsModule: any | undefined = undefined;

function getHapticsModule(): any | null {
  if (hapticsModule !== undefined) {
    return hapticsModule;
  }
  try {
    const pkg = 'expo-haptics';
    hapticsModule = require(pkg);
  } catch {
    hapticsModule = null;
  }
  return hapticsModule;
}

export function hapticSelection(): void {
  try {
    const Haptics = getHapticsModule();
    if (Haptics?.selectionAsync) {
      void Haptics.selectionAsync();
      return;
    }
    if (Platform.OS === 'android') {
      Vibration.vibrate(6);
    }
  } catch {
    // Ignore on unsupported devices
  }
}

export function hapticLight(): void {
  try {
    const Haptics = getHapticsModule();
    if (Haptics?.impactAsync && Haptics?.ImpactFeedbackStyle) {
      void Haptics.impactAsync(Haptics.ImpactFeedbackStyle.Light);
      return;
    }
    if (Platform.OS === 'android') {
      Vibration.vibrate(8);
    }
  } catch {
    // Ignore on unsupported devices
  }
}

export function hapticMedium(): void {
  try {
    const Haptics = getHapticsModule();
    if (Haptics?.impactAsync && Haptics?.ImpactFeedbackStyle) {
      void Haptics.impactAsync(Haptics.ImpactFeedbackStyle.Medium);
      return;
    }
    if (Platform.OS === 'android') {
      Vibration.vibrate(12);
    }
  } catch {
    // Ignore on unsupported devices
  }
}

export function hapticSuccess(): void {
  try {
    const Haptics = getHapticsModule();
    if (Haptics?.notificationAsync && Haptics?.NotificationFeedbackType) {
      void Haptics.notificationAsync(Haptics.NotificationFeedbackType.Success);
      return;
    }
    if (Platform.OS === 'android') {
      Vibration.vibrate([0, 10, 40, 14]);
    }
  } catch {
    // Ignore on unsupported devices
  }
}

export function hapticWarning(): void {
  try {
    const Haptics = getHapticsModule();
    if (Haptics?.notificationAsync && Haptics?.NotificationFeedbackType) {
      void Haptics.notificationAsync(Haptics.NotificationFeedbackType.Warning);
      return;
    }
    if (Platform.OS === 'android') {
      Vibration.vibrate([0, 14, 50, 14]);
    }
  } catch {
    // Ignore on unsupported devices
  }
}

export function hapticError(): void {
  try {
    const Haptics = getHapticsModule();
    if (Haptics?.notificationAsync && Haptics?.NotificationFeedbackType) {
      void Haptics.notificationAsync(Haptics.NotificationFeedbackType.Error);
      return;
    }
    if (Platform.OS === 'android') {
      Vibration.vibrate([0, 18, 45, 22]);
    }
  } catch {
    // Ignore on unsupported devices
  }
}
