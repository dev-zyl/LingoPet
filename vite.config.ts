import { defineConfig } from "vite";
import { resolve } from "path";

const host = process.env.TAURI_DEV_HOST;

export default defineConfig({
  root: "src",
  build: {
    rollupOptions: {
      input: {
        pet: resolve(__dirname, "src/pet/index.html"),
        config: resolve(__dirname, "src/config/index.html"),
      },
    },
    outDir: resolve(__dirname, "dist"),
    emptyOutDir: true,
  },
  server: {
    port: 5173,
    strictPort: true,
    host: host || false,
    hmr: host
      ? {
          protocol: "ws",
          host,
          port: 5174,
        }
      : undefined,
  },
  clearScreen: false,
});
