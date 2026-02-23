// overlay-main.js - Entry point for the overlay page (overlay.html)
// This page only contains modal markup. No shader, no home screen, no background.
// C# sends a message like { type: "open", modal: "run" | "menu3" | "sysinfo" }
// and this script opens the corresponding modal.
// When the modal closes, it sends "hide" back to C# to hide the overlay window.

import { loadConfig, appConfig } from './config.js';
import { buildProjectUI, initCarousel, initMenuTilt, openMenuModal, closeMenuModal } from './menu.js';
import { initMenu3Elements, openMenu3, closeMenu3, setMenu3SwitcherMode } from './menu3.js';
import { initMenu3RunElements, openMenu3Run, closeMenu3Run } from './menu3run.js';
import { initQuickMenuElements, openQuickMenu, closeQuickMenu } from './quickmenu.js';
import { initModals, closeAbout, closeSystemInfo, getSystemInfoCachedData } from './modals.js';
import { initWeatherStatus, updateHomeScreen, updateTimeDisplay } from './ui-utils.js';
import { initOverlayWidgets, refreshOverlayWidgetSettings, hasVisibleWidgets, isOverlayWidgetsMenuOpen, closeOverlayWidgetsMenu, setOverlayBlurActive, suppressBlurSync } from './overlay-widgets.js';

const uiAccentPalette = {
  white: { rgb: '255, 255, 255' },
  cyan: { rgb: '102, 198, 255' },
  green: { rgb: '124, 255, 158' },
  amber: { rgb: '255, 176, 0' }
};

const OVERLAY_SHOWONLY_KEY = 'overlayShowOnlyActive';
const OVERLAY_DIM_LEVEL_KEY = 'overlayScrimDimLevel';
const OVERLAY_DIM_LEVELS = Object.freeze({
  '0': 0.0,
  '20': 0.2,
  '40': 0.4,
  '60': 0.6,
  '80': 0.8
});

let overlayPinnedOpen = false;
let overlayDimButton = null;
let overlayDimDropdown = null;
let overlayDimDock = null;
function clampOverlayDimAlpha(value) {
  return Math.max(0, Math.min(0.9, value));
}

function getOverlayDimAlphaForLevel(level) {
  return Object.prototype.hasOwnProperty.call(OVERLAY_DIM_LEVELS, level)
    ? OVERLAY_DIM_LEVELS[level]
    : null;
}

function getClosestOverlayDimLevel(alpha) {
  const target = Number.isFinite(alpha) ? alpha : 0.6;
  let bestLevel = '60';
  let bestDiff = Number.POSITIVE_INFINITY;
  Object.entries(OVERLAY_DIM_LEVELS).forEach(([level, value]) => {
    const diff = Math.abs(target - value);
    if (diff < bestDiff) {
      bestDiff = diff;
      bestLevel = level;
    }
  });
  return bestLevel;
}

function readOverlaySettingsSource() {
  let source = null;
  try {
    const savedSettingsStr = localStorage.getItem('developerSettings');
    if (savedSettingsStr) {
      source = JSON.parse(savedSettingsStr);
    }
  } catch {
    source = null;
  }

  if (!source && appConfig?.developerPanelSettings && typeof appConfig.developerPanelSettings === 'object') {
    source = appConfig.developerPanelSettings;
  }

  return source;
}

function readOverlayDimAlpha() {
  let dimAlpha = 0.60;
  const settingsSource = readOverlaySettingsSource();
  const parsedDim = Number.parseFloat(settingsSource?.overlayDimAlpha);
  if (Number.isFinite(parsedDim)) {
    dimAlpha = clampOverlayDimAlpha(parsedDim);
  }
  try {
    const savedLevel = localStorage.getItem(OVERLAY_DIM_LEVEL_KEY);
    const alphaByLevel = getOverlayDimAlphaForLevel(savedLevel || '');
    if (Number.isFinite(alphaByLevel)) {
      dimAlpha = clampOverlayDimAlpha(alphaByLevel);
    }
  } catch {
  }
  return dimAlpha;
}

