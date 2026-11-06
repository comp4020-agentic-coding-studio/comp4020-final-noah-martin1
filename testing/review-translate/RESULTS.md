# Translating reviews: which model, measured

Reviews are translated into English in the reader's browser, only when they
press Translate. The site has no translation service and no API keys, and
AI stays advisory, so the model must run on the device, be small enough to
download on demand, and be right often enough to help. A translation that
changes the meaning (garlic into salt) is worse than none.

Tested in node with transformers.js 3.8.1 and the same quantised (q8) ONNX
models the browser downloads, on review-like sentences: a cook saying what
they changed. "Right" means the meaning survived: the food, the change, the
verdict. Times are per sentence on an Apple M4.

## Candidates

| Model | Right (12 sentences, 11 languages) | Download | Per sentence |
|---|---|---|---|
| Opus-MT many→English (`Xenova/opus-mt-mul-en`) | 3 | 108 MB | 0.1 s |
| M2M100 418M | 10 (two food-word swaps: fish sauce → water, onions → potatoes) | 632 MB | 0.4 s |
| NLLB-200 distilled 600M | 9 | 864 MB | 0.8 s |
| **Opus-MT one model per language** (`Xenova/opus-mt-<lang>-en`) | **8 of 12**, and 14 of 16 languages right on a second sentence set | **~110 MB per language** | **0.1 s** |

The many-languages model is unusable: "I put less sugar in and it was
perfect" became "it got less sugar and it got dirty"; Tagalog "This is really
delicious, I added garlic" became "The cover was so tight, I ran away from
home". M2M100 and NLLB are better but 600–900 MB, too much to download to
read one comment.

## Chosen: one Opus-MT model per language

Loaded only for the review's language, detected when it was posted
(`src/language.ts`), cached by the browser after the first time.

| Language | Example result |
|---|---|
| Chinese | "The chicken's a little dry. Next time I'll be less than ten minutes." (meaning: bake ten minutes less; close) |
| Spanish | "I loved this recipe, but I put less sugar on it and it was perfect." |
| Japanese | "It was very delicious. I'll put a lot of onions next time." |
| Arabic | "Nice recipe, but I added more garlic." |
| French | "I've replaced the cream with Greek yogurt." |
| German | "Very tasty, but the baking time was ten minutes longer." |
| Thai | "It's delicious. It's easy. Next time, put some pepper on." |
| Russian | "It's delicious, but I added less salt and more garlic." |
| Indonesian | "This recipe is very good, my family loves it, and I'll have more chili next time." |
| Turkish | "It's delicious, but I baked it ten minutes more." |
| Polish | "Very tasty, but I added less sugar and more cinnamon." |
| Dutch | "Very nice recipe, I used less sugar and it was perfect." |
| Italian | "I'll definitely do it again for my family." (dropped "great recipe") |
| Vietnamese | "I've added a little bit of bilge water." (fish sauce; wrong) |
| Korean | "They loved it." (dropped "really delicious") |
| Hindi | "I mixed a little bit more." (dropped "spice") |

Offered: Chinese, Japanese, Korean, Vietnamese, Thai, Hindi, Arabic, Russian,
Spanish, Italian, French, German, Dutch, Indonesian, Turkish, Polish. Not
offered (only the many-languages model exists, and it mistranslated):
Greek, Portuguese, Tagalog; those reviews say "Written in Greek" instead.

Because Vietnamese, Korean and Hindi slip, every translation is shown beside
the original, labelled "Machine translation · may be inaccurate", and the
original is one tap away; nothing is saved.

In Chrome, end to end: the Spanish model downloaded in about 20 s (119 MB)
with a progress bar, translated the review correctly in under a second, and
a second press was instant from the cache.

## Language detection

`src/language.ts`, plain code: scripts settle Chinese, Japanese, Korean,
Thai, Hindi, Arabic, Greek and Russian; Latin-script languages by their
commonest words and accented letters. 29 of 30 review sentences right; the
miss was two words ("Great recipe"), now read as English since unaccented
text on this site is. English with borrowed food words (pho, gochujang,
kimchi, ragu) stays English. A scrap with no clear language ("10/10", an
emoji, "jalapeño" alone) is "unknown" and never offered for translation.
