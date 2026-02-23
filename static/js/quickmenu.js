import { appConfig, updateConfig } from './config.js';
import { showToast, executeAppCommand } from './ui-utils.js';
import { closeMenu3 } from './menu3.js';
import { closeMenu3Run } from './menu3run.js';
import { closeMenuModal } from './menu.js';

let quickMenuModal;
let quickMenuWrapper;
let quickMenuContent;
let quickMenuClose;
let quickMenuDragHandle;
let quickMenuActionsContainer;
let quickMenuPrevButton;
let quickMenuNextButton;
let quickMenuNavCounter;
let quickMenuPrevLabel;
let quickMenuCurrentPageLabel;
let quickMenuTotalPagesLabel;
let quickMenuTitle;
let quickMenuLockButton;
let quickMenuSignOutButton;
let quickMenuPowerButton;
let quickMenuUtilityRow;
let quickMenuConfirmOverlay;
let quickMenuConfirmText;
let quickMenuConfirmYesButton;
let quickMenuConfirmNoButton;
let quickMenuConfirmResolver = null;

let quickMenuDragInitialized = false;
let quickMenuTiltInitialized = false;
let quickMenuTiltTargetX = 0;
let quickMenuTiltTargetY = 0;
let quickMenuTiltCurrentX = 0;
let quickMenuTiltCurrentY = 0;
let quickMenuLastMouseX = window.innerWidth / 2;
let quickMenuLastMouseY = window.innerHeight / 2;
let quickMenuIsLocked = false;
let quickMenuFollowAnimationId = null;
let quickMenuMouseX = window.innerWidth / 2;
let quickMenuMouseY = window.innerHeight / 2;
let quickMenuModalX = window.innerWidth / 2;
let quickMenuModalY = window.innerHeight / 2;
let quickMenuCurrentPage = 0;
let quickMenuSelectedIndex = 0;
let quickMenuView = 'main';
let quickMenuWheelAccumulator = 0;
let quickMenuWheelResetTimer = null;

const QUICK_MENU_PAGE_SIZE = 7;
const PS_SCRIPT_PREFIX = 'powershell -NoProfile -ExecutionPolicy Bypass -WindowStyle Hidden -File "scripts\\';
const QUICK_MENU_UTILITY_COMMANDS = {
  lock: 'rundll32.exe user32.dll,LockWorkStation',
  signout: `${PS_SCRIPT_PREFIX}sign_out.ps1"`,
  shutdown: `${PS_SCRIPT_PREFIX}shutdown_now.ps1"`,
  restart: `${PS_SCRIPT_PREFIX}restart_now.ps1"`,
  restartAdvanced: `${PS_SCRIPT_PREFIX}restart_advanced_startup.ps1"`
};

const QUICK_MENU_POWER_ITEMS = [
  {
    id: 'shutdown_now',
    title: 'Shutdown',
    command: QUICK_MENU_UTILITY_COMMANDS.shutdown,
    confirm: true,
    confirmText: 'Shut down now?'
  },
  {
    id: 'restart_now',
    title: 'Restart',
    command: QUICK_MENU_UTILITY_COMMANDS.restart,
    confirm: true,
    confirmText: 'Restart now?'
  },
  {
    id: 'restart_advanced_startup',
    title: 'Restart (Advanced Startup)',
    command: QUICK_MENU_UTILITY_COMMANDS.restartAdvanced,
    confirm: true,
    confirmText: 'Restart into advanced startup now?'
  }
];

const DEFAULT_QUICK_MENU_ITEMS = [
  { id: 'restart_explorer', title: 'Restart Explorer', command: `${PS_SCRIPT_PREFIX}restart_explorer.ps1"`, enabled: true },
  { id: 'reset_gpu_driver', title: 'Reset GPU Driver', command: `${PS_SCRIPT_PREFIX}reset_gpu_driver.ps1"`, enabled: true },
  { id: 'minimize_all_windows', title: 'Minimize All Windows', command: `${PS_SCRIPT_PREFIX}minimize_all_windows.ps1"`, enabled: true },
  {
    id: 'close_all_windows',
    title: 'Close All Windows',
    command: `${PS_SCRIPT_PREFIX}close_all_windows.ps1"`,
    enabled: true,
    confirm: true,
    confirmText: 'Close all windows? Unsaved work may be lost.'
  },
  { id: 'toggle_taskbar', title: 'Toggle Taskbar', command: `${PS_SCRIPT_PREFIX}toggle_taskbar.ps1"`, enabled: true },
  { id: 'task_manager', title: 'Task Manager', command: `${PS_SCRIPT_PREFIX}open_task_manager.ps1"`, enabled: true }
];

