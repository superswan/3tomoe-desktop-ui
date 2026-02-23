// js/menu3run.js - Run modal (Menu3 style)
import { showToast, executeAppCommand, getApiBase } from './ui-utils.js';
import { appConfig } from './config.js';
import { closeMenu3 } from './menu3.js';
import { closeMenuModal } from './menu.js';

let menu3RunModal;
let menu3RunWrapper;
let menu3RunContent;
let menu3RunClose;
let menu3RunDragHandle;
let menu3RunInput;
let menu3RunButton;
let menu3RunCancel;
let menu3RunSuggestions;
let menu3RunAttachedIcon;

let menu3RunDragInitialized = false;
let menu3RunTiltInitialized = false;
let menu3RunTiltTargetX = 0;
let menu3RunTiltTargetY = 0;
let menu3RunTiltCurrentX = 0;
let menu3RunTiltCurrentY = 0;
let menu3RunLastMouseX = window.innerWidth / 2;
let menu3RunLastMouseY = window.innerHeight / 2;
let menu3RunIsLocked = false;
let menu3RunFollowAnimationId = null;
let menu3RunMouseX = window.innerWidth / 2;
let menu3RunMouseY = window.innerHeight / 2;
let menu3RunModalX = window.innerWidth / 2;
let menu3RunModalY = window.innerHeight / 2;
let menu3RunOpenFocusTimer = null;
let menu3RunSearchTimer = null;
let menu3RunSelection = [];
let menu3RunActiveIndex = 0;
let menu3RunListMode = false;
let menu3RunAutocompletePosition = 'top';
let menu3RunAutoFilling = false;

function getAutocompletePosition() {
  try {
    const raw = localStorage.getItem('developerSettings');
    if (raw) {
      const parsed = JSON.parse(raw);
      const value = parsed?.overlayRunAutocompleteIconPosition;
      if (value === 'top' || value === 'bottom' || value === 'right') {
        return value;
      }
    }
  } catch {
  }
  const fromConfig = appConfig?.developerPanelSettings?.overlayRunAutocompleteIconPosition;
  if (fromConfig === 'top' || fromConfig === 'bottom' || fromConfig === 'right') {
    return fromConfig;
  }
  return 'top';
}

function setRunListMode(next) {
  menu3RunListMode = next === true;
  menu3RunContent?.classList.toggle('list-mode', menu3RunListMode);
  renderRunSuggestions();
}

function scheduleInputFocus() {
  if (menu3RunOpenFocusTimer) {
    clearTimeout(menu3RunOpenFocusTimer);
    menu3RunOpenFocusTimer = null;
  }
  const focusInput = () => {
    if (!menu3RunModal?.classList.contains('active') || !menu3RunInput) return false;
    try {
      menu3RunInput.focus({ preventScroll: true });
      const len = menu3RunInput.value.length;
      menu3RunInput.setSelectionRange(len, len);
      return document.activeElement === menu3RunInput;
    } catch {
      return false;
    }
  };
  // Light-touch: the C# host injects a real hardware click via SendInput
  // to satisfy Chromium's user-gesture requirement. This is just a fallback.
  requestAnimationFrame(focusInput);
  menu3RunOpenFocusTimer = setTimeout(focusInput, 80);
}

function getTypedQuery() {
  if (!menu3RunInput) return '';
  return menu3RunInput.value || '';
}

function getCurrentSuggestion() {
  if (!Array.isArray(menu3RunSelection) || menu3RunSelection.length === 0) return null;
  const idx = Math.max(0, Math.min(menu3RunSelection.length - 1, menu3RunActiveIndex));
  return menu3RunSelection[idx] || null;
}

function applyAutocompleteSelection() {
  return;
}

function renderRunIcon() {
  if (!menu3RunAttachedIcon) return;
  const query = getTypedQuery().trim();
  if (!query) {
    menu3RunAttachedIcon.classList.remove('visible');
    return;
  }
  const selected = getCurrentSuggestion();
  const icon = selected?.icon;
  if (!icon) {
    menu3RunAttachedIcon.classList.remove('visible');
    return;
  }
  const img = menu3RunAttachedIcon.querySelector('img');
  if (img) {
    img.src = icon;
    img.alt = selected?.name ? `${selected.name} icon` : 'Application icon';
  }
  menu3RunAttachedIcon.className = `menu3run-attached-icon visible pos-${menu3RunAutocompletePosition}`;
}

