import { en } from './en';
import { zhTW } from './zh-TW';

/**
 * Interface language (D9.1). `zh-TW` is the source of every text; another language may translate any
 * part of it, and what it does not translate shows in `zh-TW` rather than as a hole.
 */
export type Locale = 'zh-TW' | 'en';
export const LOCALES: readonly Locale[] = ['zh-TW', 'en'];
export const DEFAULT_LOCALE: Locale = 'zh-TW';

export type MessageKey = keyof typeof zhTW;
type Template<K extends MessageKey> = (typeof zhTW)[K];

/** The `{name}`s of a template, as a union of string literals. */
export type Placeholders<S extends string> = S extends `${string}{${infer P}}${infer R}` ? P | Placeholders<R> : never;
export type Params<K extends MessageKey> = [Placeholders<Template<K>>] extends [never] ? [] : [params: Record<Placeholders<Template<K>>, string | number>];
/** Keys whose text has no placeholders: what a plain label may use. */
export type PlainKey = { [K in MessageKey]: [Placeholders<Template<K>>] extends [never] ? K : never }[MessageKey];

export type Translation = Partial<Record<MessageKey, string>>;

const catalogs: Record<Locale, Translation> = { 'zh-TW': zhTW, en };
let current: Locale = DEFAULT_LOCALE;
const listeners = new Set<() => void>();

export const getLocale = (): Locale => current;

/** Switches the language of every text produced from now on. Texts already produced keep the language they had. */
export function setLocale(locale: Locale): void {
  if (locale === current) return;
  current = locale;
  for (const fn of listeners) fn();
}

/** For `useSyncExternalStore`: called whenever the language changes. */
export function subscribeLocale(fn: () => void): () => void {
  listeners.add(fn);
  return () => listeners.delete(fn);
}

/** Adds (or replaces) translated texts of a language. Partial by design; `zh-TW` itself cannot be replaced. */
export function registerTranslation(locale: Exclude<Locale, 'zh-TW'>, messages: Translation): void {
  catalogs[locale] = { ...catalogs[locale], ...messages };
  if (locale === current) for (const fn of listeners) fn();
}

/** The text of a message in the current language, its placeholders filled. */
export function t<K extends MessageKey>(key: K, ...args: Params<K>): string {
  const template = catalogs[current][key] ?? zhTW[key];
  const params = (args[0] ?? {}) as Record<string, string | number>;
  return template.replace(/\{(\w+)\}/g, (whole, name: string) => (name in params ? String(params[name]) : whole));
}

/** Whether the catalog has this key (a key made up at run time, like a help topic's, may not). */
export function hasText(key: string): key is MessageKey {
  return key in zhTW;
}

/** The text of a key made up at run time, or `undefined` when there is none (in the current language, else `zh-TW`). */
export function textOf(key: string): string | undefined {
  return hasText(key) ? (catalogs[current][key] ?? zhTW[key]) : undefined;
}

/**
 * An object of texts that reads them when they are asked for, so a table written once at module level
 * (`FEATURE_LABEL`) follows the language: `labelsOf({ a: 'x.a' }).a` is `t('x.a')` at the time of the read.
 */
export function labelsOf<K extends string>(keys: Record<K, PlainKey>): Record<K, string> {
  const out = {} as Record<K, string>;
  for (const k of Object.keys(keys) as K[]) Object.defineProperty(out, k, { enumerable: true, get: () => t(keys[k] as never) });
  return out;
}

/** The placeholder names of a template; used by the test that a translation keeps them. */
export function placeholdersOf(template: string): string[] {
  return [...new Set([...template.matchAll(/\{(\w+)\}/g)].map((m) => m[1]!))].sort();
}

export { en, zhTW };
