import AsyncStorage from '@react-native-async-storage/async-storage';

import { supportedLanguages } from '@/i18n/config';
import { SupportedLanguage } from '@/i18n/types';

const languagePreferenceKey = 'ppeye:onboarding:languagePreference';

function isSupportedLanguage(value: string | null): value is SupportedLanguage {
  return supportedLanguages.includes(value as SupportedLanguage);
}

export async function storeLanguagePreference(language: SupportedLanguage) {
  if (typeof window === 'undefined') return;
  await AsyncStorage.setItem(languagePreferenceKey, language);
}

export async function getLanguagePreference() {
  if (typeof window === 'undefined') return null;
  const language = await AsyncStorage.getItem(languagePreferenceKey);
  return isSupportedLanguage(language) ? language : null;
}

export async function hasLanguagePreference() {
  return (await getLanguagePreference()) !== null;
}

