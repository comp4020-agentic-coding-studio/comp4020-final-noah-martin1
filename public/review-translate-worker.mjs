// Translates a review into English in a worker, so the page stays smooth:
// a small Opus-MT model for the review's language (about 110 MB the first
// time, from the browser's cache after), loaded only when someone presses
// Translate. Plain WebAssembly, so any current browser can run it. The
// translation is shown beside the original, marked as a machine's; the
// review itself is never changed (CLAUDE.md: AI stays advisory).

const LIB = "https://cdn.jsdelivr.net/npm/@huggingface/transformers@3.8.1/+esm";

// languages with a direct model into English (Xenova/opus-mt-<code>-en),
// measured on review-like sentences (testing/review-translate/RESULTS.md).
// Greek, Portuguese and Tagalog have only the many-languages model, which
// turned "I added garlic" into "I ran away from home": not offered. The
// same list is in src/language.ts (TRANSLATABLE), which decides the button.
const MODELS = { zh: "zh", ja: "ja", ko: "ko", vi: "vi", th: "th", hi: "hi", ar: "ar", ru: "ru", es: "es", it: "it", fr: "fr", de: "de", nl: "nl", id: "id", tr: "tr", pl: "pl" };

let T = null;
const loaded = new Map();

async function translator(lang) {
  if (loaded.has(lang)) return loaded.get(lang);
  T ??= await import(LIB);
  T.env.allowLocalModels = false;
  const files = new Map();
  const p = T.pipeline("translation", `Xenova/opus-mt-${MODELS[lang]}-en`, {
    dtype: "q8",
    device: "wasm",
    progress_callback: (e) => {
      if (e.status === "progress" && e.total) {
        files.set(e.file, [e.loaded, e.total]);
        let a = 0, b = 0;
        for (const [l, t] of files.values()) {
          a += l;
          b += t;
        }
        postMessage({ type: "download", lang, loaded: a, total: b });
      }
    },
  });
  loaded.set(lang, p);
  p.catch(() => loaded.delete(lang));
  return p;
}

// a long review in sentence-sized pieces: these models are trained on
// sentences and drop words from long inputs
function pieces(text) {
  const out = [];
  for (const para of text.split(/\n{2,}/)) {
    const parts = para.match(/[^.!?。！？]+[.!?。！？]*\s*/g) ?? [para];
    out.push({ parts: parts.map((s) => s.trim()).filter(Boolean) });
  }
  return out;
}

self.addEventListener("message", async (e) => {
  const { id, lang, text } = e.data;
  try {
    if (!MODELS[lang]) throw new Error("there's no translator for that language yet");
    const tr = await translator(lang);
    postMessage({ type: "working", id });
    const paras = [];
    for (const p of pieces(text)) {
      const done = [];
      for (const s of p.parts) {
        const [o] = await tr(s, { max_new_tokens: 256 });
        done.push(o.translation_text);
      }
      paras.push(done.join(" "));
    }
    postMessage({ type: "result", id, text: paras.join("\n\n") });
  } catch (err) {
    postMessage({ type: "error", id, message: String(err?.message ?? err) });
  }
});
