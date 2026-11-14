import { cookies } from "next/headers";
import { LOCALES, DEFAULT_LOCALE, type Locale } from "@sichttakt/shared";
import de, { type Messages } from "./de";
import en from "./en";
import tr from "./tr";

const dictionaries: Record<Locale, Messages> = { de, en, tr };
export const LOCALE_COOKIE = "st_locale";

/** Locale: explicit cookie → German default (product default for the DE market; Accept-Language is NOT used to override). */
export async function getLocale(): Promise<Locale> {
  const c = (await cookies()).get(LOCALE_COOKIE)?.value;
  return (LOCALES as readonly string[]).includes(c ?? "") ? (c as Locale) : DEFAULT_LOCALE;
}

export async function getMessages() {
  const locale = await getLocale();
  return { locale, t: dictionaries[locale] };
}

export const intlLocale = (l: Locale) => ({ de: "de-DE", en: "en-GB", tr: "tr-TR" })[l];

export function fmt(template: string, vars: Record<string, string>) {
  return template.replace(/\{(\w+)\}/g, (_, k: string) => vars[k] ?? `{${k}}`);
}
