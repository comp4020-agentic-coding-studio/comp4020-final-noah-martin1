import { logActivity } from "../activity.ts";
import {
  createSession,
  destroySession,
  hashPassword,
  SESSION_DAYS,
  USERNAME,
  verifyPassword,
} from "../auth.ts";
import { one, run } from "../db.ts";
import { DEMO_USERNAMES } from "../demo.ts";
import { html } from "../html.ts";
import { t } from "../i18n.ts";
import { type Ctx, cookie, htmlReply, isHttps, parseCookies, redirect, setFlash } from "../http.ts";
import type { Route } from "../server.ts";
import { errors, publicPage } from "../views/layout.ts";

// Only same-site paths are followed after sign-in, never another host.
function safeNext(next: string | null): string {
  return next && next.startsWith("/") && !next.startsWith("//") ? next : "/";
}

function signIn(ctx: Ctx, userId: number): void {
  const token = createSession(userId);
  ctx.setCookies.push(cookie("sid", token, { maxAge: SESSION_DAYS * 86400, secure: isHttps(ctx.req) }));
}

function authForm(
  ctx: Ctx,
  mode: "login" | "register",
  values: Record<string, string>,
  problems: string[],
  status = 200,
) {
  const isRegister = mode === "register";
  const next = values.next ?? ctx.url.searchParams.get("next") ?? "";
  return htmlReply(
    publicPage(ctx, {
      title: isRegister ? t("Create account") : t("Sign in"),
      body: html`<section class="auth">
        <div class="auth-card">
          <p class="eyebrow">${isRegister ? t("Join Larder") : t("Welcome back")}</p>
          <h1>${isRegister ? t("Create your account") : t("Sign in")}</h1>
          ${errors(problems)}
          <form method="post" action="/${mode}" class="stack">
            <input type="hidden" name="next" value="${next}" />
            ${isRegister
              ? html`<label class="field">
                  <span>${t("Display name")}</span>
                  <input name="display_name" required maxlength="40" autocomplete="name" value="${values.display_name ?? ""}" />
                </label>`
              : ""}
            <label class="field">
              <span>${t("Username")}</span>
              <input name="username" required autocomplete="username" autocapitalize="none" spellcheck="false"
                ${isRegister ? html`pattern="[a-z0-9_]{3,24}" maxlength="24"` : ""} value="${values.username ?? ""}" />
              ${isRegister ? html`<small>${t("3–24 characters: lowercase letters, numbers, underscores.")}</small>` : ""}
            </label>
            <label class="field">
              <span>${t("Password")}</span>
              <input type="password" name="password" required ${isRegister ? html`minlength="8"` : ""}
                autocomplete="${isRegister ? "new-password" : "current-password"}" />
              ${isRegister ? html`<small>${t("At least 8 characters.")}</small>` : ""}
            </label>
            <button class="button button-block" type="submit">${isRegister ? t("Create account") : t("Sign in")}</button>
          </form>
          <p class="auth-switch">
            ${isRegister
              ? html`${t("Already have an account?")} <a href="/login">${t("Sign in")}</a>`
              : html`${t("New here?")} <a href="/register">${t("Create an account")}</a>`}
          </p>
        </div>
      </section>`,
    }),
    status,
  );
}

export const routes: Route[] = [
  {
    method: "GET",
    path: "/register",
    handler: (ctx) => (ctx.user ? redirect("/") : authForm(ctx, "register", {}, [])),
  },
  {
    method: "POST",
    path: "/register",
    handler: async (ctx) => {
      const form = await ctx.form();
      const username = (form.get("username") ?? "").trim().toLowerCase();
      const displayName = (form.get("display_name") ?? "").trim();
      const password = form.get("password") ?? "";
      const values = { username, display_name: displayName, next: form.get("next") ?? "" };

      const problems: string[] = [];
      if (!USERNAME.test(username)) problems.push(t("Username must be 3–24 lowercase letters, numbers or underscores."));
      if (!displayName || displayName.length > 40) problems.push(t("Display name is required (up to 40 characters)."));
      if (password.length < 8) problems.push(t("Password must be at least 8 characters."));
      // the demo names belong to the seeded shared accounts, whose passwords
      // can't change, so a person never registers one of them
      if (!problems.length && (DEMO_USERNAMES.includes(username) || one("SELECT 1 FROM users WHERE username = ?", username))) {
        problems.push(t("That username is taken."));
      }
      if (problems.length) return authForm(ctx, "register", values, problems, 422);

      const { id } = run(
        "INSERT INTO users (username, display_name, password_hash) VALUES (?, ?, ?)",
        username,
        displayName,
        await hashPassword(password),
      );
      signIn(ctx, id);
      logActivity({ actor: { id, username }, action: "auth.register" });
      setFlash(ctx, t("Welcome to Larder, {name}.", { name: displayName }));
      return redirect(safeNext(values.next));
    },
  },
  {
    method: "GET",
    path: "/login",
    handler: (ctx) => (ctx.user ? redirect("/") : authForm(ctx, "login", {}, [])),
  },
  {
    method: "POST",
    path: "/login",
    handler: async (ctx) => {
      const form = await ctx.form();
      const username = (form.get("username") ?? "").trim().toLowerCase();
      const password = form.get("password") ?? "";
      const next = form.get("next") ?? "";
      // sample reviewers (src/sample-reviews.ts) have no password to sign in with
      const user = one<{ id: number; password_hash: string }>(
        "SELECT id, password_hash FROM users WHERE username = ? AND is_sample = 0",
        username,
      );
      if (!user || !(await verifyPassword(password, user.password_hash))) {
        // the name tried, never the password; unknown names are cut short
        logActivity({ action: "auth.login_failed", outcome: "denied", subject: username.slice(0, 24), detail: { known_user: !!user } });
        return authForm(ctx, "login", { username, next }, [t("Username or password is incorrect.")], 401);
      }
      signIn(ctx, user.id);
      logActivity({ actor: { id: user.id, username }, action: "auth.login" });
      return redirect(safeNext(next));
    },
  },
  {
    method: "POST",
    path: "/logout",
    handler: (ctx) => {
      if (ctx.user) logActivity({ actor: ctx.user, action: "auth.logout" });
      destroySession(parseCookies(ctx.req.headers.cookie).sid);
      ctx.setCookies.push(cookie("sid", "", { maxAge: 0, secure: isHttps(ctx.req) }));
      setFlash(ctx, t("Signed out."));
      return redirect("/");
    },
  },
];
