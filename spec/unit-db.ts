import { mkdtempSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";

// Unit specs import src/ modules, which open a database on load. Each test
// file gets its own throwaway directory, never the app's ./data or /data.
process.env.DATA_DIR = mkdtempSync(join(tmpdir(), "larder-unit-"));
