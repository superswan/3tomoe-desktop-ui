// js/menu3.js - Applications Menu (Menu3) System
import { appConfig } from './config.js';
import { pad, showToast, executeAppCommand, getApiBase } from './ui-utils.js';
import { closeMenuModal } from './menu.js';

let menu3Modal, menu3Close, menu3Wrapper, menu3DragHandle;
let menu3TotalCards = 0;
let menu3CurrentIndex = 0;
let menu3Cards = [];
let menu3CarouselInitialized = false;
let menu3TitleEl = null;
let menu3TaglineEl = null;
let menu3MainContainer = null;
let menu3WindowSwitcher = null;
let menu3WindowInput = null;
let menu3WindowList = null;
let menu3WindowPrev = null;
let menu3WindowNext = null;
let menu3WindowPageCurrent = null;
let menu3WindowPageTotal = null;
let menu3WindowSelection = [];
let menu3WindowAll = [];
let menu3WindowActiveIndex = 0;
let menu3WindowPage = 0;
const MENU3_WINDOW_PAGE_SIZE = 9;
let menu3WindowSearchTimer = null;
let menu3ModeSwitchTimer = null;
let menu3Mode = 'apps';
let isLocked = false;
let lockOffsetX = 0, lockOffsetY = 0;
let pointerTrackingBound = false;
let lastPointerX = window.innerWidth / 2;
let lastPointerY = window.innerHeight / 2;

// Follow mode variables
let followAnimationId = null;
let mouseX = window.innerWidth / 2;
let mouseY = window.innerHeight / 2;
let modalX = window.innerWidth / 2;
let modalY = window.innerHeight / 2;

function stopFollowMode() {
  document.removeEventListener('mousemove', trackMouse);
  if (followAnimationId) {
    cancelAnimationFrame(followAnimationId);
    followAnimationId = null;
  }
  if (menu3Wrapper) {
    menu3Wrapper.style.transform = 'translate(-50%, -50%)';
  }
}

function trackMouse(e) {
  if (window.__wv2_freeze_follow) return;
  mouseX = e.clientX;
  mouseY = e.clientY;
}

function trackPointer(e) {
  lastPointerX = e.clientX;
  lastPointerY = e.clientY;
}

function followLoop() {
  if (!isLocked || !menu3Modal?.classList.contains('active')) {
    followAnimationId = null;
    return;
  }

  if (window.__wv2_freeze_follow) {
    followAnimationId = requestAnimationFrame(followLoop);
    return;
  }

  const dx = mouseX - modalX;
  const dy = mouseY - modalY;

  modalX += dx * 0.12;
  modalY += dy * 0.12;

  const velocityX = dx * 0.12;
  const velocityY = dy * 0.12;

  const tiltAmountX = Math.max(-8, Math.min(8, velocityY * 2));
  const tiltAmountY = Math.max(-8, Math.min(8, -velocityX * 2));

  menu3Wrapper.style.left = modalX + 'px';
  menu3Wrapper.style.top = modalY + 'px';
  menu3Wrapper.style.transform = `translate(-50%, -50%) perspective(1000px) rotateX(${tiltAmountX}deg) rotateY(${tiltAmountY}deg)`;

  localStorage.setItem('menu3Left', menu3Wrapper.style.left);
  localStorage.setItem('menu3Top', menu3Wrapper.style.top);

  followAnimationId = requestAnimationFrame(followLoop);
}

function startFollowModeAt(x, y) {
  if (!menu3Wrapper) return;

  if (Number.isFinite(x) && Number.isFinite(y)) {
    modalX = x;
    modalY = y;
    menu3Wrapper.style.left = `${x}px`;
    menu3Wrapper.style.top = `${y}px`;
  } else {
    const rect = menu3Wrapper.getBoundingClientRect();
    modalX = rect.left + rect.width / 2;
    modalY = rect.top + rect.height / 2;
  }

  mouseX = modalX;
  mouseY = modalY;

  document.addEventListener('mousemove', trackMouse);
  if (!followAnimationId) {
    followAnimationId = requestAnimationFrame(followLoop);
  }
}

function enableFollowModeAt(x, y) {
  if (!menu3Wrapper) return;
  isLocked = true;
  menu3Wrapper.classList.add('follow-mode');
  const dragLine = menu3DragHandle?.querySelector('.drag-line');
  if (dragLine) dragLine.style.background = '#ffffff';
  startFollowModeAt(x, y);
}

