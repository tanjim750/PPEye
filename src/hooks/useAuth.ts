import { authStore } from '@/stores/auth.store';

export function useAuth() {
  return {
    isAuthenticated: Boolean(authStore.user),
    user: authStore.user,
  };
}
