import i18n from 'i18next';
import { initReactI18next } from 'react-i18next';

import authBn from '@/i18n/locales/bn/auth.json';
import commonBn from '@/i18n/locales/bn/common.json';
import homeBn from '@/i18n/locales/bn/home.json';
import reviewBn from '@/i18n/locales/bn/review.json';
import settingsBn from '@/i18n/locales/bn/settings.json';
import submissionBn from '@/i18n/locales/bn/submission.json';
import authEn from '@/i18n/locales/en/auth.json';
import commonEn from '@/i18n/locales/en/common.json';
import homeEn from '@/i18n/locales/en/home.json';
import reviewEn from '@/i18n/locales/en/review.json';
import settingsEn from '@/i18n/locales/en/settings.json';
import submissionEn from '@/i18n/locales/en/submission.json';
import { defaultLanguage } from '@/i18n/config';

export const resources = {
  bn: {
    auth: authBn,
    common: commonBn,
    home: homeBn,
    review: reviewBn,
    settings: settingsBn,
    submission: submissionBn,
  },
  en: {
    auth: authEn,
    common: commonEn,
    home: homeEn,
    review: reviewEn,
    settings: settingsEn,
    submission: submissionEn,
  },
};

if (!i18n.isInitialized) {
  i18n.use(initReactI18next).init({
    compatibilityJSON: 'v4',
    defaultNS: 'common',
    fallbackLng: defaultLanguage,
    interpolation: {
      escapeValue: false,
    },
    lng: defaultLanguage,
    resources,
  });
}

export default i18n;