function ensureWindowSwitcherElements() {
  if (!menu3MainContainer) return;
  if (menu3WindowSwitcher && menu3WindowInput && menu3WindowList) return;

  const existing = menu3MainContainer.querySelector('#menu3-window-switcher');
  if (existing) {
    menu3WindowSwitcher = existing;
    menu3WindowInput = existing.querySelector('#menu3-window-input');
    menu3WindowList = existing.querySelector('#menu3-window-list');
    menu3WindowPrev = existing.querySelector('#menu3-window-prev');
    menu3WindowNext = existing.querySelector('#menu3-window-next');
    menu3WindowPageCurrent = existing.querySelector('#menu3-window-page-current');
    menu3WindowPageTotal = existing.querySelector('#menu3-window-page-total');
  } else {
    menu3MainContainer.insertAdjacentHTML('beforeend', `
    <div class="menu3-window-switcher" id="menu3-window-switcher" style="display:none;">
      <div class="menu3run-panel">
        <div class="menu3run-row">
          <input class="menu3run-input" id="menu3-window-input" type="text" autocomplete="off" autocapitalize="off" spellcheck="false" placeholder="Filter windows" aria-label="Filter windows">
        </div>
        <div class="menu3run-actions quickmenu-actions menu3-window-list" id="menu3-window-list"></div>
      </div>
      <div class="nav-container menu3-window-nav">
        <div class="nav-frame">
          <div class="nav-corner tl"></div>
          <div class="nav-corner tr"></div>
          <div class="nav-corner bl"></div>
          <div class="nav-corner br"></div>
        </div>
        <button class="nav-btn chamfer" id="menu3-window-prev" type="button"><span>PREV</span></button>
        <div class="nav-counter"><span id="menu3-window-page-current">01</span> / <span id="menu3-window-page-total">01</span></div>
        <button class="nav-btn chamfer" id="menu3-window-next" type="button"><span>NEXT</span></button>
      </div>
    </div>
  `);
  }

  menu3WindowSwitcher = menu3MainContainer.querySelector('#menu3-window-switcher');
  menu3WindowInput = menu3MainContainer.querySelector('#menu3-window-input');
  menu3WindowList = menu3MainContainer.querySelector('#menu3-window-list');
  menu3WindowPrev = menu3MainContainer.querySelector('#menu3-window-prev');
  menu3WindowNext = menu3MainContainer.querySelector('#menu3-window-next');
  menu3WindowPageCurrent = menu3MainContainer.querySelector('#menu3-window-page-current');
  menu3WindowPageTotal = menu3MainContainer.querySelector('#menu3-window-page-total');

  if (menu3WindowInput) {
    if (menu3WindowInput.dataset.boundInput !== '1') {
      menu3WindowInput.dataset.boundInput = '1';
      menu3WindowInput.addEventListener('input', () => {
        if (menu3WindowSearchTimer) {
          clearTimeout(menu3WindowSearchTimer);
          menu3WindowSearchTimer = null;
        }
        menu3WindowSearchTimer = setTimeout(() => {
          applyWindowSearchFilter();
        }, 120);
      });
    }
  }

  if (menu3WindowList) {
    if (menu3WindowList.dataset.boundList !== '1') {
      menu3WindowList.dataset.boundList = '1';
    let windowScrollTimeout = null;
    menu3WindowList.addEventListener('wheel', (e) => {
      e.preventDefault();
      e.stopPropagation();
      if (windowScrollTimeout) return;
      windowScrollTimeout = setTimeout(() => { windowScrollTimeout = null; }, 150);
      const totalPages = Math.max(1, Math.ceil(menu3WindowSelection.length / MENU3_WINDOW_PAGE_SIZE));
      if (e.deltaY > 0) {
        menu3WindowPage = (menu3WindowPage + 1) % totalPages;
      } else {
        menu3WindowPage = (menu3WindowPage - 1 + totalPages) % totalPages;
      }
      renderWindowCandidates();
    });
    menu3WindowList.addEventListener('click', (e) => {
      const item = e.target.closest('.menu3-window-item');
      if (!item) return;
      const idx = Number.parseInt(item.dataset.globalIndex, 10);
      if (!Number.isFinite(idx)) return;
      menu3WindowActiveIndex = Math.max(0, Math.min(menu3WindowSelection.length - 1, idx));
      ensureWindowPageForActiveIndex();
      updateWindowSelectionStyles();
      focusSelectedWindow();
    });
    }
  }

  if (menu3WindowPrev) {
    if (menu3WindowPrev.dataset.boundPrev !== '1') {
      menu3WindowPrev.dataset.boundPrev = '1';
      menu3WindowPrev.addEventListener('click', () => {
        const totalPages = Math.max(1, Math.ceil(menu3WindowSelection.length / MENU3_WINDOW_PAGE_SIZE));
        menu3WindowPage = (menu3WindowPage - 1 + totalPages) % totalPages;
        renderWindowCandidates();
      });
    }
  }

  if (menu3WindowNext) {
    if (menu3WindowNext.dataset.boundNext !== '1') {
      menu3WindowNext.dataset.boundNext = '1';
      menu3WindowNext.addEventListener('click', () => {
        const totalPages = Math.max(1, Math.ceil(menu3WindowSelection.length / MENU3_WINDOW_PAGE_SIZE));
        menu3WindowPage = (menu3WindowPage + 1) % totalPages;
        renderWindowCandidates();
      });
    }
  }
}

