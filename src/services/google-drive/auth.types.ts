/**
 * Google Drive Authentication & Authorization Types
 */

/**
 * The minimum compatible Google Drive scope for PPEye.
 * Grants read and write access strictly to files created or opened by PPEye.
 * Avoids requesting dangerous, over-permissive full drive access ('https://www.googleapis.com/auth/drive').
 */
export const GOOGLE_DRIVE_MINIMAL_SCOPE = 'https://www.googleapis.com/auth/drive.file' as const;

export const DEFAULT_GOOGLE_DRIVE_SCOPES = [GOOGLE_DRIVE_MINIMAL_SCOPE] as const;

export interface GoogleAuthConfig {
  /**
   * OAuth Web Client ID (from Google Cloud Console).
   * Required on Android for Drive scopes and idToken minting.
   */
  webClientId?: string;

  /**
   * iOS Client ID (optional, usually inferred from GoogleService-Info.plist).
   */
  iosClientId?: string;

  /**
   * OAuth Scopes to request. Defaults to ['https://www.googleapis.com/auth/drive.file'].
   */
  scopes?: string[];

  /**
   * Whether to request server authorization code for offline access.
   */
  offlineAccess?: boolean;

  /**
   * Force refresh token issuance when offline access is requested.
   */
  forceCodeForRefreshToken?: boolean;
}

export interface GoogleAuthUser {
  id: string;
  email: string;
  name?: string | null;
  photo?: string | null;
  familyName?: string | null;
  givenName?: string | null;
}

export interface GoogleAuthSession {
  /**
   * Authenticated Google user profile.
   */
  user: GoogleAuthUser;

  /**
   * OAuth Access Token for Google Drive v3 REST API.
   * NOTE: Never log or expose this value.
   */
  accessToken: string;

  /**
   * OpenID Connect ID token for identity verification (optional).
   */
  idToken?: string | null;

  /**
   * Authorized scopes for this session.
   */
  scopes: string[];

  /**
   * Expiration timestamp in milliseconds (Date.now() + expiresIn * 1000).
   */
  expiresAt: number;
}

export interface GoogleTokenInfo {
  token: string;
  expiresAt: number;
}

/**
 * Pluggable native adapter interface for @react-native-google-signin/google-signin.
 * Allows safe dependency injection in unit tests and environment detection.
 */
export interface IGoogleSignInNativeModule {
  configure(params?: any): void;
  hasPlayServices(params?: { showPlayServicesUpdateDialog?: boolean }): Promise<boolean>;
  signIn(): Promise<any>;
  signInSilently(): Promise<any>;
  signOut(): Promise<null | void>;
  revokeAccess(): Promise<null | void>;
  hasPreviousSignIn(): Promise<boolean>;
  getCurrentUser(): Promise<any>;
  clearCachedAccessToken(accessTokenString: string): Promise<null | void>;
  getTokens(): Promise<{ idToken: string; accessToken: string }>;
}