function getQuickMenuItems() {
  const configured = appConfig?.quickMenu?.items;
  if (!Array.isArray(configured) || configured.length === 0) {
    return DEFAULT_QUICK_MENU_ITEMS.map((item) => ({ ...item }));
  }

  return configured
    .filter((item) => item && typeof item === 'object' && String(item.id || '').trim().length > 0)
    .map((item) => {
      const match = DEFAULT_QUICK_MENU_ITEMS.find((defaultItem) => defaultItem.id === item.id);
      return {
        ...(match || {}),
        ...item,
        id: String(item.id).trim(),
        title: String(item.title || match?.title || item.id).trim(),
        command: String(item.command || match?.command || '').trim(),
        enabled: item.enabled !== false,
        confirm: item.confirm === true,
        confirmText: String(item.confirmText || match?.confirmText || '').trim()
      };
    });
}

export function isQuickMenuActive() {
  return !!(quickMenuModal && quickMenuModal.classList.contains('active'));
}

export function openQuickMenu(options = {}) {
  if (!quickMenuModal) initQuickMenuElements();
  if (!quickMenuModal) return;

  closeMenu3Run();
  closeMenu3();
  closeMenuModal();

  quickMenuCurrentPage = 0;
  quickMenuSelectedIndex = 0;
  quickMenuView = 'main';
  quickMenuWheelAccumulator = 0;
  if (quickMenuWheelResetTimer) {
    clearTimeout(quickMenuWheelResetTimer);
    quickMenuWheelResetTimer = null;
  }
  renderQuickMenuActions();
  quickMenuModal.classList.add('active');

  if (quickMenuWrapper) {
    const leftPos = localStorage.getItem('quickmenuLeft') || '50%';
    const topPos = localStorage.getItem('quickmenuTop') || '50%';
    quickMenuWrapper.style.left = leftPos;
    quickMenuWrapper.style.top = topPos;
    quickMenuWrapper.style.transform = 'translate(-50%, -50%)';
  }

  if (options.lockToCursor) {
    const x = Number.isFinite(options.x) ? options.x : quickMenuLastMouseX;
    const y = Number.isFinite(options.y) ? options.y : quickMenuLastMouseY;
    enableFollowModeAt(x, y);
  } else {
    disableFollowMode();
  }

  requestAnimationFrame(() => {
    quickMenuContent?.focus({ preventScroll: true });
  });

  refreshQuickMenuConfig();
}

export function closeQuickMenu() {
  disableFollowMode();
  resolveConfirmModal(false);
  quickMenuWheelAccumulator = 0;
  if (quickMenuWheelResetTimer) {
    clearTimeout(quickMenuWheelResetTimer);
    quickMenuWheelResetTimer = null;
  }
  if (quickMenuModal) quickMenuModal.classList.remove('active');
}

