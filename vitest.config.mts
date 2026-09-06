import path from "node:path";
import { defineConfig } from "vitest/config";

export default defineConfig({
  resolve: {
    alias: {
      "@": path.resolve(import.meta.dirname, "./src"),
    },
  },
  test: {
    environment: "node",
    include: ["src/**/*.test.ts", "adversarial/**/*.test.ts"],
    /*
     * Each test file gets its own process.
     *
     * Two suites configure the JSON store by mutating `process.env.LOCAL_STORE_PATH`
     * and deleting it again in afterEach. Under the default thread pool that
     * variable is shared between files running in parallel, so one file's cleanup
     * could land between another file's setup and its assertions -- the store then
     * fell back to its default path and an optimistic-concurrency test failed
     * intermittently while passing in isolation.
     *
     * A flaky test is worse here than a slow one. This repo relies on CI to stop a
     * merge that reverts a safety guard, and a suite that fails at random teaches
     * people to re-run until it is green, which is exactly how a real regression
     * gets waved through.
     */
    pool: "forks",
  },
});