function applyOverlayDimAlpha(alpha) {
  const clamped = clampOverlayDimAlpha(alpha);
  document.documentElement.style.setProperty('--overlay-scrim-alpha', String(clamped));
  const level = getClosestOverlayDimLevel(clamped);
  if (overlayDimDropdown) {
    overlayDimDropdown.querySelectorAll('.overlay-dimmer-option').forEach((option) => {
      option.classList.toggle('active', option.dataset.dim === level);
    });
  }
}

function persistOverlayDimAlpha(alpha) {
  const clamped = clampOverlayDimAlpha(alpha);
  const level = getClosestOverlayDimLevel(clamped);
  try {
    const raw = localStorage.getItem('developerSettings');
    const settings = raw ? JSON.parse(raw) : {};
    settings.overlayDimAlpha = clamped;
    localStorage.setItem('developerSettings', JSON.stringify(settings));
    localStorage.setItem(OVERLAY_DIM_LEVEL_KEY, level);
  } catch {
  }

  if (appConfig?.developerPanelSettings && typeof appConfig.developerPanelSettings === 'object') {
    appConfig.developerPanelSettings.overlayDimAlpha = clamped;
  }

  applyOverlayDimAlpha(clamped);
}

function initOverlayDimmerControl() {
  overlayDimDock = document.getElementById('overlay-dimmer-dock');
  overlayDimButton = document.getElementById('overlay-dimmer-btn');
  overlayDimDropdown = document.getElementById('overlay-dimmer-dropdown');
  if (!overlayDimDock || !overlayDimButton || !overlayDimDropdown) return;

  const closeDropdown = () => {
    overlayDimDropdown.classList.remove('open');
    overlayDimButton.setAttribute('aria-expanded', 'false');
  };

  const openDropdown = () => {
    overlayDimDropdown.classList.add('open');
    overlayDimButton.setAttribute('aria-expanded', 'true');
  };

  overlayDimButton.addEventListener('click', (e) => {
    e.stopPropagation();
    if (overlayDimDropdown.classList.contains('open')) {
      closeDropdown();
    } else {
      openDropdown();
    }
  });

  overlayDimDropdown.querySelectorAll('.overlay-dimmer-option').forEach((option) => {
    option.addEventListener('click', () => {
      const alpha = getOverlayDimAlphaForLevel(option.dataset.dim || '');
      if (!Number.isFinite(alpha)) return;
      persistOverlayDimAlpha(alpha);
      closeDropdown();
    });
  });

  document.addEventListener('click', (e) => {
    if (!overlayDimDropdown.classList.contains('open')) return;
    if (e.target.closest('#overlay-dimmer-dock')) return;
    closeDropdown();
  });

  document.addEventListener('keydown', (e) => {
    if (e.key !== 'Escape') return;
    if (!overlayDimDropdown.classList.contains('open')) return;
    closeDropdown();
  });

  applyOverlayDimAlpha(readOverlayDimAlpha());
  requestAnimationFrame(placeOverlayDimmerDock);
}

function setShowOnlyScrim(active) {
  const scrim = document.getElementById('overlay-showonly-scrim');
  if (!scrim) return;
  scrim.classList.toggle('active', active === true);
}

function brightenRgb(rgbString, mix = 0.35) {
  const parts = rgbString.split(',').map((value) => Number.parseFloat(value.trim()));
  const [r, g, b] = parts.length === 3 ? parts : [102, 198, 255];
  const clamp = (value) => Math.max(0, Math.min(255, value));
  const bright = [r, g, b].map((value) => clamp(Math.round(value + (255 - value) * mix)));
  return bright.join(', ');
}