function renderQuickMenuActions() {
  if (!quickMenuActionsContainer) return;

  const allItems = getCurrentQuickMenuItems();

  if (quickMenuTitle) {
    quickMenuTitle.textContent = quickMenuView === 'power' ? 'Power' : 'Quick Menu';
  }

  if (quickMenuUtilityRow) {
    quickMenuUtilityRow.style.display = quickMenuView === 'power' ? 'none' : 'flex';
  }

  const totalPages = Math.max(1, Math.ceil(allItems.length / QUICK_MENU_PAGE_SIZE));
  quickMenuCurrentPage = Math.max(0, Math.min(quickMenuCurrentPage, totalPages - 1));

  const startIndex = quickMenuCurrentPage * QUICK_MENU_PAGE_SIZE;
  const pageItems = allItems.slice(startIndex, startIndex + QUICK_MENU_PAGE_SIZE);

  if (pageItems.length === 0) {
    quickMenuActionsContainer.innerHTML = '<div class="quickmenu-empty">No quick menu items enabled</div>';
  } else {
    quickMenuActionsContainer.innerHTML = pageItems.map((item, pageIndex) => {
      const title = escapeHtml(item.title || item.id || 'Action');
      const absoluteIndex = startIndex + pageIndex;
      return `<button class="quickmenu-option quickmenu-btn" data-action-index="${absoluteIndex}">${title}</button>`;
    }).join('');
  }

  if (pageItems.length > 0) {
    quickMenuSelectedIndex = Math.max(0, Math.min(quickMenuSelectedIndex, pageItems.length - 1));
  } else {
    quickMenuSelectedIndex = 0;
  }

  if (quickMenuCurrentPageLabel) quickMenuCurrentPageLabel.textContent = String(quickMenuCurrentPage + 1).padStart(2, '0');
  if (quickMenuTotalPagesLabel) quickMenuTotalPagesLabel.textContent = String(totalPages).padStart(2, '0');

  if (quickMenuView === 'power') {
    quickMenuContent?.classList.add('quickmenu-power-view');
    if (quickMenuPrevLabel) quickMenuPrevLabel.textContent = 'BACK';
    if (quickMenuPrevButton) quickMenuPrevButton.disabled = false;
    if (quickMenuNextButton) quickMenuNextButton.style.display = 'none';
    if (quickMenuNavCounter) quickMenuNavCounter.style.display = 'none';
  } else {
    quickMenuContent?.classList.remove('quickmenu-power-view');
    if (quickMenuPrevLabel) quickMenuPrevLabel.textContent = 'PREV';
    if (quickMenuPrevButton) quickMenuPrevButton.disabled = quickMenuCurrentPage <= 0;
    if (quickMenuNextButton) quickMenuNextButton.style.display = '';
    if (quickMenuNavCounter) quickMenuNavCounter.style.display = '';
    if (quickMenuNextButton) quickMenuNextButton.disabled = quickMenuCurrentPage >= totalPages - 1;
  }

  quickMenuActionsContainer.querySelectorAll('.quickmenu-btn').forEach((btn, idx) => {
    btn.addEventListener('mouseenter', () => {
      quickMenuSelectedIndex = idx;
      updateQuickMenuSelectionVisual();
    });

    btn.addEventListener('click', async () => {
      const actionIndex = parseInt(btn.getAttribute('data-action-index') || '', 10);
      const action = Number.isFinite(actionIndex) ? allItems[actionIndex] : null;
      if (!action) return;

      if (action.confirm) {
        const ok = await showConfirmModal(action.confirmText || 'Are you sure?');
        if (!ok) return;
      }

      const command = (action.command || '').trim();
      if (!command) {
        showToast('No command configured for this action');
        return;
      }

      disableFollowMode();
      const result = await executeAppCommand(command);
      showToast(result.message);
      if (result.ok) {
        closeQuickMenu();
      }
    });
  });

  updateQuickMenuSelectionVisual();
}

function getCurrentQuickMenuItems() {
  return quickMenuView === 'power'
    ? QUICK_MENU_POWER_ITEMS
    : getQuickMenuItems().filter((item) => item.enabled !== false);
}

function getVisibleQuickMenuButtons() {
  return quickMenuActionsContainer
    ? Array.from(quickMenuActionsContainer.querySelectorAll('.quickmenu-btn'))
    : [];
}

function changeQuickMenuPage(step, selectedIndex = 0) {
  if (!Number.isFinite(step) || step === 0) return false;

  if (quickMenuView === 'power') {
    if (step < 0) {
      quickMenuView = 'main';
      quickMenuCurrentPage = 0;
      quickMenuSelectedIndex = 0;
      renderQuickMenuActions();
      return true;
    }
    return false;
  }

  const allItems = getCurrentQuickMenuItems();
  const totalPages = Math.max(1, Math.ceil(allItems.length / QUICK_MENU_PAGE_SIZE));
  const nextPage = Math.max(0, Math.min(totalPages - 1, quickMenuCurrentPage + (step > 0 ? 1 : -1)));

  if (nextPage === quickMenuCurrentPage) return false;

  quickMenuCurrentPage = nextPage;
  quickMenuSelectedIndex = Math.max(0, selectedIndex);
  renderQuickMenuActions();
  return true;
}

