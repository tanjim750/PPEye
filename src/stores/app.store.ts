import { defaultLanguage } from '@/i18n/config';
import { SupportedLanguage } from '@/i18n/types';

type AppState = {
  language: SupportedLanguage;
};

export const appStore: AppState = {
  language: defaultLanguage,
};