function renderRunSuggestions() {
  if (!menu3RunSuggestions) return;
  const query = getTypedQuery().trim();
  const shouldShow = menu3RunListMode || query.length > 0;
  const items = shouldShow ? menu3RunSelection : [];
  if (!items.length) {
    menu3RunSuggestions.innerHTML = '';
    menu3RunSuggestions.classList.remove('visible');
    renderRunIcon();
    return;
  }
  menu3RunSuggestions.classList.add('visible');
  menu3RunSuggestions.innerHTML = items.map((item, index) => {
    const active = index === menu3RunActiveIndex;
    return `<button class="menu3run-suggestion${active ? ' active' : ''}" data-index="${index}" type="button">${item.name}</button>`;
  }).join('');
  menu3RunSuggestions.querySelectorAll('.menu3run-suggestion').forEach((node) => {
    node.addEventListener('mouseenter', () => {
      const idx = Number.parseInt(node.dataset.index || '0', 10);
      if (!Number.isFinite(idx)) return;
      menu3RunActiveIndex = Math.max(0, Math.min(menu3RunSelection.length - 1, idx));
      const all = menu3RunSuggestions.querySelectorAll('.menu3run-suggestion');
      all.forEach((btn) => btn.classList.remove('active'));
      node.classList.add('active');
      renderRunIcon();
    });
    node.addEventListener('click', (e) => {
      e.preventDefault();
      const idx = Number.parseInt(node.dataset.index || '0', 10);
      if (!Number.isFinite(idx)) return;
      menu3RunActiveIndex = Math.max(0, Math.min(menu3RunSelection.length - 1, idx));
      const selected = getCurrentSuggestion();
      if (selected?.name && menu3RunInput) {
        menu3RunInput.value = selected.name;
      }
      executeRunCommand();
    });
  });
  renderRunIcon();
}

async function fetchRunSuggestions(query) {
  try {
    const base = getApiBase();
    const limit = menu3RunListMode ? 12 : 8;
    const url = `${base}/api/start-menu-apps?q=${encodeURIComponent(query || '')}&limit=${limit}&icons=1`;
    const response = await fetch(url, { cache: 'no-store' });
    if (!response.ok) throw new Error('failed');
    const data = await response.json();
    const items = Array.isArray(data?.items) ? data.items : [];
    menu3RunSelection = items
      .filter((item) => item && item.name && item.command)
      .map((item) => ({
        name: String(item.name),
        command: String(item.command),
        icon: typeof item.iconUrl === 'string'
          ? item.iconUrl
          : (typeof item.icon === 'string' ? item.icon : '')
      }));
    console.log('[Run] suggestion results', {
      query,
      count: menu3RunSelection.length,
      icons: menu3RunSelection.filter((item) => !!item.icon).length,
      names: menu3RunSelection.map((item) => item.name)
    });
    menu3RunActiveIndex = 0;
    renderRunSuggestions();
    applyAutocompleteSelection();
  } catch {
    console.warn('[Run] suggestion fetch failed', query);
    menu3RunSelection = [];
    menu3RunActiveIndex = 0;
    renderRunSuggestions();
  }
}

function scheduleRunSuggestions() {
  if (menu3RunSearchTimer) {
    clearTimeout(menu3RunSearchTimer);
    menu3RunSearchTimer = null;
  }
  // Capture query at fire time, not schedule time, to avoid stale reads
  menu3RunSearchTimer = setTimeout(() => {
    const query = getTypedQuery().trim();
    fetchRunSuggestions(query);
  }, 60);
}

function resolveRunCommand() {
  const typed = menu3RunInput?.value.trim() || '';
  const active = getCurrentSuggestion();
  if (active && typed.toLowerCase() === active.name.toLowerCase()) {
    return active.command;
  }
  if (active && typed && active.name.toLowerCase().startsWith(typed.toLowerCase())) {
    return active.command;
  }
  if (menu3RunListMode && active?.command) {
    return active.command;
  }
  const direct = menu3RunSelection.find((item) => typed.toLowerCase() === item.name.toLowerCase());
  if (direct?.command) {
    return direct.command;
  }
  if (typed && menu3RunSelection.length > 0) {
    return menu3RunSelection[0].command;
  }
  return typed;
}