function setMenu3Mode(nextMode) {
  const mode = nextMode === 'windows' ? 'windows' : 'apps';
  menu3Mode = mode;

  if (menu3TitleEl) menu3TitleEl.textContent = mode === 'windows' ? 'Window Switcher' : 'Applications';
  if (menu3TaglineEl) menu3TaglineEl.textContent = mode === 'windows' ? 'Select a window' : 'Select a program';

  const stack = menu3MainContainer?.querySelector('.menu3-stack-container');
  const nav = menu3MainContainer?.querySelector('.menu3-nav-container');
  if (stack) stack.style.display = mode === 'windows' ? 'none' : '';
  if (nav) nav.style.display = mode === 'windows' ? 'none' : '';
  if (menu3WindowSwitcher) menu3WindowSwitcher.style.display = mode === 'windows' ? 'block' : 'none';

  if (mode === 'windows') {
    menu3WindowInput.value = '';
    loadWindowSwitcher();
    const focusInput = () => {
      if (!menu3WindowInput) return;
      try {
        menu3WindowInput.focus({ preventScroll: true });
        const len = menu3WindowInput.value.length;
        menu3WindowInput.setSelectionRange(len, len);
      } catch {}
    };
    requestAnimationFrame(focusInput);
    setTimeout(focusInput, 45);
  }
}

export function setMenu3SwitcherMode(useWindowSwitcher = false) {
  if (!menu3Modal) initMenu3Elements();
  if (!menu3Modal?.classList.contains('active')) return;
  ensureWindowSwitcherElements();
  const targetMode = useWindowSwitcher ? 'windows' : 'apps';
  const inner = menu3Modal.querySelector('.menu3-inner');
  if (!inner) {
    setMenu3Mode(targetMode);
    return;
  }

  if (menu3ModeSwitchTimer) {
    clearTimeout(menu3ModeSwitchTimer);
    menu3ModeSwitchTimer = null;
  }

  inner.classList.remove('mode-switch-enter');
  inner.classList.add('mode-switch-exit');

  menu3ModeSwitchTimer = setTimeout(() => {
    setMenu3Mode(targetMode);
    requestAnimationFrame(() => {
      inner.classList.remove('mode-switch-exit');
      inner.classList.add('mode-switch-enter');
      menu3ModeSwitchTimer = setTimeout(() => {
        inner.classList.remove('mode-switch-enter');
        menu3ModeSwitchTimer = null;
      }, 220);
    });
  }, 130);
}

function truncateWindowTitle(value) {
  const text = String(value || 'Untitled window');
  if (text.length <= 60) return text;
  return `${text.slice(0, 57)}...`;
}

function escapeHtml(value) {
  return String(value || '')
    .replaceAll('&', '&amp;')
    .replaceAll('<', '&lt;')
    .replaceAll('>', '&gt;')
    .replaceAll('"', '&quot;')
    .replaceAll("'", '&#39;');
}

function windowSortKey(item) {
  return `${String(item?.process || '').toLowerCase()}|${String(item?.title || '').toLowerCase()}`;
}

async function fetchWindowCandidates(limit = 1000) {
  const base = getApiBase();
  const url = `${base}/api/windows?limit=${Math.max(1, Math.min(4000, limit))}`;
  const response = await fetch(url, { cache: 'no-store' });
  if (!response.ok) throw new Error(`Window list failed (${response.status})`);
  const payload = await response.json();
  const items = Array.isArray(payload?.items) ? payload.items : [];
  return items.sort((a, b) => windowSortKey(a).localeCompare(windowSortKey(b)));
}

function applyWindowSearchFilter() {
  const query = (menu3WindowInput?.value || '').trim().toLowerCase();
  if (!query) {
    menu3WindowSelection = menu3WindowAll.slice();
  } else {
    menu3WindowSelection = menu3WindowAll.filter((item) => {
      const title = String(item?.title || '').toLowerCase();
      const process = String(item?.process || '').toLowerCase();
      return title.includes(query) || process.includes(query);
    });
  }

  menu3WindowActiveIndex = 0;
  menu3WindowPage = 0;
  renderWindowCandidates();
}

function ensureWindowPageForActiveIndex() {
  if (!Array.isArray(menu3WindowSelection) || menu3WindowSelection.length === 0) {
    menu3WindowPage = 0;
    return;
  }
  menu3WindowPage = Math.floor(menu3WindowActiveIndex / MENU3_WINDOW_PAGE_SIZE);
}

function updateWindowSelectionStyles() {
  if (!menu3WindowList) return;
  const buttons = menu3WindowList.querySelectorAll('.menu3-window-item');
  buttons.forEach((button) => {
    const idx = Number.parseInt(button.dataset.globalIndex, 10);
    button.classList.toggle('selected', Number.isFinite(idx) && idx === menu3WindowActiveIndex);
  });
}

