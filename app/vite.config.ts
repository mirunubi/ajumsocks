import { defineConfig } from "vite";
import react from "@vitejs/plugin-react";
import { VitePWA } from "vite-plugin-pwa";

export default defineConfig({
  plugins: [
    react(),
    VitePWA({
      registerType: "autoUpdate",
      includeAssets: ["icons/icon.svg"],
      manifest: {
        name: "아점양말",
        short_name: "아점삭스",
        description: "행사 운영 업무용",
        lang: "ko",
        start_url: "/",
        scope: "/",
        display: "standalone",
        background_color: "#f7f3ee",
        theme_color: "#7a1f1f",
        icons: [
          {
            src: "/icons/icon.svg",
            sizes: "any",
            type: "image/svg+xml",
            purpose: "any",
          },
        ],
      },
    }),
  ],
  server: {
    host: "127.0.0.1",
    port: 5173,
  },
});
