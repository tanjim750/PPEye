import AsyncStorage from '@react-native-async-storage/async-storage';
import { AuthUser } from '@/features/auth/types';

type AuthState = {
  user: AuthUser | null;
};

const LEGACY_AUTH_STORAGE_KEY = 'ppeye:auth:user_session_v1';
const PROFILE_OVERRIDES_KEY = 'ppeye:auth:profile_overrides_v1';

type ProfileOverride = Pick<
  Partial<AuthUser>,
  'name' | 'email' | 'phone' | 'designation' | 'projectName' | 'vendorName'
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
  if (typeof window === 'undefined' || !user?.id) return;
  try {
    const key = String(user.id);
    profileOverridesCache[key] = {
      name: user.name,
      email: user.email,
      phone: user.phone,
      designation: user.designation,
      projectName: user.projectName,
      vendorName: user.vendorName,
    };
    await AsyncStorage.setItem(
      PROFILE_OVERRIDES_KEY,
      JSON.stringify(profileOverridesCache)
    );
  } catch {}
}

/**
 * Hydrates store metadata on cold start and purges any legacy persisted session
 * so every cold start requires explicit authentication on the Login screen.
 */
export async function hydrateAuthStore(): Promise<AuthUser | null> {
  if (isHydrated || typeof window === 'undefined') {
    return currentUser;
  }
  if (hydrationPromise) {
    return hydrationPromise;
  }

  hydrationPromise = (async () => {
    try {
      const [, rawOverrides] = await Promise.all([
        AsyncStorage.removeItem(LEGACY_AUTH_STORAGE_KEY),
        AsyncStorage.getItem(PROFILE_OVERRIDES_KEY),
      ]);
      if (rawOverrides) {
        const parsed = JSON.parse(rawOverrides);
        if (parsed && typeof parsed === 'object') {
          profileOverridesCache = parsed;
        }
      }
    } catch {
      // Ignore storage errors
    } finally {
      isHydrated = true;
      hydrationPromise = null;
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
    const override = profileOverridesCache[String(user.id)];
    currentUser = override ? { ...user, ...override } : user;
  } else {
    currentUser = null;
  }
  isHydrated = true;
  if (typeof window !== 'undefined' && !user) {
    void AsyncStorage.removeItem(LEGACY_AUTH_STORAGE_KEY).catch(() => {});
  }
  notifyListeners();
}

export function updateAuthUser(patch: Partial<AuthUser>): void {
  if (!currentUser) return;
  currentUser = { ...currentUser, ...patch };
  void saveProfileOverride(currentUser);
  notifyListeners();
}

export function clearAuthSession(): void {
  currentUser = null;
  if (typeof window !== 'undefined') {
    void AsyncStorage.removeItem(LEGACY_AUTH_STORAGE_KEY).catch(() => {});
  }
  notifyListeners();
}

export const authStore: AuthState = {
  get user() {
    return currentUser;
  },
  set user(nextUser: AuthUser | null) {
    setAuthUser(nextUser);
  },
};
