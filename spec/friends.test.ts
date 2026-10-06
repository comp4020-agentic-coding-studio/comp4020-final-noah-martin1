import { describe, expect, it } from "vitest";
import { registered } from "./helpers.ts";

// CLAUDE.md invariant 5: a friendship is accepted only once both people act.
describe("friendships", () => {
  it("the person who sent a request cannot accept it themselves", async () => {
    const alice = await registered("alice");
    const bob = await registered("bob");
    await alice.client.post(`/friends/${bob.username}/request`);

    const selfAccept = await alice.client.post(`/friends/${bob.username}/accept`);
    expect(selfAccept.status).toBe(403);

    const page = await (await alice.client.get("/friends")).text();
    expect(page).toContain("Sent");
    expect(page).not.toContain("Your friends");
  });

  it("the recipient accepting makes them friends on both sides", async () => {
    const alice = await registered("alice");
    const bob = await registered("bob");
    await alice.client.post(`/friends/${bob.username}/request`);

    const accept = await bob.client.post(`/friends/${alice.username}/accept`);
    expect(accept.status).toBe(200);
    expect(await (await alice.client.get("/friends")).text()).toContain("Your friends");
    expect(await (await bob.client.get("/friends")).text()).toContain("Your friends");
  });

  it("requesting someone who already asked you counts as accepting", async () => {
    const alice = await registered("alice");
    const bob = await registered("bob");
    await alice.client.post(`/friends/${bob.username}/request`);
    await bob.client.post(`/friends/${alice.username}/request`);
    expect(await (await alice.client.get("/friends")).text()).toContain("Your friends");
  });

  it("you cannot accept a request nobody sent", async () => {
    const alice = await registered("alice");
    const bob = await registered("bob");
    const res = await bob.client.post(`/friends/${alice.username}/accept`);
    expect(res.status).toBe(403);
  });
});