function renderWindowCandidates() {
  if (!menu3WindowList) return;

  if (!Array.isArray(menu3WindowSelection) || menu3WindowSelection.length === 0) {
    // Even with no results, render placeholder slots to maintain stable size
    let html = '<div class="quickmenu-empty" style="position:absolute;width:100%;text-align:center;padding:20px 0;">No matching windows</div>';
    for (let i = 0; i < MENU3_WINDOW_PAGE_SIZE; i++) {
      html += '<button class="quickmenu-option menu3-window-item placeholder" type="button">&nbsp;</button>';
    }
    menu3WindowList.innerHTML = html;
    if (menu3WindowPageCurrent) menu3WindowPageCurrent.textContent = '00';
    if (menu3WindowPageTotal) menu3WindowPageTotal.textContent = '00';
    return;
  }

  const totalPages = Math.max(1, Math.ceil(menu3WindowSelection.length / MENU3_WINDOW_PAGE_SIZE));
  menu3WindowPage = Math.max(0, Math.min(totalPages - 1, menu3WindowPage));

  const start = menu3WindowPage * MENU3_WINDOW_PAGE_SIZE;
  const end = start + MENU3_WINDOW_PAGE_SIZE;
  const pageItems = menu3WindowSelection.slice(start, end);

  // Always render exactly MENU3_WINDOW_PAGE_SIZE slots for stable layout
  let html = '';
  for (let i = 0; i < MENU3_WINDOW_PAGE_SIZE; i++) {
    const item = pageItems[i];
    if (item) {
      const globalIndex = start + i;
      const selected = globalIndex === menu3WindowActiveIndex;
      const fullTitle = String(item?.title || 'Untitled window');
      const processName = String(item?.process || '');
      const shortTitle = truncateWindowTitle(fullTitle);
      const label = processName ? `${escapeHtml(processName)} — ${escapeHtml(shortTitle)}` : escapeHtml(shortTitle);
      html += `<button class="quickmenu-option menu3-window-item${selected ? ' selected' : ''}" type="button" data-global-index="${globalIndex}">${label}</button>`;
    } else {
      html += '<button class="quickmenu-option menu3-window-item placeholder" type="button">&nbsp;</button>';
    }
  }
  menu3WindowList.innerHTML = html;

  if (menu3WindowPageCurrent) menu3WindowPageCurrent.textContent = pad(menu3WindowPage + 1);
  if (menu3WindowPageTotal) menu3WindowPageTotal.textContent = pad(totalPages);
  updateWindowSelectionStyles();
}

async function loadWindowSwitcher() {
  if (menu3Mode !== 'windows') return;
  try {
    const items = await fetchWindowCandidates(2000);
    menu3WindowAll = Array.isArray(items) ? items : [];
    applyWindowSearchFilter();
  } catch {
    menu3WindowAll = [];
    menu3WindowSelection = [];
    menu3WindowActiveIndex = 0;
    menu3WindowPage = 0;
    if (menu3WindowList) {
      menu3WindowList.innerHTML = '<div class="quickmenu-empty">Unable to load windows</div>';
    }
    if (menu3WindowPageCurrent) menu3WindowPageCurrent.textContent = '00';
    if (menu3WindowPageTotal) menu3WindowPageTotal.textContent = '00';
  }
}

async function focusSelectedWindow() {
  const item = Array.isArray(menu3WindowSelection) && menu3WindowSelection.length > 0
    ? menu3WindowSelection[Math.max(0, Math.min(menu3WindowSelection.length - 1, menu3WindowActiveIndex))]
    : null;
  if (!item || !item.hwnd) return;

  const base = getApiBase();
  window.dispatchEvent(new CustomEvent('appCommandExecuted', { detail: { ok: true } }));
  await new Promise((resolve) => setTimeout(resolve, 80));

  try {
    const response = await fetch(`${base}/api/windows/focus`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ hwnd: String(item.hwnd), pid: item.pid })
    });
    const payload = await response.json().catch(() => ({}));
    if (!response.ok || payload?.success !== true) return;
  } catch {
    return;
  }
}

export function openMenu3(options = {}) {
  if (!menu3Modal) initMenu3Elements();
  window.dispatchEvent(new Event('closeMenu3Run'));
  closeMenuModal();
  buildMenu3UI();
  ensureWindowSwitcherElements();
  menu3Modal.classList.add('active');
  initMenu3Carousel();

  if (menu3Wrapper) {
    if (options.randomize) {
      requestAnimationFrame(() => {
        const rect = menu3Wrapper.getBoundingClientRect();
        const width = rect.width || 720;
        const height = rect.height || 420;
        const margin = 24;
        const spread = 180;
        const maxOffsetX = Math.max(0, Math.min(spread, window.innerWidth / 2 - margin - width / 2));
        const maxOffsetY = Math.max(0, Math.min(spread, window.innerHeight / 2 - margin - height / 2));
        const offsetX = (Math.random() * 2 - 1) * maxOffsetX;
        const offsetY = Math.random() * maxOffsetY;
        const left = window.innerWidth / 2 + offsetX;
        const top = window.innerHeight / 2 + offsetY;
        menu3Wrapper.style.left = `${left}px`;
        menu3Wrapper.style.top = `${top}px`;
        menu3Wrapper.style.transform = 'translate(-50%, -50%)';
      });
    } else {
      const leftPos = localStorage.getItem('menu3Left') || '50%';
      const topPos = localStorage.getItem('menu3Top') || '50%';
      menu3Wrapper.style.left = leftPos;
      menu3Wrapper.style.top = topPos;
      menu3Wrapper.style.transform = 'translate(-50%, -50%)';
    }
  }

  if (options.lockToCursor) {
    enableFollowModeAt(lastPointerX, lastPointerY);
  } else {
    disableFollowMode();
  }

  setMenu3Mode(options.switcherMode ? 'windows' : 'apps');
}

