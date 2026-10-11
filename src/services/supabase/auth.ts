import { LoginCredentials } from '@/features/auth/types';
import { supabase } from '@/services/supabase/client';

export function signInWithPassword({ email, password }: LoginCredentials) {
  return supabase.auth.signInWithPassword({ email, password });
}

export function signOut() {
  return supabase.auth.signOut();
}
