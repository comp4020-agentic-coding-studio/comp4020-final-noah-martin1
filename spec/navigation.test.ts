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
    expect(links.length).toBeGreaterThanOrEqual(10);

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

  it.each(["/household/pantry", "/household/calendar", "/household/members", "/household/new", "/live/1", "/live/1/along", "/planner/week"])(
    "%s opens and is marked as a preview",
    async (path) => {
      const { client } = await registered();
      const res = await client.get(path);
      expect(res.status).toBe(200);
      expect(await res.text()).toContain("Preview with sample data");
    },
  );
});
