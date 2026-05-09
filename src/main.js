import { createRubberBandNode } from "rubberband-web";

const DRAG_THRESHOLD_PX = 6;
/** DJ 탭은 전부 채널명이라, 가로가 세로보다 조금만 커도 스크럽으로 오인됨 → 뜯기가 막힘. 가로가 이만큼(px) 더 커야 스크럽. */
const TAB_SCRUB_HORIZONTAL_LEAD_PX = 10;

/** 창 합치기: 창 전체 rect가 이 비율 이상 겹쳐야 병합(작은 쪽 면적 기준) */
const MERGE_WINDOW_OVERLAP_MIN = 0.8;
/** 창 겹침 40%부터 다음 곡으로 크로스페이드 시작 */
const MERGE_CROSSFADE_START = 0.4;

/** window 포인터 리스너는 캡처로 등록(드래그 중 move/up이 묻히지 않게) */
const POINTER_WIN_OPTS = { capture: true };

/** 탭 제목과 매칭 (index.html 탭 이름과 동일) */
const DJ_CHANNELS = ["Volume", "Pitch", "Tempo", "Bass"];

/** 창 중심이 이 픽셀만큼 움직일 때 약 1% 변화 (클수록 둔감). 예전 대비 약 3배 둔하게. */
const DJ_WIN_PX_PER_PERCENT = 50;

/** 창이 화면 가장자리에서 완전히 붙지 않게 남길 여백(px) */
const WINDOW_DRAG_VIEWPORT_PADDING = 0;

const djState = Object.fromEntries(DJ_CHANNELS.map((name) => [name, 50]));

const DJ_CONTROLLER_ASSET_DIR = "./controllers/";

const DJ_CONTROLLER_META = {
  Volume: {
    type: "dial",
    panel: "volume",
    control: "volume_dial",
    panelW: 561,
    panelH: 604,
    controlW: 331,
    controlH: 341,
  },
  Pitch: {
    type: "stick",
    panel: "pitch",
    control: "pitch_stick",
    panelW: 561,
    panelH: 604,
    controlW: 128,
    controlH: 88,
    rangePx: 400,
  },
  Tempo: {
    type: "stick",
    panel: "tempo",
    control: "tempo_stick",
    panelW: 561,
    panelH: 604,
    controlW: 128,
    controlH: 89,
    rangePx: 400,
  },
  Bass: {
    type: "dial",
    panel: "bass",
    control: "bass_dial",
    panelW: 561,
    panelH: 604,
    controlW: 331,
    controlH: 341,
  },
};

const DJ_CHANNEL_COLORS = {
  Volume: "#ffebc9",
  Pitch: "#ccfaff",
  Tempo: "#ffffc8",
  Bass: "#f4e6ff",
};

function getDjControllerAssetUrl(name) {
  return `${DJ_CONTROLLER_ASSET_DIR}${name}.png`;
}

/** 배경 트랙 Web Audio (Rubber Band: 피치만 / 템포: media playbackRate + preservesPitch / lowshelf·gain) */
let exhibitionMediaEl = null;
let exhibitionTransitionEl = null;
let exhibitionCtx = null;
let exhibitionRb = null;
let exhibitionRbTransition = null;
let exhibitionBass = null;
let exhibitionTransitionBass = null;
let exhibitionDeckGain = null;
let exhibitionTransitionGain = null;
let exhibitionMaster = null;
let exhibitionGraphReady = false;

/** Rubber Band: 마지막으로 성공한 setPitch 비율(서보 현재값) */
let exhibitionRbLastPitch = NaN;
/** 볼륨·베이스는 값이 바뀔 때만 AudioParam에 써서 그래프 불필요 갱신 방지 */
let lastAppliedVolPct = NaN;
let lastAppliedBassPct = NaN;
let mergeCrossfadeActive = false;
let mergeCrossfadeCurrentTrack = null;
let mergeCrossfadeCurrentIndex = 0;
let mergeCrossfadeArmedIndex = -1;
let mergeCrossfadeArmedReady = false;

const MERGE_CROSSFADE_PLAYLIST = [
  { src: "./audio/08. Aphex Twin - We Are the Music Makers.mp3", offsetSec: 0 },
  { src: "./audio/01. Aphex Twin - Xtal.mp3", offsetSec: 0 },
  { src: "./audio/04. Aphex Twin - Ageispolis.mp3", offsetSec: 55 },
  { src: "./audio/06. Aphex Twin - Green Calx.mp3", offsetSec: 12 },
  { src: "./audio/10. Aphex Twin - Ptolemy.mp3", offsetSec: 0 },
];

function getNextMergeCrossfadeIndex() {
  return (mergeCrossfadeCurrentIndex + 1) % MERGE_CROSSFADE_PLAYLIST.length;
}

/** 드래그 중: 게인·베이스·playbackRate를 포인터마다가 아니라 프레임당 1회만 적용 */
let exhibitionAudioGraphRaf = 0;

/** 피치: setPitch 폭주 방지 — 매 프레임 목표로 아주 조금씩만 이동하는 전용 rAF 루프 */
let exhibitionPitchServoRaf = 0;
/** 한 번에 바꿀 수 있는 피치 비율 상한(워클릿 안정성) */
const RB_PITCH_MAX_STEP_RATIO = 0.0024;

/** Pitch 드래그 중 setPitch 최소 간격. 너무 낮으면 끊김 */
const RB_PITCH_LIVE_INTERVAL_MS = 180;

/** Pitch 값이 이 정도 이상 바뀌었을 때만 setPitch */
const RB_PITCH_LIVE_MIN_DIFF = 0.004;

let exhibitionRbLastLivePitchAt = 0;

/** 템포는 playbackRate로만 — 드래그 중 급변 완화용 스무딩(손 떼면 스냅) */
let exhibitionTempoPlaybackSmoothed = 1;
const DJ_TEMPO_PLAYBACK_SMOOTH = 0.68;

/** 15초 무입력 시 전시 화면 자동 리프레시 */
const INACTIVITY_RELOAD_MS = 15000;
let inactivityReloadTimer = 0;

/** HUD DOM은 rAF로 묶음 */
let djHudDomRaf = 0;

/** 50% 기준 ±(이 값) 옥타브 — 좁을수록 아티팩트·불안정 감소 */
const DJ_PITCH_OCT_RANGE = 0.18;
/** 템포: HUD % 증가 = 체감 빨라짐(라이브러리 부호에 맞춤 반전 적용) */
const DJ_TEMPO_OCT_RANGE = 0.16;
/** Rubber Band에 넣을 배속/피치 비율 하한·상한(너무 극단이면 무음·깨짐) */
const DJ_RB_RATIO_MIN = 0.5;
const DJ_RB_RATIO_MAX = 1.5;

const OMNIBOX_GOOGLE_G = `<span class="chrome-omnibox__google-g" aria-hidden="true">🎧</span>`;

function clamp(n, min, max) {
  return Math.min(Math.max(n, min), max);
}

function parseTranslate(win) {
  if (win.classList.contains("chrome-window--floated")) {
    return { dx: 0, dy: 0 };
  }
  const dx = Number(win.dataset.dx || 0);
  const dy = Number(win.dataset.dy || 0);
  return { dx, dy };
}

function applyTranslate(win, dx, dy) {
  if (win.classList.contains("chrome-window--floated")) return;
  win.dataset.dx = String(dx);
  win.dataset.dy = String(dy);
  win.style.transform = `translate(${dx}px, ${dy}px)`;
}

