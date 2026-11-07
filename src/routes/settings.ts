import { destroySession, hashPassword, verifyPassword } from "../auth.ts";
import { deleteAccount, deletionPreview } from "../account.ts";
import { CHARACTERS, characterSvg, isCharacter } from "../avatars.ts";
import { one, run } from "../db.ts";
import { DEMO_USERNAMES } from "../demo.ts";
import { DIETARY_TAGS } from "../format.ts";
import { html, raw } from "../html.ts";
import { t, th, tn } from "../i18n.ts";
import { cookie, type Ctx, htmlReply, isHttps, parseCookies, redirect, setFlash } from "../http.ts";
import { ACTION_LABEL, activityFor, logActivity } from "../activity.ts";
import { CITIES, CITY_BY_KEY } from "../live.ts";
import { prefsFor } from "../prefs.ts";

const REGIONS = [...new Set(CITIES.map((c) => c.region))];
import type { Route } from "../server.ts";
import { avatar, errors, page, pageHeader } from "../views/layout.ts";

const VIS = [
  ["public", "Public"],
  ["friends", "Friends"],
  ["private", "Only me"],
] as const;

// who can watch you cook live: everyone by default
const LIVE_VIS = [
  ["public", "Everyone"],
  ["friends", "Friends"],
  ["private", "Only me"],
] as const;

// The cooking characters to choose from, plus plain initials: radio buttons,
// so the picker works by keyboard and without a script.
function avatarPicker(ctx: Ctx): ReturnType<typeof html> {
  const user = ctx.user!;
  return html`<fieldset class="field avatar-pick"><legend>${t("Your picture")}</legend>
    <p class="muted small">${t("Shown beside your name on reviews, your profile and around Larder.")}</p>
    <div class="avatar-grid">
      <label class="avatar-option"><input type="radio" name="avatar" value="" ${user.avatar ? "" : raw("checked")} />
        <span class="avatar-tile">${avatar(user.display_name, "lg")}<span>${t("Initials")}</span></span></label>
      ${CHARACTERS.map(
        (c) => html`<label class="avatar-option"><input type="radio" name="avatar" value="${c.key}" ${user.avatar === c.key ? raw("checked") : ""} />
          <span class="avatar-tile"><span class="avatar avatar-lg avatar-char" style="--av: ${c.wash}" aria-hidden="true">${characterSvg(c)}</span><span>${t(c.name)}</span></span></label>`,
      )}
    </div>
  </fieldset>`;
}

