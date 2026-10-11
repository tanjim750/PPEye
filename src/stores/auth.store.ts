import { AuthUser } from '@/features/auth/types';

type AuthState = {
  user: AuthUser | null;
};

export const authStore: AuthState = {
  user: null,
};