export function closeMenu3() {
  if (menu3ModeSwitchTimer) {
    clearTimeout(menu3ModeSwitchTimer);
    menu3ModeSwitchTimer = null;
  }
  const inner = menu3Modal?.querySelector('.menu3-inner');
  if (inner) {
    inner.classList.remove('mode-switch-enter', 'mode-switch-exit');
  }
  if (menu3Modal) menu3Modal.classList.remove('active');
}

export function initMenu3Elements() {
  menu3Modal = document.getElementById('menu3-modal');
  menu3Close = document.getElementById('menu3-close');
  menu3Wrapper = menu3Modal?.querySelector('.menu3-modal-wrapper');
  menu3DragHandle = document.getElementById('menu3-drag-handle');
  menu3TitleEl = menu3Modal?.querySelector('.menu3-logo') || null;
  menu3TaglineEl = menu3Modal?.querySelector('.menu3-tagline') || null;
  menu3MainContainer = menu3Modal?.querySelector('.menu3-main-container') || null;
  ensureWindowSwitcherElements();

  if (!pointerTrackingBound) {
    document.addEventListener('mousemove', trackPointer, { passive: true });
    pointerTrackingBound = true;
  }
  
  if (menu3Wrapper && menu3DragHandle) {
    initMenu3Drag();
    initMenu3Tilt();
  }
  
  if (menu3Close) {
    menu3Close.addEventListener('click', closeMenu3);
  }
  
  // Scrim click does not close menu3 - use Escape or item selection instead.

  window.addEventListener('closeMenu3', closeMenu3);
  
  // Keyboard navigation
  document.addEventListener('keydown', (e) => {
    if (!menu3Modal?.classList.contains('active')) return;
    const target = e.target;
    const isTyping = target && (
      target.tagName === 'INPUT' ||
      target.tagName === 'TEXTAREA' ||
      target.tagName === 'SELECT' ||
      target.isContentEditable
    );
    
    if (e.key === 'Escape') {
      if (isLocked) {
        disableFollowMode();
        // Prevent overlay-main.js from seeing this event and closing the modal
        e.stopImmediatePropagation();
        return;
      }
      closeMenu3();
      return;
    }

    if (menu3Mode === 'windows') {
      // Arrow keys and Enter work regardless of focus target
      if (e.key === 'ArrowUp') {
        e.preventDefault();
        if (menu3WindowSelection.length > 0) {
          menu3WindowActiveIndex = (menu3WindowActiveIndex - 1 + menu3WindowSelection.length) % menu3WindowSelection.length;
          ensureWindowPageForActiveIndex();
          renderWindowCandidates();
        }
        return;
      }
      if (e.key === 'ArrowDown') {
        e.preventDefault();
        if (menu3WindowSelection.length > 0) {
          menu3WindowActiveIndex = (menu3WindowActiveIndex + 1) % menu3WindowSelection.length;
          ensureWindowPageForActiveIndex();
          renderWindowCandidates();
        }
        return;
      }
      if (e.key === 'ArrowLeft') {
        if (isTyping) return; // Allow cursor movement in input
        e.preventDefault();
        const totalPages = Math.max(1, Math.ceil(menu3WindowSelection.length / MENU3_WINDOW_PAGE_SIZE));
        menu3WindowPage = (menu3WindowPage - 1 + totalPages) % totalPages;
        renderWindowCandidates();
        return;
      }
      if (e.key === 'ArrowRight') {
        if (isTyping) return; // Allow cursor movement in input
        e.preventDefault();
        const totalPages = Math.max(1, Math.ceil(menu3WindowSelection.length / MENU3_WINDOW_PAGE_SIZE));
        menu3WindowPage = (menu3WindowPage + 1) % totalPages;
        renderWindowCandidates();
        return;
      }
      if (e.key === 'Enter') {
        e.preventDefault();
        focusSelectedWindow();
        return;
      }

      // Printable character keys auto-focus the filter input for immediate typing
      if (!isTyping && menu3WindowInput && e.key.length === 1 && !e.ctrlKey && !e.altKey && !e.metaKey) {
        menu3WindowInput.focus({ preventScroll: true });
        // Let the keypress naturally flow into the now-focused input
        return;
      }
      return;
    }

    if (isTyping) return;

    if (!e.ctrlKey && !e.altKey && !e.metaKey && /^[0-9]$/.test(e.key)) {
      if (!menu3TotalCards) return;
      e.preventDefault();
      const targetIndex = e.key === '0' ? (menu3TotalCards - 1) : (Number.parseInt(e.key, 10) - 1);
      if (targetIndex >= 0 && targetIndex < menu3TotalCards) {
        menu3CurrentIndex = targetIndex;
        updateMenu3Cards();
      }
      return;
    }

    if (e.key === 'ArrowUp' || e.key === 'k' || e.key === 'K') {
      e.preventDefault();
      menu3PrevCard?.();
    } else if (e.key === 'ArrowDown' || e.key === 'j' || e.key === 'J') {
      e.preventDefault();
      menu3NextCard?.();
    } else if (e.key === 'Enter') {
      e.preventDefault();
      executeActiveApp();
    }
  });
}

