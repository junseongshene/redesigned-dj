import { defineConfig } from "vite";

/** 전시: dist를 하위 경로에 올릴 때도 상대 경로로 열리도록 */
export default defineConfig({
  base: "./",
  publicDir: "public",
});
