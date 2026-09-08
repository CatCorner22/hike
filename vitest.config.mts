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
    // Transient adversarial-review agent workspaces. Agents create these to run
    // their own repro probes while a swarm is in flight; collecting them makes
    // this suite's result depend on whatever an agent happens to be executing.
    exclude: ["**/node_modules/**", "src/__probe-*/**", "src/__verify-*/**", "src/__refute-*/**"],
  },
});
