/// <reference types="vitest" />
import { defineConfig } from "vitest/config";
import react from "@vitejs/plugin-react";
import { fileURLToPath, URL } from "node:url";

export default defineConfig({
  plugins: [react()],
  resolve: { alias: { "@": fileURLToPath(new URL("./src", import.meta.url)) } },
  server: {
    host: true, // los terminales entran por la LAN
    // El puerto del API se puede mover con FH_API_PORT. Sirve para levantar una
    // segunda copia —una rama en revisión, por ejemplo— sin apagar la primera.
    proxy: { "/api": `http://localhost:${process.env.FH_API_PORT ?? 3000}` },
  },
  build: { assetsInlineLimit: 0 },
  test: {
    /**
     * jsdom para todos los archivos, y no solo para los de pantalla.
     *
     * `tokens.test.ts` no necesita un DOM —lee un CSS con expresiones
     * regulares— y se podría dejar en `node` con un `@vitest-environment` por
     * archivo. No vale la pena: el ahorro son milisegundos, y el costo es que
     * el día que alguien escriba un test de pantalla y olvide el comentario
     * mágico, el error que reciba sea «document is not defined», que no se
     * parece en nada a «te falta una línea arriba».
     */
    environment: "jsdom",
    setupFiles: ["./vitest.setup.ts"],
    globals: false,
  },
});
