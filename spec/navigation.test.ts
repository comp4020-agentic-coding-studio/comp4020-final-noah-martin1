import { JSDOM } from "jsdom";
import { describe, expect, it } from "vitest";
import { registered } from "./helpers.ts";

// Every section in the navigation answers for a signed-in person, and the
// sections that are still previews say so (CLAUDE.md: "previews say they're
// previews").
describe("navigation", () => {
  it("every sidebar link opens, and preview sections carry the preview banner", async () => {
    const { client } = await registered();
    const home = new JSDOM(await (await client.get("/")).text()).window.document;
    const links = [...home.querySelectorAll<HTMLAnchorElement>(".sidebar nav a")];
    // the core sections are all one click away
    const hrefs = links.map((a) => a.getAttribute("href"));
    for (const core of ["/", "/global", "/pantry", "/recipes", "/calendar", "/shopping", "/friends"]) expect(hrefs).toContain(core);

    for (const link of links) {
      const res = await client.get(link.getAttribute("href")!);
      expect(res.status, link.getAttribute("href")!).toBe(200);
      const isPreview = !!link.querySelector("small");
      if (isPreview) expect(await res.text(), link.getAttribute("href")!).toContain("Preview with sample data");
    }
  });

  it("the mobile More page lists every section", async () => {
    const { client } = await registered();
    const home = new JSDOM(await (await client.get("/")).text()).window.document;
    const sidebar = [...home.querySelectorAll(".sidebar nav a")].map((a) => a.getAttribute("href"));
    const more = new JSDOM(await (await client.get("/more")).text()).window.document;
    const listed = [...more.querySelectorAll(".more-list a")].map((a) => a.getAttribute("href"));
    for (const href of sidebar) expect(listed).toContain(href);
  });

  // the planner and the shared schedule now live inside the calendar
  it.each(["/planner", "/planner/week", "/schedule"])("%s leads to the calendar", async (path) => {
    const { client } = await registered();
    const res = await client.get(path);
    expect(res.status).toBe(200);
    expect(res.finalUrl).toMatch(/^\/calendar/);
  });

  // live cooking is real now and lives on the globe
  it.each(["/live", "/live/1", "/live/1/along"])("%s leads to the globe", async (path) => {
    const { client } = await registered();
    const res = await client.get(path);
    expect(res.status).toBe(200);
    expect(res.finalUrl).toMatch(/^\/global/);
  });

  // households are real now: no sample data, and someone outside one is shown
  // how to start or join one (the details are in household.test.ts)
  it("/household is real, not a preview", async () => {
    const { client } = await registered();
    const res = await client.get("/household");
    expect(res.status).toBe(200);
    const body = await res.text();
    expect(body).not.toContain("Preview with sample data");
    expect(body).toMatch(/invite code/i);
  });
});