function settingsPage(ctx: Ctx, problems: string[] = [], passwordProblems: string[] = [], status = 200, deleteProblems: string[] = []) {
  const user = ctx.user!;
  const prefs = prefsFor(user.id);
  const budget = prefs.weekly_budget_cents === null ? "" : (prefs.weekly_budget_cents / 100).toFixed(2);
  const trail = activityFor(user.id, 25);
  const body = html`
    ${pageHeader(t("Settings"), t("Your profile, what you eat, what you spend, and who sees what by default."))}
    <div class="settings">
      <nav class="settings-nav" aria-label="${t("Settings sections")}">
        <a href="#profile">${t("Profile")}</a><a href="#food">${t("Food & budget")}</a><a href="#privacy">${t("Privacy")}</a><a href="#live">${t("Cooking live")}</a><a href="#activity">${t("Your activity")}</a><a href="#account">${t("Account")}</a><a href="#delete">${t("Delete account")}</a>
      </nav>
      <div class="side-stack">
        <form method="post" action="/settings" class="side-stack">
          ${errors(problems)}
          <section class="panel stack" id="profile">
            <h2 class="panel-title">${t("Profile")}</h2>
            <label class="field"><span>${t("Display name")}</span><input name="display_name" required maxlength="40" value="${user.display_name}" /></label>
            <label class="field"><span>${t("Username")}</span><input value="@${user.username}" disabled /><small>${t("Usernames can't be changed — friends find you by it.")}</small></label>
            ${avatarPicker(ctx)}
          </section>
          <section class="panel stack" id="food">
            <h2 class="panel-title">${t("Food & budget")}</h2>
            <fieldset class="field"><legend>${t("Diet")}</legend>
              <div class="chips">${DIETARY_TAGS.map(
                (tag) => html`<label class="chip"><input type="checkbox" name="diet" value="${tag}" ${prefs.dietary_prefs.includes(tag) ? raw("checked") : ""} /><span>${t(tag)}</span></label>`,
              )}</div>
              <small>${t("The meal planner only suggests recipes tagged with all of these.")}</small>
            </fieldset>
            <label class="field"><span>${t("Ingredients to avoid")}</span><input name="dislikes" maxlength="200" placeholder="${t("e.g. coriander, mushrooms")}" value="${prefs.dislikes}" /></label>
            <div class="field-row">
              <label class="field"><span>${t("Cooking for")}</span><input name="default_servings" type="number" min="1" max="20" value="${prefs.default_servings}" /></label>
              <label class="field"><span>${t("Weekly grocery budget")}</span><span class="input-prefix"><span>$</span><input name="weekly_budget" inputmode="decimal" placeholder="${t("e.g. 80")}" value="${budget}" /></span>
                <small>${t("The shopping list and planner compare against this. Leave blank for none.")}</small></label>
            </div>
          </section>
          <section class="panel stack" id="privacy">
            <h2 class="panel-title">${t("Privacy")}</h2>
            <fieldset class="field"><legend>${t("New recipes are visible to")}</legend>
              <div class="segmented">${VIS.map(
                ([v, label]) => html`<label><input type="radio" name="default_visibility" value="${v}" ${prefs.default_visibility === v ? raw("checked") : ""} /><span>${t(label)}</span></label>`,
              )}</div>
            </fieldset>
            <p class="muted small">${t("Your pantry is always private. Planned meals are shared with friends only when you tick “share”.")}</p>
          </section>
          <section class="panel stack" id="live">
            <h2 class="panel-title">${t("Cooking live")}</h2>
            <input type="hidden" name="live_fields" value="1" />
            <fieldset class="field"><legend>${t("Who can watch you cook")}</legend>
              <div class="segmented">${LIVE_VIS.map(
                ([v, label]) => html`<label><input type="radio" name="live_visibility" value="${v}" ${prefs.live_visibility === v ? raw("checked") : ""} /><span>${t(label)}</span></label>`,
              )}</div>
              <small>${t("Never wider than the recipe allows: cooking a private recipe stays private.")}</small>
            </fieldset>
            <label class="check-inline"><input type="checkbox" name="auto_live" value="1" ${prefs.auto_live ? raw("checked") : ""} /> <span>${t("Go live automatically when I start cooking")}</span></label>
            <p class="muted small">${t("Your pan appears for {who} and you can turn it off with one tap while cooking. Untick to never start live by yourself.", { who: prefs.live_visibility === "public" ? t("everyone on the globe") : prefs.live_visibility === "friends" ? t("your friends") : t("only you") })}</p>
            <label class="field"><span>${t("Where an automatic session appears")}</span>
              <select name="live_city">
                <option value="" ${prefs.live_city === "" ? raw("selected") : ""}>${t("Not on the map (listed only)")}</option>
                ${REGIONS.map((region) => html`<optgroup label="${t(region)}">${CITIES.filter((c) => c.region === region).map((c) => html`<option value="${c.key}" ${prefs.live_city === c.key ? raw("selected") : ""}>${c.name}${c.country !== c.name ? `, ${c.country}` : ""}</option>`)}</optgroup>`)}
              </select>
              <small>${t("A city centre only. It also updates when you pick a city in Go live. Your device location is never used automatically.")}</small></label>
          </section>
          <div class="form-actions"><button class="button" type="submit">${t("Save settings")}</button></div>
        </form>

        <section class="panel stack" id="activity">
          <h2 class="panel-title">${t("Your activity")}</h2>
          <p class="muted small">${t("What you've done in Larder, as the server recorded it. Kept so problems can be traced; it never holds passwords or what you typed in questions.")}</p>
          ${trail.length
            ? html`<ol class="activity-list">${trail.map(
                (a) => html`<li class="activity-${a.outcome}"><time class="mono muted" datetime="${a.at}">${a.at.slice(0, 16).replace("T", " ")} UTC</time><span>${a.action in ACTION_LABEL ? t(ACTION_LABEL[a.action]) : a.action}${a.subject ? html`: <strong>${a.subject}</strong>` : ""}${a.outcome !== "ok" ? html` <span class="pill pill-${a.outcome === "failed" ? "expired" : "soon"}">${t(a.outcome)}</span>` : ""}</span></li>`,
              )}</ol>`
            : html`<p class="muted">${t("Nothing yet.")}</p>`}
        </section>

        <form method="post" action="/settings/password" class="panel stack" id="account">
          <h2 class="panel-title">${t("Change password")}</h2>
          ${errors(passwordProblems)}
          <label class="field"><span>${t("Current password")}</span><input type="password" name="current" required autocomplete="current-password" /></label>
          <label class="field"><span>${t("New password")}</span><input type="password" name="next" required minlength="8" autocomplete="new-password" /></label>
          <div><button class="button button-ghost" type="submit">${t("Update password")}</button></div>
        </form>

        ${deleteSection(ctx, deleteProblems)}
      </div>
    </div>`;
  return htmlReply(page(ctx, { title: t("Settings"), active: "settings", body, mainClass: "main-read" }), status);
}

