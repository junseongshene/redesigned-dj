const DRAG_THRESHOLD_PX = 6;

const OMNIBOX_GOOGLE_G = `<svg class="chrome-omnibox__google-g" width="18" height="18" viewBox="0 0 24 24" aria-hidden="true"><path fill="#4285F4" d="M22.56 12.25c0-.78-.07-1.53-.2-2.25H12v4.26h5.92c-.26 1.37-1.04 2.53-2.21 3.31v2.77h3.57c2.08-1.92 3.28-4.74 3.28-8.09z"/><path fill="#34A853" d="M12 23c2.97 0 5.46-.98 7.28-2.66l-3.57-2.77c-.98.66-2.23 1.06-3.71 1.06-2.86 0-5.29-1.93-6.16-4.53H2.18v2.84C3.99 20.53 7.7 23 12 23z"/><path fill="#FBBC05" d="M5.84 14.09c-.22-.66-.35-1.36-.35-2.09s.13-1.43.35-2.09V7.07H2.18C1.43 8.55 1 10.22 1 12s.43 3.45 1.18 4.93l2.85-2.22.81-.62z"/><path fill="#EA4335" d="M12 5.38c1.62 0 3.06.56 4.21 1.64l3.15-3.15C17.45 2.09 14.97 1 12 1 7.7 1 3.99 3.47 2.18 7.07l3.66 2.84c.87-2.6 3.3-4.53 6.16-4.53z"/></svg>`;

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

function selectWindow(selected) {
  document.querySelectorAll(".chrome-window").forEach((w) => {
    w.classList.toggle("chrome-window--selected", w === selected);
  });
}