async function applyUiAccentFromStorage() {
  try {
    const savedSettingsStr = localStorage.getItem('developerSettings');
    if (savedSettingsStr) {
      const savedSettings = JSON.parse(savedSettingsStr);
      const key = savedSettings?.uiAccentPreset;
      if (key) {
        const palette = uiAccentPalette[key] || uiAccentPalette.cyan;
        document.documentElement.style.setProperty('--ui-accent-rgb', palette.rgb);
        document.documentElement.style.setProperty('--ui-accent-bright-rgb', brightenRgb(palette.rgb));
      }
      applyCardAlphaFromSettings(savedSettings);
      if (key) return;
    }
  } catch {
  }

  if (appConfig?.developerPanelSettings && typeof appConfig.developerPanelSettings === 'object') {
    const key = appConfig.developerPanelSettings?.uiAccentPreset;
    if (key) {
      const palette = uiAccentPalette[key] || uiAccentPalette.cyan;
      document.documentElement.style.setProperty('--ui-accent-rgb', palette.rgb);
      document.documentElement.style.setProperty('--ui-accent-bright-rgb', brightenRgb(palette.rgb));
    }
    applyCardAlphaFromSettings(appConfig.developerPanelSettings);
  }

  // Fallback: resolve accent from currently selected preset.
  await applyUiAccentFromLastPreset();
}

function applyCardAlphaFromSettings(settings) {
  const baseAlpha = Number.isFinite(settings?.cardAlpha) ? settings.cardAlpha : null;
  if (baseAlpha === null) return;
  const clamped = Math.max(0, Math.min(1, baseAlpha));
  const headerAlpha = Math.max(0, Math.min(1, clamped + 0.08));
  document.documentElement.style.setProperty('--card-panel-alpha', String(clamped));
  document.documentElement.style.setProperty('--card-header-alpha', String(headerAlpha));
}

function pxVar(name, fallback = 0) {
  const raw = getComputedStyle(document.documentElement).getPropertyValue(name).trim();
  const parsed = Number.parseFloat(raw);
  return Number.isFinite(parsed) ? parsed : fallback;
}

function resolveOverlayAnchor() {
  const left = pxVar('--overlay-anchor-left', 0);
  const top = pxVar('--overlay-anchor-top', 0);
  const height = pxVar('--overlay-anchor-height', window.innerHeight);
  const widthRaw = pxVar('--overlay-anchor-width', 0);
  const right = pxVar('--overlay-anchor-right', 0);
  let width = widthRaw;
  if (!Number.isFinite(width) || width <= 0) {
    if (Number.isFinite(right) && right > left) {
      width = right - left;
    } else {
      width = window.innerWidth;
    }
  }
  return {
    left,
    top,
    width,
    height
  };
}

function alignOverlayChromeCenter() {
  const anchor = resolveOverlayAnchor();
  const centerX = anchor.left + anchor.width / 2;
  const leftPx = Math.round(centerX);
  const header = document.querySelector('.home-logo-section');
  const statusLine = document.getElementById('status-line');
  const versionInfo = document.getElementById('overlay-version-info');
  [header, statusLine, versionInfo].forEach((el) => {
    if (!el) return;
    el.style.left = `${leftPx}px`;
    el.style.transform = 'translateX(-50%)';
  });
}

function placeOverlayDimmerDock() {
  if (!overlayDimDock) return;

  const anchor = resolveOverlayAnchor();
  const margin = 40;
  const rightNudge = 8;
  const debugGearOffset = pxVar('--debug-gear-offset', 0);
  const dockW = overlayDimDock.offsetWidth || 148;
  const dockH = overlayDimDock.offsetHeight || 44;

  let left = anchor.left + anchor.width - margin - dockW - rightNudge - Math.max(0, debugGearOffset);
  let top = anchor.top + margin;

  left = Math.max(8, Math.min(left, window.innerWidth - dockW - 8));
  top = Math.max(8, Math.min(top, window.innerHeight - dockH - 8));

  overlayDimDock.style.left = `${Math.round(left)}px`;
  overlayDimDock.style.top = `${Math.round(top)}px`;
  overlayDimDock.style.right = 'auto';
}

