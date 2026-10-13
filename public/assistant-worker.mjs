// Runs the small on-device model off the main thread so the page never
// stutters. transformers.js and Qwen2.5-0.5B-Instruct are both free and
// Apache-2.0; the browser caches the weights after the first download. The
// model is asked only to reword facts it's given, and the page discards a
// reply that names a food the facts don't.

const LIB = "https://cdn.jsdelivr.net/npm/@huggingface/transformers@3.8.1/+esm";
const MODEL = "onnx-community/Qwen2.5-0.5B-Instruct";

let generator = null;
let lib = null;

async function load() {
  // Only half-precision on a GPU kept to the facts in testing; the 4- and
  // 8-bit builds garbled words or crawled. Without WebGPU, no model: the
  // checked answer is the answer.
  if (!(await hasWebGPU())) throw new Error("no-webgpu");
  lib = await import(LIB);
  lib.env.allowLocalModels = false;
  const device = "webgpu";
  const files = new Map();
  generator = await lib.pipeline("text-generation", MODEL, {
    device,
    dtype: "fp16",
    progress_callback: (p) => {
      if (p.status === "progress" && p.total) {
        files.set(p.file, [p.loaded, p.total]);
        let loaded = 0;
        let total = 0;
        for (const [l, t] of files.values()) {
          loaded += l;
          total += t;
        }
        postMessage({ type: "progress", pct: (loaded / total) * 100 });
      }
    },
  });
  postMessage({ type: "ready", device });
}

async function hasWebGPU() {
  try {
    return !!(self.navigator?.gpu && (await self.navigator.gpu.requestAdapter()));
  } catch {
    return false;
  }
}

async function ask({ question, facts, headline, lines }) {
  // small models stay on track with a short brief: the checked answer first,
  // the recipe context after, and one worked example of the tone we want
  const answer = [headline, ...lines].join(" ");
  const messages = [
    {
      role: "system",
      content:
        "You are a warm, concise cooking helper. Rewrite the checked answer as one or two friendly sentences spoken to the cook. Keep every ingredient and amount exactly as given. Never add new ingredients, amounts, times or advice.",
    },
    { role: "user", content: "Question: what can I use instead of butter?\nChecked answer: Instead of butter: olive oil: use ¾ of the amount; fine for sautéing, not for creaming into cakes. coconut oil: same amount; works in baking." },
    { role: "assistant", content: "Olive oil is a good swap: use about three quarters as much, though it won't cream like butter in a cake. Coconut oil works one for one, including in baking." },
    { role: "user", content: `Question: ${question}\nChecked answer: ${answer}` },
  ];
  let text = "";
  const streamer = new lib.TextStreamer(generator.tokenizer, {
    skip_prompt: true,
    skip_special_tokens: true,
    callback_function: (t) => {
      text += t;
      postMessage({ type: "token", text });
    },
  });
  // no repetition penalty: it also punishes the prompt's words, which are
  // exactly the ones a faithful rewording needs. Loops are cut client-side.
  await generator(messages, { max_new_tokens: 64, do_sample: false, streamer });
  postMessage({ type: "done", text });
}

self.addEventListener("message", async (e) => {
  try {
    if (e.data.type === "load") await load();
    if (e.data.type === "ask") await ask(e.data);
  } catch (err) {
    postMessage({ type: "error", message: String(err?.message ?? err) });
  }
});