function moveQuickMenuSelection(step) {
  if (!Number.isFinite(step) || step === 0) return;

  const buttons = getVisibleQuickMenuButtons();
  if (buttons.length === 0) return;

  const nextIndex = quickMenuSelectedIndex + (step > 0 ? 1 : -1);
  if (nextIndex >= 0 && nextIndex < buttons.length) {
    quickMenuSelectedIndex = nextIndex;
    updateQuickMenuSelectionVisual();
    return;
  }

  if (step > 0) {
    if (!changeQuickMenuPage(1, 0)) {
      quickMenuSelectedIndex = buttons.length - 1;
      updateQuickMenuSelectionVisual();
    }
    return;
  }

  if (!changeQuickMenuPage(-1, QUICK_MENU_PAGE_SIZE - 1)) {
    quickMenuSelectedIndex = 0;
    updateQuickMenuSelectionVisual();
  }
}

function updateQuickMenuSelectionVisual() {
  const buttons = getVisibleQuickMenuButtons();
  buttons.forEach((btn, idx) => {
    if (idx === quickMenuSelectedIndex) {
      btn.classList.add('selected');
      try { btn.focus({ preventScroll: true }); } catch {}
    } else {
      btn.classList.remove('selected');
    }
  });
}

function triggerSelectedQuickMenuItem() {
  const buttons = getVisibleQuickMenuButtons();
  if (buttons.length === 0) return;
  const btn = buttons[Math.max(0, Math.min(quickMenuSelectedIndex, buttons.length - 1))];
  btn?.click();
}

async function refreshQuickMenuConfig() {
  try {
    const response = await fetch(`config.json?_ts=${Date.now()}`, { cache: 'no-store' });
    if (!response.ok) return;
    const latestConfig = await response.json();
    if (!latestConfig || typeof latestConfig !== 'object') return;

    if (latestConfig.quickMenu && typeof latestConfig.quickMenu === 'object') {
      updateConfig({ quickMenu: latestConfig.quickMenu });
      renderQuickMenuActions();
    }
  } catch {
  }
}

function showConfirmModal(message) {
  if (!quickMenuConfirmOverlay || !quickMenuConfirmText) {
    return Promise.resolve(false);
  }

  quickMenuConfirmText.textContent = message || 'Are you sure?';
  quickMenuConfirmOverlay.classList.add('active');

  return new Promise((resolve) => {
    quickMenuConfirmResolver = resolve;
  });
}

function resolveConfirmModal(value) {
  if (quickMenuConfirmOverlay) {
    quickMenuConfirmOverlay.classList.remove('active');
  }

  const resolver = quickMenuConfirmResolver;
  quickMenuConfirmResolver = null;
  if (resolver) resolver(Boolean(value));
}

