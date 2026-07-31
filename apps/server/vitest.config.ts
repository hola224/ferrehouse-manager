import { defineConfig } from "vitest/config";

export default defineConfig({
  test: {
    include: ["src/**/*.test.ts", "prisma/**/*.test.ts"],
    testTimeout: 30000,
    hookTimeout: 60000,
    // Cada archivo de test recibe su PROPIA base: `test-db-url.ts` corre antes
    // del grafo de módulos y le pone un nombre único a DATABASE_URL. Compartir
    // un archivo y borrarlo entre test y test era una carrera que rompía una de
    // cada tres o cuatro corridas.
    setupFiles: ["./src/test-db-url.ts"],
    // SQLite con connection_limit=1: una escritura a la vez.
    fileParallelism: false,
    env: { DATABASE_URL: "file:./test-e2e.db?connection_limit=1", JWT_SECRET: "test-secret" },
  },
});
