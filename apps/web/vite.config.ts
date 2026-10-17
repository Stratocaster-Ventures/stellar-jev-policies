import { defineConfig } from "vite";
import { resolve } from "node:path";
export default defineConfig({
  server: { port: 5173, proxy: { "/api": "http://localhost:4317" } },
  build: { rollupOptions: { input: { main: resolve(__dirname, "index.html"), blog: resolve(__dirname, "blog.html") } } },
});