export function openMenu3Run(options = {}) {
  if (!menu3RunModal) initMenu3RunElements();
  if (!menu3RunModal) return;
  if (menu3RunModal.classList.contains('active')) {
    setRunListMode(!menu3RunListMode);
    scheduleInputFocus();
    scheduleRunSuggestions();
    return;
  }
  closeMenu3();
  closeMenuModal();
  menu3RunModal.classList.add('active');
  menu3RunAutocompletePosition = getAutocompletePosition();
  setRunListMode(false);

  if (menu3RunWrapper) {
    if (options.randomize) {
      requestAnimationFrame(() => {
        const rect = menu3RunWrapper.getBoundingClientRect();
        const width = rect.width || 520;
        const height = rect.height || 320;
        const margin = 24;
        const spread = 200;
        const maxOffsetX = Math.max(0, Math.min(spread, window.innerWidth / 2 - margin - width / 2));
        const maxOffsetY = Math.max(0, Math.min(spread, window.innerHeight / 2 - margin - height / 2));
        const offsetX = -Math.random() * maxOffsetX;
        const offsetY = Math.random() * maxOffsetY;
        const left = window.innerWidth / 2 + offsetX;
        const top = window.innerHeight / 2 + offsetY;
        menu3RunWrapper.style.left = `${left}px`;
        menu3RunWrapper.style.top = `${top}px`;
        menu3RunWrapper.style.transform = 'translate(-50%, -50%)';
      });
    } else {
      const leftPos = localStorage.getItem('menu3runLeft') || '50%';
      const topPos = localStorage.getItem('menu3runTop') || '50%';
      menu3RunWrapper.style.left = leftPos;
      menu3RunWrapper.style.top = topPos;
      menu3RunWrapper.style.transform = 'translate(-50%, -50%)';
    }
  }

  if (options.lockToCursor) {
    const x = Number.isFinite(options.x) ? options.x : menu3RunLastMouseX;
    const y = Number.isFinite(options.y) ? options.y : menu3RunLastMouseY;
    enableFollowModeAt(x, y);
  } else {
    disableFollowMode();
  }
  scheduleInputFocus();
  scheduleRunSuggestions();
}

export function closeMenu3Run() {
  disableFollowMode();
  if (menu3RunModal) menu3RunModal.classList.remove('active');
  if (menu3RunInput) {
    menu3RunInput.value = '';
  }
  menu3RunSelection = [];
  menu3RunActiveIndex = 0;
  renderRunSuggestions();
  setRunListMode(false);
}

async function executeRunCommand() {
  if (!menu3RunInput) return;
  const cmd = resolveRunCommand();
  if (!cmd) {
    showToast('Enter a command to run');
    menu3RunInput.focus();
    return;
  }

  disableFollowMode();

  const result = await executeAppCommand(cmd);
  showToast(result.message);
  if (result.ok) {
    closeMenu3Run();
  } else {
    menu3RunInput.focus();
    const len = menu3RunInput.value.length;
    menu3RunInput.setSelectionRange(len, len);
  }
}

function bindRunTriggers() {
  const runTriggers = document.querySelectorAll('[data-action="run"]');
  runTriggers.forEach((trigger) => {
    if (trigger.dataset.runBound) return;
    trigger.addEventListener('click', () => openMenu3Run({ randomize: true }));
    trigger.dataset.runBound = 'true';
  });
}