function applyOverlayChromeSettings() {
  let showStatusLine = false;
  let showStatusElementBoxes = false;
  let showHeader = false;
  let position = 'bottom';
  let dimAlpha = 0.60;
  let settingsSource = null;

  settingsSource = readOverlaySettingsSource();

  if (settingsSource) {
    showStatusLine = settingsSource?.overlayShowStatusLine === true;
    showStatusElementBoxes = settingsSource?.overlayShowStatusElementBoxes === true;
    showHeader = settingsSource?.overlayShowHeader === true;
    position = settingsSource?.overlayPosition === 'top' ? 'top' : 'bottom';
    const parsedDim = Number.parseFloat(settingsSource?.overlayDimAlpha);
    if (Number.isFinite(parsedDim)) {
      dimAlpha = clampOverlayDimAlpha(parsedDim);
    }
  }

  try {
    const savedLevel = localStorage.getItem(OVERLAY_DIM_LEVEL_KEY);
    const alphaByLevel = getOverlayDimAlphaForLevel(savedLevel || '');
    if (Number.isFinite(alphaByLevel)) {
      dimAlpha = clampOverlayDimAlpha(alphaByLevel);
    }
  } catch {
  }

  const statusLine = document.getElementById('status-line');
  const header = document.querySelector('.home-logo-section');
  if (statusLine) statusLine.style.display = showStatusLine ? 'flex' : 'none';
  if (statusLine) statusLine.dataset.statusElementBoxes = showStatusElementBoxes ? 'true' : 'false';
  if (header) header.style.display = showHeader ? 'block' : 'none';
  document.body.dataset.overlayChromePosition = position;
  applyOverlayDimAlpha(dimAlpha);

  // Window switcher panel alpha
  let windowSwitcherAlpha = 0.22;
  if (settingsSource) {
    const parsedWsAlpha = Number.parseFloat(settingsSource?.overlayWindowSwitcherAlpha);
    if (Number.isFinite(parsedWsAlpha)) {
      windowSwitcherAlpha = Math.max(0, Math.min(0.95, parsedWsAlpha));
    }
  }
  document.documentElement.style.setProperty('--window-switcher-alpha', String(windowSwitcherAlpha));

  // Apply explicit positions to avoid CSS specificity collisions.
  if (header) {
    if (position === 'top') {
      header.style.top = '11vh';
      header.style.bottom = '';
    } else {
      header.style.bottom = '12vh';
      header.style.top = '';
    }
  }

  if (statusLine) {
    if (position === 'top') {
      statusLine.style.top = 'calc(11vh + 52px)';
      statusLine.style.bottom = '';
    } else {
      statusLine.style.bottom = '8vh';
      statusLine.style.top = '';
    }
  }

  alignOverlayChromeCenter();
  placeOverlayDimmerDock();
}

async function updateOverlayVersionInfo() {
  const container = document.getElementById('overlay-version-info');
  if (!container) return;

  const osEl = document.getElementById('overlay-version-os');
  const appEl = document.getElementById('overlay-version-app');

  if (appEl) {
    appEl.textContent = appConfig?.version || '--';
  }

  try {
    const data = await getSystemInfoCachedData({ allowStale: true });
    const osText = data?.os || '';
    if (osEl) osEl.textContent = osText || '--';
  } catch {
    if (osEl) osEl.textContent = '--';
  }
}

async function applyUiAccentFromLastPreset() {
  try {
    const lastPreset = localStorage.getItem('lastPreset');
    if (!lastPreset || !Array.isArray(appConfig?.presets)) return;

    const presetEntry = appConfig.presets.find((preset) => (
      preset?.name === lastPreset || preset?.id === lastPreset
    ));
    if (!presetEntry?.file) return;

    const response = await fetch(`${presetEntry.file}?_ts=${Date.now()}`, { cache: 'no-store' });
    if (!response.ok) return;
    const presetData = await response.json();
    const key = presetData?.uiAccentPreset;
    if (!key) return;

    const palette = uiAccentPalette[key] || uiAccentPalette.cyan;
    document.documentElement.style.setProperty('--ui-accent-rgb', palette.rgb);
    document.documentElement.style.setProperty('--ui-accent-bright-rgb', brightenRgb(palette.rgb));
  } catch {
  }
}

