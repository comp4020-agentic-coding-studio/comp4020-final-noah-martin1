// A scan takes a minute on a local model: say so, and stop a second press
// sending the photo twice. The form posts normally either way.
const form = document.querySelector("[data-scan-form]");
if (form) {
  form.addEventListener("submit", () => {
    const button = form.querySelector("[data-scan-submit]");
    const wait = form.querySelector("[data-scan-wait]");
    if (wait) wait.hidden = false;
    // disabled after this tick, so the click still submits
    setTimeout(() => {
      if (button) button.disabled = true;
    });
  });
}