function getClampedTranslateForViewport(win, dx, dy) {
  const pad = WINDOW_DRAG_VIEWPORT_PADDING;

  const currentDx = Number(win.dataset.dx || 0);
  const currentDy = Number(win.dataset.dy || 0);

  const r = win.getBoundingClientRect();

  // 현재 rect는 이미 기존 translate가 적용된 상태이므로,
  // 기존 translate를 빼서 원래 grid 위치 기준 rect를 복원한다.
  const baseLeft = r.left - currentDx;
  const baseTop = r.top - currentDy;
  const width = r.width;
  const height = r.height;

  const minDx = pad - baseLeft;
  const maxDx = window.innerWidth - pad - (baseLeft + width);

  const minDy = pad - baseTop;
  const maxDy = window.innerHeight - pad - (baseTop + height);

  return {
    dx: clamp(dx, minDx, maxDx),
    dy: clamp(dy, minDy, maxDy),
  };
}

let chromeWindowZSeed = 40;

function bringWindowToFront(win) {
  if (!win) return;

  chromeWindowZSeed += 1;
  win.style.zIndex = String(chromeWindowZSeed);
}

function selectWindow(selected) {
  document.querySelectorAll(".chrome-window").forEach((w) => {
    w.classList.toggle("chrome-window--selected", w === selected);
  });

  bringWindowToFront(selected);

  if (typeof syncWindowActiveChannelAttrs === "function") {
    syncWindowActiveChannelAttrs();
  }
}

function syncWindowActiveChannelAttrs() {
  document.querySelectorAll(".chrome-window").forEach((win) => {
    const channelKeys = getDjChannelKeysForWindow(win);
    const channelKey = getDjChannelKeyForWindow(win);

    if (channelKey && channelKeys.length > 0) {
      win.dataset.activeChannel = channelKey;
      const gradient = buildWindowChannelGradient(channelKeys);
      if (gradient) {
        win.style.setProperty("--window-top-grad", gradient);
      } else {
        win.style.removeProperty("--window-top-grad");
      }
    } else {
      delete win.dataset.activeChannel;
      win.style.removeProperty("--window-top-grad");
    }
  });
}

function buildWindowChannelGradient(channelKeys) {
  const colors = channelKeys.map((k) => DJ_CHANNEL_COLORS[k]).filter(Boolean);
  if (colors.length === 0) return "";
  if (colors.length === 1) return colors[0];
  return `linear-gradient(90deg, ${colors.join(", ")})`;
}

function getTabs(strip) {
  return [...strip.querySelectorAll(":scope > .chrome-tab")];
}

/** 포인터가 스트립 밖으로 벗어나도 삽입 X를 스트립 안으로 잡아 임의 순서 점프 완화 */
function clampClientXIntoStrip(strip, clientX, clientY) {
  const r = strip.getBoundingClientRect();
  if (r.width <= 20) return clientX;
  const pad = 12;
  const x = clamp(clientX, r.left + pad, r.right - pad);
  if (clientY < r.top - 80 || clientY > r.bottom + 80) {
    return (r.left + r.right) / 2;
  }
  return x;
}

function findInsertBefore(strip, clientX) {
  const newTabBtn = strip.querySelector(":scope > .chrome-newtab");
  if (!newTabBtn) return null;
  for (const t of getTabs(strip)) {
    const r = t.getBoundingClientRect();
    if (clientX < r.left + r.width / 2) return t;
  }
  return newTabBtn;
}

function clearDropMarkers() {
  document
    .querySelectorAll(".chrome-tabstrip__tabs--drop-target")
    .forEach((el) => {
      el.classList.remove("chrome-tabstrip__tabs--drop-target");
      el.style.removeProperty("--drop-marker-x");
    });
}

function updateDropIndicator(strip, clientX) {
  clearDropMarkers();
  if (!strip) return;
  const stripRect = strip.getBoundingClientRect();
  const insertBefore = findInsertBefore(strip, clientX);
  const newTabBtn = strip.querySelector(":scope > .chrome-newtab");
  if (!insertBefore || !newTabBtn) return;

  let x;
  if (insertBefore === newTabBtn) {
    const nr = newTabBtn.getBoundingClientRect();
    x = nr.left - stripRect.left - 2;
  } else {
    const tr = insertBefore.getBoundingClientRect();
    x = tr.left - stripRect.left - 2;
  }
  strip.style.setProperty("--drop-marker-x", `${Math.max(0, x)}px`);
  strip.classList.add("chrome-tabstrip__tabs--drop-target");
}

function stripUnderPoint(clientX, clientY, ignoreEl) {
  const stack = document.elementsFromPoint(clientX, clientY);
  for (const el of stack) {
    if (ignoreEl && (el === ignoreEl || ignoreEl.contains(el))) continue;
    const s = el.closest?.(".chrome-tabstrip__tabs");
    if (s) return s;
  }
  return null;
}

function setOnlyActiveTab(strip, activeTab) {
  getTabs(strip).forEach((t) => {
    const isActive = t === activeTab;
    t.classList.toggle("chrome-tab--active", isActive);
    t.classList.toggle("chrome-tab--inactive", !isActive);
  });

  syncWindowActiveChannelAttrs();
  renderDjControllers();
}

function resetOmniboxToNewTab(win) {
  const urlEl = win.querySelector(".chrome-omnibox__url");
  const icon = win.querySelector(".chrome-omnibox__icon");
  if (urlEl) urlEl.textContent = "Drag to tune Parameter";
  if (icon) {
    icon.className = "chrome-omnibox__icon";
    icon.innerHTML = OMNIBOX_GOOGLE_G;
  }
}

function pickTabNearestX(strip, clientX) {
  const all = getTabs(strip);
  if (all.length === 0) return null;
  let best = all[0];
  let bestD = Infinity;
  for (const t of all) {
    const r = t.getBoundingClientRect();
    const cx = (r.left + r.right) / 2;
    const d = Math.abs(clientX - cx);
    if (d < bestD) {
      bestD = d;
      best = t;
    }
  }
  return best;
}

function mergeAllTabs(sourceStrip, targetStrip, clientX, clientY) {
  const tabs = getTabs(sourceStrip);
  if (tabs.length === 0) return;
  const cy = typeof clientY === "number" ? clientY : clientX;
  const x = clampClientXIntoStrip(targetStrip, clientX, cy);
  const insertBefore = findInsertBefore(targetStrip, x);
  if (!insertBefore) return;
  const frag = document.createDocumentFragment();
  for (const t of tabs) {
    frag.appendChild(t);
  }
  targetStrip.insertBefore(frag, insertBefore);
  const mergedTabs = getTabs(targetStrip);
  const active =
    pickTabNearestX(targetStrip, x) || mergedTabs[mergedTabs.length - 1];
  if (active) setOnlyActiveTab(targetStrip, active);
  clearDropMarkers();

  renderDjControllers();
}

function overlapRatioAgainstSmallerRect(a, b) {
  const x1 = Math.max(a.left, b.left);
  const x2 = Math.min(a.right, b.right);
  const y1 = Math.max(a.top, b.top);
  const y2b = Math.min(a.bottom, b.bottom);
  if (x2 <= x1 || y2b <= y1) return 0;
  const inter = (x2 - x1) * (y2b - y1);
  const areaA = a.width * a.height;
  const areaB = b.width * b.height;
  const smaller = Math.min(areaA, areaB);
  if (smaller <= 0) return 0;
  return inter / smaller;
}

function windowOverlapRatio(aWin, bWin) {
  return overlapRatioAgainstSmallerRect(
    aWin.getBoundingClientRect(),
    bWin.getBoundingClientRect(),
  );
}

function rectsOverlapRatio(a, b, minRatio) {
  return overlapRatioAgainstSmallerRect(a, b) >= minRatio;
}

