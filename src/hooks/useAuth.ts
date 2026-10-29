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
  const [user, setUser] = useState(() => (authStore.user ? { ...authStore.user } : null));
  const [isHydrated, setIsHydrated] = useState(() => isAuthStoreHydrated());

  useEffect(() => {
    setUser(authStore.user ? { ...authStore.user } : null);
    hydrateAuthStore().then((hydrated) => {
      setIsHydrated(true);
      setUser(hydrated ? { ...hydrated } : authStore.user ? { ...authStore.user } : null);
    });

    const unsubscribe = subscribeAuthStore(() => {
      setIsHydrated(isAuthStoreHydrated());
      setUser(authStore.user ? { ...authStore.user } : null);
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
