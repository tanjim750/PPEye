import {
  getValidAccessToken,
  STORAGE_KEY_ACCESS_TOKEN,
  STORAGE_KEY_EXPIRES_AT,
} from './auth';

export * from './auth.types';
export * from './auth';
export * from './folders.types';
export * from './folders';
export * from './files';
export * from './upload';

let inMemoryAccessToken: string | null = null;
let tokenExpiresAt: number = 0;

/**
 * Helper to safely obtain AsyncStorage without failing in bare Node environments.
 */
function getAsyncStorage(): typeof import('@react-native-async-storage/async-storage').default | null {
  if (typeof window === 'undefined' && typeof (globalThis as any).nativeCallSyncHook === 'undefined') {
    return null;
  }
  try {
    const mod = require('@react-native-async-storage/async-storage');
    return mod?.default ?? mod;
  } catch {
    return null;
  }
}

/**
 * Manually set or update the active Google Drive OAuth Access Token.
 */
export async function setGoogleDriveAccessToken(token: string, expiresInSeconds: number = 3600): Promise<void> {
  inMemoryAccessToken = token;
  tokenExpiresAt = Date.now() + expiresInSeconds * 1000;

  const storage = getAsyncStorage();
  if (!storage) return;

  try {
    await storage.multiSet([
      [STORAGE_KEY_ACCESS_TOKEN, token],
      [STORAGE_KEY_EXPIRES_AT, tokenExpiresAt.toString()],
    ]);
  } catch (err) {
    console.warn('[Google Drive] Error saving token to storage:', err);
  }
}

/**
 * Retrieve the active, valid Google Drive Access Token.
 * Delegates to getValidAccessToken() which automatically performs
 * expiration checks, silent token refresh, or silent session restore.
 */
export async function getGoogleDriveAccessToken(): Promise<string | null> {
  // First check if a manual token was set
  if (inMemoryAccessToken && Date.now() < tokenExpiresAt - 60000) {
    return inMemoryAccessToken;
  }

  // Primary acquisition via Google Auth flow
  const token = await getValidAccessToken();
  if (token) {
    return token;
  }

  return inMemoryAccessToken;
}

/**
 * Header helper for Google Drive API requests.
 */
export async function getGoogleDriveHeaders(): Promise<Record<string, string> | null> {
  const token = await getGoogleDriveAccessToken();
  if (!token) {
    return null;
  }
  return {
    Authorization: `Bearer ${token}`,
  };
}
