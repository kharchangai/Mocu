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
    /*
     * HMR can request a full WebView reload while a Tauri invoke is still
     * pending, orphaning its callback. Keep it disabled in dev; restart or
     * manually refresh the WebView when you want to load frontend changes.
     */
    hmr: false,
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