function hideOverlay() {
  overlayPinnedOpen = false;
  setShowOnlyScrim(false);
  setOverlayBlurActive(false);
  try {
    sessionStorage.setItem(OVERLAY_SHOWONLY_KEY, 'false');
  } catch {
  }
  if (window.chrome && window.chrome.webview) {
    window.chrome.webview.postMessage('hide');
  }
}

function showOverlayOnly() {
  overlayPinnedOpen = true;
  void applyUiAccentFromStorage();
  applyOverlayChromeSettings();
  refreshOverlayWidgetSettings();
  suppressBlurSync(true);
  closeAllModals();
  hideAllModalsInstant();
  suppressBlurSync(false);
  setShowOnlyScrim(true);
  setOverlayBlurActive(true);
  try {
    sessionStorage.setItem(OVERLAY_SHOWONLY_KEY, 'true');
  } catch {
  }
}

function closeAllModals() {
  closeAbout();
  closeMenuModal();
  closeMenu3();
  closeMenu3Run();
  closeQuickMenu();
  closeSystemInfo();
  closeOverlayWidgetsMenu();
}

function hideAllModalsInstant() {
  const overlays = document.querySelectorAll(
    '.menu-modal-overlay, .about-modal-overlay, .menu3-modal-overlay, .menu3run-modal-overlay, .quickmenu-modal-overlay, .system-modal-overlay'
  );

  overlays.forEach((el) => {
    el.style.transition = 'none';
    el.classList.remove('active', 'closing');
  });

  const wrappers = document.querySelectorAll(
    '.menu-modal-wrapper, .menu3-modal-wrapper, .menu3run-modal-wrapper, .quickmenu-modal-wrapper, .about-modal-wrapper'
  );
  wrappers.forEach((el) => {
    el.classList.remove('follow-mode', 'dragging');
  });

  void document.body.offsetHeight;

  requestAnimationFrame(() => {
    overlays.forEach((el) => {
      el.style.transition = '';
    });
  });
}

function ensureModalFocus(modalName) {
  const selectorSets = {
    run: ['#menu3run-input', '#menu3run-content'],
    menu3: ['#menu3-window-input', '#menu3-content', '.menu3-modal-wrapper'],
    settings: ['#menu-content', '.menu-modal-wrapper'],
    sysinfo: ['#menu-content', '.menu-modal-wrapper'],
    quickmenu: ['#quickmenu-content', '#quickmenu-actions .quickmenu-btn', '.quickmenu-modal-wrapper']
  };

  const selectors = selectorSets[modalName] || ['#menu3run-input', '#quickmenu-content', '#menu-content', '#menu3-content'];

  const isVisible = (el) => {
    if (!el) return false;
    const style = window.getComputedStyle(el);
    if (style.display === 'none' || style.visibility === 'hidden') return false;
    // Check that the parent modal overlay is active
    const overlay = el.closest('.menu3run-modal-overlay, .menu3-modal-overlay, .menu-modal-overlay, .quickmenu-modal-overlay');
    if (overlay && !overlay.classList.contains('active')) return false;
    const rect = el.getBoundingClientRect();
    return rect.width > 0 && rect.height > 0;
  };

  const focusOnce = () => {
    window.focus();
    for (const sel of selectors) {
      const el = document.querySelector(sel);
      if (!isVisible(el)) continue;
      try {
        if (!Number.isInteger(el.tabIndex) || el.tabIndex < 0) {
          el.tabIndex = 0;
        }
      } catch {}
      try {
        el.focus({ preventScroll: true });
        if (typeof el.select === 'function') el.select();
        return true;
      } catch {}
    }
    return false;
  };

  // Light-touch JS focus: the C# host handles the real focus via SendInput.
  // This is just a best-effort fallback that runs once after a short delay.
  requestAnimationFrame(focusOnce);
  setTimeout(focusOnce, 80);
}

function isMenu3WindowModeActive() {
  const modal = document.getElementById('menu3-modal');
  if (!modal?.classList.contains('active')) return false;
  const switcher = document.getElementById('menu3-window-switcher');
  if (!switcher) return false;
  const style = window.getComputedStyle(switcher);
  return style.display !== 'none';
}

