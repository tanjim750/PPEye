import { config } from '../../constants/config';
import { StorageError, StorageErrorCode } from '../storage/storage.errors';
import {
  DEFAULT_GOOGLE_DRIVE_SCOPES,
  GOOGLE_DRIVE_MINIMAL_SCOPE,
  GoogleAuthConfig,
  GoogleAuthSession,
  GoogleAuthUser,
  GoogleTokenInfo,
  IGoogleSignInNativeModule,
} from './auth.types';

export {
  DEFAULT_GOOGLE_DRIVE_SCOPES,
  GOOGLE_DRIVE_MINIMAL_SCOPE,
  GoogleAuthConfig,
  GoogleAuthSession,
  GoogleAuthUser,
  GoogleTokenInfo,
  IGoogleSignInNativeModule,
};

// Storage Keys
export const STORAGE_KEY_ACCESS_TOKEN = 'ppeye_google_drive_access_token';
export const STORAGE_KEY_EXPIRES_AT = 'ppeye_google_drive_token_expires_at';
export const STORAGE_KEY_SESSION = 'ppeye_google_drive_session';

// In-memory token & session cache
let inMemoryToken: string | null = null;
let inMemoryExpiresAt: number = 0;
let inMemorySession: GoogleAuthSession | null = null;
let isConfigured: boolean = false;
let activeConfig: GoogleAuthConfig | null = null;

// Mock / injected native module override (for unit tests and deterministic CI)
let injectedNativeModule: IGoogleSignInNativeModule | null = null;

/**
 * Inject or override the native GoogleSignIn module.
 * Used for mocked unit tests and preview environments.
 */
export function setGoogleSignInNativeModule(module: IGoogleSignInNativeModule | null): void {
  injectedNativeModule = module;
}

/**
 * Safely resolves the native @react-native-google-signin/google-signin module.
 * Returns null if not linked, running in Expo Go, or running in a Node/test runner.
 */
function getNativeGoogleSignIn(): IGoogleSignInNativeModule | null {
  if (injectedNativeModule) {
    return injectedNativeModule;
  }
  try {
    const mod = require('@react-native-google-signin/google-signin');
    return mod?.GoogleSignin ?? mod?.default ?? mod;
  } catch {
    return null;
  }
}

/**
 * Detects if the app is running in standard Expo Go or a non-native preview.
 * Native Google Sign-In requires an Expo Development Build and will crash or fail in Expo Go.
 */
export function isExpoPreviewOrGo(): boolean {
  try {
    const Constants = require('expo-constants');
    const appOwnership = Constants?.default?.appOwnership ?? Constants?.appOwnership;
    return appOwnership === 'expo';
  } catch {
    return false;
  }
}

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
 * Checks if a token expiration timestamp is expired or expiring within bufferSeconds (default 60s).
 */
export function isTokenExpired(expiresAt: number, bufferSeconds: number = 60): boolean {
  if (!expiresAt || expiresAt <= 0) {
    return true;
  }
  return Date.now() >= expiresAt - bufferSeconds * 1000;
}

/**
 * Configure Google Authentication once with the minimal compatible Drive scope.
 * Safe to call multiple times (idempotent).
 */
export function configureGoogleAuth(options?: GoogleAuthConfig): void {
  if (isConfigured && !options) {
    return;
  }

  const webClientId = options?.webClientId ?? config.googleClientId;
  const scopes = options?.scopes && options.scopes.length > 0
    ? options.scopes
    : [...DEFAULT_GOOGLE_DRIVE_SCOPES];

  activeConfig = {
    webClientId,
    scopes,
    offlineAccess: options?.offlineAccess ?? true,
    forceCodeForRefreshToken: options?.forceCodeForRefreshToken ?? true,
    iosClientId: options?.iosClientId,
  };

  const native = getNativeGoogleSignIn();
  if (native && typeof native.configure === 'function') {
    try {
      native.configure({
        webClientId: activeConfig.webClientId,
        iosClientId: activeConfig.iosClientId,
        scopes: activeConfig.scopes,
        offlineAccess: activeConfig.offlineAccess,
        forceCodeForRefreshToken: activeConfig.forceCodeForRefreshToken,
      });
    } catch (err) {
      console.warn('[Google Auth] Native configure error:', err);
    }
  }

  isConfigured = true;
}

