// The cooking characters people can show beside their name instead of their
// initials: picked from a gallery in Settings, stored as a key on the user
// (users.avatar). Drawn here as small inline SVGs, so there's nothing to
// upload or fetch, each with a gentle idle animation (a blink, a bob, a
// curl of steam) that public/app.css switches off for reduced motion.
// Original drawings: friendly faces on everyday foods and kitchen things.

import { type Html, raw } from "./html.ts";

export interface Character {
  key: string;
  name: string;
  // the wash behind the character, a token from public/app.css
  wash: string;
  svg: string;
}

// a pair of eyes that blink, and a smile, centred on (cx, cy)
const face = (cx: number, cy: number, s = 1, ink = "#2b2522") => `
  <g class="av-blink" style="transform-origin:${cx}px ${cy - 2 * s}px">
    <ellipse cx="${cx - 5 * s}" cy="${cy - 2 * s}" rx="${1.6 * s}" ry="${2 * s}" fill="${ink}"/>
    <ellipse cx="${cx + 5 * s}" cy="${cy - 2 * s}" rx="${1.6 * s}" ry="${2 * s}" fill="${ink}"/>
  </g>
  <path d="M${cx - 3.5 * s} ${cy + 2.5 * s} q${3.5 * s} ${3 * s} ${7 * s} 0" stroke="${ink}" stroke-width="${1.6 * s}" fill="none" stroke-linecap="round"/>
  <circle cx="${cx - 8.5 * s}" cy="${cy + 2 * s}" r="${1.8 * s}" fill="#f29a8f" opacity=".55"/>
  <circle cx="${cx + 8.5 * s}" cy="${cy + 2 * s}" r="${1.8 * s}" fill="#f29a8f" opacity=".55"/>`;