function shouldMergeWindowToStrip(draggedWin, targetStrip) {
  const targetWin = targetStrip.closest(".chrome-window");
  if (!targetWin || targetWin === draggedWin) return false;
  const draggedRect = draggedWin.getBoundingClientRect();
  const targetRect = targetWin.getBoundingClientRect();
  return rectsOverlapRatio(draggedRect, targetRect, MERGE_WINDOW_OVERLAP_MIN);
}

function pickBestOverlapTargetWin(draggedWin, stage) {
  let bestWin = null;
  let bestRatio = 0;
  for (const other of stage.querySelectorAll(".chrome-window")) {
    if (other === draggedWin) continue;
    const r = windowOverlapRatio(draggedWin, other);
    if (r > bestRatio) {
      bestRatio = r;
      bestWin = other;
    }
  }
  return { bestWin, bestRatio };
}

function resetTabDragStyles(tab) {
  tab.classList.remove("chrome-tab--floating");
  tab.style.position = "";
  tab.style.left = "";
  tab.style.top = "";
  tab.style.width = "";
  tab.style.height = "";
  tab.style.margin = "";
  tab.style.zIndex = "";
}

function createWindowWithTab(tab, clientX, clientY, stage, sourceWin) {
  const proto = stage.querySelector(".chrome-window");
  if (!proto) return;

  const clone = proto.cloneNode(true);
  clone.classList.remove("chrome-window--selected", "chrome-window--dragging");
  const strip = clone.querySelector(".chrome-tabstrip__tabs");
  if (!strip) return;
  getTabs(strip).forEach((t) => t.remove());
  const newTabBtn = strip.querySelector(".chrome-newtab");
  if (newTabBtn) strip.insertBefore(tab, newTabBtn);

  resetOmniboxToNewTab(clone);
  setOnlyActiveTab(strip, tab);

  const pr = proto.getBoundingClientRect();
  const sr = stage.getBoundingClientRect();
  const w = pr.width;
  const h = pr.height;
  let left = clientX - sr.left - w / 2;
  let top = clientY - sr.top - 28;
  left = Math.round(clamp(left, 0, Math.max(0, sr.width - w)));
  top = Math.round(clamp(top, 0, Math.max(0, sr.height - h)));

  clone.style.position = "absolute";
  clone.style.left = `${left}px`;
  clone.style.top = `${top}px`;
  clone.style.width = `${w}px`;
  clone.style.height = `${h}px`;
  clone.style.zIndex = "8";
  clone.style.transform = "none";
  clone.removeAttribute("data-dx");
  clone.removeAttribute("data-dy");
  clone.classList.add("chrome-window--floated");

  stage.appendChild(clone);
  selectWindow(clone);
  renderDjControllers();

  if (sourceWin) {
    const srcStrip = sourceWin.querySelector(".chrome-tabstrip__tabs");
    if (srcStrip && getTabs(srcStrip).length === 0) {
      sourceWin.remove();
    }
  }
}

/**
 * 탭 좌클릭 드래그:
 * - 가로가 세로보다 크면 → 그 탭 채널 믹스(상승만, 이동 거리 비례)
 * - 세로가 크면 → 기존 탭 뜯기/합치기/새 창
 */
function beginTabTear(e, win, tab, stage) {
  e.stopPropagation();
  selectWindow(win);

  const sourceStrip = tab.closest(".chrome-tabstrip__tabs");
  if (!sourceStrip) return;

  const sourceWin = win;
  const pointerId = e.pointerId;
  const startX = e.clientX;
  const startY = e.clientY;
  let tearing = false;
  let scrubbing = false;
  const channelKeyTab = getDjChannelKeyFromTab(tab);
  let lastScrubX = e.clientX;

  const rect0 = tab.getBoundingClientRect();
  const offsetX = e.clientX - rect0.left;
  const offsetY = e.clientY - rect0.top;

  function startTearVisual() {
    tearing = true;
    document.body.classList.add("chrome-ui--tab-tearing");
    tab.classList.add("chrome-tab--floating");
    document.body.appendChild(tab);
    tab.style.position = "fixed";
    tab.style.left = `${rect0.left}px`;
    tab.style.top = `${rect0.top}px`;
    tab.style.width = `${rect0.width}px`;
    tab.style.height = `${rect0.height}px`;
    tab.style.margin = "0";
    tab.style.zIndex = "10000";
    try {
      tab.setPointerCapture(pointerId);
    } catch {
      /* */
    }
  }

  const onMove = (ev) => {
    if (ev.pointerId !== pointerId) return;
    const mx = ev.clientX - startX;
    const my = ev.clientY - startY;

    if (
      !tearing &&
      !scrubbing &&
      (Math.abs(mx) > DRAG_THRESHOLD_PX || Math.abs(my) > DRAG_THRESHOLD_PX)
    ) {
      const horizontalLead = Math.abs(mx) - Math.abs(my);
      if (channelKeyTab && horizontalLead >= TAB_SCRUB_HORIZONTAL_LEAD_PX) {
        scrubbing = true;
      } else {
        startTearVisual();
      }
    }

    if (scrubbing && channelKeyTab) {
      ev.preventDefault();
      const dx = ev.clientX - lastScrubX;
      lastScrubX = ev.clientX;
      /** 좌클릭 제스처 = 상승만: 좌우 어느 방향이든 움직인 만큼 증가 */
      djState[channelKeyTab] = clamp(
        djState[channelKeyTab] + Math.abs(dx) / DJ_WIN_PX_PER_PERCENT,
        0,
        100,
      );
      syncExhibitionAudioFromDjState({ deferToFrame: true });
      scheduleDjHudDom();
      return;
    }

    if (!tearing) return;
    ev.preventDefault();
    tab.style.left = `${ev.clientX - offsetX}px`;
    tab.style.top = `${ev.clientY - offsetY}px`;

    const hoverStrip = stripUnderPoint(ev.clientX, ev.clientY, tab);
    if (hoverStrip) {
      const hx = clampClientXIntoStrip(hoverStrip, ev.clientX, ev.clientY);
      updateDropIndicator(hoverStrip, hx);
    } else {
      clearDropMarkers();
    }
  };

  const onUp = (ev) => {
    if (ev.pointerId !== pointerId) return;
    window.removeEventListener("pointermove", onMove, POINTER_WIN_OPTS);
    window.removeEventListener("pointerup", onUp, POINTER_WIN_OPTS);
    window.removeEventListener("pointercancel", onUp, POINTER_WIN_OPTS);
    clearDropMarkers();

    if (scrubbing) {
      flushDjHudDom();
      return;
    }

    if (!tearing) {
      const mx = ev.clientX - startX;
      const my = ev.clientY - startY;
      if (
        tab.classList.contains("chrome-tab--inactive") &&
        Math.hypot(mx, my) < DRAG_THRESHOLD_PX + 2
      ) {
        const strip = tab.closest(".chrome-tabstrip__tabs");
        if (strip) setOnlyActiveTab(strip, tab);
      }
      return;
    }

    try {
      tab.releasePointerCapture(pointerId);
    } catch {
      /* */
    }
    document.body.classList.remove("chrome-ui--tab-tearing");

    const targetStrip = stripUnderPoint(ev.clientX, ev.clientY, tab);

    if (targetStrip) {
      const ix = clampClientXIntoStrip(targetStrip, ev.clientX, ev.clientY);
      const insertBefore = findInsertBefore(targetStrip, ix);
      resetTabDragStyles(tab);
      if (insertBefore) {
        targetStrip.insertBefore(tab, insertBefore);
      } else {
        targetStrip.appendChild(tab);
      }
      setOnlyActiveTab(targetStrip, tab);

      const tw = targetStrip.closest(".chrome-window");
      if (sourceWin !== tw && getTabs(sourceStrip).length === 0) {
        sourceWin.remove();
      }
      if (tw) selectWindow(tw);
    } else {
      resetTabDragStyles(tab);
      createWindowWithTab(tab, ev.clientX, ev.clientY, stage, sourceWin);
    }
  };

  window.addEventListener("pointermove", onMove, POINTER_WIN_OPTS);
  window.addEventListener("pointerup", onUp, POINTER_WIN_OPTS);
  window.addEventListener("pointercancel", onUp, POINTER_WIN_OPTS);
}

