import { defineConfig } from "vitest/config";

export default defineConfig({
  test: {
    include: ["src/**/*.test.ts", "prisma/**/*.test.ts"],
    testTimeout: 30000,
    hookTimeout: 60000,
    // SQLite con connection_limit=1: una escritura a la vez, y cada archivo de
    // test monta su propia base. En paralelo se pisan.
    fileParallelism: false,
    env: { DATABASE_URL: "file:./test-e2e.db?connection_limit=1", JWT_SECRET: "test-secret" },
  },
});
