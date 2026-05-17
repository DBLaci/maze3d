import { defineConfig } from "vite";

export default defineConfig({
  server: {
    port: 5173,
    proxy: {
      "/ws": {
        target: "ws://localhost:3000",
        ws: true
      },
      "/health": "http://localhost:3000"
    }
  },
  build: {
    rollupOptions: {
      input: {
        main: "index.html",
        lattice: "lattice.html"
      }
    },
    outDir: "dist",
    emptyOutDir: true
  }
});