function getDjChannelKeyFromTab(tab) {
  const label = tab.querySelector(".chrome-tab__title")?.textContent?.trim();
  return DJ_CHANNELS.includes(label) ? label : null;
}

function getDjChannelKeyForWindow(win) {
  const titleEl =
    win.querySelector(".chrome-tab.chrome-tab--active .chrome-tab__title") ||
    win.querySelector(".chrome-tab .chrome-tab__title");
  const label = titleEl?.textContent?.trim();
  return DJ_CHANNELS.includes(label) ? label : null;
}

function fitDjControllerWidth(page, meta) {
  const pageW = page.clientWidth;
  const pageH = page.clientHeight;

  if (!pageW || !pageH) return meta.panelW;

  const padding = 28;

  const byWidth = Math.max(120, pageW - padding * 2);
  const byHeight = Math.max(120, (pageH - padding * 2) * (meta.panelW / meta.panelH));

  return Math.min(meta.panelW, byWidth, byHeight);
}

function ensureDjControllerMount(page) {
  let mount = page.querySelector(".dj-controller-mount");

  if (!mount) {
    mount = document.createElement("div");
    mount.className = "dj-controller-mount";
    page.appendChild(mount);
  }

  return mount;
}

function getDjChannelKeysForWindow(win) {
  const strip = win.querySelector(".chrome-tabstrip__tabs");
  if (!strip) return [];

  const keys = [];

  for (const tab of getTabs(strip)) {
    const key = getDjChannelKeyFromTab(tab);

    if (key && DJ_CONTROLLER_META[key] && !keys.includes(key)) {
      keys.push(key);
    }
  }

  return keys;
}

function getDjControllerGridShape(count) {
  if (count <= 1) return { cols: 1, rows: 1 };
  if (count === 2) return { cols: 2, rows: 1 };
  return { cols: 2, rows: 2 };
}

function fitDjControllerWidthInGrid(page, meta, count) {
  const pageW = page.clientWidth;
  const pageH = page.clientHeight;

  if (!pageW || !pageH) return meta.panelW;

  const padding = 24;
  const gap = 20;
  const { cols, rows } = getDjControllerGridShape(count);

  const availableW = Math.max(120, pageW - padding * 2 - gap * (cols - 1));
  const availableH = Math.max(120, pageH - padding * 2 - gap * (rows - 1));

  const cellW = availableW / cols;
  const cellH = availableH / rows;

  const widthByCellW = cellW;
  const widthByCellH = cellH * (meta.panelW / meta.panelH);

  return Math.min(meta.panelW, widthByCellW, widthByCellH);
}

function renderDjControllers() {
  document.querySelectorAll(".chrome-window").forEach((win) => {
    const page = win.querySelector(".chrome-page--blank");
    if (!page) return;

    const channelKeys = getDjChannelKeysForWindow(win);
    const mount = ensureDjControllerMount(page);

    if (channelKeys.length === 0) {
      mount.innerHTML = "";
      mount.removeAttribute("data-channels");
      return;
    }

    const channelSignature = channelKeys.join("|");

    if (mount.dataset.channels !== channelSignature) {
      mount.dataset.channels = channelSignature;

      mount.innerHTML = `
        <div class="dj-controller-grid" data-count="${channelKeys.length}">
          ${channelKeys
            .map((channelKey) => {
              const meta = DJ_CONTROLLER_META[channelKey];

              return `
                <div class="dj-controller dj-controller--${meta.type}" data-channel="${channelKey}">
                  <img
                    class="dj-controller__panel"
                    src="${getDjControllerAssetUrl(meta.panel)}"
                    alt=""
                    draggable="false"
                    aria-hidden="true"
                  />
                  <img
                    class="dj-controller__control"
                    src="${getDjControllerAssetUrl(meta.control)}"
                    alt=""
                    draggable="false"
                    aria-hidden="true"
                  />
                </div>
              `;
            })
            .join("")}
        </div>
      `;
    }

    const grid = mount.querySelector(".dj-controller-grid");
    if (!grid) return;

    grid.dataset.count = String(channelKeys.length);

    channelKeys.forEach((channelKey) => {
      const meta = DJ_CONTROLLER_META[channelKey];
      const controller = grid.querySelector(`.dj-controller[data-channel="${channelKey}"]`);
      if (!controller || !meta) return;

      const controllerW = fitDjControllerWidthInGrid(page, meta, channelKeys.length);

      controller.style.setProperty("--panel-w", String(meta.panelW));
      controller.style.setProperty("--panel-h", String(meta.panelH));
      controller.style.setProperty("--controller-w", `${Math.round(controllerW)}px`);
      controller.style.setProperty("--control-w", `${(meta.controlW / meta.panelW) * 100}%`);

      const pct = clamp(Number(djState[channelKey] ?? 50), 0, 100);

      if (meta.type === "dial") {
        const deg = -135 + (pct / 100) * 270;

        controller.style.setProperty("--dial-rot", `${deg}deg`);
        controller.style.removeProperty("--stick-y");
      }

      if (meta.type === "stick") {
        const yPx = (50 - pct) * (meta.rangePx / 100);
        const yPercent = (yPx / meta.panelH) * 100;

        controller.style.setProperty("--stick-y", `${yPercent}%`);
        controller.style.removeProperty("--dial-rot");
      }
    });
  });
}

/**
 * @param {{ mode: "up" | "down" }} tune — 좌클릭: 상승만, 우클릭: 하락만. 변화량은 창 중심 이동 거리에 비례.
 */
