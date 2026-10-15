/**
 * Ambient type definitions for @react-native-google-signin/google-signin
 * Matches the public API contract of the Google Sign-In SDK for React Native.
 */
declare module '@react-native-google-signin/google-signin' {
  export interface GoogleUser {
    id: string;
    name: string | null;
    email: string;
    photo: string | null;
    familyName: string | null;
    givenName: string | null;
  }

  export interface User {
    user: GoogleUser;
    idToken: string | null;
    serverAuthCode: string | null;
    scopes?: string[];
  }

  export interface SignInSuccessResponse {
    type: 'success';
    data: User;
  }

  export interface SignInCancelledResponse {
    type: 'cancelled';
  }

  export type SignInResponse = SignInSuccessResponse | SignInCancelledResponse;

  export interface ConfigureParams {
    webClientId?: string;
    iosClientId?: string;
    scopes?: string[];
    offlineAccess?: boolean;
    hostedDomain?: string;
    forceCodeForRefreshToken?: boolean;
    accountName?: string;
    googleServicePlistPath?: string;
    openIdRealm?: string;
    profileImageSize?: number;
  }

  export interface HasPlayServicesParams {
    showPlayServicesUpdateDialog?: boolean;
  }

  export interface GoogleSigninType {
    configure(params?: ConfigureParams): void;
    hasPlayServices(params?: HasPlayServicesParams): Promise<boolean>;
    signIn(): Promise<SignInResponse | User>;
    signInSilently(): Promise<SignInResponse | User>;
    signOut(): Promise<null | void>;
    revokeAccess(): Promise<null | void>;
    hasPreviousSignIn(): Promise<boolean>;
    getCurrentUser(): Promise<User | null>;
    clearCachedAccessToken(accessTokenString: string): Promise<null | void>;
    getTokens(): Promise<{ idToken: string; accessToken: string }>;
  }

  export const GoogleSignin: GoogleSigninType;

  export const statusCodes: {
    SIGN_IN_CANCELLED: string;
    IN_PROGRESS: string;
    PLAY_SERVICES_NOT_AVAILABLE: string;
    SIGN_IN_REQUIRED: string;
  };
}
