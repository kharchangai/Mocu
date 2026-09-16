import { defineConfig } from "vite";
import react from "@vitejs/plugin-react";
import tailwindcss from "@tailwindcss/vite";

const host = process.env.TAURI_DEV_HOST;

export default defineConfig(async () => ({
  plugins: [
    react(),
    tailwindcss(),
  ],

  clearScreen: false,

  server: {
    port: 1431,
    strictPort: true,
    host: host || "localhost",
    hmr: {
      protocol: "ws",
      host: host || "localhost",
      port: 1431,
    },
    watch: {
      /*
       * Project conversations and memory databases are stored inside
       * <project>/.mocu. When the active project is this repository itself,
       * those files are written while Vite is running and must not trigger a
       * dev-server reload. Otherwise pending Tauri invoke callbacks are lost
       * and the webview returns to the New chat page.
       */
      ignored: [
        "**/src-tauri/**",
        "**/.mocu/**",
        "**/.mocu",
      ],
    },
  },
}));