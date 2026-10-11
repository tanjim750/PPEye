import { useCallback, useSyncExternalStore } from 'react';

import i18n from '@/i18n';
import { SupportedLanguage } from '@/i18n/types';
import { appStore } from '@/stores/app.store';

const listeners = new Set<() => void>();

function emit() {
  listeners.forEach((listener) => listener());
}

function subscribe(listener: () => void) {
  listeners.add(listener);
  return () => listeners.delete(listener);
}

export function useLanguage() {
  const language = useSyncExternalStore(
    subscribe,
    () => appStore.language,
    () => appStore.language,
  );

  const setLanguage = useCallback((nextLanguage: SupportedLanguage) => {
    appStore.language = nextLanguage;
    i18n.changeLanguage(nextLanguage);
    emit();
  }, []);

  return {
    language,
    setLanguage,
  };
}