// Deleting the account: what goes and what stays, said plainly, and the
// password to confirm. Demo accounts are shared and can't be deleted.
function deleteSection(ctx: Ctx, problems: string[]) {
  const user = ctx.user!;
  if (DEMO_USERNAMES.includes(user.username.toLowerCase())) {
    return html`<section class="panel stack" id="delete"><h2 class="panel-title">${t("Delete account")}</h2><p class="muted">${t("Demo accounts are shared, so they can't be deleted.")}</p></section>`;
  }
  const p = deletionPreview(user.id);
  return html`<form method="post" action="/settings/delete" class="panel stack danger-zone" id="delete" data-confirm="${t("Delete your Larder account for good? This can't be undone.")}">
    <h2 class="panel-title">${t("Delete account")}</h2>
    ${errors(problems)}
    <ul class="delete-list">
      <li><strong>${t("Deleted:")}</strong> ${p.recipes ? tn(p.recipes, "your {n} recipe (and reviews of them), pantry, planned meals, friends and live sessions.", "your {n} recipes (and reviews of them), pantry, planned meals, friends and live sessions.") : t("your pantry, planned meals, friends and live sessions.")}</li>
      ${p.reviewsKept ? html`<li><strong>${t("Kept without your name or picture:")}</strong> ${tn(p.reviewsKept, "your {n} review and reply on other people's recipes. Delete any you don't want left first.", "your {n} reviews and replies on other people's recipes. Delete any you don't want left first.")}</li>` : html`<li>${t("Reviews you write on other people's recipes stay, shown as from a deleted account.")}</li>`}
      ${p.household ? html`<li>${th("You'll leave {household}; what you added to its pantry and calendar stays with the household.", { household: html`<strong>${p.household}</strong>` })}</li>` : ""}
    </ul>
    <label class="field"><span>${t("Your password, to confirm")}</span><input type="password" name="password" required autocomplete="current-password" /></label>
    <div><button class="button button-danger" type="submit">${t("Delete my account")}</button></div>
  </form>`;
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
      // "" is initials; anything else must be one of the characters
      const avatarRaw = form.has("avatar") ? (form.get("avatar") ?? "") : (ctx.user!.avatar ?? "");

      const problems: string[] = [];
      if (!displayName || displayName.length > 40) problems.push(t("Display name is required (up to 40 characters)."));
      if (!Number.isInteger(servings) || servings < 1 || servings > 20) problems.push(t("Cooking for must be a whole number from 1 to 20."));
      let budgetCents: number | null = null;
      if (budgetRaw !== "") {
        if (!/^\d+(\.\d{1,2})?$/.test(budgetRaw) || Number(budgetRaw) > 100000) problems.push(t("Budget must be a dollar amount like 80 or 80.50."));
        else budgetCents = Math.round(Number(budgetRaw) * 100);
      }
      if (!VIS.some(([v]) => v === visibility)) problems.push(t("Choose a default visibility."));
      if (avatarRaw !== "" && !isCharacter(avatarRaw)) problems.push(t("Choose one of the pictures, or initials."));
      // the live section is only changed when the form that shows it is sent
      const before = prefsFor(ctx.user!.id);
      const liveFields = form.get("live_fields") === "1";
      const autoLive = liveFields ? form.get("auto_live") === "1" : before.auto_live;
      const liveCity = liveFields ? (form.get("live_city") ?? "") : before.live_city;
      const liveVisibility = liveFields ? (form.get("live_visibility") ?? before.live_visibility) : before.live_visibility;
      if (!LIVE_VIS.some(([v]) => v === liveVisibility)) problems.push(t("Choose who can watch you cook."));
      if (liveCity !== "" && !CITY_BY_KEY.has(liveCity)) problems.push(t("Choose a city from the list, or not on the map."));
      if (problems.length) return settingsPage(ctx, problems, [], 422);

      run(
        `UPDATE users SET display_name = ?, dietary_prefs = ?, dislikes = ?, default_servings = ?,
         weekly_budget_cents = ?, default_visibility = ?, live_visibility = ?, auto_live = ?, live_city = ?, avatar = ? WHERE id = ?`,
        displayName, JSON.stringify(diet), dislikes, servings, budgetCents, visibility, liveVisibility, autoLive ? 1 : 0, liveCity, avatarRaw || null, ctx.user!.id,
      );
      logActivity({
        actor: ctx.user,
        action: "settings.update",
        detail: {
          budget_changed: budgetCents !== before.weekly_budget_cents,
          visibility,
          live_visibility: liveVisibility,
          auto_live: autoLive,
          live_city: liveCity || "none",
        },
      });
      setFlash(ctx, t("Settings saved."));
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
      // the shared demo accounts must stay usable by everyone
      if (DEMO_USERNAMES.includes(ctx.user!.username.toLowerCase())) {
        return settingsPage(ctx, [], [t("Demo accounts are shared, so their password can't be changed.")], 403);
      }
      const row = one<{ password_hash: string }>("SELECT password_hash FROM users WHERE id = ?", ctx.user!.id)!;
      if (!(await verifyPassword(current, row.password_hash))) return settingsPage(ctx, [], [t("Current password is incorrect.")], 422);
      if (next.length < 8) return settingsPage(ctx, [], [t("New password must be at least 8 characters.")], 422);
      run("UPDATE users SET password_hash = ? WHERE id = ?", await hashPassword(next), ctx.user!.id);
      setFlash(ctx, t("Password updated."));
      return redirect("/settings");
    },
  },
  {
    method: "POST",
    path: "/settings/delete",
    auth: true,
    handler: async (ctx) => {
      const user = ctx.user!;
      if (DEMO_USERNAMES.includes(user.username.toLowerCase())) return settingsPage(ctx, [], [], 403, [t("Demo accounts are shared, so they can't be deleted.")]);
      const password = (await ctx.form()).get("password") ?? "";
      const row = one<{ password_hash: string }>("SELECT password_hash FROM users WHERE id = ?", user.id)!;
      if (!(await verifyPassword(password, row.password_hash))) {
        logActivity({ actor: user, action: "account.delete", outcome: "denied", detail: { reason: "wrong password" } });
        return settingsPage(ctx, [], [], 422, [t("That password isn't right, so nothing was deleted.")]);
      }
      // logged before the row goes; the log keeps that it happened, its
      // actor set to null by the delete, and nothing naming them
      logActivity({ actor: user, action: "account.delete" });
      const summary = deleteAccount(user.id);
      destroySession(parseCookies(ctx.req.headers.cookie).sid);
      ctx.setCookies.push(cookie("sid", "", { maxAge: 0, secure: isHttps(ctx.req) }));
      setFlash(ctx, `${t("Your account is deleted.")}${summary.reviewsKept ? ` ${tn(summary.reviewsKept, "{n} review you wrote stays, without your name.", "{n} reviews you wrote stay, without your name.")}` : ""}`);
      return redirect("/");
    },
  },
];