function openModal(name) {
  overlayPinnedOpen = false;
  setShowOnlyScrim(false);
  void applyUiAccentFromStorage();
  applyOverlayChromeSettings();
  refreshOverlayWidgetSettings();

  const wasSettingsActive = !!document.getElementById('menu-modal')?.classList.contains('active');
  const wasQuickMenuActive = !!document.getElementById('quickmenu-modal')?.classList.contains('active');
  const wasMenu3Active = !!document.getElementById('menu3-modal')?.classList.contains('active');
  const wasMenu3WindowMode = isMenu3WindowModeActive();

  if (name === 'menu3' && wasMenu3Active) {
    window.focus();
    setOverlayBlurActive(true);
    setMenu3SwitcherMode(!wasMenu3WindowMode);
    ensureModalFocus('menu3');
    return;
  }

  suppressBlurSync(true);
  closeAllModals();
  hideAllModalsInstant();
  suppressBlurSync(false);

  // Force window focus first
  window.focus();

  setOverlayBlurActive(true);

  switch (name) {
    case 'settings':
      openMenuModal({ lockToCursor: true });
      break;
    case 'run':
      openMenu3Run({ lockToCursor: true });
      break;
    case 'menu3':
      openMenu3({ lockToCursor: true, switcherMode: wasMenu3Active ? !wasMenu3WindowMode : false });
      break;
    case 'sysinfo':
      // Alt+tilde opens settings; pressing it again while settings is active opens quick menu.
      if (wasSettingsActive) {
        openQuickMenu({ lockToCursor: true });
        ensureModalFocus('quickmenu');
        return;
      }

      // Pressing shortcut again while quick menu is active toggles back to settings.
      if (wasQuickMenuActive) {
        openMenuModal({ lockToCursor: true });
        ensureModalFocus('settings');
        return;
      }

      openMenuModal({ lockToCursor: true });
      break;
    default:
      console.warn('Unknown modal:', name);
      hideOverlay();
      return;
  }

  ensureModalFocus(name);
}

// Listen for messages from C# host
function initMessageListener() {
  if (window.chrome && window.chrome.webview) {
    window.chrome.webview.addEventListener('message', (e) => {
      const data = e.data;
      if (!data) return;

      // Handle string messages
      if (typeof data === 'string') {
        try {
          const parsed = JSON.parse(data);
          if (parsed.type === 'open' && parsed.modal) {
            openModal(parsed.modal);
          } else if (parsed.type === 'show-only') {
            showOverlayOnly();
          }
        } catch {
          // Not JSON, ignore
        }
        return;
      }

      // Handle object messages
      if (data.type === 'open' && data.modal) {
        openModal(data.modal);
      } else if (data.type === 'show-only') {
        showOverlayOnly();
      }
    });
  }
}

// Intercept all modal close actions to also hide the overlay window
function interceptCloseActions() {
  // When any close button is clicked, also hide the overlay
  document.addEventListener('click', (e) => {
    const closeBtn = e.target.closest('#about-close, #menu-close, #menu3-close, #menu3run-close, #quickmenu-close, #system-close');
    if (closeBtn) {
      const id = closeBtn.id;
      if (id === 'about-close' || id === 'system-close') {
        return;
      }
      setTimeout(hideOverlay, 50);
    }
  });

  // When clicking the empty overlay background (outside modal), close + hide
  // Clicking outside a modal does not close it or the overlay.
  // Use Escape to close modals, or select an item.

  // Escape key: if a modal is in follow/lock mode, first Escape disables that.
  // If not locked, Escape closes the modal and hides the overlay.
  // We use a late (non-capture) listener so the modal's own Escape handler
  // can disable follow mode first.
  document.addEventListener('keydown', (e) => {
    if (e.key !== 'Escape') return;

    const aboutActive = document.getElementById('about-modal')?.classList.contains('active');
    const systemActive = document.getElementById('system-info-modal')?.classList.contains('active');
    if (aboutActive || systemActive) {
      return;
    }

    // If the widgets menu is open, close just that - don't hide the overlay.
    const widgetsMenuActive = document.getElementById('widgets-menu-modal')?.classList.contains('active');
    if (widgetsMenuActive) {
      closeOverlayWidgetsMenu();
      return;
    }

    // Check if any modal wrapper is currently in follow/lock mode.
    // menu3.js and menu3run.js add 'follow-mode' class to the wrapper when locked.
    const followModeActive = document.querySelector('.follow-mode');
    if (followModeActive) {
      // Let the modal's own handler disable follow mode.
      // Don't close or hide -- the user needs a second Escape to dismiss.
      return;
    }

    // No follow mode active -- close everything and hide the overlay window.
    closeAllModals();
    hideOverlay();
  });
}