/**
 * Authenticate with Google and acquire an OAuth access token for Google Drive.
 * 
 * IMPORTANT:
 * - Distinguishes Google Drive authorization from Supabase user authentication.
 * - Enforces minimum compatible Drive scope ('https://www.googleapis.com/auth/drive.file').
 * - Blocks interactive login during Expo Go / preview runs to avoid native crashes.
 * - Extracts Google Drive REST API access token via getTokens().
 * - Never logs credentials.
 */
export async function signInToGoogle(): Promise<GoogleAuthSession> {
  // 1. Prevent interactive sign-in during previews or Expo Go
  if (isExpoPreviewOrGo()) {
    throw new StorageError(
      StorageErrorCode.PROVIDER_UNAVAILABLE,
      'Interactive Google Sign-In is not supported in Expo Go or web previews. Please build and run an Expo Development Build (npx expo run:android / npx expo run:ios).'
    );
  }

  const native = getNativeGoogleSignIn();
  if (!native) {
    throw new StorageError(
      StorageErrorCode.PROVIDER_UNAVAILABLE,
      'Native Google Sign-In module is not available in the current runtime. An Expo Development Build is required.'
    );
  }

  // 2. Ensure Google Auth is configured once
  if (!isConfigured) {
    configureGoogleAuth();
  }

  // 3. Verify Play Services (Android)
  if (typeof native.hasPlayServices === 'function') {
    try {
      await native.hasPlayServices({ showPlayServicesUpdateDialog: true });
    } catch (err: any) {
      throw new StorageError(
        StorageErrorCode.PROVIDER_UNAVAILABLE,
        'Google Play Services is not available or requires update.',
        { cause: err }
      );
    }
  }

  // 4. Perform native Sign-In
  let signInResponse: any;
  try {
    signInResponse = await native.signIn();
  } catch (err: any) {
    const isCancelled =
      err?.code === 'SIGN_IN_CANCELLED' ||
      err?.message?.toLowerCase().includes('cancel') ||
      err?.message?.toLowerCase().includes('dismissed');

    if (isCancelled) {
      throw new StorageError(
        StorageErrorCode.PERMISSION_DENIED,
        'Google Sign-In was cancelled by the user.',
        { cause: err }
      );
    }

    throw new StorageError(
      StorageErrorCode.AUTHENTICATION_REQUIRED,
      `Google Sign-In failed: ${err?.message ?? 'Unknown sign-in error'}`,
      { cause: err }
    );
  }

  // Check if response indicates cancellation (v11+ type: 'cancelled')
  if (signInResponse?.type === 'cancelled') {
    throw new StorageError(
      StorageErrorCode.PERMISSION_DENIED,
      'Google Sign-In was cancelled by the user.'
    );
  }

  // 5. Extract user data safely
  const responseData = signInResponse?.data ?? signInResponse;
  const user = responseData?.user ?? responseData;
  const idToken = responseData?.idToken ?? signInResponse?.idToken ?? null;

  // 6. Acquire Google Drive REST API access token
  // Native signIn() DOES NOT expose accessToken directly; getTokens() must be called.
  let tokens: { idToken: string; accessToken: string };
  try {
    tokens = await native.getTokens();
  } catch (err: any) {
    throw new StorageError(
      StorageErrorCode.AUTHENTICATION_REQUIRED,
      'Failed to acquire Google Drive OAuth access token from Google Play Services.',
      { cause: err }
    );
  }

  if (!tokens?.accessToken) {
    throw new StorageError(
      StorageErrorCode.AUTHENTICATION_REQUIRED,
      'Google Sign-In succeeded but no valid access token was returned for Google Drive scopes.'
    );
  }

  const expiresAt = Date.now() + 3600 * 1000;
  const sessionUser: GoogleAuthUser = {
    id: user?.id ?? '',
    email: user?.email ?? '',
    name: user?.name ?? null,
    photo: user?.photo ?? null,
    familyName: user?.familyName ?? null,
    givenName: user?.givenName ?? null,
  };

  const session: GoogleAuthSession = {
    user: sessionUser,
    accessToken: tokens.accessToken,
    idToken: tokens.idToken ?? idToken,
    scopes: activeConfig?.scopes ?? [...DEFAULT_GOOGLE_DRIVE_SCOPES],
    expiresAt,
  };

  // 7. Persist session (without logging tokens)
  await persistSession(session);

  return session;
}

/**
 * Non-interactively restore an existing Google Drive session.
 * Used during app launch to resume storage operations without prompting the user.
 */
