import { login } from '@/features/auth/services/auth.service';

export function useLogin() {
  return {
    login,
  };
}