function escapeHtml(text) {
  return String(text)
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;')
    .replace(/'/g, '&#39;');
}

function initQuickMenuDrag() {
  if (!quickMenuWrapper) return;
  quickMenuWrapper.style.position = 'absolute';
  quickMenuWrapper.style.left = '50%';
  quickMenuWrapper.style.top = '50%';
  quickMenuWrapper.style.transform = 'translate(-50%, -50%)';
  const dragLine = quickMenuDragHandle?.querySelector('.drag-line');

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
    if (!quickMenuWrapper) return;

    const targetTiltX = Math.max(-12, Math.min(12, velocityY * 0.5));
    const targetTiltY = Math.max(-12, Math.min(12, -velocityX * 0.5));

    tiltX += (targetTiltX - tiltX) * 0.15;
    tiltY += (targetTiltY - tiltY) * 0.15;

    quickMenuWrapper.style.transform = `translate(-50%, -50%) perspective(1000px) rotateX(${tiltX}deg) rotateY(${tiltY}deg)`;

    velocityX *= 0.92;
    velocityY *= 0.92;

    if (Math.abs(velocityX) > 0.01 || Math.abs(velocityY) > 0.01 || Math.abs(tiltX) > 0.1 || Math.abs(tiltY) > 0.1) {
      animationId = requestAnimationFrame(applyTilt);
    } else {
      quickMenuWrapper.style.transform = 'translate(-50%, -50%)';
      tiltX = 0;
      tiltY = 0;
      animationId = null;
    }
  }

  const startDrag = (e) => {
    if (e.button !== 0) return;
    if (e.target.closest('input, textarea, select, button, a')) return;
    if (quickMenuIsLocked) return;
    if (quickMenuWrapper) {
      const rect = quickMenuWrapper.getBoundingClientRect();
      quickMenuWrapper.style.left = `${rect.left + rect.width / 2}px`;
      quickMenuWrapper.style.top = `${rect.top + rect.height / 2}px`;
      quickMenuWrapper.style.transform = 'translate(-50%, -50%)';
    }
    isDragging = true;
    startX = lastX = e.clientX;
    startY = lastY = e.clientY;
    lastTime = performance.now();
    quickMenuWrapper.classList.add('dragging');
    quickMenuDragHandle?.classList.add('dragging');
    if (dragLine) dragLine.style.background = '#ffffff';

    if (animationId) {
      cancelAnimationFrame(animationId);
      animationId = null;
    }

    e.preventDefault();
  };

  quickMenuDragHandle?.addEventListener('mousedown', startDrag);
  quickMenuContent?.addEventListener('mousedown', startDrag);

  quickMenuContent?.addEventListener('dblclick', (e) => {
    if (e.target.closest('input, textarea, select, button, a')) return;
    if (quickMenuIsLocked) {
      disableFollowMode();
      return;
    }
    enableFollowModeAt();
  });

  document.addEventListener('mousemove', (e) => {
    if (!isDragging || !quickMenuWrapper) return;

    const currentTime = performance.now();
    const dt = currentTime - lastTime;
    const dx = e.clientX - startX;
    const dy = e.clientY - startY;

    const currentLeft = parseFloat(quickMenuWrapper.style.left) || window.innerWidth / 2;
    const currentTop = parseFloat(quickMenuWrapper.style.top) || window.innerHeight / 2;
    quickMenuWrapper.style.left = `${currentLeft + dx}px`;
    quickMenuWrapper.style.top = `${currentTop + dy}px`;

    if (dt > 0) {
      velocityX = ((e.clientX - lastX) / dt) * 16;
      velocityY = ((e.clientY - lastY) / dt) * 16;
    }

    const tiltAmountX = Math.max(-10, Math.min(10, velocityY * 0.3));
    const tiltAmountY = Math.max(-10, Math.min(10, -velocityX * 0.3));
    quickMenuWrapper.style.transform = `translate(-50%, -50%) perspective(1000px) rotateX(${tiltAmountX}deg) rotateY(${tiltAmountY}deg)`;

    lastX = e.clientX;
    lastY = e.clientY;
    lastTime = currentTime;
    startX = e.clientX;
    startY = e.clientY;
  });

  document.addEventListener('mouseup', () => {
    if (!isDragging || !quickMenuWrapper) return;
    isDragging = false;
    quickMenuWrapper.classList.remove('dragging');
    quickMenuDragHandle?.classList.remove('dragging');
    if (dragLine) dragLine.style.background = '';

    localStorage.setItem('quickmenuLeft', quickMenuWrapper.style.left);
    localStorage.setItem('quickmenuTop', quickMenuWrapper.style.top);

    if (!animationId && (Math.abs(velocityX) > 0.5 || Math.abs(velocityY) > 0.5)) {
      animationId = requestAnimationFrame(applyTilt);
    } else {
      quickMenuWrapper.style.transform = 'translate(-50%, -50%)';
      velocityX = 0;
      velocityY = 0;
      tiltX = 0;
      tiltY = 0;
    }
  });
}

