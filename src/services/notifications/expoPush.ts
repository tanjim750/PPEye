import { registerDevicePushToken } from './pushNotification.service';

export async function getExpoPushToken(): Promise<string | null> {
  return registerDevicePushToken();
}
