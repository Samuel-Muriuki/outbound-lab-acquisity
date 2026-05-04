import { defineConfig } from "vitest/config";
import { resolve } from "node:path";

export default defineConfig({
  test: {
    environment: "node",
    globals: false,
    // Tests live next to source. Component tests will switch the env to
    // jsdom on a per-file basis with /** @vitest-environment jsdom */.
    include: ["src/**/*.test.ts", "src/**/*.test.tsx", "tests/**/*.test.ts"],
    exclude: ["node_modules/**", "dist/**", ".next/**"],
    // Server-side modules import 'server-only' which throws at module load
    // outside Next.js. Stub it so tests can import server code freely.
    server: {
      deps: {
        inline: ["server-only"],
      },
    },
    setupFiles: ["./vitest.setup.ts"],
  },
  resolve: {
    alias: {
      "@": resolve(__dirname, "./src"),
    },
  },
});
