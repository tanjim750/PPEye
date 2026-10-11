import { LoginCredentials } from '@/features/auth/types';
import { signInWithPassword, signOut } from '@/services/supabase/auth';

export async function login(credentials: LoginCredentials) {
  return signInWithPassword(credentials);
}

export async function logout() {
  return signOut();
}
