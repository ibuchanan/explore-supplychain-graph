import { defineConfig } from "vitest/config";

export default defineConfig({
  test: {
    exclude: [
      "**/node_modules/**",
      "**/.agents/**",
      "**/dist/**",
      "**/coverage/**",
      "specs/**",
      "vendor/**",
    ],
    globals: false,
    coverage: { provider: "v8" },
  },
});
