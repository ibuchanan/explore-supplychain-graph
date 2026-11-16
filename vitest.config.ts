import { defineConfig } from "vitest/config";

export default defineConfig({
  test: {
    exclude: [
      ...(process.env["WORKDOWN_DEPLOYED_TEST"] === "1"
        ? []
        : ["**/*.deployed.test.ts"]),
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
