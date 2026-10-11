import * as Device from 'expo-device';

export async function getExpoPushToken() {
  if (!Device.isDevice) {
    return null;
  }

  throw new Error('Expo push notification registration is not configured yet.');
}
