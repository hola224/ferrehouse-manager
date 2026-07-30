import { defineConfig } from "vite";
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
});
