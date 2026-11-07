// The interface in other languages, keyed by the English it replaces
// (src/i18n.ts). Lines from the people pages; see src/i18n/shell.ts for the frame.
import type { Part } from "../i18n.ts";

// what the server writes into pages
const part: Part = {
  zh: {},
  es: {},
  hi: {},
};
export default part;

// what this area's browser scripts show (public/*.mjs), sent to the page
export const browser: Part = {
  zh: {},
  es: {},
  hi: {},
};