function initQuickMenuTilt() {
  if (quickMenuTiltInitialized) return;
  quickMenuTiltInitialized = true;

  function onMove(e) {
    quickMenuLastMouseX = e.clientX;
    quickMenuLastMouseY = e.clientY;
  }

  function update() {
    const active = quickMenuModal?.classList.contains('active');
    const isDragging = quickMenuWrapper?.classList.contains('dragging');

    if (!active || isDragging || quickMenuIsLocked || !quickMenuWrapper) {
      requestAnimationFrame(update);
      return;
    }

    const rect = quickMenuWrapper.getBoundingClientRect();
    const centerX = rect.left + rect.width / 2;
    const centerY = rect.top + rect.height / 2;

    const dx = (quickMenuLastMouseX - centerX) / (rect.width / 2);
    const dy = (quickMenuLastMouseY - centerY) / (rect.height / 2);

    const maxTiltX = 8;
    const maxTiltY = 10;

    quickMenuTiltTargetY = Math.max(-maxTiltY, Math.min(maxTiltY, dx * maxTiltY));
    quickMenuTiltTargetX = Math.max(-maxTiltX, Math.min(maxTiltX, -dy * maxTiltX));

    quickMenuTiltCurrentX += (quickMenuTiltTargetX - quickMenuTiltCurrentX) * 0.12;
    quickMenuTiltCurrentY += (quickMenuTiltTargetY - quickMenuTiltCurrentY) * 0.12;

    quickMenuWrapper.style.transform = `translate(-50%, -50%) perspective(1000px) rotateX(${quickMenuTiltCurrentX}deg) rotateY(${quickMenuTiltCurrentY}deg)`;

    requestAnimationFrame(update);
  }

  document.addEventListener('mousemove', onMove);
  update();
}

function disableFollowMode() {
  quickMenuIsLocked = false;
  quickMenuWrapper?.classList.remove('follow-mode');
  const dragLine = quickMenuDragHandle?.querySelector('.drag-line');
  if (dragLine) dragLine.style.background = '';
  stopFollowMode();
}

function stopFollowMode() {
  document.removeEventListener('mousemove', trackMouse);
  if (quickMenuFollowAnimationId) {
    cancelAnimationFrame(quickMenuFollowAnimationId);
    quickMenuFollowAnimationId = null;
  }
  if (quickMenuWrapper) {
    quickMenuWrapper.style.transform = 'translate(-50%, -50%)';
  }
}

function trackMouse(e) {
  if (window.__wv2_freeze_follow) return;
  quickMenuMouseX = e.clientX;
  quickMenuMouseY = e.clientY;
}

function startFollowModeAt(x, y) {
  if (!quickMenuWrapper) return;
  if (Number.isFinite(x) && Number.isFinite(y)) {
    quickMenuModalX = x;
    quickMenuModalY = y;
    quickMenuWrapper.style.left = `${x}px`;
    quickMenuWrapper.style.top = `${y}px`;
  } else {
    const rect = quickMenuWrapper.getBoundingClientRect();
    quickMenuModalX = rect.left + rect.width / 2;
    quickMenuModalY = rect.top + rect.height / 2;
  }
  quickMenuMouseX = quickMenuModalX;
  quickMenuMouseY = quickMenuModalY;

  document.addEventListener('mousemove', trackMouse);
  if (!quickMenuFollowAnimationId) {
    quickMenuFollowAnimationId = requestAnimationFrame(followLoop);
  }
}

function enableFollowModeAt(x, y) {
  if (!quickMenuWrapper) return;
  quickMenuIsLocked = true;
  quickMenuWrapper.classList.add('follow-mode');
  const dragLine = quickMenuDragHandle?.querySelector('.drag-line');
  if (dragLine) dragLine.style.background = '#ffffff';
  startFollowModeAt(x, y);
}

