import { defineConfig } from "vite";
import react from "@vitejs/plugin-react";

const BACKEND_PORT = process.env.PORT ?? "3000";

export default defineConfig({
  plugins: [react()],
  build: {
    outDir: "../dist/public",
    emptyOutDir: true,
  },
  server: {
    proxy: {
      "/api": `http://localhost:${BACKEND_PORT}`,
      "/health": `http://localhost:${BACKEND_PORT}`,
    },
  },
});
