import type { Route } from "../server.ts";
import { moved } from "./planner.ts";

// The shared schedule used to be a preview page of its own. Friends' shared
// meals are now overlaid on the calendar itself, so old links land there.

export const routes: Route[] = [{ method: "GET", path: "/schedule", handler: () => moved("/calendar") }];