function initMenu3RunDrag() {
  if (!menu3RunWrapper) return;
  menu3RunWrapper.style.position = 'absolute';
  menu3RunWrapper.style.left = '50%';
  menu3RunWrapper.style.top = '50%';
  menu3RunWrapper.style.transform = 'translate(-50%, -50%)';
  const dragLine = menu3RunDragHandle?.querySelector('.drag-line');

  let isDragging = false;
  let startX;
  let startY;
  let lastX;
  let lastY;
  let lastTime;
  let velocityX = 0;
  let velocityY = 0;
  let tiltX = 0;
  let tiltY = 0;
  let animationId = null;

  function applyTilt() {
    if (!menu3RunWrapper) return;

    const targetTiltX = Math.max(-12, Math.min(12, velocityY * 0.5));
    const targetTiltY = Math.max(-12, Math.min(12, -velocityX * 0.5));

    tiltX += (targetTiltX - tiltX) * 0.15;
    tiltY += (targetTiltY - tiltY) * 0.15;

    menu3RunWrapper.style.transform = `translate(-50%, -50%) perspective(1000px) rotateX(${tiltX}deg) rotateY(${tiltY}deg)`;

    velocityX *= 0.92;
    velocityY *= 0.92;

    if (Math.abs(velocityX) > 0.01 || Math.abs(velocityY) > 0.01 || Math.abs(tiltX) > 0.1 || Math.abs(tiltY) > 0.1) {
      animationId = requestAnimationFrame(applyTilt);
    } else {
      menu3RunWrapper.style.transform = 'translate(-50%, -50%)';
      tiltX = 0;
      tiltY = 0;
      animationId = null;
    }
  }

  const startDrag = (e) => {
    if (e.button !== 0) return;
    if (e.target.closest('input, textarea, select, button, a')) return;
    if (menu3RunIsLocked) return;
    if (menu3RunWrapper) {
      const rect = menu3RunWrapper.getBoundingClientRect();
      menu3RunWrapper.style.left = `${rect.left + rect.width / 2}px`;
      menu3RunWrapper.style.top = `${rect.top + rect.height / 2}px`;
      menu3RunWrapper.style.transform = 'translate(-50%, -50%)';
    }
    isDragging = true;
    startX = lastX = e.clientX;
    startY = lastY = e.clientY;
    lastTime = performance.now();
    menu3RunWrapper.classList.add('dragging');
    menu3RunDragHandle?.classList.add('dragging');
    if (dragLine) dragLine.style.background = '#ffffff';

    if (animationId) {
      cancelAnimationFrame(animationId);
      animationId = null;
    }

    e.preventDefault();
  };

  menu3RunDragHandle?.addEventListener('mousedown', startDrag);
  menu3RunContent?.addEventListener('mousedown', startDrag);

  menu3RunContent?.addEventListener('dblclick', (e) => {
    if (e.target.closest('input, textarea, select, button, a')) return;
    if (menu3RunIsLocked) {
      disableFollowMode();
      return;
    }
    enableFollowModeAt();
  });

  document.addEventListener('mousemove', (e) => {
    if (!isDragging || !menu3RunWrapper) return;

    const currentTime = performance.now();
    const dt = currentTime - lastTime;
    const dx = e.clientX - startX;
    const dy = e.clientY - startY;

    const currentLeft = parseFloat(menu3RunWrapper.style.left) || window.innerWidth / 2;
    const currentTop = parseFloat(menu3RunWrapper.style.top) || window.innerHeight / 2;
    menu3RunWrapper.style.left = (currentLeft + dx) + 'px';
    menu3RunWrapper.style.top = (currentTop + dy) + 'px';

    if (dt > 0) {
      velocityX = (e.clientX - lastX) / dt * 16;
      velocityY = (e.clientY - lastY) / dt * 16;
    }

    const tiltAmountX = Math.max(-10, Math.min(10, velocityY * 0.3));
    const tiltAmountY = Math.max(-10, Math.min(10, -velocityX * 0.3));
    menu3RunWrapper.style.transform = `translate(-50%, -50%) perspective(1000px) rotateX(${tiltAmountX}deg) rotateY(${tiltAmountY}deg)`;

    lastX = e.clientX;
    lastY = e.clientY;
    lastTime = currentTime;
    startX = e.clientX;
    startY = e.clientY;
  });

  document.addEventListener('mouseup', () => {
    if (!isDragging || !menu3RunWrapper) return;
    isDragging = false;
    menu3RunWrapper.classList.remove('dragging');
    menu3RunDragHandle.classList.remove('dragging');
    if (dragLine) dragLine.style.background = '';

    localStorage.setItem('menu3runLeft', menu3RunWrapper.style.left);
    localStorage.setItem('menu3runTop', menu3RunWrapper.style.top);

    if (!animationId && (Math.abs(velocityX) > 0.5 || Math.abs(velocityY) > 0.5)) {
      animationId = requestAnimationFrame(applyTilt);
    } else {
      menu3RunWrapper.style.transform = 'translate(-50%, -50%)';
      velocityX = 0;
      velocityY = 0;
      tiltX = 0;
      tiltY = 0;
    }
  });
}

