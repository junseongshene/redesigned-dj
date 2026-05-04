import fs from "fs";
import path from "path";
import { fileURLToPath } from "url";

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const root = path.resolve(__dirname, "..");
const srcDir = path.join(root, "node_modules", "rubberband-web", "public");
const destDir = path.join(root, "public", "rubberband");

if (!fs.existsSync(srcDir)) {
  console.warn("[copy-rubberband] node_modules/rubberband-web/public 없음 — npm install 후 다시 실행하세요.");
  process.exit(0);
}

fs.mkdirSync(destDir, { recursive: true });
fs.cpSync(srcDir, destDir, { recursive: true });
console.log("[copy-rubberband] public/rubberband 로 복사했습니다.");
