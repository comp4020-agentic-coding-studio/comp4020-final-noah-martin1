import { hashPassword, verifyPassword } from "../auth.ts";
import { one, run } from "../db.ts";
import { DEMO_LOGIN, DEMO_MODE } from "../demo.ts";
import { DIETARY_TAGS } from "../format.ts";
import { html, raw } from "../html.ts";
import { type Ctx, htmlReply, redirect, setFlash } from "../http.ts";
import { prefsFor } from "../prefs.ts";
import type { Route } from "../server.ts";
import { errors, page, pageHeader } from "../views/layout.ts";

const VIS = [
  ["public", "Public"],
  ["friends", "Friends"],
  ["private", "Only me"],
] as const;

function settingsPage(ctx: Ctx, problems: string[] = [], passwordProblems: string[] = [], status = 200) {
  const user = ctx.user!;
  const prefs = prefsFor(user.id);
  const budget = prefs.weekly_budget_cents === null ? "" : (prefs.weekly_budget_cents / 100).toFixed(2);
  const body = html`
    ${pageHeader("Settings", "Your profile, what you eat, what you spend, and who sees what by default.")}
    <div class="settings">
      <nav class="settings-nav" aria-label="Settings sections">
        <a href="#profile">Profile</a><a href="#food">Food & budget</a><a href="#privacy">Privacy</a><a href="#account">Account</a>
      </nav>
      <div class="side-stack">
        <form method="post" action="/settings" class="side-stack">
          ${errors(problems)}
          <section class="panel stack" id="profile">
            <h2 class="panel-title">Profile</h2>
            <label class="field"><span>Display name</span><input name="display_name" required maxlength="40" value="${user.display_name}" /></label>
            <label class="field"><span>Username</span><input value="@${user.username}" disabled /><small>Usernames can't be changed — friends find you by it.</small></label>
          </section>
          <section class="panel stack" id="food">
            <h2 class="panel-title">Food & budget</h2>
            <fieldset class="field"><legend>Diet</legend>
              <div class="chips">${DIETARY_TAGS.map(
                (t) => html`<label class="chip"><input type="checkbox" name="diet" value="${t}" ${prefs.dietary_prefs.includes(t) ? raw("checked") : ""} /><span>${t}</span></label>`,
              )}</div>
              <small>The meal planner only suggests recipes tagged with all of these.</small>
            </fieldset>
            <label class="field"><span>Ingredients to avoid</span><input name="dislikes" maxlength="200" placeholder="e.g. coriander, mushrooms" value="${prefs.dislikes}" /></label>
            <div class="field-row">
              <label class="field"><span>Cooking for</span><input name="default_servings" type="number" min="1" max="20" value="${prefs.default_servings}" /></label>
              <label class="field"><span>Weekly grocery budget</span><span class="input-prefix"><span>$</span><input name="weekly_budget" inputmode="decimal" placeholder="e.g. 80" value="${budget}" /></span>
                <small>The shopping list and planner compare against this. Leave blank for none.</small></label>
            </div>
          </section>
          <section class="panel stack" id="privacy">
            <h2 class="panel-title">Privacy</h2>
            <fieldset class="field"><legend>New recipes are visible to</legend>
              <div class="segmented">${VIS.map(
                ([v, label]) => html`<label><input type="radio" name="default_visibility" value="${v}" ${prefs.default_visibility === v ? raw("checked") : ""} /><span>${label}</span></label>`,
              )}</div>
            </fieldset>
            <p class="muted small">Your pantry is always private. Planned meals are shared with friends only when you tick “share”.</p>
          </section>
          <div class="form-actions"><button class="button" type="submit">Save settings</button></div>
        </form>

        <form method="post" action="/settings/password" class="panel stack" id="account">
          <h2 class="panel-title">Change password</h2>
          ${errors(passwordProblems)}
          <label class="field"><span>Current password</span><input type="password" name="current" required autocomplete="current-password" /></label>
          <label class="field"><span>New password</span><input type="password" name="next" required minlength="8" autocomplete="new-password" /></label>
          <div><button class="button button-ghost" type="submit">Update password</button></div>
        </form>
      </div>
    </div>`;
  return htmlReply(page(ctx, { title: "Settings", active: "settings", body }), status);
}

export const routes: Route[] = [
  { method: "GET", path: "/settings", auth: true, handler: (ctx) => settingsPage(ctx) },
  {
    method: "POST",
    path: "/settings",
    auth: true,
    handler: async (ctx) => {
      const form = await ctx.form();
      const displayName = (form.get("display_name") ?? "").trim();
      const diet = form.getAll("diet").filter((t) => (DIETARY_TAGS as readonly string[]).includes(t));
      const dislikes = (form.get("dislikes") ?? "").trim().slice(0, 200);
      const servings = Number(form.get("default_servings") ?? 2);
      const budgetRaw = (form.get("weekly_budget") ?? "").trim().replace(/^\$/, "");
      const visibility = form.get("default_visibility") ?? "friends";

      const problems: string[] = [];
      if (!displayName || displayName.length > 40) problems.push("Display name is required (up to 40 characters).");
      if (!Number.isInteger(servings) || servings < 1 || servings > 20) problems.push("Cooking for must be a whole number from 1 to 20.");
      let budgetCents: number | null = null;
      if (budgetRaw !== "") {
        if (!/^\d+(\.\d{1,2})?$/.test(budgetRaw) || Number(budgetRaw) > 100000) problems.push("Budget must be a dollar amount like 80 or 80.50.");
        else budgetCents = Math.round(Number(budgetRaw) * 100);
      }
      if (!VIS.some(([v]) => v === visibility)) problems.push("Choose a default visibility.");
      if (problems.length) return settingsPage(ctx, problems, [], 422);

      run(
        `UPDATE users SET display_name = ?, dietary_prefs = ?, dislikes = ?, default_servings = ?,
         weekly_budget_cents = ?, default_visibility = ? WHERE id = ?`,
        displayName, JSON.stringify(diet), dislikes, servings, budgetCents, visibility, ctx.user!.id,
      );
      setFlash(ctx, "Settings saved.");
      return redirect("/settings");
    },
  },
  {
    method: "POST",
    path: "/settings/password",
    auth: true,
    handler: async (ctx) => {
      const form = await ctx.form();
      const current = form.get("current") ?? "";
      const next = form.get("next") ?? "";
      // the shared demo account must stay usable by everyone
      if (DEMO_MODE && ctx.user!.username === DEMO_LOGIN.username) {
        return settingsPage(ctx, [], ["The demo account's password can't be changed."], 403);
      }
      const row = one<{ password_hash: string }>("SELECT password_hash FROM users WHERE id = ?", ctx.user!.id)!;
      if (!(await verifyPassword(current, row.password_hash))) return settingsPage(ctx, [], ["Current password is incorrect."], 422);
      if (next.length < 8) return settingsPage(ctx, [], ["New password must be at least 8 characters."], 422);
      run("UPDATE users SET password_hash = ? WHERE id = ?", await hashPassword(next), ctx.user!.id);
      setFlash(ctx, "Password updated.");
      return redirect("/settings");
    },
  },
];