export const CHARACTERS: Character[] = [
  {
    key: "dumpling",
    name: "Dumpling",
    wash: "var(--butter)",
    svg: `<g class="av-bob"><path d="M10 34c0-11 9-19 20-19s20 8 20 19c0 4-4 6-20 6s-20-2-20-6z" fill="#fff7ea" stroke="#e7d3b3" stroke-width="1.5"/>
      <path d="M18 20q3 4 0 8M25 16q2 5 0 9M32 16q-2 5 0 9M39 19q-3 4 0 8" stroke="#e2c9a4" stroke-width="1.6" fill="none" stroke-linecap="round"/>${face(30, 31, 0.9)}</g>`,
  },
  {
    key: "avocado",
    name: "Avocado",
    wash: "var(--sage)",
    svg: `<g class="av-bob"><path d="M30 9c-9 0-15 12-15 23 0 9 6 16 15 16s15-7 15-16C45 21 39 9 30 9z" fill="#5f8f4e"/>
      <path d="M30 13c-7 0-12 10-12 19 0 7 5 13 12 13s12-6 12-13c0-9-5-19-12-19z" fill="#d9eaa6"/>
      <circle cx="30" cy="36" r="6" fill="#a9763f"/>${face(30, 24, 0.8)}</g>`,
  },
  {
    key: "whisk",
    name: "Whisk",
    wash: "var(--sky)",
    svg: `<g class="av-sway" style="transform-origin:30px 50px"><rect x="27" y="36" width="6" height="15" rx="3" fill="#c98b5a"/>
      <path d="M30 37C18 33 17 13 30 9c13 4 12 24 0 28z" fill="none" stroke="#8aa3b8" stroke-width="2"/>
      <path d="M30 37c-6-6-6-22 0-28M30 37c6-6 6-22 0-28" fill="none" stroke="#8aa3b8" stroke-width="1.6"/>
      <circle cx="30" cy="23" r="9" fill="#eef5fb" opacity=".9"/>${face(30, 24, 0.75)}</g>`,
  },
  {
    key: "teapot",
    name: "Teapot",
    wash: "var(--lavender)",
    svg: `<path class="av-steam" d="M40 12c-2-3 2-5 0-8" stroke="#b9b0dc" stroke-width="2" fill="none" stroke-linecap="round"/>
      <g class="av-bob"><path d="M14 30c0-8 7-13 16-13s16 5 16 13-5 14-16 14-16-6-16-14z" fill="#8b7fc7"/>
      <path d="M46 28c6 0 7 7 2 9" stroke="#8b7fc7" stroke-width="3.5" fill="none" stroke-linecap="round"/>
      <path d="M14 29c-5-3-7-8-5-9" stroke="#8b7fc7" stroke-width="3.5" fill="none" stroke-linecap="round"/>
      <rect x="25" y="13" width="10" height="5" rx="2.5" fill="#6d61ad"/>${face(30, 31, 0.9, "#fff")}</g>`,
  },
  {
    key: "strawberry",
    name: "Strawberry",
    wash: "var(--rose)",
    svg: `<g class="av-bob"><path d="M30 49C17 41 13 30 15 23c2-6 9-8 15-8s13 2 15 8c2 7-2 18-15 26z" fill="#e2524f"/>
      <path d="M22 16l8 5 8-5-3 7h-10z" fill="#4f9a55"/><path d="M30 21v-8" stroke="#4f9a55" stroke-width="2" stroke-linecap="round"/>
      <g fill="#ffd9a3"><circle cx="20" cy="27" r=".9"/><circle cx="40" cy="27" r=".9"/><circle cx="22" cy="37" r=".9"/><circle cx="38" cy="37" r=".9"/><circle cx="30" cy="42" r=".9"/></g>${face(30, 30, 0.85, "#3a1414")}</g>`,
  },
  {
    key: "pan",
    name: "Frying pan",
    wash: "var(--peach)",
    svg: `<g class="av-sway" style="transform-origin:30px 30px"><rect x="43" y="28" width="15" height="5" rx="2.5" fill="#6b5446"/>
      <circle cx="28" cy="30" r="17" fill="#3d3a39"/><circle cx="28" cy="30" r="13" fill="#56514e"/>
      <path d="M22 26c0-5 13-6 13 1 0 5-4 8-7 8-4 0-6-3-6-9z" fill="#fff"/><circle cx="28.5" cy="29" r="3.6" fill="#f6b73c"/></g>
      <g transform="translate(0 -2)">${face(28, 21, 0.6, "#fff")}</g>`,
  },
  {
    key: "carrot",
    name: "Carrot",
    wash: "var(--peach)",
    svg: `<g class="av-bob"><path d="M26 18h8l-2 32c-1 2-3 2-4 0z" fill="#f08a3c"/>
      <path d="M30 18c-4-6-9-7-11-5 3 0 7 2 9 5M30 18c0-7 3-10 5-10-1 3-2 7-3 10M30 18c4-5 9-6 11-4-3 0-7 2-9 4" fill="#5aa05f"/>
      <path d="M27 30h3M28 38h3" stroke="#d26f26" stroke-width="1.3" stroke-linecap="round"/>${face(30, 25, 0.6)}</g>`,
  },
  {
    key: "egg",
    name: "Egg",
    wash: "var(--butter)",
    svg: `<g class="av-bob"><path d="M30 10c-9 0-15 13-15 22 0 9 7 15 15 15s15-6 15-15c0-9-6-22-15-22z" fill="#fffaf2" stroke="#efe2cc" stroke-width="1.5"/>${face(30, 31, 0.95)}</g>`,
  },
  {
    key: "chilli",
    name: "Chilli",
    wash: "var(--rose)",
    svg: `<g class="av-sway" style="transform-origin:30px 14px"><path d="M27 15c-9 6-12 20-6 30 2 3 6 2 6-1-2-8 1-18 8-25z" fill="#d93d3a"/>
      <path d="M27 15c1-4 5-6 8-4" stroke="#4f9a55" stroke-width="3" fill="none" stroke-linecap="round"/>
      <g transform="rotate(-18 26 28)">${face(26, 29, 0.6, "#3a1414")}</g></g>`,
  },
  {
    key: "mushroom",
    name: "Mushroom",
    wash: "var(--surface-3)",
    svg: `<g class="av-bob"><path d="M12 30c0-11 8-18 18-18s18 7 18 18z" fill="#c9785a"/>
      <g fill="#f6e3d3"><circle cx="21" cy="21" r="2.5"/><circle cx="36" cy="18" r="2"/><circle cx="40" cy="26" r="1.8"/></g>
      <path d="M22 30h16v12c0 4-3 6-8 6s-8-2-8-6z" fill="#f4eadf"/>${face(30, 38, 0.65)}</g>`,
  },
  {
    key: "bread",
    name: "Bread",
    wash: "var(--butter)",
    svg: `<g class="av-bob"><path d="M12 26c0-8 8-12 18-12s18 4 18 12c0 3-2 4-3 4v14c0 2-1 3-3 3H18c-2 0-3-1-3-3V30c-1 0-3-1-3-4z" fill="#d79c5c"/>
      <path d="M17 29v14c0 1 1 2 2 2h22c1 0 2-1 2-2V29" fill="#f6dcae"/>${face(30, 35, 0.85)}</g>`,
  },
  {
    key: "onigiri",
    name: "Onigiri",
    wash: "var(--sage)",
    svg: `<g class="av-bob"><path d="M30 10c-4 0-17 22-17 30 0 5 6 8 17 8s17-3 17-8c0-8-13-30-17-30z" fill="#fdfdfb" stroke="#e5e3dc" stroke-width="1.5"/>
      <path d="M21 39h18v9c-3 1-6 1-9 1s-6 0-9-1z" fill="#2f3a32"/>${face(30, 30, 0.85)}</g>`,
  },
];

const BY_KEY = new Map(CHARACTERS.map((c) => [c.key, c]));

export function isCharacter(key: unknown): key is string {
  return typeof key === "string" && BY_KEY.has(key);
}

export function character(key: string | null | undefined): Character | undefined {
  return key ? BY_KEY.get(key) : undefined;
}

// The character's drawing, sized to fill its round badge. Trusted markup
// written above, never anything a person typed.
export function characterSvg(c: Character): Html {
  return raw(`<svg viewBox="0 0 60 60" role="presentation" focusable="false">${c.svg}</svg>`);
}
