import i18n from 'i18next';
import { initReactI18next } from 'react-i18next';
import * as Localization from 'expo-localization';
import AsyncStorage from '@react-native-async-storage/async-storage';

import en from './locales/en.json';
import hr from './locales/hr.json';
import de from './locales/de.json';

// EN + HR + DE at launch (guide §2 "Locked decisions" — i18n from day one).
// Mirrors the web dashboard's HR/EN/DE support (ADMIN_T in
// shared/services/dashboard-language.service.ts) but uses i18next, the RN
// standard, instead of the dashboard's hand-rolled translation object.

const LANGUAGE_STORAGE_KEY = 'fixfly_language';
export const SUPPORTED_LANGUAGES = ['en', 'hr', 'de'] as const;
export type SupportedLanguage = (typeof SUPPORTED_LANGUAGES)[number];

function deviceLanguage(): SupportedLanguage {
  const tag = Localization.getLocales()[0]?.languageCode ?? 'en';
  return (SUPPORTED_LANGUAGES as readonly string[]).includes(tag) ? (tag as SupportedLanguage) : 'en';
}

export async function initI18n(): Promise<void> {
  const stored = await AsyncStorage.getItem(LANGUAGE_STORAGE_KEY);
  const initialLanguage = (stored as SupportedLanguage | null) ?? deviceLanguage();

  await i18n.use(initReactI18next).init({
    resources: {
      en: { translation: en },
      hr: { translation: hr },
      de: { translation: de },
    },
    lng: initialLanguage,
    fallbackLng: 'en',
    interpolation: { escapeValue: false },
  });
}

export async function setLanguage(lang: SupportedLanguage): Promise<void> {
  await i18n.changeLanguage(lang);
  await AsyncStorage.setItem(LANGUAGE_STORAGE_KEY, lang);
}

export default i18n;
