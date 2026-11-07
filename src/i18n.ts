// The interface in the visitor's language. English is written in the code
// as it always was, and is also the key: `t("Save settings")` looks that
// sentence up in the chosen language's table and falls back to the English
// when a line has no translation yet, so a missing entry shows English, never
// a blank or a key. Only the interface is translated; recipes, ingredient
// names and what people write stay as they were written.
//
// The language is settled once per request (the `lang` cookie the picker
// sets, else the browser's Accept-Language, else English) and held for the
// rest of it, so the many helpers that build a page don't each need passing
// it. Code that runs outside a request (seeding, the expiry sweep) is English.

import { AsyncLocalStorage } from "node:async_hooks";
import type { IncomingMessage } from "node:http";
import { escape, Html } from "./html.ts";
import calendar, { browser as calendarB } from "./i18n/calendar.ts";
import household, { browser as householdB } from "./i18n/household.ts";
import kitchen, { browser as kitchenB } from "./i18n/kitchen.ts";
import live, { browser as liveB } from "./i18n/live.ts";
import people, { browser as peopleB } from "./i18n/people.ts";
import recipes, { browser as recipesB } from "./i18n/recipes.ts";
import reviews, { browser as reviewsB } from "./i18n/reviews.ts";
import shell from "./i18n/shell.ts";

export type Lang = "en" | "zh" | "es" | "hi";

// one area's lines (src/i18n/*.ts), each language keyed by the English
export type Part = Record<Exclude<Lang, "en">, Record<string, string>>;

// the picker's order, each named in its own language
export const UI_LANGUAGES: { code: Lang; name: string; tag: string }[] = [
  { code: "en", name: "English", tag: "en-AU" },
  { code: "zh", name: "中文（简体）", tag: "zh-Hans" },
  { code: "es", name: "Español", tag: "es" },
  { code: "hi", name: "हिन्दी", tag: "hi" },
];

const PARTS: Part[] = [shell, people, kitchen, recipes, reviews, calendar, household, live];
const BROWSER: Part[] = [peopleB, kitchenB, recipesB, reviewsB, calendarB, householdB, liveB];
const merge = (parts: Part[]): Part => {
  const out: Part = { zh: {}, es: {}, hi: {} };
  for (const p of parts) for (const l of ["zh", "es", "hi"] as const) Object.assign(out[l], p[l]);
  return out;
};
const TABLES = merge(PARTS);
const CLIENT = merge(BROWSER);

const store = new AsyncLocalStorage<Lang>();

export function isLang(s: string | null | undefined): s is Lang {
  return s === "en" || s === "zh" || s === "es" || s === "hi";
}

// the cookie wins; then the first of the browser's languages we have
export function langFor(req: IncomingMessage, cookieLang: string | undefined): Lang {
  if (isLang(cookieLang)) return cookieLang;
  for (const part of String(req.headers["accept-language"] ?? "").split(",")) {
    const base = part.split(";")[0].trim().toLowerCase().split("-")[0];
    if (isLang(base)) return base;
  }
  return "en";
}

export function withLang<T>(lang: Lang, fn: () => T): T {
  return store.run(lang, fn);
}

export function lang(): Lang {
  return store.getStore() ?? "en";
}

// the BCP 47 tag for <html lang>
export function langTag(): string {
  const l = lang();
  return UI_LANGUAGES.find((u) => u.code === l)!.tag;
}

// A line of the interface in the current language. `{name}` placeholders are
// filled from `vars` after translation, so a translation can move them.
export function t(english: string, vars?: Record<string, string | number>): string {
  const l = lang();
  let s = l === "en" ? english : (TABLES[l][english] ?? english);
  if (vars) s = s.replace(/\{(\w+)\}/g, (m, k) => (k in vars ? String(vars[k]) : m));
  return s;
}

// A line with markup in its gaps ("Added {name} to <the list>"): the
// translated text is escaped like any other, and each placeholder takes an
// Html part as it is, or a string escaped. Never raw() a translation.
export function th(english: string, vars: Record<string, Html | string | number>): Html {
  const l = lang();
  const s = l === "en" ? english : (TABLES[l][english] ?? english);
  let out = "";
  let last = 0;
  for (const m of s.matchAll(/\{(\w+)\}/g)) {
    out += escape(s.slice(last, m.index));
    const v = vars[m[1]];
    out += v === undefined ? escape(m[0]) : v instanceof Html ? v.value : escape(String(v));
    last = m.index! + m[0].length;
  }
  return new Html(out + escape(s.slice(last)));
}

// one of two forms by count: "1 item" / "3 items". Chinese and Hindi
// tables can give both the same translation.
export function tn(n: number, one: string, many: string, vars?: Record<string, string | number>): string {
  return t(n === 1 ? one : many, { n, ...vars });
}

// The lines the browser's scripts use (each area's `browser` part) in the
// current language, for a JSON <script> in the head (public/i18n.mjs reads
// it). English is the scripts' own text, so it sends nothing.
export function clientTable(): string {
  const l = lang();
  return l === "en" ? "{}" : JSON.stringify(CLIENT[l]).replace(/</g, "\\u003c");
}

// every area's lines, for the checks in spec/i18n.test.ts
export function allParts(): Part[] {
  return [...PARTS, ...BROWSER];
}