export async function restoreGoogleSession(): Promise<GoogleAuthSession | null> {
  const native = getNativeGoogleSignIn();

  // 1. Try silent sign in via native SDK if available
  if (native) {
    if (!isConfigured) {
      configureGoogleAuth();
    }

    try {
      if (typeof native.hasPreviousSignIn === 'function') {
        const hasPrevious = await native.hasPreviousSignIn();
        if (!hasPrevious) {
          return null;
        }
      }

      let silentResponse: any;
      if (typeof native.signInSilently === 'function') {
        silentResponse = await native.signInSilently();
      } else if (typeof native.getCurrentUser === 'function') {
        silentResponse = await native.getCurrentUser();
      }

      if (!silentResponse) {
        return null;
      }

      const responseData = silentResponse?.data ?? silentResponse;
      const user = responseData?.user ?? responseData;
      const idToken = responseData?.idToken ?? silentResponse?.idToken ?? null;

      const tokens = await native.getTokens();
      if (!tokens?.accessToken) {
        return null;
      }

      const expiresAt = Date.now() + 3600 * 1000;
      const sessionUser: GoogleAuthUser = {
        id: user?.id ?? '',
        email: user?.email ?? '',
        name: user?.name ?? null,
        photo: user?.photo ?? null,
        familyName: user?.familyName ?? null,
        givenName: user?.givenName ?? null,
      };

      const session: GoogleAuthSession = {
        user: sessionUser,
        accessToken: tokens.accessToken,
        idToken: tokens.idToken ?? idToken,
        scopes: activeConfig?.scopes ?? [...DEFAULT_GOOGLE_DRIVE_SCOPES],
        expiresAt,
      };

      await persistSession(session);
      return session;
    } catch {
      // Authorization revoked, expired, or SIGN_IN_REQUIRED
      await clearLocalSession();
      return null;
    }
  }

  // 2. Fallback to cached session from storage
  const cached = await getStoredSession();
  if (cached && !isTokenExpired(cached.expiresAt)) {
    inMemorySession = cached;
    inMemoryToken = cached.accessToken;
    inMemoryExpiresAt = cached.expiresAt;
    return cached;
  }

  return null;
}

/**
 * Checks whether Google Drive authorization is currently active and unexpired.
 */
export async function isGoogleAuthenticated(): Promise<boolean> {
  // Check memory
  if (inMemoryToken && !isTokenExpired(inMemoryExpiresAt)) {
    return true;
  }

  // Check stored token
  const stored = await getStoredTokenInfo();
  if (stored && !isTokenExpired(stored.expiresAt)) {
    inMemoryToken = stored.token;
    inMemoryExpiresAt = stored.expiresAt;
    return true;
  }

  // Check native silent restore
  const native = getNativeGoogleSignIn();
  if (native && typeof native.hasPreviousSignIn === 'function') {
    try {
      const hasPrevious = await native.hasPreviousSignIn();
      if (hasPrevious) {
        const restored = await restoreGoogleSession();
        return restored !== null;
      }
    } catch {
      return false;
    }
  }

  return false;
}

/**
 * Retrieve a valid, unexpired Google Drive OAuth Access Token.
 * Automatically refreshes if expired, or restores session silently.
 * Never logs the token content.
 */
export async function getValidAccessToken(): Promise<string | null> {
  // 1. Check in-memory validity (with 60-second safety margin)
  if (inMemoryToken && !isTokenExpired(inMemoryExpiresAt)) {
    return inMemoryToken;
  }

  // 2. Check stored token validity
  const stored = await getStoredTokenInfo();
  if (stored && !isTokenExpired(stored.expiresAt)) {
    inMemoryToken = stored.token;
    inMemoryExpiresAt = stored.expiresAt;
    return inMemoryToken;
  }

  // 3. Token is missing or expired -> attempt refresh where supported
  const refreshedToken = await refreshAccessToken();
  if (refreshedToken) {
    return refreshedToken;
  }

  // 4. Fallback to silent session restore
  const restored = await restoreGoogleSession();
  if (restored?.accessToken) {
    return restored.accessToken;
  }

  return null;
}

/**
 * Refresh the Google Drive Access Token using native SDK token refresh.
 * 
 * Supported Flow:
 * Native Google Play Services / iOS SDK manages the refresh token internally and does not
 * expose it to JS. Calling clearCachedAccessToken() clears the expired cached token,
 * and a subsequent getTokens() call causes Google Play Services / iOS SDK to mint a fresh access token.
 * 
 * NOTE: For corporate storage operations requiring client secrets or service accounts,
 * PPEye strictly uses Server-Mediated Mode via Supabase Edge Functions.
 */
