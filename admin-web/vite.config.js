import { defineConfig } from "vite";
import react from "@vitejs/plugin-react";

// Served by PhleboBackend (Express) at /admin, so base + build output must match.
export default defineConfig({
  plugins: [react()],
  base: "/admin/",
  build: {
    outDir: "dist",
    emptyOutDir: true,
  },
  server: {
    port: 5175,
    proxy: {
      "/v1/api": "http://localhost:3010",
      "/uploads": "http://localhost:3010",
    },
  },
});