function disableFollowMode() {
  if (isLocked) {
    isLocked = false;
    menu3Wrapper?.classList.remove('follow-mode');
    const dragLine = menu3DragHandle?.querySelector('.drag-line');
    if (dragLine) dragLine.style.background = '';
    stopFollowMode?.();
  }
}

async function executeActiveApp() {
  // Disable follow mode when opening an app
  disableFollowMode();
  
  const activeCard = menu3Cards[menu3CurrentIndex];
  if (!activeCard) return;
  
  const cmd = activeCard.dataset.cmd;
  if (cmd && cmd !== '') {
    console.log('Executing command:', cmd);
    const result = await executeAppCommand(cmd);
    showToast(result.message);
    closeMenu3();
  }
}

function initMenu3Drag() {
  menu3Wrapper.style.position = 'absolute';
  menu3Wrapper.style.left = '50%';
  menu3Wrapper.style.top = '50%';
  menu3Wrapper.style.transform = 'translate(-50%, -50%)';
  
  const modalContent = menu3Wrapper.querySelector('.menu3-modal');
  const dragLine = menu3DragHandle.querySelector('.drag-line');
  
  // Double-click to toggle follow mode (cursor following)
  menu3Wrapper.addEventListener('dblclick', (e) => {
    if (e.target.closest('.menu3-close') || e.target.closest('.menu3-card')) return;
    
    // If already in follow mode, disable it
    if (isLocked) {
      disableFollowMode();
      return;
    }
    
    // Otherwise enable follow mode
    enableFollowModeAt();
  });
  
  // Drag functionality with velocity/tilt effects
  let isDragging = false;
  let startX, startY, initialLeft, initialTop;
  let lastX, lastY, lastTime;
  let velocityX = 0, velocityY = 0;
  let tiltX = 0, tiltY = 0;
  let animationId = null;
  
  function applyTilt() {
    if (!modalContent) return;
    
    // Calculate tilt based on velocity (weighted drag effect)
    const targetTiltX = Math.max(-15, Math.min(15, velocityY * 0.5)); // Tilt up/down based on vertical velocity
    const targetTiltY = Math.max(-15, Math.min(15, -velocityX * 0.5)); // Tilt left/right based on horizontal velocity
    
    // Smooth interpolation
    tiltX += (targetTiltX - tiltX) * 0.15;
    tiltY += (targetTiltY - tiltY) * 0.15;
    
    // Apply 3D transform with tilt
    const transform = `translate(-50%, -50%) perspective(1000px) rotateX(${tiltX}deg) rotateY(${tiltY}deg)`;
    menu3Wrapper.style.transform = transform;
    
    // Decay velocity
    velocityX *= 0.92;
    velocityY *= 0.92;
    
    // Continue animation if still moving or tilted
    if (Math.abs(velocityX) > 0.01 || Math.abs(velocityY) > 0.01 || Math.abs(tiltX) > 0.1 || Math.abs(tiltY) > 0.1) {
      animationId = requestAnimationFrame(applyTilt);
    } else {
      // Reset to neutral position
      menu3Wrapper.style.transform = 'translate(-50%, -50%)';
      tiltX = 0;
      tiltY = 0;
      animationId = null;
    }
  }
  
  menu3Wrapper.addEventListener('mousedown', (e) => {
    if (e.button !== 0) return; // Only left-click starts a drag
    // Don't allow regular drag when in follow mode
    if (isLocked) return;
    if (e.target.closest('.menu3-close') || e.target.closest('.menu3-card') || e.target.closest('.nav-btn')) return;
    
    isDragging = true;
    startX = lastX = e.clientX;
    startY = lastY = e.clientY;
    lastTime = performance.now();
    initialLeft = parseFloat(menu3Wrapper.style.left) || window.innerWidth / 2;
    initialTop = parseFloat(menu3Wrapper.style.top) || window.innerHeight / 2;
    menu3Wrapper.style.cursor = 'grabbing';
    menu3Wrapper.classList.add('dragging');
    menu3DragHandle?.classList.add('dragging');
    if (dragLine) dragLine.style.background = '#ffffff';
    
    // Cancel any ongoing tilt animation
    if (animationId) {
      cancelAnimationFrame(animationId);
      animationId = null;
    }
    
    e.preventDefault();
  });
  
  document.addEventListener('mousemove', (e) => {
    if (!isDragging) return;
    
    const currentTime = performance.now();
    const dt = currentTime - lastTime;
    
    if (!isLocked && isDragging) {
      const dx = e.clientX - startX;
      const dy = e.clientY - startY;
      const currentLeft = parseFloat(menu3Wrapper.style.left) || window.innerWidth / 2;
      const currentTop = parseFloat(menu3Wrapper.style.top) || window.innerHeight / 2;
      menu3Wrapper.style.left = (currentLeft + dx) + 'px';
      menu3Wrapper.style.top = (currentTop + dy) + 'px';
      
      // Calculate velocity for tilt effect
      if (dt > 0) {
        velocityX = (e.clientX - lastX) / dt * 16; // Normalize to ~60fps
        velocityY = (e.clientY - lastY) / dt * 16;
      }
      
      // Apply tilt during drag
      const tiltAmountX = Math.max(-12, Math.min(12, velocityY * 0.3));
      const tiltAmountY = Math.max(-12, Math.min(12, -velocityX * 0.3));
      menu3Wrapper.style.transform = `translate(-50%, -50%) perspective(1000px) rotateX(${tiltAmountX}deg) rotateY(${tiltAmountY}deg)`;
    }
    // Note: Follow mode is handled by separate animation loop, not here
    
    lastX = e.clientX;
    lastY = e.clientY;
    lastTime = currentTime;
    startX = e.clientX;
    startY = e.clientY;
  });
  
  document.addEventListener('mouseup', () => {
    if (!isDragging) return;
    isDragging = false;
    menu3Wrapper.style.cursor = '';
    menu3Wrapper.classList.remove('dragging');
    menu3DragHandle?.classList.remove('dragging');
    if (dragLine) dragLine.style.background = '';
    localStorage.setItem('menu3Left', menu3Wrapper.style.left);
    localStorage.setItem('menu3Top', menu3Wrapper.style.top);
    
    // Start momentum/tilt animation
    if (!animationId && (Math.abs(velocityX) > 0.5 || Math.abs(velocityY) > 0.5)) {
      animationId = requestAnimationFrame(applyTilt);
    } else {
      // Reset immediately if no momentum
      menu3Wrapper.style.transform = 'translate(-50%, -50%)';
      velocityX = 0;
      velocityY = 0;
      tiltX = 0;
      tiltY = 0;
    }
  });
  
  // Follow mode handled by module-level helpers
}