function initMenu3RunTilt() {
  if (menu3RunTiltInitialized) return;
  menu3RunTiltInitialized = true;

  function onMove(e) {
    menu3RunLastMouseX = e.clientX;
    menu3RunLastMouseY = e.clientY;
  }

  function update() {
    const active = menu3RunModal?.classList.contains('active');
    const isDragging = menu3RunWrapper?.classList.contains('dragging');

    if (!active || isDragging || menu3RunIsLocked || !menu3RunWrapper || window.__wv2_freeze_follow) {
      requestAnimationFrame(update);
      return;
    }

    const rect = menu3RunWrapper.getBoundingClientRect();
    const centerX = rect.left + rect.width / 2;
    const centerY = rect.top + rect.height / 2;

    const dx = (menu3RunLastMouseX - centerX) / (rect.width / 2);
    const dy = (menu3RunLastMouseY - centerY) / (rect.height / 2);

    const maxTiltX = 8;
    const maxTiltY = 10;

    menu3RunTiltTargetY = Math.max(-maxTiltY, Math.min(maxTiltY, dx * maxTiltY));
    menu3RunTiltTargetX = Math.max(-maxTiltX, Math.min(maxTiltX, -dy * maxTiltX));

    menu3RunTiltCurrentX += (menu3RunTiltTargetX - menu3RunTiltCurrentX) * 0.12;
    menu3RunTiltCurrentY += (menu3RunTiltTargetY - menu3RunTiltCurrentY) * 0.12;

    menu3RunWrapper.style.transform = `translate(-50%, -50%) perspective(1000px) rotateX(${menu3RunTiltCurrentX}deg) rotateY(${menu3RunTiltCurrentY}deg)`;

    requestAnimationFrame(update);
  }

  document.addEventListener('mousemove', onMove);
  update();
}

function disableFollowMode() {
  if (!menu3RunIsLocked) return;
  menu3RunIsLocked = false;
  menu3RunWrapper?.classList.remove('follow-mode');
  const dragLine = menu3RunDragHandle?.querySelector('.drag-line');
  if (dragLine) dragLine.style.background = '';
  stopFollowMode();
}

function stopFollowMode() {
  document.removeEventListener('mousemove', trackMouse);
  if (menu3RunFollowAnimationId) {
    cancelAnimationFrame(menu3RunFollowAnimationId);
    menu3RunFollowAnimationId = null;
  }
  if (menu3RunWrapper) {
    menu3RunWrapper.style.transform = 'translate(-50%, -50%)';
  }
}

function trackMouse(e) {
  if (window.__wv2_freeze_follow) return;
  menu3RunMouseX = e.clientX;
  menu3RunMouseY = e.clientY;
}

function startFollowModeAt(x, y) {
  if (!menu3RunWrapper) return;
  if (Number.isFinite(x) && Number.isFinite(y)) {
    menu3RunModalX = x;
    menu3RunModalY = y;
    menu3RunWrapper.style.left = `${x}px`;
    menu3RunWrapper.style.top = `${y}px`;
  } else {
    const rect = menu3RunWrapper.getBoundingClientRect();
    menu3RunModalX = rect.left + rect.width / 2;
    menu3RunModalY = rect.top + rect.height / 2;
  }
  menu3RunMouseX = menu3RunModalX;
  menu3RunMouseY = menu3RunModalY;

  document.addEventListener('mousemove', trackMouse);
  if (!menu3RunFollowAnimationId) {
    menu3RunFollowAnimationId = requestAnimationFrame(followLoop);
  }
}

function enableFollowModeAt(x, y) {
  if (!menu3RunWrapper) return;
  menu3RunIsLocked = true;
  menu3RunWrapper.classList.add('follow-mode');
  const dragLine = menu3RunDragHandle?.querySelector('.drag-line');
  if (dragLine) dragLine.style.background = '#ffffff';
  startFollowModeAt(x, y);
}

function followLoop() {
  if (!menu3RunIsLocked || !menu3RunModal?.classList.contains('active')) {
    menu3RunFollowAnimationId = null;
    return;
  }

  // Skip position update while C# is injecting a SendInput click
  if (window.__wv2_freeze_follow) {
    menu3RunFollowAnimationId = requestAnimationFrame(followLoop);
    return;
  }

  const dx = menu3RunMouseX - menu3RunModalX;
  const dy = menu3RunMouseY - menu3RunModalY;

  menu3RunModalX += dx * 0.12;
  menu3RunModalY += dy * 0.12;

  const velocityX = dx * 0.12;
  const velocityY = dy * 0.12;
  const tiltAmountX = Math.max(-8, Math.min(8, velocityY * 2));
  const tiltAmountY = Math.max(-8, Math.min(8, -velocityX * 2));

  menu3RunWrapper.style.left = menu3RunModalX + 'px';
  menu3RunWrapper.style.top = menu3RunModalY + 'px';
  menu3RunWrapper.style.transform = `translate(-50%, -50%) perspective(1000px) rotateX(${tiltAmountX}deg) rotateY(${tiltAmountY}deg)`;

  localStorage.setItem('menu3runLeft', menu3RunWrapper.style.left);
  localStorage.setItem('menu3runTop', menu3RunWrapper.style.top);

  menu3RunFollowAnimationId = requestAnimationFrame(followLoop);
}

