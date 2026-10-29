import AsyncStorage from '@react-native-async-storage/async-storage';
import { AuthUser } from '@/features/auth/types';

type AuthState = {
  user: AuthUser | null;
};

// Storage keys for persisting authentication sessions and local profile overrides
const LEGACY_AUTH_STORAGE_KEY = 'ppeye:auth:user_session_v1';
const AUTH_SESSION_KEY = 'ppeye:auth:user_session_v2';
const PROFILE_OVERRIDES_KEY = 'ppeye:auth:profile_overrides_v1';

// Session lifetime: 7 consecutive days (7 * 24 hours)
const SESSION_TTL_MS = 7 * 24 * 60 * 60 * 1000;

type StoredSession = {
  user: AuthUser;
  savedAt: number;
  expiresAt: number;
};

type ProfileOverride = Pick<
  Partial<AuthUser>,
  'name' | 'email' | 'phone' | 'designation' | 'projectName' | 'vendorName' | 'profilePictureUrl'
>;

let currentUser: AuthUser | null = null;
let isHydrated = false;
let hydrationPromise: Promise<AuthUser | null> | null = null;
let profileOverridesCache: Record<string, ProfileOverride> = {};
const listeners = new Set<() => void>();

function notifyListeners() {
  listeners.forEach((listener) => {
    try {
      listener();
    } catch {}
  });
}

async function saveProfileOverride(user: AuthUser) {
  if (!user?.id) return;
  try {
    const key = String(user.id);
    profileOverridesCache[key] = {
      name: user.name,
      email: user.email,
      phone: user.phone,
      designation: user.designation,
      projectName: user.projectName,
      vendorName: user.vendorName,
      profilePictureUrl: user.profilePictureUrl,
    };
    await AsyncStorage.setItem(
      PROFILE_OVERRIDES_KEY,
      JSON.stringify(profileOverridesCache)
    );
  } catch {}
}

/**
 * Persists user session to AsyncStorage with 7-day expiration timestamp.
 * Allows user to remain logged in across app restarts without re-entering credentials.
 */
async function persistSession(user: AuthUser | null) {
  try {
    if (!user || !user.id) {
      await AsyncStorage.removeItem(AUTH_SESSION_KEY);
      return;
    }
    const session: StoredSession = {
      user,
      savedAt: Date.now(),
      expiresAt: Date.now() + SESSION_TTL_MS,
    };
    await AsyncStorage.setItem(AUTH_SESSION_KEY, JSON.stringify(session));
  } catch {}
}

/**
 * Hydrates authentication session on app start.
 * If current time is within 7 days of login, session is restored automatically.
 * Expired sessions are cleanly purged.
 */
export async function hydrateAuthStore(): Promise<AuthUser | null> {
  if (isHydrated) {
    return currentUser;
  }
  if (hydrationPromise) {
    return hydrationPromise;
  }

  hydrationPromise = (async () => {
    try {
      const [rawSession, rawOverrides] = await Promise.all([
        AsyncStorage.getItem(AUTH_SESSION_KEY),
        AsyncStorage.getItem(PROFILE_OVERRIDES_KEY),
        AsyncStorage.removeItem(LEGACY_AUTH_STORAGE_KEY).catch(() => {}),
      ]);
      if (rawOverrides) {
        try {
          const parsed = JSON.parse(rawOverrides);
          if (parsed && typeof parsed === 'object') {
            profileOverridesCache = parsed;
          }
        } catch {}
      }

      if (rawSession) {
        try {
          const parsedSession: StoredSession = JSON.parse(rawSession);
          if (parsedSession && parsedSession.user && typeof parsedSession.expiresAt === 'number') {
            if (Date.now() < parsedSession.expiresAt) {
              currentUser = parsedSession.user;
            } else {
              // Purge expired 7-day session
              await AsyncStorage.removeItem(AUTH_SESSION_KEY);
              currentUser = null;
            }
          }
        } catch {
          await AsyncStorage.removeItem(AUTH_SESSION_KEY);
        }
      }
    } catch {
      // Ignore storage errors
    } finally {
      isHydrated = true;
      hydrationPromise = null;
      if (currentUser && currentUser.id) {
        const override = profileOverridesCache[String(currentUser.id)];
        if (override) {
          currentUser = { ...currentUser, ...override };
        }
      }
      notifyListeners();
    }
    return currentUser;
  })();

  return hydrationPromise;
}

export function isAuthStoreHydrated(): boolean {
  return isHydrated;
}

export function subscribeAuthStore(listener: () => void): () => void {
  listeners.add(listener);
  return () => {
    listeners.delete(listener);
  };
}

export function setAuthUser(user: AuthUser | null): void {
  if (user && user.id) {
    currentUser = { ...user };
  } else {
    currentUser = null;
  }
  isHydrated = true;
  void persistSession(currentUser);
  notifyListeners();
}

export function updateAuthUser(patch: Partial<AuthUser>): void {
  if (!currentUser) return;
  currentUser = { ...currentUser, ...patch };
  void saveProfileOverride(currentUser);
  void persistSession(currentUser);
  notifyListeners();
}

export function updateProfilePicture(url: string): void {
  if (!currentUser) return;
  currentUser = { ...currentUser, profilePictureUrl: url };
  void saveProfileOverride(currentUser);
  void persistSession(currentUser);
  notifyListeners();
}

export function clearAuthSession(): void {
  currentUser = null;
  void AsyncStorage.removeItem(AUTH_SESSION_KEY).catch(() => {});
  void AsyncStorage.removeItem(LEGACY_AUTH_STORAGE_KEY).catch(() => {});
  notifyListeners();
}

export const authStore = {
  get user(): AuthUser | null {
    return currentUser;
  },
  set user(nextUser: AuthUser | null) {
    if (nextUser && currentUser && String(nextUser.id) === String(currentUser.id)) {
      currentUser = { ...currentUser, ...nextUser };
      void saveProfileOverride(currentUser);
      void persistSession(currentUser);
      notifyListeners();
    } else {
      setAuthUser(nextUser);
      if (nextUser) {
        void saveProfileOverride(nextUser);
      }
    }
  },
  setProfilePictureUrl: updateProfilePicture,
  updateUser: updateAuthUser,
};
