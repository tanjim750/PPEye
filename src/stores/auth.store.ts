import AsyncStorage from '@react-native-async-storage/async-storage';
import { AuthUser } from '@/features/auth/types';

type AuthState = {
  user: AuthUser | null;
};

const LEGACY_AUTH_STORAGE_KEY = 'ppeye:auth:user_session_v1';
const PROFILE_OVERRIDES_KEY = 'ppeye:auth:profile_overrides_v1';

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
 * Hydrates store metadata on cold start and purges any legacy persisted session
 * so every cold start requires explicit authentication on the Login screen.
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
  if (!user) {
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

export function updateProfilePicture(url: string): void {
  if (!currentUser) return;
  currentUser = { ...currentUser, profilePictureUrl: url };
  void saveProfileOverride(currentUser);
  notifyListeners();
}

export function clearAuthSession(): void {
  currentUser = null;
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
