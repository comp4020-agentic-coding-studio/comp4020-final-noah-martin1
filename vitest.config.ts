import { defineConfig } from "vitest/config";

// Every test in spec/ runs against the running app, which spec/global-setup.ts
// finds. Only spec/ runs: a test anywhere else needs adding to `include`.
// Unit specs that import src/ modules open a database of their own in a
// throwaway directory per file (spec/unit-db.ts), never the app's.
export default defineConfig({
  test: {
    include: ["spec/**/*.test.ts"],
    globalSetup: ["./spec/global-setup.ts"],
    setupFiles: ["./spec/unit-db.ts"],
  },
});