function beginWindowDrag(e, win, handle, stage, tune) {
  e.stopPropagation();
  selectWindow(win);

  const isFloated = win.classList.contains("chrome-window--floated");
  const startX = e.clientX;
  const startY = e.clientY;
  const { dx: originDx, dy: originDy } = parseTranslate(win);
  const sr0 = stage.getBoundingClientRect();
  const wr0 = win.getBoundingClientRect();
  const originLeft = isFloated ? wr0.left - sr0.left : 0;
  const originTop = isFloated ? wr0.top - sr0.top : 0;

  let dragging = false;
  const pointerId = e.pointerId;
  const channelKeys = getDjChannelKeysForWindow(win);
  let prevCx = null;
  let prevCy = null;

  try {
    handle.setPointerCapture(pointerId);
  } catch {
    /* */
  }

  const onMove = (ev) => {
    if (ev.pointerId !== pointerId) return;
    const mx = ev.clientX - startX;
    const my = ev.clientY - startY;
    if (
      !dragging &&
      (Math.abs(mx) > DRAG_THRESHOLD_PX || Math.abs(my) > DRAG_THRESHOLD_PX)
    ) {
      dragging = true;
      win.classList.add("chrome-window--dragging");
      document.body.classList.add("chrome-ui--window-dragging");
    }
    if (!dragging) return;
    if (isFloated) {
      const sr = stage.getBoundingClientRect();
      const w = win.offsetWidth;
      const h = win.offsetHeight;
      let left = originLeft + mx;
      let top = originTop + my;
      left = clamp(left, 0, Math.max(0, sr.width - w));
      top = clamp(top, 0, Math.max(0, sr.height - h));
      win.style.left = `${Math.round(left)}px`;
      win.style.top = `${Math.round(top)}px`;
    } else {
      const next = getClampedTranslateForViewport(win, originDx + mx, originDy + my);
      applyTranslate(win, next.dx, next.dy);
    }

    const { bestRatio } = pickBestOverlapTargetWin(win, stage);
    applyMergeCrossfadePreview(bestRatio);

    if (channelKeys.length > 0) {
      const r = win.getBoundingClientRect();
      const cx = (r.left + r.right) / 2;
      const cy = (r.top + r.bottom) / 2;
      if (prevCx !== null && prevCy !== null) {
        const segment = Math.hypot(cx - prevCx, cy - prevCy);
        if (segment > 0) {
          for (const key of channelKeys) {
            const pxPerPercent = key === "Pitch" ? 40 : DJ_WIN_PX_PER_PERCENT;
            const deltaPct =
              (tune.mode === "up" ? 1 : -1) * (segment / pxPerPercent);
            djState[key] = clamp(djState[key] + deltaPct, 0, 100);
          }

          syncExhibitionAudioFromDjState({ deferToFrame: true });
          scheduleDjHudDom();
        }
      }
      prevCx = cx;
      prevCy = cy;
    }
  };

  const onUp = (ev) => {
    if (ev.pointerId !== pointerId) return;
    if (channelKeys.includes("Pitch")) {
      if (djHudDomRaf) {
        cancelAnimationFrame(djHudDomRaf);
        djHudDomRaf = 0;
      }
      updateDjHudDom();

      // 손 뗄 때도 directPitch로 확 점프시키지 않음
      syncExhibitionAudioFromDjState({
        snapTempo: true,
        directPitch: false,
        livePitch: true,
      });
    } else {
      flushDjHudDom();
    }
    win.classList.remove("chrome-window--dragging");
    document.body.classList.remove("chrome-ui--window-dragging");
    try {
      handle.releasePointerCapture(pointerId);
    } catch {
      /* */
    }
    window.removeEventListener("pointermove", onMove, POINTER_WIN_OPTS);
    window.removeEventListener("pointerup", onUp, POINTER_WIN_OPTS);
    window.removeEventListener("pointercancel", onUp, POINTER_WIN_OPTS);

    if (dragging) {
      const sourceStrip = win.querySelector(".chrome-tabstrip__tabs");
      if (sourceStrip && getTabs(sourceStrip).length > 0) {
        for (const other of stage.querySelectorAll(".chrome-window")) {
          if (other === win) continue;
          const ts = other.querySelector(".chrome-tabstrip__tabs");
          if (!ts) continue;
          if (shouldMergeWindowToStrip(win, ts)) {
            const overlapAtMerge = windowOverlapRatio(win, other);
            mergeAllTabs(sourceStrip, ts, ev.clientX, ev.clientY);
            if (overlapAtMerge >= MERGE_WINDOW_OVERLAP_MIN) {
              finalizeMergeCrossfadeAfterMerge();
            } else {
              resetMergeCrossfadeState();
            }
            if (getTabs(sourceStrip).length === 0) {
              win.remove();
              selectWindow(other);
            } else {
              selectWindow(other);
            }
            return;
          }
        }
      }
    }
    resetMergeCrossfadeState();
  };

  window.addEventListener("pointermove", onMove, POINTER_WIN_OPTS);
  window.addEventListener("pointerup", onUp, POINTER_WIN_OPTS);
  window.addEventListener("pointercancel", onUp, POINTER_WIN_OPTS);
}

function updateDjHudDom() {
  const el = document.getElementById("dj-param-hud");

  if (el) {
    el.innerHTML = DJ_CHANNELS.map(
      (name) =>
        `<div class="dj-param-hud__row"><span class="dj-param-hud__name">${name}</span><span class="dj-param-hud__val">${Math.round(
          djState[name]
        )}%</span></div>`
    ).join("");
  }

  renderDjControllers();
}

// ===== EASTER EGG START =====
let siuEggArmed = true;
let siuEggBuffer = null;
let siuEggIR = null;
let siuEggLoading = false;

function buildSiuReverbIR(ctx) {
  // 합성 임펄스 응답: 좌우 채널 노이즈를 지수감쇠시켜 홀 느낌 잔향.
  const seconds = 2.6;
  const decay = 2.4;
  const rate = ctx.sampleRate;
  const len = Math.floor(seconds * rate);
  const buf = ctx.createBuffer(2, len, rate);
  for (let c = 0; c < 2; c++) {
    const data = buf.getChannelData(c);
    for (let i = 0; i < len; i++) {
      data[i] = (Math.random() * 2 - 1) * Math.pow(1 - i / len, decay);
    }
  }
  return buf;
}

async function ensureSiuAudioReady() {
  if (siuEggBuffer || siuEggLoading) return;
  if (!exhibitionCtx) return;
  siuEggLoading = true;
  try {
    const res = await fetch("./audio/siuu.mp3");
    const arr = await res.arrayBuffer();
    siuEggBuffer = await exhibitionCtx.decodeAudioData(arr);
    siuEggIR = buildSiuReverbIR(exhibitionCtx);
  } catch (err) {
    console.warn("[siu-egg] 사운드 로드 실패:", err);
  } finally {
    siuEggLoading = false;
  }
}

function playSiuSound() {
  if (!exhibitionCtx || !siuEggBuffer || !siuEggIR) return;
  if (exhibitionCtx.state === "suspended") {
    exhibitionCtx.resume().catch(() => {});
  }

  const src = exhibitionCtx.createBufferSource();
  src.buffer = siuEggBuffer;

  const dry = exhibitionCtx.createGain();
  dry.gain.value = 0.7;

  const wet = exhibitionCtx.createGain();
  wet.gain.value = 0.55;

  const conv = exhibitionCtx.createConvolver();
  conv.buffer = siuEggIR;

  // 잔향에 약간의 저역 컷을 줘서 깔끔하게.
  const wetHP = exhibitionCtx.createBiquadFilter();
  wetHP.type = "highpass";
  wetHP.frequency.value = 220;

  src.connect(dry).connect(exhibitionCtx.destination);
  src.connect(wetHP).connect(conv).connect(wet).connect(exhibitionCtx.destination);

  src.start();
  src.onended = () => {
    try {
      src.disconnect();
      dry.disconnect();
      wet.disconnect();
      conv.disconnect();
      wetHP.disconnect();
    } catch {
      /* */
    }
  };
}

function maybeFireSiuEgg() {
  const allAt67 = DJ_CHANNELS.every((ch) => Math.round(djState[ch]) === 67);
  if (!allAt67) {
    siuEggArmed = true;
    return;
  }
  if (!siuEggArmed) return;
  siuEggArmed = false;
  const el = document.getElementById("siu-egg");
  if (el) {
    el.classList.remove("is-firing");
    void el.offsetWidth;
    el.classList.add("is-firing");
  }
  ensureSiuAudioReady().then(playSiuSound);
}
// ===== EASTER EGG END =====

/** 드래그 중: 오디오는 즉시, HUD 문자열만 프레임당 한 번(메인 스레드 막힘 방지) */
function scheduleDjHudDom() {
  if (djHudDomRaf) cancelAnimationFrame(djHudDomRaf);
  djHudDomRaf = requestAnimationFrame(() => {
    djHudDomRaf = 0;
    updateDjHudDom();
  });
}

function flushDjHudDom() {
  if (djHudDomRaf) {
    cancelAnimationFrame(djHudDomRaf);
    djHudDomRaf = 0;
  }
  updateDjHudDom();
  syncExhibitionAudioFromDjState({ snapTempo: true, directPitch: true });
}

function renderDjHud() {
  updateDjHudDom();
  syncExhibitionAudioFromDjState({ snapTempo: true, directPitch: true });
}

