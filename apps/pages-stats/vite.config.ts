import { defineConfig } from "vite";
import react from "@vitejs/plugin-react";

export default defineConfig({
  plugins: [react()],
  base: "/open-prs/",
  build: {
    outDir: "dist/open-prs",
    emptyOutDir: true
  }
});