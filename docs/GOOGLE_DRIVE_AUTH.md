# PPEye Google Drive Authentication & Expo Development Build Guide

This document describes the architecture, token acquisition lifecycle, configuration, and Expo Development Build requirements for Google Drive authorization in PPEye.

---

## 1. Architecture Overview & Separation of Concerns

PPEye maintains a strict separation between **Application Authentication** and **Storage Authorization**:

| Concern | Provider | Role in PPEye |
| :--- | :--- | :--- |
| **App Authentication** | **Supabase Auth** | User identity, phone/email login, roles (`VENDOR`, `REVIEWER`, `ADMIN`), app sessions, RLS security policies. |
| **Storage Authorization** | **Google Drive OAuth** | Obtaining delegated OAuth access tokens strictly for uploading, downloading, and managing evidence photos in Google Drive. |

> [!IMPORTANT]
> Google Drive authorization **never** overrides or alters the Supabase authentication session. Signing out of Google Drive clears Drive tokens without logging the user out of PPEye.

---

## 2. Minimal Compatible Drive Scope

To comply with the principle of least privilege and Google OAuth Verification guidelines, PPEye requests **only** the minimum compatible Drive scope:

```typescript
export const GOOGLE_DRIVE_MINIMAL_SCOPE = 'https://www.googleapis.com/auth/drive.file';
```

- **`https://www.googleapis.com/auth/drive.file`**: Grants read and write access **only** to files and folders created or opened by PPEye.
- PPEye **never** requests `https://www.googleapis.com/auth/drive` (which requests access to all private files in the user's entire Drive).

---

## 3. Supported Token Acquisition & Refresh Lifecycle

Native Google Sign-In (`@react-native-google-signin/google-signin`) on Android/iOS wraps Google Play Services and the iOS GoogleSignIn SDK. It behaves differently than web OAuth:

1. **Sign-In (`signInToGoogle`)**:
   - Calling `GoogleSignin.signIn()` performs the authentication prompt and returns user identity (`idToken`, `user`).
   - **Crucial SDK Detail**: `signIn()` **does not** return the OAuth `accessToken` for Google Drive REST APIs!
   - PPEye immediately invokes `GoogleSignin.getTokens()` to retrieve `{ accessToken, idToken }`.

2. **Native Refresh (`refreshAccessToken`)**:
   - Native Google Sign-In does not expose raw OAuth refresh tokens to JavaScript; Google Play Services manages refresh tokens internally.
   - To refresh an expired access token natively:
     1. PPEye calls `GoogleSignin.clearCachedAccessToken(currentToken)`.
     2. PPEye invokes `GoogleSignin.getTokens()`, triggering Google Play Services to exchange its internal refresh token for a brand new REST `accessToken`.

3. **Fallback Refresh (Server / Service)**:
   - If `EXPO_PUBLIC_GOOGLE_REFRESH_TOKEN`, `EXPO_PUBLIC_GOOGLE_CLIENT_ID`, and `EXPO_PUBLIC_GOOGLE_CLIENT_SECRET` are configured, PPEye supports fallback refresh via Google's `https://oauth2.googleapis.com/token` endpoint.

4. **Silent Restore (`restoreGoogleSession`)**:
   - On app launch, PPEye calls `GoogleSignin.signInSilently()` and `GoogleSignin.getTokens()` without displaying an interactive prompt.
   - If authorization was revoked, PPEye catches `SIGN_IN_REQUIRED`, clears the local token cache safely, and flags the session as unauthenticated.

---

## 4. Expo Development Build Requirements

Because `@react-native-google-signin/google-signin` relies on native binaries (Java/Kotlin for Android Play Services, Objective-C/Swift for iOS), **it cannot run in the pre-compiled standard Expo Go app**. An **Expo Development Build** is required.

### Step 1: Install Package & Config Plugin

When preparing the development build in your local environment with network access:

```bash
npx expo install @react-native-google-signin/google-signin
```

### Step 2: Configure `app.json`

Add the config plugin and Google services configuration to `app.json`:

```json
{
  "expo": {
    "name": "PPEye",
    "slug": "PPEye",
    "scheme": "ppeye",
    "android": {
      "package": "com.tanjim.abubokor.PPEye",
      "googleServicesFile": "./google-services.json"
    },
    "ios": {
      "bundleIdentifier": "com.tanjim.abubokor.PPEye",
      "googleServicesFile": "./GoogleService-Info.plist"
    },
    "plugins": [
      "expo-router",
      [
        "@react-native-google-signin/google-signin",
        {
          "iosUrlScheme": "com.googleusercontent.apps.YOUR-IOS-CLIENT-ID"
        }
      ]
    ]
  }
}
```

### Step 3: Google Cloud Console Credentials

1. **Android Client ID**:
   - Package name: `com.tanjim.abubokor.PPEye`
   - SHA-1 fingerprint: Obtain via `cd android && ./gradlew signingReport` or from your EAS credentials.
   - Download the generated `google-services.json` and place it in the project root.
2. **Web Client ID (Required for Android Drive Scopes)**:
   - Create a **Web application** OAuth 2.0 Client ID in Google Cloud Console.
   - Configure `EXPO_PUBLIC_GOOGLE_CLIENT_ID=<YOUR_WEB_CLIENT_ID>.apps.googleusercontent.com` in `.env`.
   - Android Google Play Services requires the Web Client ID passed to `webClientId` to request Drive scopes and server auth codes.
3. **iOS Client ID**:
   - Create an iOS application client ID with bundle identifier `com.tanjim.abubokor.PPEye`.
   - Download `GoogleService-Info.plist` and place it in the project root.

### Step 4: Run the Development Build

Generate the native code and compile the custom development build:

```bash
# Android
npx expo run:android

# iOS (macOS only)
npx expo run:ios

# Or build via EAS Build
eas build --profile development --platform android
```

---

## 5. Preview & Test Safety

PPEye includes safety checks (`isExpoPreviewOrGo()`):
- Interactive sign-in is **blocked** during Expo Go and web previews to prevent native crashes.
- In unit testing and CI, `setGoogleSignInNativeModule(mockModule)` provides mock dependency injection without requiring Google Play Services or active network connections.
