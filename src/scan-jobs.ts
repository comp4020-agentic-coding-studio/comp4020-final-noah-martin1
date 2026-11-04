// Background scans. An upload becomes a job row and the request returns at
// once; one worker loop takes jobs in order (the model can only run one at
// a time) and records each finished pass, so the person's page can show a
// progress bar and they can leave and come back. A job belongs to its
// uploader alone: every read here is scoped to the user id.

import { all, one, run } from "./db.ts";
import { callVision, catalogueHas, learnedNames, plannedSteps, resolveName, scanConfig, scanPhoto, ScanUnavailable, type Resolved } from "./fridge-scan.ts";
import { lineQuantity, parseReceipt, RECEIPT_PROMPT, type Receipt } from "./receipt-scan.ts";
import { logActivity } from "./activity.ts";

export type JobKind = "photo" | "receipt";
export type JobStatus = "queued" | "running" | "done" | "failed";

export interface Job {
  id: number;
  user_id: number;
  kind: JobKind;
  status: JobStatus;
  step: number;
  steps: number;
  result: string | null;
  error: string | null;
  model: string;
  created_at: string;
  updated_at: string;
}

// What a finished job hands the review page, whatever produced it.
export interface JobResult {
  rows: ResultRow[];
  seconds: number;
  receipt?: { total_cents: number | null; sum_cents: number | null; matches: boolean | null };
}

export interface ResultRow {
  detected: string;
  name: string;
  match: Resolved["match"];
  confidence: "high" | "medium" | "low";
  quantity: string;
  unit: string;
  price_cents: number | null;
  // the printed receipt line, shown so the person can check the reading
  source?: string;
}

const JOB_COLS = "id, user_id, kind, status, step, steps, result, error, model, created_at, updated_at";

export function createJob(userId: number, kind: JobKind, image: Buffer, check: { mime: string; width: number; height: number }): number {
  const cfg = scanConfig();
  // a receipt is read whole: bands would cut lines and their prices apart
  const steps = kind === "receipt" ? 1 : plannedSteps();
  const { id } = run(
    "INSERT INTO scan_jobs (user_id, kind, mime, width, height, image, steps, model) VALUES (?, ?, ?, ?, ?, ?, ?, ?)",
    userId,
    kind,
    check.mime,
    check.width,
    check.height,
    image,
    steps,
    cfg?.model ?? "",
  );
  kick();
  return id;
}

export function jobFor(userId: number, id: number): Job | undefined {
  return one<Job>(`SELECT ${JOB_COLS} FROM scan_jobs WHERE id = ? AND user_id = ?`, id, userId);
}

// The person's own unreviewed scans from the last day, newest first, for
// the "your scan is ready" notice on the fridge page.
export function recentJobs(userId: number): Job[] {
  return all<Job>(
    `SELECT ${JOB_COLS} FROM scan_jobs WHERE user_id = ? AND created_at > datetime('now', '-1 day') AND status != 'failed'
     ORDER BY id DESC LIMIT 5`,
    userId,
  );
}

export function finishReview(userId: number, id: number): void {
  // reviewed: the photo has done its job
  run("DELETE FROM scan_jobs WHERE id = ? AND user_id = ?", id, userId);
}

export function jobResult(job: Job): JobResult | null {
  if (job.status !== "done" || !job.result) return null;
  try {
    return JSON.parse(job.result) as JobResult;
  } catch {
    return null;
  }
}

// A position in the queue, so a waiting job can say "1 scan ahead of yours".
export function aheadOf(id: number): number {
  return one<{ n: number }>("SELECT COUNT(*) AS n FROM scan_jobs WHERE status IN ('queued', 'running') AND id < ?", id)?.n ?? 0;
}

/* ---------------- the worker ---------------- */

let working = false;

// Start the loop if it isn't running. Called on every new job and once at
// boot; it drains the queue and stops.
export function kick(): void {
  if (working) return;
  working = true;
  void (async () => {
    try {
      for (;;) {
        const next = one<{ id: number }>("SELECT id FROM scan_jobs WHERE status = 'queued' ORDER BY id LIMIT 1");
        if (!next) break;
        await runJob(next.id);
      }
    } finally {
      working = false;
    }
  })();
}

