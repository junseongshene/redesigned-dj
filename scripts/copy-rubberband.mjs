import fs from "fs";
import path from "path";
import { fileURLToPath } from "url";

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const root = path.resolve(__dirname, "..");
const srcDir = path.join(root, "node_modules", "rubberband-web", "public");
const destDir = path.join(root, "public", "rubberband");
const processorPath = path.join(destDir, "rubberband-processor.js");

if (!fs.existsSync(srcDir)) {
  console.warn(
    "[copy-rubberband] node_modules/rubberband-web/public 없음 — npm install 후 다시 실행하세요.",
  );
  process.exit(0);
}

fs.mkdirSync(destDir, { recursive: true });
fs.cpSync(srcDir, destDir, { recursive: true });
console.log("[copy-rubberband] public/rubberband 로 복사했습니다.");

// 피치를 빠르게/자주 긁으면 라이브러리가 내부 메모리를 다시 잡으면서 그 위치가
// 옮겨지는데, 라이브러리는 옛 위치를 기억해두고 있다가 거기에 오디오를 써넣으려다 간헐적으로 실패하는 문제가 있다. getChannelArray를 패치해서 매번 HEAPF32에서 새로 읽어오도록 해서 해결함 '-^

const PATCH_MARKER = "/*RB_DETACH_REFRESH_PATCH*/";
const ORIGINAL = `{key:"getChannelArray",value:function(A){if(A<0||A>=this.channelCount)throw new Error("Invalid channel index ".concat(A,", please choose an index from 0 to ").concat(this.channelCount));return this.channelData[A]}}`;
const PATCHED = `{key:"getChannelArray",value:function(A){${PATCH_MARKER}if(A<0||A>=this.channelCount)throw new Error("Invalid channel index ".concat(A,", please choose an index from 0 to ").concat(this.channelCount));var __h=this.module.HEAPF32;var __v=this.channelData[A];if(!__v||__v.buffer!==__h.buffer){var __i=this.length*4;for(var __g=0;__g<this.channelCount;++__g){var __Y=this.dataPtr+__g*__i;this.channelData[__g]=__h.subarray(__Y>>2,(__Y+__i)>>2)}__v=this.channelData[A]}return __v}}`;

if (!fs.existsSync(processorPath)) {
  console.warn("[copy-rubberband] rubberband-processor.js 없음 — 패치 건너뜀.");
  process.exit(0);
}

let code = fs.readFileSync(processorPath, "utf8");
if (code.includes(PATCH_MARKER)) {
  console.log("[copy-rubberband] 이미 패치됨.");
  process.exit(0);
}
if (!code.includes(ORIGINAL)) {
  console.warn(
    "[copy-rubberband] 예상한 getChannelArray 패턴을 찾지 못했습니다. rubberband-web 버전이 바뀐 듯.",
  );
  process.exit(0);
}
code = code.replace(ORIGINAL, PATCHED);
fs.writeFileSync(processorPath, code);
console.log("[copy-rubberband] detach-refresh 패치 적용 완료.");
