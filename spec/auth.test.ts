import { describe, expect, it } from "vitest";
import { Client, PASSWORD, registered, uniqueName } from "./helpers.ts";

// Accounts are how the app tells people apart (the brief's multi-user line).
describe("accounts", () => {
  it("registering signs you in and lands on your dashboard", async () => {
    const { client, username } = await registered();
    const home = await client.get("/");
    expect(home.status).toBe(200);
    expect(await home.text()).toContain(`@${username}`);
  });

  it("refuses a username that is already taken", async () => {
    const { username } = await registered();
    const res = await new Client().post("/register", { username, display_name: "Copycat", password: PASSWORD });
    expect(res.status).toBe(422);
    expect(await res.text()).toContain("That username is taken");
  });

  it("refuses a wrong password and accepts the right one", async () => {
    const { username } = await registered();
    const wrong = await new Client().post("/login", { username, password: "not the password" });
    expect(wrong.status).toBe(401);

    const right = new Client();
    const res = await right.post("/login", { username, password: PASSWORD });
    expect(res.finalUrl).toBe("/");
    expect(await res.text()).toContain(`@${username}`);
  });

  it("signing out ends the session", async () => {
    const { client } = await registered();
    await client.post("/logout");
    const res = await client.get("/pantry");
    expect(res.finalUrl).toMatch(/^\/login/);
  });

  it.each(["/feed", "/recipes", "/pantry", "/calendar", "/friends"])(
    "sends a signed-out visitor from %s to sign in",
    async (path) => {
      const res = await new Client().get(path);
      expect(res.finalUrl).toBe(`/login?next=${encodeURIComponent(path)}`);
    },
  );

  it("rejects a form posted from another site", async () => {
    const res = await new Client().request("/register", {
      method: "POST",
      headers: { "content-type": "application/x-www-form-urlencoded", origin: "https://evil.example" },
      body: new URLSearchParams({ username: uniqueName(), display_name: "x", password: PASSWORD }),
    });
    expect(res.status).toBe(403);
  });
});
