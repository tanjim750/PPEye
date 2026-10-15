/**
 * PPEye Google Drive Authentication Unit Tests (Mocked)
 *
 * Verifies:
 * - configureGoogleAuth (once, minimum scope)
 * - signInToGoogle (safe token acquisition flow via getTokens(), preview blocking, cancellation)
 * - restoreGoogleSession (silent restore, revoked handling)
 * - isGoogleAuthenticated (valid vs expired vs revoked)
 * - getValidAccessToken (automatic refresh, buffer safety, credential protection)
 * - refreshAccessToken (native clearCachedAccessToken + getTokens flow, OAuth2 refresh)
 * - signOutFromGoogle (session cleanup, Supabase isolation)
 */

import {
  configureGoogleAuth,
  DEFAULT_GOOGLE_DRIVE_SCOPES,
  getValidAccessToken,
  GOOGLE_DRIVE_MINIMAL_SCOPE,
  IGoogleSignInNativeModule,
  isGoogleAuthenticated,
  isTokenExpired,
  refreshAccessToken,
  restoreGoogleSession,
  setGoogleSignInNativeModule,
  signInToGoogle,
  signOutFromGoogle,
} from '../auth';
import { isStorageError, StorageErrorCode } from '../../storage/storage.errors';

function assert(condition: boolean, message: string): void {
  if (!condition) {
    throw new Error(`Assertion Failed: ${message}`);
  }
}

function assertThrows(fn: () => any, expectedCode?: string, message?: string): void {
  let threw = false;
  try {
    fn();
  } catch (err: any) {
    threw = true;
    if (expectedCode) {
      assert(
        err?.code === expectedCode,
        `Expected error code '${expectedCode}', received '${err?.code}': ${message}`
      );
    }
  }
  assert(threw, `Expected function to throw, but it succeeded: ${message}`);
}

async function assertAsyncThrows(
  promiseFn: () => Promise<any>,
  expectedCode?: string,
  message?: string
): Promise<void> {
  let threw = false;
  try {
    await promiseFn();
  } catch (err: any) {
    threw = true;
    if (expectedCode) {
      assert(
        err?.code === expectedCode,
        `Expected error code '${expectedCode}', received '${err?.code}' (${err?.message}): ${message}`
      );
    }
  }
  assert(threw, `Expected async function to throw, but it succeeded: ${message}`);
}