function followLoop() {
  if (!quickMenuIsLocked || !quickMenuModal?.classList.contains('active')) {
    quickMenuFollowAnimationId = null;
    return;
  }

  if (window.__wv2_freeze_follow) {
    quickMenuFollowAnimationId = requestAnimationFrame(followLoop);
    return;
  }

  const dx = quickMenuMouseX - quickMenuModalX;
  const dy = quickMenuMouseY - quickMenuModalY;

  quickMenuModalX += dx * 0.12;
  quickMenuModalY += dy * 0.12;

  const velocityX = dx * 0.12;
  const velocityY = dy * 0.12;
  const tiltAmountX = Math.max(-8, Math.min(8, velocityY * 2));
  const tiltAmountY = Math.max(-8, Math.min(8, -velocityX * 2));

  quickMenuWrapper.style.left = `${quickMenuModalX}px`;
  quickMenuWrapper.style.top = `${quickMenuModalY}px`;
  quickMenuWrapper.style.transform = `translate(-50%, -50%) perspective(1000px) rotateX(${tiltAmountX}deg) rotateY(${tiltAmountY}deg)`;

  localStorage.setItem('quickmenuLeft', quickMenuWrapper.style.left);
  localStorage.setItem('quickmenuTop', quickMenuWrapper.style.top);

  quickMenuFollowAnimationId = requestAnimationFrame(followLoop);
}

