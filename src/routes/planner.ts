import type { Reply } from "../http.ts";
import type { Route } from "../server.ts";

// The meal planner used to be a page of its own. It now lives inside the
// calendar ("Plan my week for me"), so old links land there.

export function moved(location: string): Reply {
  return { status: 302, headers: { location }, body: "" };
}

export const routes: Route[] = [
  { method: "GET", path: "/planner", handler: () => moved("/calendar#plan") },
  { method: "GET", path: "/planner/week", handler: () => moved("/calendar#plan") },
];
