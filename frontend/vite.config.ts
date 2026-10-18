import { createHash } from "node:crypto";
import { defineConfig, loadEnv, type Plugin } from "vite";
import react from "@vitejs/plugin-react";
import {resolveApiUrl} from "./src/api";

const INLINE_SCRIPT = /<script(?![^>]*\bsrc=)[^>]*>([\s\S]*?)<\/script>/g;
const CRLF = /\r\n?/g;

/** Content Security Policy for the built page. Scripts only from this site (inline ones only by
 *  their hash), requests only to this site and the API: even an injected script couldn't send a
 *  sign-in token anywhere else. Framing is blocked by headers in vercel.json (meta tags can't). */
function contentSecurityPolicy(apiUrl: string): Plugin {
  const api = apiUrl.startsWith("/") ? "" : ` ${new URL(apiUrl).origin}`;
  const policy = (hashes: string[]) =>
    [
      "default-src 'self'",
      `script-src 'self' ${hashes.join(" ")}`.trim(),
      // React sets style attributes (colours, positions); fonts come from Google Fonts.
      "style-src 'self' 'unsafe-inline' https://fonts.googleapis.com",
      "font-src 'self' https://fonts.gstatic.com",
      "img-src 'self' blob: data:",
      "media-src 'self'",
      `connect-src 'self'${api}`,
      "object-src 'none'",
      "base-uri 'self'",
      "form-action 'self'",
    ].join("; ");
  return {
    name: "outfitly-csp",
    apply: "build",
    enforce: "post", // after Vite's own HTML step has put index.html in the bundle
    // Hashed in the file as written. Browsers turn CRLF line endings into LF before hashing an
    // inline script (the HTML spec), so the hash is taken the same way, or a Windows checkout
    // would publish a hash that never matches.
    generateBundle(_, bundle) {
      for (const file of Object.values(bundle)) {
        if (file.type !== "asset" || !file.fileName.endsWith(".html")) continue;
        const html = String(file.source);
        const hashes = [...html.matchAll(INLINE_SCRIPT)].map(
          ([, code]) => `'sha256-${createHash("sha256").update(code.replace(CRLF, "\n")).digest("base64")}'`,
        );
        file.source = html.replace("<head>", `<head>\n    <meta http-equiv="Content-Security-Policy" content="${policy(hashes)}" />`);
      }
    },
  };
}

export default defineConfig(({ mode }) => {
  const env = loadEnv(mode, ".", "");
  const appEnv = process.env.APP_ENV ?? env.APP_ENV ?? (mode === "production" ? "prod" : "dev");
  if (appEnv !== "dev" && appEnv !== "prod") throw new Error("APP_ENV must be dev or prod");
  const apiUrl = resolveApiUrl(process.env.VITE_API_URL ?? env.VITE_API_URL, appEnv);
  return {
    plugins: [react(), contentSecurityPolicy(apiUrl)],
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
