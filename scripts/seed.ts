// Local demo data so the app looks lived-in while developing: `pnpm seed`.
// Writes to ./data (package.json sets DATA_DIR). While DEMO_MODE is on the
// server also seeds this on start (src/demo.ts). Safe to re-run.
import { seedDemo } from "../src/demo.ts";

console.log((await seedDemo()) ? "seeded demo users alice, sam, bo, jo — password: password123" : "demo data already present — delete ./data to start over");
