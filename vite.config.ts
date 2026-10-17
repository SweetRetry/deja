import { defineConfig, type Plugin } from "vite";
import react from "@vitejs/plugin-react";
import tailwindcss from "@tailwindcss/vite";
import { createReadStream, statSync } from "node:fs";
import { extname, resolve, sep } from "node:path";
import { fileURLToPath, URL } from "node:url";

const TYPES: Record<string, string> = {
  ".jpg": "image/jpeg",
  ".jpeg": "image/jpeg",
  ".png": "image/png",
  ".gif": "image/gif",
  ".webp": "image/webp",
  ".avif": "image/avif",
  ".mp4": "video/mp4",
  ".mov": "video/quicktime",
  ".webm": "video/webm",
  ".mkv": "video/x-matroska",
};

/** The browser build has no file access, so pictures are read from `/vault/…`.
 *  `DEJA_SHOTS_VAULT` maps that prefix onto any folder on disk, which is how the
 *  README pictures and the promo are taken on a vault outside `public/`. */
function shotsVault(): Plugin {
  const root = process.env.DEJA_SHOTS_VAULT;
  return {
    name: "deja-shots-vault",
    configureServer(server) {
      if (!root) return;
      const base = resolve(root);
      server.middlewares.use((request, response, next) => {
        if (!request.url?.startsWith("/vault/")) return next();
        const rel = decodeURIComponent(request.url.slice("/vault/".length).split("?")[0] ?? "");
        const file = resolve(base, rel);
        if (!file.startsWith(base + sep)) return next();
        try {
          if (!statSync(file).isFile()) return next();
        } catch {
          return next();
        }
        response.setHeader("Content-Type", TYPES[extname(file).toLowerCase()] ?? "application/octet-stream");
        createReadStream(file).pipe(response);
      });
    },
  };
}

export default defineConfig({
  plugins: [react(), tailwindcss(), shotsVault()],
  resolve: { alias: { "@": fileURLToPath(new URL("./src", import.meta.url)) } },
  clearScreen: false,
  server: {
    host: "127.0.0.1",
    port: 5173,
    strictPort: true,
    watch: { ignored: ["**/src-tauri/**"] },
    proxy: {
      // The e2e build runs the real Rust backend behind this proxy.
      "/api": { target: "http://127.0.0.1:5177", changeOrigin: false },
    },
  },
});