export function initMenu3RunElements() {
  menu3RunModal = document.getElementById('menu3run-modal');
  menu3RunWrapper = menu3RunModal?.querySelector('.menu3run-modal-wrapper');
  menu3RunContent = document.getElementById('menu3run-content');
  menu3RunClose = document.getElementById('menu3run-close');
  menu3RunDragHandle = document.getElementById('menu3run-drag-handle');
  menu3RunInput = document.getElementById('menu3run-input');
  menu3RunButton = document.getElementById('menu3run-run');
  menu3RunCancel = document.getElementById('menu3run-cancel');

  if (menu3RunWrapper && !document.getElementById('menu3run-attached-icon')) {
    menu3RunAttachedIcon = document.createElement('div');
    menu3RunAttachedIcon.id = 'menu3run-attached-icon';
    menu3RunAttachedIcon.className = 'menu3run-attached-icon';
    menu3RunAttachedIcon.innerHTML = '<img alt="Application icon">';
    menu3RunWrapper.appendChild(menu3RunAttachedIcon);
  } else {
    menu3RunAttachedIcon = document.getElementById('menu3run-attached-icon');
  }

  if (menu3RunContent && !document.getElementById('menu3run-suggestions')) {
    menu3RunSuggestions = document.createElement('div');
    menu3RunSuggestions.id = 'menu3run-suggestions';
    menu3RunSuggestions.className = 'menu3run-suggestions';
    const panel = menu3RunContent.querySelector('.menu3run-panel');
    const actions = menu3RunContent.querySelector('.menu3run-actions');
    if (panel && actions) {
      panel.insertBefore(menu3RunSuggestions, actions);
    }
  } else {
    menu3RunSuggestions = document.getElementById('menu3run-suggestions');
  }

  if (menu3RunClose) {
    menu3RunClose.addEventListener('click', closeMenu3Run);
  }

  if (menu3RunCancel) {
    menu3RunCancel.addEventListener('click', closeMenu3Run);
  }

  if (menu3RunButton) {
    menu3RunButton.addEventListener('click', executeRunCommand);
  }

  // Scrim click does not close run - use Escape or execute instead.

  if (menu3RunInput) {
    menu3RunInput.addEventListener('input', () => {
      scheduleRunSuggestions();
    });
    menu3RunInput.addEventListener('keydown', (e) => {
      if (e.altKey && e.key.toLowerCase() === 'r') {
        e.preventDefault();
        setRunListMode(!menu3RunListMode);
        scheduleRunSuggestions();
        return;
      }
      if (e.key === 'ArrowDown') {
        if (menu3RunSelection.length > 0) {
          e.preventDefault();
          menu3RunActiveIndex = (menu3RunActiveIndex + 1) % menu3RunSelection.length;
          renderRunSuggestions();
          applyAutocompleteSelection();
        }
        return;
      }
      if (e.key === 'ArrowUp') {
        if (menu3RunSelection.length > 0) {
          e.preventDefault();
          menu3RunActiveIndex = (menu3RunActiveIndex - 1 + menu3RunSelection.length) % menu3RunSelection.length;
          renderRunSuggestions();
          applyAutocompleteSelection();
        }
        return;
      }
      if (e.key === 'Tab') {
        const selected = getCurrentSuggestion();
        if (selected?.name) {
          e.preventDefault();
          menu3RunInput.value = selected.name;
          const len = selected.name.length;
          menu3RunInput.setSelectionRange(len, len);
          renderRunSuggestions();
        }
        return;
      }
      if (e.key === 'Enter') {
        e.preventDefault();
        executeRunCommand();
      }
    });
  }

  document.addEventListener('keydown', (e) => {
    if (!menu3RunModal?.classList.contains('active')) return;
    if (e.defaultPrevented) return;
    if (e.altKey && e.key.toLowerCase() === 'r') {
      e.preventDefault();
      setRunListMode(!menu3RunListMode);
      scheduleRunSuggestions();
      scheduleInputFocus();
      return;
    }
    if (e.key === 'Escape') {
      if (menu3RunIsLocked) {
        e.preventDefault();
        e.stopImmediatePropagation();
        disableFollowMode();
        return;
      }
      closeMenu3Run();
    } else if (e.key === 'Enter') {
      executeRunCommand();
    }
  });

  bindRunTriggers();

  window.addEventListener('closeMenu3Run', closeMenu3Run);

  if (!menu3RunDragInitialized) {
    initMenu3RunDrag();
    menu3RunDragInitialized = true;
  }

  initMenu3RunTilt();
}
