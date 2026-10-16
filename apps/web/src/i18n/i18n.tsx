import { createContext, useCallback, useContext, useEffect, useMemo, useState, type ReactNode } from 'react';
import ru from './locales/ru.json';
import en from './locales/en.json';
import zhCN from './locales/zh-CN.json';

export type Locale = 'ru' | 'en' | 'zh-CN';

export const LOCALES: readonly Locale[] = ['ru', 'en', 'zh-CN'] as const;

export const LOCALE_LABELS: Record<Locale, string> = {
  ru: 'Русский',
  en: 'English',
  'zh-CN': '中文',
};

/** Nested translation tree; leaves are strings. */
type Tree = { [key: string]: string | Tree };

const DICTIONARIES: Record<Locale, Tree> = {
  ru: ru as Tree,
  en: en as Tree,
  'zh-CN': zhCN as Tree,
};

const STORAGE_KEY = 'flygit.locale';

function resolve(tree: Tree, path: string[]): string | undefined {
  let node: string | Tree | undefined = tree;
  for (const segment of path) {
    if (typeof node !== 'object' || node === null) return undefined;
    node = node[segment];
  }
  return typeof node === 'string' ? node : undefined;
}

interface I18nContextValue {
  locale: Locale;
  setLocale: (locale: Locale) => void;
  /** Translate a dot-separated key; falls back to English, then to the key. */
  t: (key: string, vars?: Record<string, string | number>) => string;
}

const I18nContext = createContext<I18nContextValue | null>(null);

function detectInitialLocale(): Locale {
  if (typeof window === 'undefined') return 'ru';
  const stored = window.localStorage.getItem(STORAGE_KEY);
  if (stored && (LOCALES as readonly string[]).includes(stored)) return stored as Locale;
  const nav = window.navigator.language.toLowerCase();
  if (nav.startsWith('zh')) return 'zh-CN';
  if (nav.startsWith('en')) return 'en';
  return 'ru';
}

export function I18nProvider({ children }: { children: ReactNode }) {
  const [locale, setLocaleState] = useState<Locale>(detectInitialLocale);

  useEffect(() => {
    document.documentElement.lang = locale;
    window.localStorage.setItem(STORAGE_KEY, locale);
  }, [locale]);

  const setLocale = useCallback((next: Locale) => setLocaleState(next), []);

  const t = useCallback(
    (key: string, vars?: Record<string, string | number>) => {
      const path = key.split('.');
      const primary = resolve(DICTIONARIES[locale], path) ?? resolve(DICTIONARIES.en, path) ?? key;
      if (!vars) return primary;
      return primary.replace(/\{(\w+)\}/g, (match, name: string) =>
        name in vars ? String(vars[name]) : match,
      );
    },
    [locale],
  );

  const value = useMemo<I18nContextValue>(() => ({ locale, setLocale, t }), [locale, setLocale, t]);

  return <I18nContext.Provider value={value}>{children}</I18nContext.Provider>;
}

export function useI18n(): I18nContextValue {
  const ctx = useContext(I18nContext);
  if (!ctx) throw new Error('useI18n must be used within I18nProvider');
  return ctx;
}

/** Convenience hook: just the translate function. */
export function useT(): I18nContextValue['t'] {
  return useI18n().t;
}
