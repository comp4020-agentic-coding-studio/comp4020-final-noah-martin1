// Which language a review is written in, decided by plain code when it's
// posted: the review list can be filtered by it, and the translate button
// knows which translator to load. Scripts settle most languages outright
// (Chinese, Japanese, Korean, Thai, Arabic, Greek, Hindi...); languages in
// Latin letters are told apart by their commonest short words and their
// accented letters. Too little to go on ("yum!", "10/10", an emoji) is
// "und", undetermined: never guessed, and never offered for translation.

export interface Language {
  code: string;
  name: string;
}

// Languages the site can name, filter by and (when a translator exists for
// it, public/review-translate-worker.mjs) translate into English.
export const LANGUAGES: Record<string, string> = {
  en: "English",
  zh: "Chinese",
  ja: "Japanese",
  ko: "Korean",
  vi: "Vietnamese",
  th: "Thai",
  hi: "Hindi",
  ar: "Arabic",
  el: "Greek",
  ru: "Russian",
  es: "Spanish",
  it: "Italian",
  fr: "French",
  de: "German",
  pt: "Portuguese",
  nl: "Dutch",
  id: "Indonesian",
  tl: "Tagalog",
  tr: "Turkish",
  pl: "Polish",
  und: "Unknown",
};

// Languages a review can be translated from, in the browser
// (public/review-translate-worker.mjs keeps the same list): each has its own
// model into English that read review-like sentences right. The rest are
// named but not translated: a wrong translation is worse than none.
export const TRANSLATABLE = new Set(["zh", "ja", "ko", "vi", "th", "hi", "ar", "ru", "es", "it", "fr", "de", "nl", "id", "tr", "pl"]);

export function languageName(code: string): string {
  return LANGUAGES[code] ?? LANGUAGES.und;
}

// Scripts that name one language between them (Han is Chinese unless kana
// appears beside it, which makes it Japanese).
const SCRIPTS: [RegExp, string][] = [
  [/[぀-ヿ]/g, "ja"],
  [/[가-힯ᄀ-ᇿ]/g, "ko"],
  [/[一-鿿㐀-䶿]/g, "zh"],
  [/[฀-๿]/g, "th"],
  [/[ऀ-ॿ]/g, "hi"],
  [/[؀-ۿ]/g, "ar"],
  [/[Ͱ-Ͽ]/g, "el"],
  [/[Ѐ-ӿ]/g, "ru"],
];

// The commonest short words of each Latin-script language, chosen so they
// rarely appear in the others. Each match is a vote.
const WORDS: Record<string, string[]> = {
  en: ["the", "and", "was", "with", "this", "it", "i", "to", "of", "is", "my", "for", "but", "so", "very", "added", "made", "loved", "great", "next", "time", "recipe", "delicious", "easy", "would", "will", "a", "in", "we", "be", "too", "little", "bit"],
  es: ["el", "la", "los", "las", "y", "muy", "con", "pero", "receta", "rico", "rica", "deliciosa", "delicioso", "le", "puse", "más", "menos", "quedó", "es", "un", "una", "para", "que", "lo", "me", "encantó", "mi", "familia"],
  it: ["il", "la", "e", "di", "che", "molto", "ricetta", "buono", "buonissimo", "ottima", "ottimo", "con", "per", "ho", "una", "un", "è", "sono", "della", "del", "anche", "rifarò", "famiglia", "mia"],
  fr: ["le", "la", "les", "et", "est", "très", "avec", "mais", "recette", "délicieux", "délicieuse", "j'ai", "un", "une", "pour", "du", "des", "que", "c'est", "bon", "bonne", "par", "au", "trop"],
  de: ["der", "die", "das", "und", "ist", "sehr", "mit", "aber", "rezept", "lecker", "ich", "ein", "eine", "war", "nicht", "zu", "auch", "für", "es", "hat", "habe", "bei", "mir", "noch"],
  pt: ["o", "a", "os", "as", "e", "muito", "com", "mas", "receita", "gostoso", "gostosa", "delicioso", "deliciosa", "eu", "um", "uma", "para", "que", "não", "ficou", "coloquei", "família", "é"],
  nl: ["de", "het", "een", "en", "is", "erg", "heel", "met", "maar", "recept", "lekker", "ik", "niet", "van", "voor", "ook", "was", "heb", "nog", "wel"],
  vi: ["món", "rất", "ngon", "tôi", "và", "này", "đã", "một", "chút", "nước", "mắm", "của", "cho", "không", "là", "với", "có", "thêm", "nhà", "lần"],
  id: ["dan", "yang", "ini", "sangat", "enak", "saya", "dengan", "tapi", "resep", "untuk", "tidak", "sekali", "banget", "sedikit", "lagi", "keluarga", "suka"],
  tl: ["ang", "ng", "sa", "na", "at", "masarap", "ako", "ko", "ito", "talaga", "po", "naman", "mga", "para", "pero", "lang"],
  tr: ["ve", "bir", "çok", "bu", "ile", "ama", "tarif", "lezzetli", "güzel", "için", "ben", "da", "de", "daha", "oldu"],
  pl: ["i", "w", "na", "z", "jest", "bardzo", "ale", "przepis", "pyszne", "smaczne", "się", "to", "że", "nie", "dla", "było"],
};