export function buildMenu3UI() {
  const applications = appConfig.applications || [];
  
  if (applications.length === 0) {
    console.log('No applications configured');
    return;
  }
  
  menu3TotalCards = applications.length;
  const stackEl = document.getElementById('menu3-card-stack');
  if (!stackEl) return;
  
  stackEl.innerHTML = '';
  
  applications.forEach((app, i) => {
    stackEl.insertAdjacentHTML('beforeend', `
      <div class="data-card chamfer menu3-card" data-index="${i}" data-cmd="${app.command || ''}">
        <div class="edge-mark tl"></div>
        <div class="edge-mark tr"></div>
        <div class="edge-mark bl"></div>
        <div class="edge-mark br"></div>
        <div class="card-header">
          <div class="card-header-content">
            <div class="card-meta">
              <span class="card-index">${pad(i + 1)}</span>
              <span class="card-title">${app.name}</span>
            </div>
            <span class="card-counter">${pad(i + 1)} / ${pad(menu3TotalCards)}</span>
          </div>
        </div>
        <div class="card-body">
          <div class="paper-panel">
            <p class="card-desc">${app.description || ''}</p>
          </div>
        </div>
      </div>
    `);
  });
  
  const totalCountEl = document.getElementById('menu3-total-count');
  if (totalCountEl) totalCountEl.textContent = pad(menu3TotalCards);
}

// Helper functions for carousel positioning
function getMenu3CardPosition(index) {
  const diff = (index - menu3CurrentIndex + menu3TotalCards) % menu3TotalCards;
  if (diff === 0) return 'active';
  if (diff === 1) return 'next-1';
  if (diff === 2) return 'next-2';
  if (diff === 3 && menu3TotalCards >= 7) return 'next-3';
  if (diff === 4 && menu3TotalCards >= 8) return 'next-4';
  if (diff === menu3TotalCards - 1) return 'prev-1';
  if (diff === menu3TotalCards - 2) return 'prev-2';
  if (diff === menu3TotalCards - 3 && menu3TotalCards >= 7) return 'prev-3';
  if (diff === menu3TotalCards - 4 && menu3TotalCards >= 8) return 'prev-4';
  return 'hidden';
}

function updateMenu3Cards() {
  const indexDisplay = document.getElementById('menu3-current-index');
  menu3Cards.forEach((card, i) => {
    card.classList.remove('active', 'next-1', 'next-2', 'next-3', 'next-4', 'prev-1', 'prev-2', 'prev-3', 'prev-4', 'hidden');
    const pos = getMenu3CardPosition(i);
    card.classList.add(pos);
  });
  if (indexDisplay) indexDisplay.textContent = pad(menu3CurrentIndex + 1);
}

