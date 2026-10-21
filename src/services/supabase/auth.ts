import { LoginCredentials } from '@/features/auth/types';
import { supabase } from '@/services/supabase/client';

export function signInWithPassword({ email, password }: LoginCredentials) {
  return supabase.auth.signInWithPassword({ email, password });
}

export function signOut() {
  return supabase.auth.signOut();
}

export function getCurrentSession() {
  return supabase.auth.getSession();
}

export function updatePassword(password: string) {
  return supabase.auth.updateUser({ password });
}

export function requestPasswordReset(email: string) {
  return supabase.auth.resetPasswordForEmail(email);
}
