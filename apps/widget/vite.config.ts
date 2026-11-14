/// <reference types="vitest" />
import { defineConfig } from "vite";

export default defineConfig({
  // customer pages may not declare UTF-8: escape every non-ASCII character (Hindi, Tamil, emoji) in the bundle,
  // so the script works whatever encoding the page uses
  esbuild: { charset: "ascii" },
  build: {
    lib: {
      entry: "src/main.ts",
      name: "BotForge",
      formats: ["iife"],
      fileName: () => "widget.js",
    },
    target: "es2019",
    outDir: "dist",
    emptyOutDir: true,
  },
  test: {
    environment: "jsdom",
  },
});