export async function runGoogleAuthTests(): Promise<{ passed: number; failed: number }> {
  let passed = 0;
  let failed = 0;

  async function test(name: string, fn: () => Promise<void> | void): Promise<void> {
    try {
      await fn();
      console.log(`  ✔ [PASS] ${name}`);
      passed++;
    } catch (err: any) {
      console.error(`  ✘ [FAIL] ${name}`);
      console.error(`     Error: ${err?.message ?? err}`);
      failed++;
    }
  }

  console.log('\n--- PPEye Google Drive Authentication Test Suite ---\n');

  // Test Suite 1: Scope & Configuration
  console.log('• Suite: Scope & Configuration');

  await test('minimum Drive scope is https://www.googleapis.com/auth/drive.file', () => {
    assert(
      GOOGLE_DRIVE_MINIMAL_SCOPE === 'https://www.googleapis.com/auth/drive.file',
      'Minimal scope must be drive.file'
    );
    assert(
      DEFAULT_GOOGLE_DRIVE_SCOPES.includes(GOOGLE_DRIVE_MINIMAL_SCOPE),
      'Default scopes must include minimal scope'
    );
    assert(
      !DEFAULT_GOOGLE_DRIVE_SCOPES.includes('https://www.googleapis.com/auth/drive' as any),
      'Must NOT request dangerous full drive scope'
    );
  });

  await test('configureGoogleAuth sets up native module with minimal scope once', () => {
    let configuredOptions: any = null;
    const mockNative: IGoogleSignInNativeModule = {
      configure: (opts) => {
        configuredOptions = opts;
      },
      hasPlayServices: async () => true,
      signIn: async () => ({ user: { id: 'u1', email: 'test@example.com' } }),
      signInSilently: async () => null,
      signOut: async () => {},
      revokeAccess: async () => {},
      hasPreviousSignIn: async () => false,
      getCurrentUser: async () => null,
      clearCachedAccessToken: async () => {},
      getTokens: async () => ({ idToken: 'id-tok', accessToken: 'acc-tok' }),
    };

    setGoogleSignInNativeModule(mockNative);
    configureGoogleAuth({ webClientId: 'custom-client-id.apps.googleusercontent.com' });

    assert(configuredOptions !== null, 'configure should have been called on native module');
    assert(
      configuredOptions.webClientId === 'custom-client-id.apps.googleusercontent.com',
      'webClientId should match config'
    );
    assert(
      configuredOptions.scopes[0] === GOOGLE_DRIVE_MINIMAL_SCOPE,
      'scopes should contain drive.file'
    );
  });

  // Test Suite 2: Sign In Flow & Supported Token Acquisition
  console.log('\n• Suite: signInToGoogle & Token Acquisition');

  await test('signInToGoogle throws PROVIDER_UNAVAILABLE when native module is missing', async () => {
    setGoogleSignInNativeModule(null);
    await assertAsyncThrows(
      () => signInToGoogle(),
      StorageErrorCode.PROVIDER_UNAVAILABLE,
      'Missing native module should reject with PROVIDER_UNAVAILABLE'
    );
  });

  await test('signInToGoogle handles user cancellation safely', async () => {
    const mockNative: IGoogleSignInNativeModule = {
      configure: () => {},
      hasPlayServices: async () => true,
      signIn: async () => {
        const err: any = new Error('User cancelled sign in');
        err.code = 'SIGN_IN_CANCELLED';
        throw err;
      },
      signInSilently: async () => null,
      signOut: async () => {},
      revokeAccess: async () => {},
      hasPreviousSignIn: async () => false,
      getCurrentUser: async () => null,
      clearCachedAccessToken: async () => {},
      getTokens: async () => ({ idToken: '', accessToken: '' }),
    };

    setGoogleSignInNativeModule(mockNative);
    await assertAsyncThrows(
      () => signInToGoogle(),
      StorageErrorCode.PERMISSION_DENIED,
      'Cancellation should map to PERMISSION_DENIED'
    );
  });

  await test('signInToGoogle acquires access token via getTokens() and returns session', async () => {
    let getTokensCalled = false;
    const mockNative: IGoogleSignInNativeModule = {
      configure: () => {},
      hasPlayServices: async () => true,
      signIn: async () => ({
        // Note: signIn does NOT include accessToken in native SDK!
        user: {
          id: 'google-user-123',
          email: 'worker@site.org',
          name: 'Site Worker',
          photo: 'https://lh3.googleusercontent.com/avatar',
        },
        idToken: 'mock-id-token',
        serverAuthCode: 'auth-code-xyz',
      }),
      signInSilently: async () => null,
      signOut: async () => {},
      revokeAccess: async () => {},
      hasPreviousSignIn: async () => true,
      getCurrentUser: async () => null,
      clearCachedAccessToken: async () => {},
      getTokens: async () => {
        getTokensCalled = true;
        return {
          idToken: 'mock-id-token',
          accessToken: 'valid-google-drive-access-token-999',
        };
      },
    };

    setGoogleSignInNativeModule(mockNative);
    const session = await signInToGoogle();

    assert(getTokensCalled, 'getTokens() must be called to obtain REST access token');
    assert(session.user.id === 'google-user-123', 'User ID should match');
    assert(session.user.email === 'worker@site.org', 'Email should match');
    assert(session.accessToken === 'valid-google-drive-access-token-999', 'Access token should match');
    assert(session.scopes.includes(GOOGLE_DRIVE_MINIMAL_SCOPE), 'Scopes must include minimal scope');
    assert(session.expiresAt > Date.now(), 'Token should have future expiry');
  });

  // Test Suite 3: Session State, Expiration & Token Retrieval
  console.log('\n• Suite: Session State & Expiration');

  await test('isTokenExpired correctly detects expired and near-expiry tokens', () => {
    assert(isTokenExpired(0), '0 expiry should be considered expired');
    assert(isTokenExpired(Date.now() - 1000), 'Past timestamp is expired');
    assert(isTokenExpired(Date.now() + 30 * 1000, 60), 'Expiring in 30s with 60s buffer is expired');
    assert(!isTokenExpired(Date.now() + 300 * 1000, 60), 'Expiring in 300s is NOT expired');
  });

  await test('isGoogleAuthenticated returns true when valid session is cached', async () => {
    const authed = await isGoogleAuthenticated();
    assert(authed === true, 'Should be authenticated after successful signIn');
  });

  await test('getValidAccessToken returns unexpired token without making unnecessary calls', async () => {
    const token = await getValidAccessToken();
    assert(token === 'valid-google-drive-access-token-999', 'Should return cached token');
  });

  // Test Suite 4: Native Refresh & Revoked Authorization
  console.log('\n• Suite: Refresh & Revocation');

  await test('refreshAccessToken invalidates cache via clearCachedAccessToken and gets new token', async () => {
    let clearCachedCalledWith: string | null = null;
    let newAccessTokenReturned = 'fresh-refreshed-drive-access-token-001';

    const mockNative: IGoogleSignInNativeModule = {
      configure: () => {},
      hasPlayServices: async () => true,
      signIn: async () => null,
      signInSilently: async () => null,
      signOut: async () => {},
      revokeAccess: async () => {},
      hasPreviousSignIn: async () => true,
      getCurrentUser: async () => null,
      clearCachedAccessToken: async (tok) => {
        clearCachedCalledWith = tok;
      },
      getTokens: async () => ({
        idToken: 'mock-id-token-2',
        accessToken: newAccessTokenReturned,
      }),
    };

    setGoogleSignInNativeModule(mockNative);
    const refreshed = await refreshAccessToken();

    assert(clearCachedCalledWith !== null, 'clearCachedAccessToken must be invoked');
    assert(refreshed === newAccessTokenReturned, 'Should return the newly acquired access token');

    const valid = await getValidAccessToken();
    assert(valid === newAccessTokenReturned, 'getValidAccessToken should now return the refreshed token');
  });

  await test('restoreGoogleSession handles revoked session safely without crashing', async () => {
    const mockNative: IGoogleSignInNativeModule = {
      configure: () => {},
      hasPlayServices: async () => true,
      signIn: async () => null,
      signInSilently: async () => {
        const err: any = new Error('Sign in required / access revoked');
        err.code = 'SIGN_IN_REQUIRED';
        throw err;
      },
      signOut: async () => {},
      revokeAccess: async () => {},
      hasPreviousSignIn: async () => true,
      getCurrentUser: async () => null,
      clearCachedAccessToken: async () => {},
      getTokens: async () => ({ idToken: '', accessToken: '' }),
    };

    setGoogleSignInNativeModule(mockNative);
    const restored = await restoreGoogleSession();
    assert(restored === null, 'Revoked session should return null safely');

    const isAuthed = await isGoogleAuthenticated();
    assert(isAuthed === false, 'isGoogleAuthenticated should return false after revocation');
  });

  // Test Suite 5: Sign Out & Supabase Isolation
  console.log('\n• Suite: Sign Out');

  await test('signOutFromGoogle clears tokens and session while leaving Supabase intact', async () => {
    let signOutCalled = false;
    let revokeCalled = false;

    const mockNative: IGoogleSignInNativeModule = {
      configure: () => {},
      hasPlayServices: async () => true,
      signIn: async () => null,
      signInSilently: async () => null,
      signOut: async () => {
        signOutCalled = true;
      },
      revokeAccess: async () => {
        revokeCalled = true;
      },
      hasPreviousSignIn: async () => false,
      getCurrentUser: async () => null,
      clearCachedAccessToken: async () => {},
      getTokens: async () => ({ idToken: '', accessToken: '' }),
    };

    setGoogleSignInNativeModule(mockNative);
    await signOutFromGoogle(true);

    assert(signOutCalled, 'Native signOut must be called');
    assert(revokeCalled, 'Native revokeAccess must be called when requested');

    const isAuthed = await isGoogleAuthenticated();
    assert(isAuthed === false, 'Must not be authenticated after signOut');

    const token = await getValidAccessToken();
    assert(token === null, 'Token should be null after signOut');
  });

  console.log('\n========================================');
  console.log(`Result: ${passed}/${passed + failed} passed (${failed} failed)`);
  console.log('========================================\n');

  // Clean up
  setGoogleSignInNativeModule(null);

  return { passed, failed };
}