export function initQuickMenuElements() {
  quickMenuModal = document.getElementById('quickmenu-modal');
  quickMenuWrapper = quickMenuModal?.querySelector('.menu3run-modal-wrapper');
  quickMenuContent = document.getElementById('quickmenu-content');
  quickMenuTitle = document.getElementById('quickmenu-title');
  quickMenuClose = document.getElementById('quickmenu-close');
  quickMenuDragHandle = document.getElementById('quickmenu-drag-handle');
  quickMenuActionsContainer = document.getElementById('quickmenu-actions');
  quickMenuPrevButton = document.getElementById('quickmenu-nav-prev');
  quickMenuNextButton = document.getElementById('quickmenu-nav-next');
  quickMenuNavCounter = quickMenuContent?.querySelector('.quickmenu-nav-container .nav-counter') || null;
  quickMenuPrevLabel = quickMenuPrevButton?.querySelector('span') || null;
  quickMenuCurrentPageLabel = document.getElementById('quickmenu-current-page');
  quickMenuTotalPagesLabel = document.getElementById('quickmenu-total-pages');
  quickMenuLockButton = document.getElementById('quickmenu-lock');
  quickMenuSignOutButton = document.getElementById('quickmenu-signout');
  quickMenuPowerButton = document.getElementById('quickmenu-power');
  quickMenuUtilityRow = quickMenuContent?.querySelector('.quickmenu-utility-row') || null;
  quickMenuConfirmOverlay = document.getElementById('quickmenu-confirm-overlay');
  quickMenuConfirmText = document.getElementById('quickmenu-confirm-text');
  quickMenuConfirmYesButton = document.getElementById('quickmenu-confirm-yes');
  quickMenuConfirmNoButton = document.getElementById('quickmenu-confirm-no');

  quickMenuPrevButton?.addEventListener('click', () => {
    changeQuickMenuPage(-1, 0);
  });

  quickMenuNextButton?.addEventListener('click', () => {
    changeQuickMenuPage(1, 0);
  });

  quickMenuConfirmYesButton?.addEventListener('click', () => resolveConfirmModal(true));
  quickMenuConfirmNoButton?.addEventListener('click', () => resolveConfirmModal(false));
  quickMenuConfirmOverlay?.addEventListener('click', (e) => {
    if (e.target === quickMenuConfirmOverlay) {
      resolveConfirmModal(false);
    }
  });

  quickMenuLockButton?.addEventListener('click', async () => {
    disableFollowMode();
    const result = await executeAppCommand(QUICK_MENU_UTILITY_COMMANDS.lock);
    showToast(result.message);
    if (result.ok) closeQuickMenu();
  });

  quickMenuSignOutButton?.addEventListener('click', async () => {
    const ok = await showConfirmModal('Sign out now?');
    if (!ok) return;
    disableFollowMode();
    const result = await executeAppCommand(QUICK_MENU_UTILITY_COMMANDS.signout);
    showToast(result.message);
    if (result.ok) closeQuickMenu();
  });

  quickMenuPowerButton?.addEventListener('click', () => {
    quickMenuView = quickMenuView === 'power' ? 'main' : 'power';
    quickMenuCurrentPage = 0;
    quickMenuSelectedIndex = 0;
    renderQuickMenuActions();
  });

  quickMenuContent?.addEventListener('wheel', (e) => {
    if (!quickMenuModal?.classList.contains('active')) return;
    if (quickMenuConfirmOverlay?.classList.contains('active')) return;
    if (quickMenuView === 'power') return;

    const allItems = getCurrentQuickMenuItems();
    const totalPages = Math.max(1, Math.ceil(allItems.length / QUICK_MENU_PAGE_SIZE));
    if (totalPages <= 1) return;

    e.preventDefault();
    e.stopPropagation();

    let delta = 0;
    if (Number.isFinite(e.deltaY) && e.deltaY !== 0) {
      delta = e.deltaY;
    } else if (Number.isFinite(e.deltaX) && e.deltaX !== 0) {
      delta = e.deltaX;
    } else if (Number.isFinite(e.wheelDelta) && e.wheelDelta !== 0) {
      delta = -e.wheelDelta;
    }
    if (!Number.isFinite(delta) || delta === 0) return;

    quickMenuWheelAccumulator += delta;
    if (quickMenuWheelResetTimer) {
      clearTimeout(quickMenuWheelResetTimer);
    }
    quickMenuWheelResetTimer = setTimeout(() => {
      quickMenuWheelAccumulator = 0;
      quickMenuWheelResetTimer = null;
    }, 120);

    const WHEEL_THRESHOLD = 26;
    if (quickMenuWheelAccumulator >= WHEEL_THRESHOLD) {
      quickMenuWheelAccumulator = 0;
      changeQuickMenuPage(1, 0);
      return;
    }

    if (quickMenuWheelAccumulator <= -WHEEL_THRESHOLD) {
      quickMenuWheelAccumulator = 0;
      changeQuickMenuPage(-1, QUICK_MENU_PAGE_SIZE - 1);
    }
  }, { passive: false });

  if (quickMenuClose) {
    quickMenuClose.addEventListener('click', closeQuickMenu);
  }

  // Scrim click does not close quickmenu - use Escape or item selection instead.

  document.addEventListener('keydown', (e) => {
    if (!quickMenuModal?.classList.contains('active')) return;
    if (e.defaultPrevented) return;
    const target = e.target;
    const isTyping = target && (
      target.tagName === 'INPUT' ||
      target.tagName === 'TEXTAREA' ||
      target.tagName === 'SELECT' ||
      target.isContentEditable
    );
    if (isTyping) return;

    if (e.key === 'j' || e.key === 'J' || e.key === 'ArrowDown') {
      e.preventDefault();
      moveQuickMenuSelection(1);
      return;
    }

    if (e.key === 'k' || e.key === 'K' || e.key === 'ArrowUp') {
      e.preventDefault();
      moveQuickMenuSelection(-1);
      return;
    }

    if (e.key === 'h' || e.key === 'H' || e.key === 'ArrowLeft') {
      e.preventDefault();
      changeQuickMenuPage(-1, 0);
      return;
    }

    if (e.key === 'l' || e.key === 'L' || e.key === 'ArrowRight') {
      e.preventDefault();
      if (quickMenuView !== 'power') changeQuickMenuPage(1, 0);
      return;
    }

    if (e.key === 'Enter') {
      e.preventDefault();
      triggerSelectedQuickMenuItem();
      return;
    }

    if (e.key === 'Escape') {
      if (quickMenuConfirmOverlay?.classList.contains('active')) {
        e.preventDefault();
        e.stopImmediatePropagation();
        resolveConfirmModal(false);
        return;
      }

      if (quickMenuIsLocked) {
        e.preventDefault();
        e.stopImmediatePropagation();
        disableFollowMode();
        return;
      }
      closeQuickMenu();
    }
  });

  window.addEventListener('closeQuickMenu', closeQuickMenu);

  if (!quickMenuDragInitialized) {
    initQuickMenuDrag();
    quickMenuDragInitialized = true;
  }

  initQuickMenuTilt();
}
