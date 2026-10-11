import { SupportedLanguage } from '@/i18n/types';

export const defaultLanguage: SupportedLanguage = 'en';

export const supportedLanguages: SupportedLanguage[] = ['en', 'bn'];

export const namespaces = ['common', 'auth', 'home', 'submission', 'review', 'settings'] as const;