/** 50% = 중립, spanDb 만큼 양끝에서 범위 */
function pctToDbFromCenter(pct, spanDb) {
  return ((pct - 50) / 50) * spanDb;
}

function clampSafeRatio(x) {
  if (!Number.isFinite(x) || x <= 0) return 1;
  return clamp(x, DJ_RB_RATIO_MIN, DJ_RB_RATIO_MAX);
}

function crossfadeTFromWindowOverlap(overlapRatio) {
  const t =
    (overlapRatio - MERGE_CROSSFADE_START) /
    (MERGE_WINDOW_OVERLAP_MIN - MERGE_CROSSFADE_START);
  return clamp(t, 0, 1);
}

function linearCrossfadeGains(t) {
  const x = clamp(t, 0, 1);
  return {
    from: 1 - x,
    to: x,
  };
}

/** Pitch: %↑ → 체감 위로(README setPitch 배수) */
function djPctToPitchRatio(pct) {
  const oct = ((pct - 50) / 50) * DJ_PITCH_OCT_RANGE;
  return clampSafeRatio(Math.pow(2, oct));
}

/** Tempo: %↑ → 빨라짐 */
function djPctToTempoRatio(pct) {
  const oct = ((pct - 50) / 50) * DJ_TEMPO_OCT_RANGE;
  return clampSafeRatio(Math.pow(2, oct));
}

function cancelPitchServo() {
  if (exhibitionPitchServoRaf) {
    cancelAnimationFrame(exhibitionPitchServoRaf);
    exhibitionPitchServoRaf = 0;
  }
}

/** 손 뗌·초기화: 서보 중단 후 목표 피치로 한 번에 맞춤 */
function applyRubberBandPitchImmediate() {
  cancelPitchServo();
  if (!exhibitionRb && !exhibitionRbTransition) return;
  const target = clampSafeRatio(djPctToPitchRatio(djState.Pitch));
  if (!Number.isFinite(target) || target <= 0) return;
  if (exhibitionRb) {
    try {
      exhibitionRb.setPitch(target);
      exhibitionRbLastPitch = target;
    } catch (err) {
      console.warn("[exhibition-audio] setPitch 실패:", err);
    }
  }
  if (exhibitionRbTransition) {
    try {
      exhibitionRbTransition.setPitch(target);
    } catch (err) {
      console.warn("[exhibition-audio] setPitch(transition) 실패:", err);
    }
  }
}

function applyRubberBandPitchLive() {
  if ((!exhibitionRb && !exhibitionRbTransition) || !exhibitionGraphReady) return;

  const now = performance.now();
  if (now - exhibitionRbLastLivePitchAt < RB_PITCH_LIVE_INTERVAL_MS) return;

  const target = clampSafeRatio(djPctToPitchRatio(djState.Pitch));
  if (!Number.isFinite(target) || target <= 0) return;

  if (
    Number.isFinite(exhibitionRbLastPitch) &&
    Math.abs(target - exhibitionRbLastPitch) < RB_PITCH_LIVE_MIN_DIFF
  ) {
    return;
  }

  try {
    if (exhibitionRb) exhibitionRb.setPitch(target);
    if (exhibitionRbTransition) exhibitionRbTransition.setPitch(target);
    exhibitionRbLastPitch = target;
    exhibitionRbLastLivePitchAt = now;
  } catch (err) {
    console.warn("[exhibition-audio] setPitch(라이브) 실패:", err);
  }
}

function ensureExhibitionMediaPlaying() {
  const el = exhibitionMediaEl;
  if (!el || el.ended) return;
  if (el.paused) {
    const p = el.play();
    if (p !== undefined) p.catch(() => {});
  }
  if (mergeCrossfadeActive && exhibitionTransitionEl?.paused) {
    const p2 = exhibitionTransitionEl.play();
    if (p2 !== undefined) p2.catch(() => {});
  }
}

/** 드래그 중: 목표 피치를 매 프레임 아주 조금씩만 따라감(setPitch 폭주·워클릿 죽음 방지) */
function requestPitchServoFrame() {
  if (!exhibitionRb || !exhibitionGraphReady) return;
  if (exhibitionPitchServoRaf) return;
  exhibitionPitchServoRaf = requestAnimationFrame(pitchServoTick);
}

function pitchServoTick() {
  exhibitionPitchServoRaf = 0;
  if (!exhibitionRb || !exhibitionGraphReady) return;

  if (exhibitionCtx?.state === "suspended") {
    exhibitionCtx.resume().catch(() => {});
  }
  ensureExhibitionMediaPlaying();

  const target = clampSafeRatio(djPctToPitchRatio(djState.Pitch));
  if (!Number.isFinite(target) || target <= 0) return;

  let cur = exhibitionRbLastPitch;
  if (!Number.isFinite(cur)) {
    cur = target;
  }

  const dist = target - cur;
  if (Math.abs(dist) <= 1e-5) {
    return;
  }

  const step =
    Math.sign(dist) * Math.min(Math.abs(dist), RB_PITCH_MAX_STEP_RATIO);
  const next = clampSafeRatio(cur + step);

  try {
    exhibitionRb.setPitch(next);
    exhibitionRbLastPitch = next;
  } catch (err) {
    console.warn("[exhibition-audio] setPitch(서보) 실패:", err);
    return;
  }

  if (Math.abs(target - next) > 1e-5) {
    exhibitionPitchServoRaf = requestAnimationFrame(pitchServoTick);
  }
}

/** 템포: Rubber Band setTempo 대신 요소 playbackRate(피치 유지) — 잡음·팝콘 방지 */
function applyExhibitionTempoPlayback(options = {}) {
  if (!exhibitionMediaEl) return;
  const target = djPctToTempoRatio(djState.Tempo);
  if (options.snap) {
    exhibitionTempoPlaybackSmoothed = target;
    try {
      exhibitionMediaEl.playbackRate = clampSafeRatio(target);
      if (exhibitionTransitionEl) {
        exhibitionTransitionEl.playbackRate = clampSafeRatio(target);
      }
    } catch {
      /* */
    }
    return;
  }
  if (Math.abs(target - exhibitionTempoPlaybackSmoothed) < 0.0007) {
    exhibitionTempoPlaybackSmoothed = target;
  } else {
    exhibitionTempoPlaybackSmoothed +=
      (target - exhibitionTempoPlaybackSmoothed) * DJ_TEMPO_PLAYBACK_SMOOTH;
  }
  const rate = clampSafeRatio(exhibitionTempoPlaybackSmoothed);
  try {
    if (Math.abs(exhibitionMediaEl.playbackRate - rate) > 1e-5) {
      exhibitionMediaEl.playbackRate = rate;
    }
    if (
      exhibitionTransitionEl &&
      Math.abs(exhibitionTransitionEl.playbackRate - rate) > 1e-5
    ) {
      exhibitionTransitionEl.playbackRate = rate;
    }
  } catch {
    /* */
  }
}

function scheduleDeferredExhibitionAudioSync() {
  if (!exhibitionGraphReady) return;
  if (exhibitionAudioGraphRaf) return;
  exhibitionAudioGraphRaf = requestAnimationFrame(() => {
    exhibitionAudioGraphRaf = 0;
    runExhibitionAudioGraphSync({
      snapTempo: false,
      directPitch: false,
      livePitch: true,
    });
  });
}

