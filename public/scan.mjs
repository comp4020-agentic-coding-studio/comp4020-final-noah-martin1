// Upload forms: say the scan has started, and stop a second press sending
// the photo twice. Progress page: poll the job and fill the bar, then go to
// the review once it's done. Both work as plain pages without this script.
const form = document.querySelector("[data-scan-form]");
if (form) {
  form.addEventListener("submit", () => {
    const button = form.querySelector("[data-scan-submit]");
    // disabled after this tick, so the click still submits
    setTimeout(() => {
      if (button) {
        button.disabled = true;
        button.textContent = "Uploading…";
      }
    });
  });
}

const job = document.querySelector("[data-job]");
if (job && job.dataset.jobStatus !== "failed") {
  const id = job.dataset.job;
  const label = job.querySelector("[data-job-label]");
  const bar = job.querySelector("[data-job-bar]");
  let wait = 1500;
  const tick = async () => {
    try {
      const res = await fetch(`/pantry/scan/jobs/${id}/status`, { headers: { accept: "application/json" } });
      if (res.status === 404) return location.assign("/pantry");
      const s = await res.json();
      if (s.status === "done") return location.assign(s.review);
      if (s.status === "failed") return location.reload();
      const pct = Math.round((s.step / Math.max(s.steps, 1)) * 100);
      // no value until the first view is in, so the bar shows it's working
      if (bar && s.step > 0) {
        bar.value = pct;
        bar.textContent = `${pct}%`;
      }
      label.textContent =
        s.status === "queued"
          ? s.ahead ? `Waiting: ${s.ahead} scan${s.ahead === 1 ? "" : "s"} ahead of yours.` : "Starting…"
          : s.kind === "receipt"
            ? "Reading the receipt…"
            : `Looking at your photo: ${s.step} of ${s.steps} views done.`;
      wait = 1500;
    } catch {
      // offline for a moment: back off and keep trying
      wait = Math.min(wait * 2, 15000);
      label.textContent = "Can't reach Larder right now. The scan carries on; this page will catch up.";
    }
    setTimeout(tick, wait);
  };
  setTimeout(tick, wait);
}