export async function refreshAccessToken(): Promise<string | null> {
  const native = getNativeGoogleSignIn();

  // Native SDK token refresh
  if (native && typeof native.clearCachedAccessToken === 'function') {
    try {
      const currentToken = inMemoryToken ?? (await getStoredTokenInfo())?.token;
      if (currentToken) {
        await native.clearCachedAccessToken(currentToken);
      }
      const newTokens = await native.getTokens();
      if (newTokens?.accessToken) {
        const expiresAt = Date.now() + 3600 * 1000;
        await persistAccessToken(newTokens.accessToken, expiresAt);
        return newTokens.accessToken;
      }
    } catch {
      // Token may be revoked or expired beyond recovery
      await clearLocalSession();
      return null;
    }
  }

  return null;
}

/**
 * Sign out from Google Drive authorization.
 * Clears Google Drive tokens and local session without affecting Supabase authentication.
 */
export async function signOutFromGoogle(revoke: boolean = false): Promise<void> {
  const native = getNativeGoogleSignIn();

  if (native) {
    try {
      if (revoke && typeof native.revokeAccess === 'function') {
        await native.revokeAccess();
      }
      if (typeof native.signOut === 'function') {
        await native.signOut();
      }
    } catch (err) {
      console.warn('[Google Auth] Native sign out note:', err);
    }
  }

  await clearLocalSession();
  // NOTE: Supabase session is intentionally untouched!
}

// ---------------------------------------------------------------------------
// Internal Persistence Helpers (Never logs tokens or secrets)
// ---------------------------------------------------------------------------

async function persistSession(session: GoogleAuthSession): Promise<void> {
  inMemorySession = session;
  inMemoryToken = session.accessToken;
  inMemoryExpiresAt = session.expiresAt;

  const storage = getAsyncStorage();
  if (!storage) return;

  try {
    await storage.multiSet([
      [STORAGE_KEY_ACCESS_TOKEN, session.accessToken],
      [STORAGE_KEY_EXPIRES_AT, session.expiresAt.toString()],
      [STORAGE_KEY_SESSION, JSON.stringify(session)],
    ]);
  } catch (err) {
    console.warn('[Google Auth] Error persisting session to storage:', err);
  }
}

async function persistAccessToken(token: string, expiresAt: number): Promise<void> {
  inMemoryToken = token;
  inMemoryExpiresAt = expiresAt;

  if (inMemorySession) {
    inMemorySession.accessToken = token;
    inMemorySession.expiresAt = expiresAt;
  }

  const storage = getAsyncStorage();
  if (!storage) return;

  try {
    await storage.multiSet([
      [STORAGE_KEY_ACCESS_TOKEN, token],
      [STORAGE_KEY_EXPIRES_AT, expiresAt.toString()],
    ]);
  } catch (err) {
    console.warn('[Google Auth] Error persisting token to storage:', err);
  }
}

async function getStoredTokenInfo(): Promise<GoogleTokenInfo | null> {
  const storage = getAsyncStorage();
  if (!storage) {
    return inMemoryToken ? { token: inMemoryToken, expiresAt: inMemoryExpiresAt } : null;
  }

  try {
    const values = await storage.multiGet([STORAGE_KEY_ACCESS_TOKEN, STORAGE_KEY_EXPIRES_AT]);
    const token = values[0]?.[1];
    const expStr = values[1]?.[1];

    if (token && expStr) {
      const expiresAt = parseInt(expStr, 10);
      if (!isNaN(expiresAt)) {
        return { token, expiresAt };
      }
    }
  } catch {
    // Ignore storage read error
  }

  return inMemoryToken ? { token: inMemoryToken, expiresAt: inMemoryExpiresAt } : null;
}

async function getStoredSession(): Promise<GoogleAuthSession | null> {
  const storage = getAsyncStorage();
  if (!storage) return inMemorySession;

  try {
    const raw = await storage.getItem(STORAGE_KEY_SESSION);
    if (raw) {
      return JSON.parse(raw) as GoogleAuthSession;
    }
  } catch {
    // Ignore parse error
  }

  return inMemorySession;
}

async function clearLocalSession(): Promise<void> {
  inMemoryToken = null;
  inMemoryExpiresAt = 0;
  inMemorySession = null;

  const storage = getAsyncStorage();
  if (!storage) return;

  try {
    await storage.multiRemove([
      STORAGE_KEY_ACCESS_TOKEN,
      STORAGE_KEY_EXPIRES_AT,
      STORAGE_KEY_SESSION,
    ]);
  } catch (err) {
    console.warn('[Google Auth] Error clearing session from storage:', err);
  }
}