// Letters that only (or mostly) belong to one language
const LETTERS: [RegExp, string][] = [
  [/[ăâđêôơưạảấầẩẫậắằẳẵặẹẻẽếềểễệỉịọỏốồổỗộớờởỡợụủứừửữựỳỵỷỹ]/gi, "vi"],
  [/[ñ¿¡]/gi, "es"],
  [/[ß]/gi, "de"],
  [/[ãõ]/gi, "pt"],
  [/[ąćęłńśźż]/gi, "pl"],
  [/[ğış]/gi, "tr"],
  [/[œ]|\b(?:j'|c'|l'|d'|qu')/gi, "fr"],
];

const LOOKUP: Map<string, string[]> = (() => {
  const m = new Map<string, string[]>();
  for (const [lang, words] of Object.entries(WORDS)) for (const w of words) m.set(w, [...(m.get(w) ?? []), lang]);
  return m;
})();

export function detectLanguage(text: string): string {
  const t = text.normalize("NFC");
  // scripts first: a few characters of Hangul or Thai settle it
  let bestScript = "";
  let bestCount = 0;
  for (const [re, lang] of SCRIPTS) {
    const n = t.match(re)?.length ?? 0;
    // kana beside Han is Japanese, however many Han characters there are
    if (lang === "ja" && n > 0) return "ja";
    if (n > bestCount) {
      bestCount = n;
      bestScript = lang;
    }
  }
  const latin = t.match(/[a-zà-ÿăđơưạ-ỹ]/gi)?.length ?? 0;
  if (bestCount >= 2 && bestCount >= latin / 3) return bestScript;

  const words = t.toLowerCase().match(/[a-zà-ÿăđơưạ-ỹąćęłńśźżğış']+/g) ?? [];
  // a few plain letters with no accents ("Great recipe", "Loved it") on an
  // English site are English; no letters at all ("10/10", an emoji) is
  // undetermined
  const plainEnglish = words.length > 0 && !/[^\x00-\x7f‘’“”–—…]/.test(t.replace(/\p{Extended_Pictographic}|‍|️/gu, ""));
  if (words.length < 3) {
    // Vietnamese tone marks settle even a short review ("Rất ngon"); not
    // Spanish ñ, which English food words carry (jalapeño, piña colada)
    if (/[ạảấầẩẫậắằẳẵặẹẻẽếềểễệỉịọỏốồổỗộớờởỡợụủứừửữựỳỵỷỹđơư]/i.test(t)) return "vi";
    return plainEnglish && words.some((w) => w.length >= 3) ? "en" : "und";
  }
  const votes = new Map<string, number>();
  const vote = (lang: string, n = 1) => votes.set(lang, (votes.get(lang) ?? 0) + n);
  for (const w of words) for (const lang of LOOKUP.get(w) ?? []) vote(lang, 1 / (LOOKUP.get(w)!.length));
  for (const [re, lang] of LETTERS) {
    const n = t.match(re)?.length ?? 0;
    if (n) vote(lang, Math.min(3, n) * 1.5);
  }
  const ranked = [...votes].sort((a, b) => b[1] - a[1]);
  const [first, second] = ranked;
  // a clear winner with real evidence; plain unaccented text with no clear
  // winner is English, the site's language; anything else is undetermined
  if (first && first[1] >= 1.5 && (!second || first[1] - second[1] >= 0.75)) return first[0];
  return plainEnglish ? "en" : "und";
}