async function runJob(id: number): Promise<void> {
  const job = one<Job & { image: Uint8Array; width: number; height: number }>("SELECT * FROM scan_jobs WHERE id = ?", id);
  if (!job) return;
  const cfg = scanConfig();
  if (!cfg) return fail(id, "Photo scanning isn't set up on this server.");
  run("UPDATE scan_jobs SET status = 'running', updated_at = datetime('now') WHERE id = ?", id);
  const image = Buffer.from(job.image);
  const learned = learnedNames(job.user_id);
  const started = Date.now();
  try {
    let result: JobResult;
    if (job.kind === "receipt") {
      const { text } = await callVision(cfg, image, RECEIPT_PROMPT);
      progress(id, 1, 1);
      result = receiptResult(parseReceipt(text), learned, Date.now() - started);
    } else {
      const { items, ms } = await scanPhoto(cfg, image, job, undefined, (done, total) => progress(id, done, total));
      const resolved = items.map((d) => resolveName(d, catalogueHas, learned));
      result = {
        seconds: Math.round(ms / 1000),
        rows: resolved.map((r) => ({
          detected: r.detected.name,
          name: r.name,
          match: r.match,
          confidence: r.detected.confidence,
          quantity: r.detected.count !== null ? String(r.detected.count) : "",
          unit: "",
          price_cents: null,
        })),
      };
    }
    run("UPDATE scan_jobs SET status = 'done', result = ?, image = NULL, updated_at = datetime('now') WHERE id = ?", JSON.stringify(result), id);
    logActivity({ actor: null, action: "pantry.scan", subject: job.kind, detail: { job: id, user: job.user_id, model: cfg.model, found: result.rows.length, seconds: result.seconds } });
  } catch (err) {
    if (!(err instanceof ScanUnavailable)) console.error(err);
    fail(id, err instanceof ScanUnavailable ? err.message : "The scan hit an error.");
  }
}

function progress(id: number, step: number, steps: number): void {
  run("UPDATE scan_jobs SET step = ?, steps = ?, updated_at = datetime('now') WHERE id = ?", step, steps, id);
}

function fail(id: number, reason: string): void {
  run("UPDATE scan_jobs SET status = 'failed', error = ?, image = NULL, updated_at = datetime('now') WHERE id = ?", reason, id);
}

export function receiptResult(receipt: Receipt, learned: Map<string, string>, ms: number): JobResult {
  return {
    seconds: Math.round(ms / 1000),
    receipt: { total_cents: receipt.total_cents, sum_cents: receipt.check?.sum_cents ?? null, matches: receipt.check?.matches ?? null },
    rows: combineSame(receipt.lines.map((l) => {
      const r = resolveName({ name: l.name, count: null, container: "", confidence: "medium" }, catalogueHas, learned);
      const q = lineQuantity(l);
      return {
        detected: l.name,
        name: r.name,
        match: r.match,
        // a printed line is read, not guessed, but a misread total makes
        // every line suspect
        confidence: receipt.check?.matches === false ? "low" : "high",
        quantity: q.quantity,
        unit: q.unit,
        price_cents: l.price_cents,
        source: l.text,
      };
    })),
  };
}

// The same food bought twice on one receipt ("MILK 2L" on two lines) is one
// pantry item: one row, quantities added when their units agree, prices
// added. Lines whose units differ stay apart rather than mix g and ml. The
// total check has already run on the separate lines.
export function combineSame(rows: ResultRow[]): ResultRow[] {
  const out: ResultRow[] = [];
  for (const r of rows) {
    const same = out.find((o) => o.name === r.name && o.unit === r.unit && o.confidence === r.confidence);
    if (!same) {
      out.push({ ...r });
      continue;
    }
    const a = Number(same.quantity);
    const b = Number(r.quantity);
    same.quantity = same.quantity && r.quantity && Number.isFinite(a) && Number.isFinite(b) ? String(+(a + b).toFixed(2)) : "";
    same.price_cents = same.price_cents !== null && r.price_cents !== null ? same.price_cents + r.price_cents : null;
    same.source = [same.source, r.source].filter(Boolean).join(" + ");
  }
  return out;
}

// At boot: a job left running by a restart will never finish, so it fails
// with a reason; photos of scans more than a day old are dropped.
export function recoverJobs(): void {
  run("UPDATE scan_jobs SET status = 'failed', error = 'The server restarted during this scan. Try it again.', image = NULL WHERE status = 'running'");
  run("DELETE FROM scan_jobs WHERE created_at < datetime('now', '-1 day')");
  kick();
}