function interceptLaunchActions() {
  window.addEventListener('appCommandExecuted', (event) => {
    const ok = event?.detail?.ok === true;
    if (!ok) return;

    // Command/app launch should dismiss overlay in normal flow.
    // About/system-info are not command launches, so they are unaffected.
    closeAllModals();
    hideOverlay();
  });
}

// Monitor modal visibility to auto-hide overlay
function initVisibilityMonitor() {
  const observer = new MutationObserver(() => {
    // Check if any modal is active
    const activeModal = document.querySelector('.menu-modal-overlay.active, .about-modal-overlay.active, .menu3-modal-overlay.active, .menu3run-modal-overlay.active, .quickmenu-modal-overlay.active, .system-modal-overlay.active');
    if (!activeModal && !isOverlayWidgetsMenuOpen() && !overlayPinnedOpen) {
      // Small delay to ensure we don't hide mid-transition if another modal is opening
      setTimeout(() => {
        const stillActive = document.querySelector('.menu-modal-overlay.active, .about-modal-overlay.active, .menu3-modal-overlay.active, .menu3run-modal-overlay.active, .quickmenu-modal-overlay.active, .system-modal-overlay.active');
        if (!stillActive && !isOverlayWidgetsMenuOpen() && !hasVisibleWidgets() && !overlayPinnedOpen) {
          hideOverlay();
        }
      }, 50);
    }
  });

  const overlays = document.querySelectorAll('.menu-modal-overlay, .about-modal-overlay, .menu3-modal-overlay, .menu3run-modal-overlay, .quickmenu-modal-overlay, .system-modal-overlay');
  overlays.forEach(el => {
    observer.observe(el, { attributes: true, attributeFilter: ['class'] });
  });
}

async function init() {
  await loadConfig();
  await applyUiAccentFromStorage();
  applyOverlayChromeSettings();
  initOverlayDimmerControl();

  updateHomeScreen(appConfig);
  updateTimeDisplay();
  setInterval(updateTimeDisplay, 1000);
  initWeatherStatus(appConfig);
  void updateOverlayVersionInfo();

  const aboutText = document.getElementById('about-text');
  if (aboutText) {
    aboutText.textContent = appConfig.about || 'Creative development lab exploring the intersection of design and technology.';
  }

  // Initialize modal DOM bindings
  initModals();
  buildProjectUI();
  initCarousel();
  initMenuTilt();
  initMenu3Elements();
  initMenu3RunElements();
  initQuickMenuElements();
  initOverlayWidgets();
  refreshOverlayWidgetSettings();

  try {
    if (sessionStorage.getItem(OVERLAY_SHOWONLY_KEY) === 'true') {
      showOverlayOnly();
    }
  } catch {
  }

  // Set up communication with C# host
  initMessageListener();

  // Intercept close actions to hide the overlay window
  interceptCloseActions();
  interceptLaunchActions();
  
  // Monitor visibility to catch programmatic closes
  initVisibilityMonitor();

  window.addEventListener('resize', alignOverlayChromeCenter);
  window.addEventListener('resize', placeOverlayDimmerDock);
  window.addEventListener('overlayViewportChanged', alignOverlayChromeCenter);
  window.addEventListener('overlayViewportChanged', placeOverlayDimmerDock);
}

init().catch(console.error);