export function initMenu3Carousel() {
  // Always re-query cards since they get rebuilt every time
  menu3Cards = document.querySelectorAll('.menu3-card');
  
  // Reset carousel state
  menu3CurrentIndex = 0;
  
  // If already initialized, just update the cards and return
  if (menu3CarouselInitialized) {
    updateMenu3Cards();
    return;
  }
  
  menu3CarouselInitialized = true;
  const navPrev = document.getElementById('menu3-nav-prev');
  const navNext = document.getElementById('menu3-nav-next');
  
  if (!menu3Cards.length) return;
  
  window.menu3NextCard = function() {
    menu3CurrentIndex = (menu3CurrentIndex + 1) % menu3TotalCards;
    updateMenu3Cards();
  };
  
  window.menu3PrevCard = function() {
    menu3CurrentIndex = (menu3CurrentIndex - 1 + menu3TotalCards) % menu3TotalCards;
    updateMenu3Cards();
  };
  
  if (navPrev) navPrev.addEventListener('click', window.menu3PrevCard);
  if (navNext) navNext.addEventListener('click', window.menu3NextCard);
  
  // Touch/swipe support
  let touchStartY = 0;
  const stackContainer = document.querySelector('.menu3-stack-container');
  
  if (stackContainer) {
    stackContainer.addEventListener('touchstart', (e) => {
      touchStartY = e.touches[0].clientY;
    }, { passive: true });
    
    stackContainer.addEventListener('touchend', (e) => {
      const diff = touchStartY - e.changedTouches[0].clientY;
      if (Math.abs(diff) > 50) {
        if (diff > 0) window.menu3NextCard();
        else window.menu3PrevCard();
      }
    }, { passive: true });
  }
  
  // Click handlers
  const menu3StackContainer = document.querySelector('.menu3-stack-container');
  if (menu3StackContainer) {
    menu3StackContainer.addEventListener('click', (e) => {
      const card = e.target.closest('.menu3-card');
      if (!card || e.target.closest('.res-link')) return;
      
      const index = parseInt(card.dataset.index);
      const cmd = card.dataset.cmd;
      const diff = (index - menu3CurrentIndex + menu3TotalCards) % menu3TotalCards;
      
        if (diff === 0) {
          if (cmd && cmd !== '') {
            executeAppCommand(cmd).then((result) => {
              showToast(result.message);
              closeMenu3();
            });
          }
        } else if (diff === 1 || diff === menu3TotalCards - 1) {
        if (diff === 1) window.menu3NextCard();
        else window.menu3PrevCard();
      }
    });
  }
  
  // Wheel navigation
  let scrollTimeout = null;
  document.addEventListener('wheel', (e) => {
    if (!menu3Modal?.classList.contains('active')) return;
    if (menu3Mode === 'windows') return;
    if (scrollTimeout) return;
    
    scrollTimeout = setTimeout(() => {
      scrollTimeout = null;
    }, 150);
    
    if (e.deltaY > 0) window.menu3NextCard?.();
    else window.menu3PrevCard?.();
  }, { passive: true });
  
  updateMenu3Cards();
}

let menu3TiltInitialized = false;
let menu3TiltTargetX = 0;
let menu3TiltTargetY = 0;
let menu3TiltCurrentX = 0;
let menu3TiltCurrentY = 0;
let menu3LastMouseX = window.innerWidth / 2;
let menu3LastMouseY = window.innerHeight / 2;

function initMenu3Tilt() {
  if (menu3TiltInitialized) return;
  menu3TiltInitialized = true;

  function onMove(e) {
    menu3LastMouseX = e.clientX;
    menu3LastMouseY = e.clientY;
  }

  function update() {
    const active = menu3Modal?.classList.contains('active');
    const isDragging = menu3Wrapper?.classList.contains('dragging');

    if (!active || isDragging || !menu3Wrapper) {
      requestAnimationFrame(update);
      return;
    }

    const rect = menu3Wrapper.getBoundingClientRect();
    const centerX = rect.left + rect.width / 2;
    const centerY = rect.top + rect.height / 2;

    const dx = (menu3LastMouseX - centerX) / (rect.width / 2);
    const dy = (menu3LastMouseY - centerY) / (rect.height / 2);

    const maxTiltX = 8;
    const maxTiltY = 10;

    menu3TiltTargetY = Math.max(-maxTiltY, Math.min(maxTiltY, dx * maxTiltY));
    menu3TiltTargetX = Math.max(-maxTiltX, Math.min(maxTiltX, -dy * maxTiltX));

    menu3TiltCurrentX += (menu3TiltTargetX - menu3TiltCurrentX) * 0.12;
    menu3TiltCurrentY += (menu3TiltTargetY - menu3TiltCurrentY) * 0.12;

    menu3Wrapper.style.transform = `translate(-50%, -50%) perspective(1000px) rotateX(${menu3TiltCurrentX}deg) rotateY(${menu3TiltCurrentY}deg)`;

    requestAnimationFrame(update);
  }

  document.addEventListener('mousemove', onMove);
  update();
}
