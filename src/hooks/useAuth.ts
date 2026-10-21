import { useEffect, useState } from 'react';
import {
  authStore,
  clearAuthSession,
  hydrateAuthStore,
  isAuthStoreHydrated,
  setAuthUser,
  subscribeAuthStore,
  updateAuthUser,
} from '@/stores/auth.store';

export function useAuth() {
  const [user, setUser] = useState(() => authStore.user);
  const [isHydrated, setIsHydrated] = useState(() => isAuthStoreHydrated());

  useEffect(() => {
    setUser(authStore.user);
    hydrateAuthStore().then((hydrated) => {
      setIsHydrated(true);
      setUser(hydrated ?? authStore.user);
    });

    const unsubscribe = subscribeAuthStore(() => {
      setIsHydrated(isAuthStoreHydrated());
      setUser(authStore.user);
    });

    return unsubscribe;
  }, []);

  return {
    isAuthenticated: Boolean(user),
    isHydrated,
    user,
    setUser: setAuthUser,
    updateUser: updateAuthUser,
    clearSession: clearAuthSession,
  };
}
