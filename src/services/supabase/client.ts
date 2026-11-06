import 'react-native-url-polyfill/auto';

import AsyncStorage from '@react-native-async-storage/async-storage';
import { createClient } from '@supabase/supabase-js';

import { authStore, hydrateAuthStore, isAuthStoreHydrated } from '@/stores/auth.store';
import type { Database } from '@/types/database.types';

const supabaseUrl = process.env.EXPO_PUBLIC_SUPABASE_URL ?? '';
const supabaseAnonKey =
  process.env.EXPO_PUBLIC_SUPABASE_ANON_KEY ?? process.env.EXPO_PUBLIC_SUPABASE_KEY ?? '';

const isServer = typeof window === 'undefined';

let pendingAuthEmail: string | null = null;

export function setPendingAuthEmail(email: string | null): void {
  pendingAuthEmail = email ? email.trim().toLowerCase() : null;
}

const ppeyeFetch: typeof fetch = async (input, init) => {
  const urlStr =
    typeof input === 'string'
      ? input
      : input instanceof URL
        ? input.toString()
        : (input as any)?.url || '';

  if (!pendingAuthEmail && !isServer && !isAuthStoreHydrated() && urlStr.includes('/rest/v1/')) {
    try {
      await hydrateAuthStore();
    } catch {}
  }

  const activeUser = authStore.user;
  const email = (pendingAuthEmail || activeUser?.email || '').trim().toLowerCase();
  const numericId = Number(activeUser?.id);
  const uid =
    !pendingAuthEmail && Number.isFinite(numericId) && numericId > 0 ? String(numericId) : '';

  if (email || uid) {
    const headers = new Headers(
      init?.headers ||
        (typeof Request !== 'undefined' && input instanceof Request ? input.headers : undefined)
    );
    const baseClientInfo = (headers.get('x-client-info') || 'ppeye-app').split('|ppeye_')[0];
    const suffix = `${uid ? `|ppeye_uid=${uid}` : ''}${email ? `|ppeye_email=${email}` : ''}`;
    headers.set('x-client-info', `${baseClientInfo}${suffix}`);
    return fetch(input, { ...init, headers });
  }

  return fetch(input, init);
};

const ssrSafeStorage = {
  getItem: (key: string) => {
    if (isServer) {
      return Promise.resolve(null);
    }
    return AsyncStorage.getItem(key);
  },
  setItem: (key: string, value: string) => {
    if (isServer) {
      return Promise.resolve();
    }
    return AsyncStorage.setItem(key, value);
  },
  removeItem: (key: string) => {
    if (isServer) {
      return Promise.resolve();
    }
    return AsyncStorage.removeItem(key);
  },
};

export const supabase = createClient<Database>(supabaseUrl, supabaseAnonKey, {
  auth: {
    autoRefreshToken: !isServer,
    detectSessionInUrl: false,
    persistSession: true,
    storage: ssrSafeStorage,
  },
  global: {
    fetch: ppeyeFetch,
  },
});