/** 게인·베이스·템포·피치를 한 번에 적용(드래그용 rAF 콜백·즉시 갱신 공통) */
function runExhibitionAudioGraphSync(options = {}) {
  if (
    !exhibitionGraphReady ||
    !exhibitionCtx ||
    !exhibitionMaster ||
    !exhibitionBass
  )
    return;

  ensureExhibitionMediaPlaying();

  if (exhibitionCtx.state === "suspended") {
    exhibitionCtx.resume().catch(() => {});
  }

  const v = djState.Volume;
  if (
    !Number.isFinite(lastAppliedVolPct) ||
    Math.abs(v - lastAppliedVolPct) > 0.02
  ) {
    const volDb = pctToDbFromCenter(v, 14);
    exhibitionMaster.gain.value = Math.pow(10, volDb / 20);
    lastAppliedVolPct = v;
  }

  const b = djState.Bass;
  if (
    !Number.isFinite(lastAppliedBassPct) ||
    Math.abs(b - lastAppliedBassPct) > 0.02
  ) {
    const bassDb = pctToDbFromCenter(b, 12);
    exhibitionBass.gain.value = bassDb;
    if (exhibitionTransitionBass) exhibitionTransitionBass.gain.value = bassDb;
    lastAppliedBassPct = b;
  }

  applyExhibitionTempoPlayback({ snap: options.snapTempo === true });

  if (exhibitionRb) {
    if (options.directPitch === true) {
      applyRubberBandPitchImmediate();
    } else if (options.livePitch === true) {
      applyRubberBandPitchLive();
    }
  }
}

function syncExhibitionAudioFromDjState(options = {}) {
  if (options.deferToFrame === true) {
    scheduleDeferredExhibitionAudioSync();
    return;
  }
  if (exhibitionAudioGraphRaf) {
    cancelAnimationFrame(exhibitionAudioGraphRaf);
    exhibitionAudioGraphRaf = 0;
  }
  runExhibitionAudioGraphSync(options);
}

function resetMergeCrossfadeState() {
  mergeCrossfadeActive = false;
  mergeCrossfadeCurrentTrack = null;
  if (exhibitionDeckGain) exhibitionDeckGain.gain.value = 1;
  if (exhibitionTransitionGain) exhibitionTransitionGain.gain.value = 0;
  if (exhibitionTransitionEl) {
    exhibitionTransitionEl.pause();
  }
}

function armNextMergeCrossfadeTrack() {
  if (!exhibitionTransitionEl) return;
  if (MERGE_CROSSFADE_PLAYLIST.length <= 1) {
    mergeCrossfadeArmedIndex = -1;
    mergeCrossfadeArmedReady = false;
    return;
  }
  const nextIndex = getNextMergeCrossfadeIndex();
  if (mergeCrossfadeArmedIndex === nextIndex && mergeCrossfadeArmedReady) {
    return;
  }
  const track = MERGE_CROSSFADE_PLAYLIST[nextIndex];
  mergeCrossfadeArmedReady = false;
  mergeCrossfadeArmedIndex = nextIndex;
  exhibitionTransitionEl.src = encodePathSegmentsPreservingSlashes(track.src);
  exhibitionTransitionEl.preload = "auto";
  const onArmed = () => {
    try {
      exhibitionTransitionEl.currentTime = track.offsetSec;
    } catch {
      /* */
    }
    exhibitionTransitionEl.pause();
    mergeCrossfadeArmedReady = true;
  };
  if (exhibitionTransitionEl.readyState >= 1) {
    onArmed();
  } else {
    exhibitionTransitionEl.addEventListener("loadedmetadata", onArmed, { once: true });
    exhibitionTransitionEl.load();
  }
}

function startMergeCrossfadeIfNeeded() {
  if (
    mergeCrossfadeActive ||
    !exhibitionTransitionEl ||
    MERGE_CROSSFADE_PLAYLIST.length <= 1
  ) {
    return;
  }
  armNextMergeCrossfadeTrack();
  if (!mergeCrossfadeArmedReady) return;
  const track = MERGE_CROSSFADE_PLAYLIST[mergeCrossfadeArmedIndex];
  mergeCrossfadeCurrentTrack = track;
  mergeCrossfadeActive = true;
  const p = exhibitionTransitionEl.play();
  if (p !== undefined) p.catch(() => {});
}

function applyMergeCrossfadePreview(overlapRatio) {
  if (!exhibitionDeckGain || !exhibitionTransitionGain) return;
  if (
    overlapRatio < MERGE_CROSSFADE_START ||
    MERGE_CROSSFADE_PLAYLIST.length <= 1
  ) {
    resetMergeCrossfadeState();
    return;
  }
  startMergeCrossfadeIfNeeded();
  if (!mergeCrossfadeActive) return;
  const t = crossfadeTFromWindowOverlap(overlapRatio);
  const g = linearCrossfadeGains(t);
  exhibitionDeckGain.gain.value = g.from;
  exhibitionTransitionGain.gain.value = g.to;
}

function finalizeMergeCrossfadeAfterMerge() {
  if (!mergeCrossfadeActive || !mergeCrossfadeCurrentTrack || !exhibitionMediaEl)
    return;
  const nextSrc = encodePathSegmentsPreservingSlashes(mergeCrossfadeCurrentTrack.src);
  const nextTime = exhibitionTransitionEl?.currentTime ?? mergeCrossfadeCurrentTrack.offsetSec;
  exhibitionMediaEl.src = nextSrc;
  const snap = () => {
    try {
      exhibitionMediaEl.currentTime = nextTime;
    } catch {
      /* */
    }
    const p = exhibitionMediaEl.play();
    if (p !== undefined) p.catch(() => {});
  };
  if (exhibitionMediaEl.readyState >= 1) {
    snap();
  } else {
    exhibitionMediaEl.addEventListener("loadedmetadata", snap, { once: true });
  }
  if (mergeCrossfadeArmedIndex >= 0) {
    mergeCrossfadeCurrentIndex = mergeCrossfadeArmedIndex;
  } else {
    mergeCrossfadeCurrentIndex = getNextMergeCrossfadeIndex();
  }
  resetMergeCrossfadeState();
  armNextMergeCrossfadeTrack();
}

async function initExhibitionWebAudioGraph(el, transitionEl) {
  if (exhibitionGraphReady) return;
  exhibitionMediaEl = el;
  exhibitionTransitionEl = transitionEl || null;
  el.volume = 1;
  if (exhibitionTransitionEl) exhibitionTransitionEl.volume = 1;
  exhibitionTempoPlaybackSmoothed = 1;
  try {
    el.preservesPitch = true;
  } catch {
    /* */
  }
  try {
    if ("webkitPreservesPitch" in el) el.webkitPreservesPitch = true;
  } catch {
    /* */
  }

  exhibitionCtx = new AudioContext();
  const src = exhibitionCtx.createMediaElementSource(el);

  exhibitionBass = exhibitionCtx.createBiquadFilter();
  exhibitionBass.type = "lowshelf";
  exhibitionBass.frequency.value = 220;
  exhibitionBass.Q.value = 0.85;
  exhibitionTransitionBass = exhibitionCtx.createBiquadFilter();
  exhibitionTransitionBass.type = "lowshelf";
  exhibitionTransitionBass.frequency.value = 220;
  exhibitionTransitionBass.Q.value = 0.85;

  exhibitionDeckGain = exhibitionCtx.createGain();
  exhibitionDeckGain.gain.value = 1;
  exhibitionTransitionGain = exhibitionCtx.createGain();
  exhibitionTransitionGain.gain.value = 0;

  exhibitionMaster = exhibitionCtx.createGain();
  exhibitionMaster.gain.value = 1;
  const srcTransition = exhibitionTransitionEl
    ? exhibitionCtx.createMediaElementSource(exhibitionTransitionEl)
    : null;

  const workletUrl = new URL(
    "rubberband/rubberband-processor.js",
    window.location.href,
  ).href;

  try {
    exhibitionRb = await createRubberBandNode(exhibitionCtx, workletUrl, {});
    try {
      exhibitionRb.setTempo(1);
    } catch {
      /* */
    }
    src.connect(exhibitionRb);
    exhibitionRb.connect(exhibitionBass);
  } catch (err) {
    console.warn(
      "[exhibition-audio] Rubber Band 실패 — 피치 없음, 템포만 playbackRate:",
      err,
    );
    exhibitionRb = null;
    src.connect(exhibitionBass);
  }

  if (srcTransition) {
    try {
      exhibitionRbTransition = await createRubberBandNode(
        exhibitionCtx,
        workletUrl,
        {},
      );
      try {
        exhibitionRbTransition.setTempo(1);
      } catch {
        /* */
      }
      srcTransition.connect(exhibitionRbTransition);
      exhibitionRbTransition.connect(exhibitionTransitionBass);
    } catch (err) {
      console.warn(
        "[exhibition-audio] Rubber Band(transition) 실패 — 전환곡 피치 없음:",
        err,
      );
      exhibitionRbTransition = null;
      srcTransition.connect(exhibitionTransitionBass);
    }
  } else {
    exhibitionRbTransition = null;
  }

  exhibitionBass.connect(exhibitionDeckGain);
  exhibitionDeckGain.connect(exhibitionMaster);
  if (srcTransition) {
    exhibitionTransitionBass.connect(exhibitionTransitionGain);
    exhibitionTransitionGain.connect(exhibitionMaster);
  }
  exhibitionMaster.connect(exhibitionCtx.destination);

  exhibitionGraphReady = true;
  exhibitionRbLastPitch = NaN;
  lastAppliedVolPct = NaN;
  lastAppliedBassPct = NaN;
  mergeCrossfadeCurrentIndex = 0;
  mergeCrossfadeArmedIndex = -1;
  mergeCrossfadeArmedReady = false;
  resetMergeCrossfadeState();
  armNextMergeCrossfadeTrack();
  syncExhibitionAudioFromDjState({ snapTempo: true, directPitch: true });
}

