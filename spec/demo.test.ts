import { describe, expect, it } from "vitest";
import { Client } from "./helpers.ts";

// TEMPORARY, like DEMO_MODE in src/demo.ts: delete this file when demo mode
// is switched off.
describe("demo account", () => {
  it("the sign-in form arrives filled in, and signing in with it works", async () => {
    const client = new Client();
    const form = await (await client.get("/login")).text();
    expect(form).toMatch(/name="username"[^>]*value="alice"/);
    expect(form).toMatch(/name="password"[^>]*value="password123"/);

    const res = await client.post("/login", { username: "alice", password: "password123" });
    expect(res.finalUrl).toBe("/");
    expect(await res.text()).toContain("@alice");
  });

  it("nobody can change the shared demo password", async () => {
    const client = new Client();
    await client.post("/login", { username: "alice", password: "password123" });
    const res = await client.post("/settings/password", { current: "password123", next: "taken over now" });
    expect(res.status).toBe(403);
    expect((await new Client().post("/login", { username: "alice", password: "password123" })).finalUrl).toBe("/");
  });
});