function getTabs(strip) {
  return [...strip.querySelectorAll(":scope > .chrome-tab")];
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
  document.querySelectorAll(".chrome-tabstrip__tabs--drop-target").forEach((el) => {
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
}

function resetOmniboxToNewTab(win) {
  const urlEl = win.querySelector(".chrome-omnibox__url");
  const icon = win.querySelector(".chrome-omnibox__icon");
  if (urlEl) urlEl.textContent = "";
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

function mergeAllTabs(sourceStrip, targetStrip, clientX) {
  const tabs = getTabs(sourceStrip);
  if (tabs.length === 0) return;
  const insertBefore = findInsertBefore(targetStrip, clientX);
  if (!insertBefore) return;
  for (const t of tabs) {
    targetStrip.insertBefore(t, insertBefore);
  }
  const mergedTabs = getTabs(targetStrip);
  const active = pickTabNearestX(targetStrip, clientX) || mergedTabs[mergedTabs.length - 1];
  if (active) setOnlyActiveTab(targetStrip, active);
  clearDropMarkers();
}

function rectsOverlapRatio(a, b, minRatio) {
  const x1 = Math.max(a.left, b.left);
  const x2 = Math.min(a.right, b.right);
  const y1 = Math.max(a.top, b.top);
  const y2b = Math.min(a.bottom, b.bottom);
  if (x2 <= x1 || y2b <= y1) return false;
  const inter = (x2 - x1) * (y2b - y1);
  const areaA = a.width * a.height;
  const areaB = b.width * b.height;
  const smaller = Math.min(areaA, areaB);
  return smaller > 0 && inter / smaller >= minRatio;
}

function shouldMergeWindowToStrip(draggedWin, targetStrip, clientX, clientY) {
  const targetWin = targetStrip.closest(".chrome-window");
  if (!targetWin || targetWin === draggedWin) return false;
  const ta = targetStrip.getBoundingClientRect();
  if (clientX >= ta.left && clientX <= ta.right && clientY >= ta.top && clientY <= ta.bottom) return true;
  const sourceStrip = draggedWin.querySelector(".chrome-tabstrip__tabs");
  if (!sourceStrip) return false;
  const sa = sourceStrip.getBoundingClientRect();
  return rectsOverlapRatio(sa, ta, 0.1);
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

  if (sourceWin) {
    const srcStrip = sourceWin.querySelector(".chrome-tabstrip__tabs");
    if (srcStrip && getTabs(srcStrip).length === 0) {
      sourceWin.remove();
    }
  }
}

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
    if (!tearing && (Math.abs(mx) > DRAG_THRESHOLD_PX || Math.abs(my) > DRAG_THRESHOLD_PX)) {
      startTearVisual();
    }
    if (!tearing) return;
    ev.preventDefault();
    tab.style.left = `${ev.clientX - offsetX}px`;
    tab.style.top = `${ev.clientY - offsetY}px`;

    const hoverStrip = stripUnderPoint(ev.clientX, ev.clientY, tab);
    if (hoverStrip) {
      updateDropIndicator(hoverStrip, ev.clientX);
    } else {
      clearDropMarkers();
    }
  };

  const onUp = (ev) => {
    if (ev.pointerId !== pointerId) return;
    window.removeEventListener("pointermove", onMove);
    window.removeEventListener("pointerup", onUp);
    window.removeEventListener("pointercancel", onUp);
    clearDropMarkers();

    if (!tearing) {
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
      const insertBefore = findInsertBefore(targetStrip, ev.clientX);
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

  window.addEventListener("pointermove", onMove);
  window.addEventListener("pointerup", onUp);
  window.addEventListener("pointercancel", onUp);
}

function beginWindowDrag(e, win, handle, stage) {
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

  try {
    handle.setPointerCapture(pointerId);
  } catch {
    /* */
  }

  const onMove = (ev) => {
    if (ev.pointerId !== pointerId) return;
    const mx = ev.clientX - startX;
    const my = ev.clientY - startY;
    if (!dragging && (Math.abs(mx) > DRAG_THRESHOLD_PX || Math.abs(my) > DRAG_THRESHOLD_PX)) {
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
      applyTranslate(win, originDx + mx, originDy + my);
    }
  };

  const onUp = (ev) => {
    if (ev.pointerId !== pointerId) return;
    win.classList.remove("chrome-window--dragging");
    document.body.classList.remove("chrome-ui--window-dragging");
    try {
      handle.releasePointerCapture(pointerId);
    } catch {
      /* */
    }
    window.removeEventListener("pointermove", onMove);
    window.removeEventListener("pointerup", onUp);
    window.removeEventListener("pointercancel", onUp);

    if (dragging) {
      const sourceStrip = win.querySelector(".chrome-tabstrip__tabs");
      if (sourceStrip && getTabs(sourceStrip).length > 0) {
        for (const other of stage.querySelectorAll(".chrome-window")) {
          if (other === win) continue;
          const ts = other.querySelector(".chrome-tabstrip__tabs");
          if (!ts) continue;
          if (shouldMergeWindowToStrip(win, ts, ev.clientX, ev.clientY)) {
            mergeAllTabs(sourceStrip, ts, ev.clientX);
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
  };

  window.addEventListener("pointermove", onMove);
  window.addEventListener("pointerup", onUp);
  window.addEventListener("pointercancel", onUp);
}

function attachStage(stage) {
  stage.addEventListener("pointerdown", (e) => {
    if (e.target === stage) {
      const first = stage.querySelector(".chrome-window");
      if (first) selectWindow(first);
      return;
    }

    const win = e.target.closest(".chrome-window");
    if (!win || !stage.contains(win) || e.button !== 0) return;

    selectWindow(win);

    const handle = win.querySelector(".chrome-tabstrip--drag-handle");
    if (!handle || !handle.contains(e.target)) return;

    if (e.target.closest(".chrome-tab__close")) return;
    if (e.target.closest(".chrome-newtab")) return;

    const tab = e.target.closest(".chrome-tab");
    if (tab) {
      e.stopPropagation();
      beginTabTear(e, win, tab, stage);
      return;
    }

    e.stopPropagation();
    beginWindowDrag(e, win, handle, stage);
  });
}

function init() {
  const stage = document.querySelector(".browser-stage");
  if (stage) attachStage(stage);
}

init();
