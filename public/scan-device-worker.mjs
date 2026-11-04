// Runs Qwen3-VL-2B in a worker so the page stays responsive while it loads
// (about 1.4 GB the first time, from the browser cache after) and while it
// scans. The page sends image bytes and the prompt; the worker replies with
// the model's raw text, which the page and then the server parse. The model
// only suggests: nothing here decides what's saved.

const LIB = "https://cdn.jsdelivr.net/npm/@huggingface/transformers@4.3.2/+esm";
const MODEL = "onnx-community/Qwen3-VL-2B-Instruct-ONNX";

let T = null;
let processor = null;
let model = null;

async function load() {
  T = await import(LIB);
  T.env.allowLocalModels = false;
  const files = new Map();
  const progress = (p) => {
    if (p.status === "progress" && p.total) {
      files.set(p.file, [p.loaded, p.total]);
      let loaded = 0;
      let total = 0;
      for (const [l, t] of files.values()) {
        loaded += l;
        total += t;
      }
      postMessage({ type: "download", loaded, total });
    }
  };
  processor = await T.AutoProcessor.from_pretrained(MODEL);
  model = await T.AutoModelForImageTextToText.from_pretrained(MODEL, { device: "webgpu", dtype: "q4f16", progress_callback: progress });
  postMessage({ type: "ready" });
}

async function scan({ id, blob, prompt }) {
  const image = await T.RawImage.fromBlob(blob);
  const messages = [{ role: "user", content: [{ type: "image" }, { type: "text", text: prompt }] }];
  const text = processor.apply_chat_template(messages, { add_generation_prompt: true, enable_thinking: false });
  const inputs = await processor(text, image);
  // the same mild repeat penalty the server uses, for the same loop
  const ids = await model.generate({ ...inputs, max_new_tokens: 700, do_sample: false, repetition_penalty: 1.1 });
  const reply = processor.batch_decode(ids.slice(null, [inputs.input_ids.dims.at(-1), null]), { skip_special_tokens: true })[0];
  postMessage({ type: "result", id, reply });
}

self.addEventListener("message", async (e) => {
  try {
    if (e.data.type === "load") await load();
    else if (e.data.type === "scan") await scan(e.data);
  } catch (err) {
    postMessage({ type: "error", message: String(err?.message ?? err) });
  }
});