function attachStage(stage) {
  /** 버블 단계: 캡처로 막지 않아야 탭까지 포인터 이벤트가 정상 전달되고 setPointerCapture가 먹힘 */
  stage.addEventListener("contextmenu", (e) => {
    if (!stage.contains(e.target)) return;
    if (e.target.closest(".chrome-tabstrip--drag-handle")) e.preventDefault();
  });

  stage.addEventListener("pointerdown", (e) => {
    if (!stage.contains(e.target)) return;

    if (e.target === stage) {
      const first = stage.querySelector(".chrome-window");
      if (first) selectWindow(first);
      return;
    }

    const win = e.target.closest(".chrome-window");
    if (!win || !stage.contains(win)) return;

    /* chrome-frame / chrome-page / 컨트롤러 영역을 눌러도 창 선택 + 최상단 */
    if (e.button === 0 || e.button === 2) {
      selectWindow(win);
    }

    const handle = win.querySelector(".chrome-tabstrip--drag-handle");
    if (!handle || !handle.contains(e.target)) return;

    if (e.target.closest(".chrome-tab__close")) return;
    if (e.target.closest(".chrome-newtab")) return;

    const tab = e.target.closest(".chrome-tab");
    const strip = win.querySelector(".chrome-tabstrip__tabs");
    if (tab && strip && e.button === 0) {
      // 탭을 잡아 창을 움직여도, 클릭한 탭이 활성화되어야 이후 동작(재분리 대상 선택)이 가능함
      setOnlyActiveTab(strip, tab);
      // 탭이 2개 이상 합쳐진 상태에서는 탭 드래그를 우선 분리 동작으로 처리
      if (getTabs(strip).length > 1) {
        selectWindow(win);
        beginTabTear(e, win, tab, stage);
        return;
      }
    }

    /** 우클릭: 창 드래그 = 수치 하락만 */
    if (e.button === 2) {
      e.preventDefault();
      selectWindow(win);
      beginWindowDrag(e, win, handle, stage, { mode: "down" });
      return;
    }

    if (e.button !== 0) return;

    e.preventDefault();
    selectWindow(win);
    beginWindowDrag(e, win, handle, stage, { mode: "up" });
  });
}

function encodePathSegmentsPreservingSlashes(href) {
  if (!href || href.startsWith("data:")) return href;
  try {
    const u = new URL(href, document.baseURI || window.location.href);
    const parts = u.pathname.split("/").filter((p) => p.length);
    const enc = parts.map((p) => {
      try {
        return encodeURIComponent(decodeURIComponent(p));
      } catch {
        return encodeURIComponent(p);
      }
    });
    u.pathname = "/" + enc.join("/");
    return u.href;
  } catch {
    return href;
  }
}

function scheduleInactivityReload() {
  if (inactivityReloadTimer) clearTimeout(inactivityReloadTimer);
  inactivityReloadTimer = window.setTimeout(() => {
    window.location.reload();
  }, INACTIVITY_RELOAD_MS);
}

function installInactivityReload(stage) {
  const markActive = () => {
    scheduleInactivityReload();
  };
  const opts = { capture: true, passive: true };
  window.addEventListener("pointerdown", markActive, opts);
  window.addEventListener("pointermove", markActive, opts);
  window.addEventListener("wheel", markActive, opts);
  window.addEventListener("keydown", markActive, opts);
  window.addEventListener("touchstart", markActive, opts);
  if (stage) {
    stage.addEventListener("pointerup", markActive, opts);
    stage.addEventListener("pointercancel", markActive, opts);
  }
  scheduleInactivityReload();
}

async function initExhibitionAudio() {
  const el = document.getElementById("exhibition-audio");
  let transitionEl = document.getElementById("exhibition-audio-transition");
  if (!transitionEl) {
    transitionEl = document.createElement("audio");
    transitionEl.id = "exhibition-audio-transition";
    transitionEl.className = "exhibition-audio";
    transitionEl.loop = true;
    transitionEl.playsInline = true;
    transitionEl.preload = "auto";
    transitionEl.setAttribute("aria-hidden", "true");
    document.body.appendChild(transitionEl);
  }
  if (!el) return;
  const rawSrc = el.getAttribute("src");
  if (rawSrc) {
    el.src = encodePathSegmentsPreservingSlashes(rawSrc);
  }

  await initExhibitionWebAudioGraph(el, transitionEl);

  const tryPlay = () => {
    const p = el.play();
    if (p !== undefined) p.catch(() => {});
  };

  tryPlay();

  const unlock = () => {
    exhibitionCtx?.resume().catch(() => {});
    tryPlay();
    document.removeEventListener("pointerdown", unlock, true);
    document.removeEventListener("keydown", unlock, true);
  };
  document.addEventListener("pointerdown", unlock, true);
  document.addEventListener("keydown", unlock, true);
}

async function init() {
  const stage = document.querySelector(".browser-stage");
  if (stage) attachStage(stage);
  installInactivityReload(stage);

  syncWindowActiveChannelAttrs();

  renderDjHud();
  await initExhibitionAudio();
}

async function boot() {
  try {
    await init();
  } catch (err) {
    console.error(err);
    const pre = document.createElement("pre");
    pre.style.cssText =
      "position:fixed;right:8px;bottom:8px;left:8px;z-index:2147483647;max-height:42vh;overflow:auto;padding:12px;background:#2d1f1f;border:1px solid #e57373;color:#ffccbc;font:12px/1.45 ui-monospace,monospace;";
    pre.textContent = `스크립트 초기화 오류:\n${err?.stack || err}`;
    document.body.appendChild(pre);
  }
}

if (document.readyState === "loading") {
  document.addEventListener(
    "DOMContentLoaded",
    () => {
      void boot();
    },
    { once: true },
  );
} else {
  void boot();
}

window.addEventListener("resize", () => {
  renderDjControllers();
});