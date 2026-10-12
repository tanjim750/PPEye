import React, { createContext, useContext, useEffect, useState, useCallback, useMemo } from 'react';
import { I18nextProvider } from 'react-i18next';

import i18n from '@/i18n';
import { SupportedLanguage } from '@/i18n/types';
import { appStore } from '@/stores/app.store';
import {
  getLanguagePreference,
  storeLanguagePreference,
} from '@/services/onboarding/languagePreference';

type LanguageContextValue = {
  language: SupportedLanguage;
  setLanguage: (lang: SupportedLanguage) => void;
};

const LanguageContext = createContext<LanguageContextValue>({
  language: appStore.language || 'en',
  setLanguage: () => {},
});

export function LanguageProvider({ children }: { children: React.ReactNode }) {
  const [language, setLanguageState] = useState<SupportedLanguage>(
    appStore.language || (i18n.language as SupportedLanguage) || 'en'
  );

  useEffect(() => {
    let isMounted = true;
    async function loadSavedLanguage() {
      const stored = await getLanguagePreference();
      if (isMounted && stored && (stored === 'en' || stored === 'bn')) {
        setLanguageState(stored);
        appStore.language = stored;
        i18n.changeLanguage(stored);
      }
    }
    loadSavedLanguage();
    return () => {
      isMounted = false;
    };
  }, []);

  const setLanguage = useCallback((nextLanguage: SupportedLanguage) => {
    setLanguageState(nextLanguage);
    appStore.language = nextLanguage;
    i18n.changeLanguage(nextLanguage);
    storeLanguagePreference(nextLanguage);
  }, []);

  const contextValue = useMemo(
    () => ({
      language,
      setLanguage,
    }),
    [language, setLanguage]
  );

  return (
    <LanguageContext.Provider value={contextValue}>
      <I18nextProvider i18n={i18n}>
        {children}
      </I18nextProvider>
    </LanguageContext.Provider>
  );
}

export function useLanguage() {
  const context = useContext(LanguageContext);
  return context;
}
