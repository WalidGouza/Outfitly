import { defineConfig, loadEnv } from "vite";
import react from "@vitejs/plugin-react";
import {resolveApiUrl} from "./src/api";
export default defineConfig(({ mode }) => {
  const env = loadEnv(mode, ".", "");
  const appEnv = process.env.APP_ENV ?? env.APP_ENV ?? (mode === "production" ? "prod" : "dev");
  if (appEnv !== "dev" && appEnv !== "prod") throw new Error("APP_ENV must be dev or prod");
  const apiUrl = resolveApiUrl(process.env.VITE_API_URL ?? env.VITE_API_URL, appEnv);
  return {
    plugins: [react()],
    define: {"import.meta.env.VITE_APP_ENV": JSON.stringify(appEnv), "import.meta.env.VITE_API_URL": JSON.stringify(apiUrl)},
    build: {sourcemap: appEnv === "dev", minify: appEnv === "prod" ? "esbuild" : false},
    server: {
      port: 5173,
      strictPort: true,
      proxy: {
        "/api": {
          target: env.API_PROXY_TARGET || "http://127.0.0.1:8000",
          changeOrigin: true,
          rewrite: (path) => path.replace(/^\/api/, ""),
        },
      },
    },
  };
});
