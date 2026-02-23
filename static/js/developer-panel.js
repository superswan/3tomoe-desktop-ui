// js/developer-panel.js - Tweakpane Developer Panel
import { GUI } from 'https://cdn.jsdelivr.net/npm/lil-gui@0.19.0/dist/lil-gui.esm.js';
import { appConfig, availablePresets, updateAvailablePresets } from './config.js';
import { showToast, loadWeatherIconMap, setWeatherIcon, updateTimeDisplay, setLogOverlayVisible } from './ui-utils.js';

let gui = null;
let tweakParams = {};
let uniforms, mesh, materialProcedural, materialTexture;
let presetController = null;
let presetState = { preset: '' };
let isSyncingPreset = false;
let persistDevSettingsTimer = null;
let devPanelObserver = null;
const uiAccentPalette = {
  white: { rgb: '255, 255, 255' },
  cyan: { rgb: '102, 198, 255' },
  green: { rgb: '124, 255, 158' },
  amber: { rgb: '255, 176, 0' }
};

function brightenRgb(rgbString, mix = 0.35) {
  const parts = rgbString.split(',').map((value) => Number.parseFloat(value.trim()));
  const [r, g, b] = parts.length === 3 ? parts : [102, 198, 255];
  const clamp = (value) => Math.max(0, Math.min(255, value));
  const bright = [r, g, b].map((value) => clamp(Math.round(value + (255 - value) * mix)));
  return bright.join(', ');
}

function updateGuiDisplays(rootGui) {
  if (!rootGui) return;
  if (rootGui.controllers) {
    rootGui.controllers.forEach((controller) => controller.updateDisplay());
  }
  if (rootGui.folders) {
    Object.values(rootGui.folders).forEach((folder) => updateGuiDisplays(folder));
  }
}

function syncDevPanelOpenState() {
  if (!gui?.domElement) return;
  const isClosed = gui.domElement.classList.contains('closed');
  const isOpen = !isClosed;
  window.__devPanelOpen = isOpen;
  try {
    localStorage.setItem('devPanelOpen', isOpen ? 'true' : 'false');
  } catch (e) {
  }
}

function rgbToHsl(r, g, b) {
  r /= 255; g /= 255; b /= 255;
  const max = Math.max(r, g, b), min = Math.min(r, g, b);
  let h, s, l = (max + min) / 2;
  if (max === min) {
    h = s = 0;
  } else {
    const d = max - min;
    s = l > 0.5 ? d / (2 - max - min) : d / (max + min);
    switch (max) {
      case r: h = ((g - b) / d + (g < b ? 6 : 0)) / 6; break;
      case g: h = ((b - r) / d + 2) / 6; break;
      case b: h = ((r - g) / d + 4) / 6; break;
    }
  }
  return { h: h * 360, s: s * 100, l: l * 100 };
}

function hslToRgb(h, s, l) {
  const hue = (h % 360 + 360) % 360;
  const sat = Math.max(0, Math.min(100, s)) / 100;
  const light = Math.max(0, Math.min(100, l)) / 100;
  if (sat === 0) {
    const gray = Math.round(light * 255);
    return { r: gray, g: gray, b: gray };
  }
  const q = light < 0.5 ? light * (1 + sat) : light + sat - light * sat;
  const p = 2 * light - q;
  const toRgb = (t) => {
    let tt = t;
    if (tt < 0) tt += 1;
    if (tt > 1) tt -= 1;
    if (tt < 1 / 6) return p + (q - p) * 6 * tt;
    if (tt < 1 / 2) return q;
    if (tt < 2 / 3) return p + (q - p) * (2 / 3 - tt) * 6;
    return p;
  };
  const r = Math.round(toRgb(hue / 360 + 1 / 3) * 255);
  const g = Math.round(toRgb(hue / 360) * 255);
  const b = Math.round(toRgb(hue / 360 - 1 / 3) * 255);
  return { r, g, b };
}

function hexToRgb(hex) {
  const value = hex.replace('#', '').trim();
  if (value.length === 3) {
    const r = parseInt(value[0] + value[0], 16);
    const g = parseInt(value[1] + value[1], 16);
    const b = parseInt(value[2] + value[2], 16);
    return { r, g, b };
  }
  if (value.length !== 6) return { r: 118, g: 166, b: 212 };
  return {
    r: parseInt(value.slice(0, 2), 16),
    g: parseInt(value.slice(2, 4), 16),
    b: parseInt(value.slice(4, 6), 16)
  };
}

function rgbToHex(r, g, b) {
  const clamp = (value) => Math.max(0, Math.min(255, Math.round(value)));
  return `#${clamp(r).toString(16).padStart(2, '0')}${clamp(g).toString(16).padStart(2, '0')}${clamp(b).toString(16).padStart(2, '0')}`;
}

function deriveSenseGradient(midHex) {
  const { r, g, b } = hexToRgb(midHex || '#76a6d4');
  const { h, s, l } = rgbToHsl(r, g, b);
  const top = hslToRgb(h, Math.min(100, s + 10), Math.min(95, l + 24));
  const bottom = hslToRgb(h, Math.max(0, s - 8), Math.max(8, l - 32));
  return {
    mid: rgbToHex(r, g, b),
    top: rgbToHex(top.r, top.g, top.b),
    bottom: rgbToHex(bottom.r, bottom.g, bottom.b)
  };
}

function updateLauncherIconFilter(rgbString) {
  const launcherIcon = document.getElementById('launcher-icon');
  if (launcherIcon) {
    launcherIcon.style.filter = '';
  }
}

function applyUiAccentPreset(presetKey) {
  const key = uiAccentPalette[presetKey] ? presetKey : 'cyan';
  if (tweakParams.uiAccentPreset !== key) {
    tweakParams.uiAccentPreset = key;
  }
  const { rgb } = uiAccentPalette[key];
  document.documentElement.style.setProperty('--ui-accent-rgb', rgb);
  document.documentElement.style.setProperty('--ui-accent-bright-rgb', brightenRgb(rgb));
  updateLauncherIconFilter(rgb);
}

function applyCardsVisibility() {
  const mainContainer = document.querySelector('.main-container');
  if (mainContainer) mainContainer.style.display = tweakParams.cardsVisible ? 'flex' : 'none';
}

function applyStatusLineDecor() {
  const statusLine = document.querySelector('.status-line');
  if (!statusLine) return;
  statusLine.dataset.statusOpaque = tweakParams.statusLineOpaque ? 'true' : 'false';
  statusLine.dataset.statusBorders = tweakParams.statusLineBorders ? 'true' : 'false';
  statusLine.dataset.statusCorners = tweakParams.statusLineCorners ? 'true' : 'false';
  statusLine.dataset.statusElementBoxes = tweakParams.statusLineElementBoxes ? 'true' : 'false';
  statusLine.dataset.statusElementBg = tweakParams.statusLineElementBg ? 'true' : 'false';
  statusLine.style.setProperty('--status-bg-alpha', String(tweakParams.statusLineAlpha ?? 0.33));
  statusLine.style.setProperty('--status-element-bg-alpha', String(tweakParams.statusLineElementBgAlpha ?? 0.33));
}

function applyCardAlpha() {
  const baseAlpha = Number.isFinite(tweakParams.cardAlpha) ? tweakParams.cardAlpha : 0.10;
  const headerAlpha = Math.max(0, Math.min(1, baseAlpha + 0.08));
  document.documentElement.style.setProperty('--card-panel-alpha', String(Math.max(0, Math.min(1, baseAlpha))));
  document.documentElement.style.setProperty('--card-header-alpha', String(headerAlpha));
}

function applyBackgroundBlur() {
  const mediaContainer = document.getElementById('regular-bg-media');
  if (!mediaContainer) return;
  const blurValue = Number.isFinite(tweakParams.backgroundBlur) ? tweakParams.backgroundBlur : 0;
  mediaContainer.querySelectorAll('img, video').forEach((node) => {
    node.style.filter = `blur(${blurValue}px)`;
  });
  if (appConfig.background) {
    appConfig.background.blur = blurValue;
  }
}

function applyHeaderPosition() {
  const position = tweakParams.headerPosition || appConfig.background?.headerPosition || 'low';
  document.body.setAttribute('data-header-position', position);
  if (appConfig.background) {
    appConfig.background.headerPosition = position;
  }
}

function applyHideModeVisibility({ showStatusLine, showHeader }) {
  document.body.dataset.showStatusLine = showStatusLine ? 'true' : 'false';
  document.body.dataset.showHeader = showHeader ? 'true' : 'false';
}

// Listen for preset updates from other sources
window.addEventListener('presetListUpdated', () => {
  if (presetController) {
    const presetNames = Object.keys(availablePresets);
    presetController.options(presetNames);
  }
});

const DEV_SETTINGS_KEY = 'developerSettings';

function loadDeveloperSettings() {
  let parsed = null;
  try {
    const saved = localStorage.getItem(DEV_SETTINGS_KEY);
    parsed = saved ? JSON.parse(saved) : null;
  } catch (e) {
    parsed = null;
  }
  if (parsed && typeof parsed === 'object') {
    return parsed;
  }
  const fromConfig = appConfig?.developerPanelSettings;
  return fromConfig && typeof fromConfig === 'object' ? fromConfig : null;
}

function saveDeveloperSettings(settings) {
  try {
    // Only save UI-related settings, not shader settings
    const base = loadDeveloperSettings() || {};
    const uiSettings = { ...base };
    const source = settings || {};
    const assign = (key, value) => {
      if (value !== undefined) uiSettings[key] = value;
    };
    assign('statusLineOpaque', source.statusLineOpaque);
    assign('statusLineBorders', source.statusLineBorders);
    assign('statusLineCorners', source.statusLineCorners);
    assign('statusLineElementBoxes', source.statusLineElementBoxes);
    assign('statusLineElementBg', source.statusLineElementBg);
    assign('statusLineAlpha', source.statusLineAlpha);
    assign('statusLineElementBgAlpha', source.statusLineElementBgAlpha);
    assign('backgroundBlur', source.backgroundBlur);
    assign('headerPosition', source.headerPosition);
    assign('cardAlpha', source.cardAlpha);
    assign('cardsVisible', source.cardsVisible);
    assign('uiAccentPreset', source.uiAccentPreset);
    assign('showHomeBox', source.showHomeBox);
    assign('hideHomeBox', source.hideHomeBox);
    assign('showStatusLine', source.showStatusLine);
    assign('showHeader', source.showHeader);
    assign('hideShowStatusLine', source.hideShowStatusLine);
    assign('hideShowHeader', source.hideShowHeader);
    assign('showVersionInfo', source.showVersionInfo);
    assign('showTimeZone', source.showTimeZone);
    assign('showLogs', source.showLogs);
    assign('overlayShowStatusLine', source.overlayShowStatusLine);
    assign('overlayShowStatusElementBoxes', source.overlayShowStatusElementBoxes);
    assign('overlayShowHeader', source.overlayShowHeader);
    assign('overlayPosition', source.overlayPosition);
    assign('overlayDimAlpha', source.overlayDimAlpha);
    assign('overlayRunAutocompleteIconPosition', source.overlayRunAutocompleteIconPosition);
    assign('overlayWidgetShowTopTable', source.overlayWidgetShowTopTable);
    assign('overlayWidgetMatchAlpha', source.overlayWidgetMatchAlpha);
    assign('overlayWidgetAlpha', source.overlayWidgetAlpha);
    assign('overlayWidgetAlphaColor', source.overlayWidgetAlphaColor);
    assign('overlayWidgetTopAlpha', source.overlayWidgetTopAlpha);
    assign('overlayWidgetFetchAlpha', source.overlayWidgetFetchAlpha);
    assign('overlay3fetchFontSize', source.overlay3fetchFontSize);
    assign('overlay3fetchFontFamily', source.overlay3fetchFontFamily);
    assign('overlay3fetchBoldLabels', source.overlay3fetchBoldLabels);
    assign('overlay3fetchBoldHeaders', source.overlay3fetchBoldHeaders);
    assign('overlay3fetchLogoSize', source.overlay3fetchLogoSize);
    assign('overlay3topUsePxPlus', source.overlay3topUsePxPlus);
    assign('overlay3topBigLabels', source.overlay3topBigLabels);
    assign('overlay3topPixelBars', source.overlay3topPixelBars);
    assign('overlay3topPixelBarsFollowAccent', source.overlay3topPixelBarsFollowAccent);
    assign('overlay3topPixelSteps', source.overlay3topPixelSteps);
    assign('overlay3topPixelColorA', source.overlay3topPixelColorA);
    assign('overlay3topPixelColorB', source.overlay3topPixelColorB);
    assign('overlay3topRefreshMs', source.overlay3topRefreshMs);
    assign('overlay3topShowAllProcesses', source.overlay3topShowAllProcesses);
    assign('overlay3topProcessLimit', source.overlay3topProcessLimit);
    assign('overlaySenseBoxAlpha', source.overlaySenseBoxAlpha);
    assign('overlaySenseGradientTop', source.overlaySenseGradientTop);
    assign('overlaySenseGradientMid', source.overlaySenseGradientMid);
    assign('overlaySenseGradientBottom', source.overlaySenseGradientBottom);
    assign('overlaySenseDisableGlow', source.overlaySenseDisableGlow);
    assign('overlaySenseDisableGradient', source.overlaySenseDisableGradient);
    assign('overlaySenseForecastOpaque', source.overlaySenseForecastOpaque);
    assign('overlaySenseDisableUnderlay', source.overlaySenseDisableUnderlay);
    assign('overlayImageWidgetBorders', source.overlayImageWidgetBorders);
    assign('overlayImageWidgetCorners', source.overlayImageWidgetCorners);
    assign('overlayBlurAmount', source.overlayBlurAmount);
    assign('overlayWindowSwitcherAlpha', source.overlayWindowSwitcherAlpha);
    localStorage.setItem(DEV_SETTINGS_KEY, JSON.stringify(uiSettings));
    if (appConfig) {
      appConfig.developerPanelSettings = uiSettings;
    }
    if (persistDevSettingsTimer) {
      clearTimeout(persistDevSettingsTimer);
    }
    persistDevSettingsTimer = setTimeout(async () => {
      try {
        await fetch('/api/config/site', {
          method: 'PATCH',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({ developerPanelSettings: uiSettings })
        });
      } catch (e) {
      }
    }, 650);
  } catch (e) {
    console.error('Failed to save developer settings:', e);
  }
}

function resolvePresetName(savedPreset) {
  const presetNames = Object.keys(availablePresets);
  if (savedPreset && presetNames.includes(savedPreset)) {
    return savedPreset;
  }
  const defaultPresetConfig = appConfig.presets?.find((preset) => (
    preset.id === appConfig.defaultPreset || preset.name === appConfig.defaultPreset
  ));
  if (defaultPresetConfig && presetNames.includes(defaultPresetConfig.name)) {
    return defaultPresetConfig.name;
  }
  if (appConfig.defaultPreset && presetNames.includes(appConfig.defaultPreset)) {
    return appConfig.defaultPreset;
  }
  return presetNames[0] || savedPreset || 'Default';
}

export function initDeveloperPanel(shaderRefs) {
  if (!appConfig.devMode) return;
  
  uniforms = shaderRefs.uniforms;
  mesh = shaderRefs.mesh;
  materialProcedural = shaderRefs.materialProcedural;
  materialTexture = shaderRefs.materialTexture;
  
  // Load only UI settings - shader settings come from presets
  const savedSettings = loadDeveloperSettings();
  if (!localStorage.getItem(DEV_SETTINGS_KEY) && savedSettings) {
    try {
      localStorage.setItem(DEV_SETTINGS_KEY, JSON.stringify(savedSettings));
    } catch (e) {
    }
  }
  if (savedSettings && typeof savedSettings === 'object') {
    const seedFlag = (key, value) => {
      if (value === undefined || value === null) return;
      if (localStorage.getItem(key) !== null) return;
      localStorage.setItem(key, value ? 'true' : 'false');
    };
    seedFlag('devShowHomeBox', savedSettings.showHomeBox);
    seedFlag('devHideHomeBox', savedSettings.hideHomeBox);
    seedFlag('devShowStatusLine', savedSettings.showStatusLine);
    seedFlag('devShowHeader', savedSettings.showHeader);
    seedFlag('devHideShowStatusLine', savedSettings.hideShowStatusLine);
    seedFlag('devHideShowHeader', savedSettings.hideShowHeader);
    seedFlag('devShowVersionInfo', savedSettings.showVersionInfo);
    seedFlag('showTimeZone', savedSettings.showTimeZone);
    seedFlag('showLogs', savedSettings.showLogs);
  }
  const senseGradientMid = typeof savedSettings?.overlaySenseGradientMid === 'string'
    ? savedSettings.overlaySenseGradientMid
    : '#76a6d4';
  const derivedSense = deriveSenseGradient(senseGradientMid);
  tweakParams = {
    bgColor: '#261c38',
    bgDarken: 0.55,
    gradStrength: 0.5,
    waveMix: 0.7,
    waveContrast: 0.5,
    waveTint: '#bfb3d9',
    waveBoost: 0.28,
    dustEnabled: true,
    dustAmount: 0.12,
    daveHoskins: false,
    cardsVisible: savedSettings?.cardsVisible ?? true,
    uiAccentPreset: savedSettings?.uiAccentPreset ?? 'cyan',
    cardAlpha: Number.isFinite(savedSettings?.cardAlpha)
      ? Math.max(0, Math.min(0.6, savedSettings.cardAlpha))
      : 0.10,
    statusLineOpaque: savedSettings?.statusLineOpaque === true,
    statusLineBorders: savedSettings?.statusLineBorders === true,
    statusLineCorners: savedSettings?.statusLineCorners === true,
    statusLineElementBoxes: savedSettings?.statusLineElementBoxes === true,
    statusLineElementBg: savedSettings?.statusLineElementBg === true,
    statusLineAlpha: Number.isFinite(savedSettings?.statusLineAlpha)
      ? Math.max(0.05, Math.min(1, savedSettings.statusLineAlpha))
      : 0.33,
    statusLineElementBgAlpha: Number.isFinite(savedSettings?.statusLineElementBgAlpha)
      ? Math.max(0.05, Math.min(1, savedSettings.statusLineElementBgAlpha))
      : 0.33,
    backgroundBlur: Number.isFinite(savedSettings?.backgroundBlur)
      ? Math.max(0, Math.min(16, savedSettings.backgroundBlur))
      : (Number.isFinite(appConfig.background?.blur) ? appConfig.background.blur : 0),
    headerPosition: savedSettings?.headerPosition || appConfig.background?.headerPosition || 'low',
    overlayShowStatusLine: savedSettings?.overlayShowStatusLine === true,
    overlayShowStatusElementBoxes: savedSettings?.overlayShowStatusElementBoxes === true,
    overlayShowHeader: savedSettings?.overlayShowHeader === true,
    overlayPosition: savedSettings?.overlayPosition === 'top' ? 'top' : 'bottom',
    overlayDimAlpha: Number.isFinite(savedSettings?.overlayDimAlpha)
      ? Math.max(0, Math.min(0.9, savedSettings.overlayDimAlpha))
      : 0.60,
    overlayRunAutocompleteIconPosition: (savedSettings?.overlayRunAutocompleteIconPosition === 'bottom' || savedSettings?.overlayRunAutocompleteIconPosition === 'right')
      ? savedSettings.overlayRunAutocompleteIconPosition
      : 'top',
    overlayWidgetShowTopTable: savedSettings?.overlayWidgetShowTopTable === true,
    overlayWidgetMatchAlpha: savedSettings?.overlayWidgetMatchAlpha === true,
    overlayWidgetAlpha: Number.isFinite(savedSettings?.overlayWidgetAlpha)
      ? Math.max(0, Math.min(0.95, savedSettings.overlayWidgetAlpha))
      : 0.24,
    overlayWidgetAlphaColor: typeof savedSettings?.overlayWidgetAlphaColor === 'string'
      ? savedSettings.overlayWidgetAlphaColor
      : 'card',
    overlayWidgetTopAlpha: Number.isFinite(savedSettings?.overlayWidgetTopAlpha)
      ? Math.max(0, Math.min(0.95, savedSettings.overlayWidgetTopAlpha))
      : 0.24,
    overlayWidgetFetchAlpha: Number.isFinite(savedSettings?.overlayWidgetFetchAlpha)
      ? Math.max(0, Math.min(0.95, savedSettings.overlayWidgetFetchAlpha))
      : 0.00,
    overlayImageWidgetBorders: savedSettings?.overlayImageWidgetBorders !== false,
    overlayImageWidgetCorners: savedSettings?.overlayImageWidgetCorners !== false,
    overlay3fetchFontSize: Number.isFinite(savedSettings?.overlay3fetchFontSize)
      ? Math.max(8, Math.min(20, savedSettings.overlay3fetchFontSize))
      : 12,
    overlay3fetchFontFamily: ['default', 'pxplus', 'helvetica'].includes(savedSettings?.overlay3fetchFontFamily)
      ? savedSettings.overlay3fetchFontFamily
      : 'default',
    overlay3fetchBoldLabels: savedSettings?.overlay3fetchBoldLabels !== false,
    overlay3fetchBoldHeaders: savedSettings?.overlay3fetchBoldHeaders !== false,
    overlay3fetchLogoSize: Number.isFinite(savedSettings?.overlay3fetchLogoSize)
      ? Math.max(72, Math.min(220, savedSettings.overlay3fetchLogoSize))
      : 112,
    overlay3topUsePxPlus: savedSettings?.overlay3topUsePxPlus === true,
    overlay3topBigLabels: savedSettings?.overlay3topBigLabels === true,
    overlay3topPixelBars: savedSettings?.overlay3topPixelBars === true,
    overlay3topPixelBarsFollowAccent: savedSettings?.overlay3topPixelBarsFollowAccent !== false,
    overlay3topPixelSteps: Number.isFinite(savedSettings?.overlay3topPixelSteps)
      ? Math.max(4, Math.min(24, savedSettings.overlay3topPixelSteps))
      : 14,
    overlay3topPixelColorA: typeof savedSettings?.overlay3topPixelColorA === 'string' ? savedSettings.overlay3topPixelColorA : '#14235a',
    overlay3topPixelColorB: typeof savedSettings?.overlay3topPixelColorB === 'string' ? savedSettings.overlay3topPixelColorB : '#dc50a0',
    overlay3topRefreshMs: Number.isFinite(savedSettings?.overlay3topRefreshMs)
      ? Math.max(1000, Math.min(15000, savedSettings.overlay3topRefreshMs))
      : 3000,
    overlay3topShowAllProcesses: savedSettings?.overlay3topShowAllProcesses !== false,
    overlay3topProcessLimit: Number.isFinite(savedSettings?.overlay3topProcessLimit)
      ? Math.max(1, Math.min(5000, savedSettings.overlay3topProcessLimit))
      : 240,
    overlaySenseBoxAlpha: Number.isFinite(savedSettings?.overlaySenseBoxAlpha)
      ? Math.max(0, Math.min(0.95, savedSettings.overlaySenseBoxAlpha))
      : 0.24,
    overlaySenseGradientTop: derivedSense.top,
    overlaySenseGradientMid: derivedSense.mid,
    overlaySenseGradientBottom: derivedSense.bottom,
    overlaySenseDisableGlow: savedSettings?.overlaySenseDisableGlow === true,
    overlaySenseDisableGradient: savedSettings?.overlaySenseDisableGradient === true,
    overlaySenseForecastOpaque: savedSettings?.overlaySenseForecastOpaque === true,
    overlaySenseDisableUnderlay: savedSettings?.overlaySenseDisableUnderlay === true,
    overlayBlurAmount: Number.isFinite(savedSettings?.overlayBlurAmount)
      ? Math.max(0, Math.min(30, savedSettings.overlayBlurAmount))
      : 10,
    overlayWindowSwitcherAlpha: Number.isFinite(savedSettings?.overlayWindowSwitcherAlpha)
      ? Math.max(0, Math.min(0.95, savedSettings.overlayWindowSwitcherAlpha))
      : 0.22
  };

  applyUiAccentPreset(tweakParams.uiAccentPreset);
  
  // Apply UI visibility settings from localStorage
  const showHomeBox = localStorage.getItem('devShowHomeBox') !== 'false';
  const showStatusLine = localStorage.getItem('devShowStatusLine') !== 'false';
  const showHeader = localStorage.getItem('devShowHeader') !== 'false';
  const hideShowStatusLine = localStorage.getItem('devHideShowStatusLine') !== 'false';
  const hideShowHeader = localStorage.getItem('devHideShowHeader') !== 'false';
  
  const homeBox = document.querySelector('.home-container');
  const statusLine = document.querySelector('.status-line');
  const header = document.querySelector('.home-logo-section');
  
  if (homeBox) homeBox.style.display = showHomeBox ? 'flex' : 'none';
  if (statusLine) statusLine.style.display = showStatusLine ? 'flex' : 'none';
  if (header) header.style.display = showHeader ? 'block' : 'none';
  applyHideModeVisibility({ showStatusLine: hideShowStatusLine, showHeader: hideShowHeader });
  
  // Apply cards visibility
  applyCardsVisibility();
  applyStatusLineDecor();
  applyCardAlpha();
  applyBackgroundBlur();
  applyHeaderPosition();
  
  const isMobile = window.matchMedia('(max-width: 720px)').matches;
  const guiWidth = isMobile ? 240 : 300;
  
  gui = new GUI({ title: 'Developer', container: document.body, width: guiWidth });
  gui.domElement.style.position = 'fixed';
  gui.domElement.style.top = '10px';
  gui.domElement.style.left = '10px';
  gui.domElement.style.zIndex = '1000';
  gui.close();
  syncDevPanelOpenState();
  if (devPanelObserver) {
    devPanelObserver.disconnect();
  }
  devPanelObserver = new MutationObserver(() => syncDevPanelOpenState());
  devPanelObserver.observe(gui.domElement, { attributes: true, attributeFilter: ['class'] });
  gui.domElement.addEventListener('click', () => {
    requestAnimationFrame(syncDevPanelOpenState);
  });
  
  // Shader controls
  const shaderFolder = gui.addFolder('Shader');
  const bgFolder = shaderFolder.addFolder('  - Background');
  bgFolder.addColor(tweakParams, 'bgColor').name('Base Color').onChange(v => {
    uniforms.uBgColor.value.set(parseInt(v.slice(1,3),16)/255, parseInt(v.slice(3,5),16)/255, parseInt(v.slice(5,7),16)/255);
  });
  bgFolder.add(tweakParams, 'bgDarken', 0.3, 1.2).name('Brightness').onChange(v => {
    uniforms.uBgDarken.value = v;
  });
  bgFolder.add(tweakParams, 'gradStrength', 0, 1).name('Depth').onChange(v => {
    uniforms.uGradTilt.value.set(0.04 * v, 0.02 * v, 0.06 * v);
  });
  
  // Waves folder
  const waveFolder = shaderFolder.addFolder('  - Waves');
  waveFolder.add(tweakParams, 'waveMix', 0, 1).name('Intensity').onChange(v => {
    uniforms.uWaveMix.value = v;
  });
  waveFolder.add(tweakParams, 'waveContrast', 0, 1).name('Contrast').onChange(v => {
    const lo = 0.02;
    const hi = 0.40 * (1 - v) + 0.12 * v;
    uniforms.uWaveBoost.value.set(lo, hi);
  });
  waveFolder.addColor(tweakParams, 'waveTint').name('Tint').onChange(v => {
    uniforms.uWaveTint.value.set(parseInt(v.slice(1,3),16)/255, parseInt(v.slice(3,5),16)/255, parseInt(v.slice(5,7),16)/255);
  });
  
  // Dust folder
  const dustFolder = shaderFolder.addFolder('  - Dust');
  dustFolder.add(tweakParams, 'dustEnabled').name('Enabled').onChange(v => {
    uniforms.uDustOn.value = v ? 1.0 : 0.0;
  });
  dustFolder.add(tweakParams, 'dustAmount', 0, 0.5).name('Amount').onChange(v => {
    uniforms.uDustAmt.value = v;
  });

  const imageFolder = gui.addFolder('Image Background');
  imageFolder.add(tweakParams, 'backgroundBlur', 0, 16).name('Blur').onChange(() => {
    applyBackgroundBlur();
    saveDeveloperSettings(tweakParams);
  });
  imageFolder.add(tweakParams, 'headerPosition', {
    Low: 'low',
    Medium: 'med',
    High: 'high'
  }).name('Header/Status Position').onChange(() => {
    applyHeaderPosition();
    saveDeveloperSettings(tweakParams);
  });
  
  // UI folder
  const uiFolder = gui.addFolder('UI');
  uiFolder.add(tweakParams, 'uiAccentPreset', {
    White: 'white',
    Cyan: 'cyan',
    'Green (Terminal)': 'green',
    Amber: 'amber'
  }).name('UI Accent').onChange((value) => {
    applyUiAccentPreset(value);
    saveDeveloperSettings(tweakParams);
  });
  uiFolder.add(tweakParams, 'cardsVisible').name('Show Cards').onChange(() => {
    applyCardsVisibility();
    saveDeveloperSettings(tweakParams);
  });
  uiFolder.add(tweakParams, 'cardAlpha', 0.02, 0.5, 0.01).name('Card Alpha').onChange(() => {
    applyCardAlpha();
    saveDeveloperSettings(tweakParams);
  });
  uiFolder.add(tweakParams, 'statusLineOpaque').name('Status Opaque BG').onChange(() => {
    applyStatusLineDecor();
    saveDeveloperSettings(tweakParams);
  });
  uiFolder.add(tweakParams, 'statusLineAlpha', 0.05, 1).name('Status BG Alpha').onChange(() => {
    applyStatusLineDecor();
    saveDeveloperSettings(tweakParams);
  });
  uiFolder.add(tweakParams, 'statusLineElementBoxes').name('Status Element Boxes').onChange(() => {
    applyStatusLineDecor();
    saveDeveloperSettings(tweakParams);
  });
  uiFolder.add(tweakParams, 'statusLineElementBg').name('Status Element BG').onChange(() => {
    applyStatusLineDecor();
    saveDeveloperSettings(tweakParams);
  });
  uiFolder.add(tweakParams, 'statusLineElementBgAlpha', 0.05, 1).name('Status Element BG Alpha').onChange(() => {
    applyStatusLineDecor();
    saveDeveloperSettings(tweakParams);
  });
  uiFolder.add(tweakParams, 'statusLineBorders').name('Status Borders').onChange(() => {
    applyStatusLineDecor();
    saveDeveloperSettings(tweakParams);
  });
  uiFolder.add(tweakParams, 'statusLineCorners').name('Status Corners').onChange(() => {
    applyStatusLineDecor();
    saveDeveloperSettings(tweakParams);
  });
  
  // Load saved visibility states
  const savedShowHomeBox = localStorage.getItem('devShowHomeBox') !== 'false';
  const savedShowStatusLine = localStorage.getItem('devShowStatusLine') !== 'false';
  const savedShowHeader = localStorage.getItem('devShowHeader') !== 'false';
  const savedHideShowStatusLine = localStorage.getItem('devHideShowStatusLine') !== 'false';
  const savedHideShowHeader = localStorage.getItem('devHideShowHeader') !== 'false';
  const savedHideHomeBox = localStorage.getItem('devHideHomeBox') === 'true';
  const savedShowVersionInfo = localStorage.getItem('devShowVersionInfo') === 'true';
  
  const homeVisibility = {
    showHomeBox: savedShowHomeBox,
    hideHomeBox: savedHideHomeBox,
    showStatusLine: savedShowStatusLine,
    showHeader: savedShowHeader
  };
  const persistVisibilitySettings = () => {
    saveDeveloperSettings({
      ...tweakParams,
      showHomeBox: homeVisibility.showHomeBox,
      hideHomeBox: homeVisibility.hideHomeBox,
      showStatusLine: homeVisibility.showStatusLine,
      showHeader: homeVisibility.showHeader
    });
  };
  uiFolder.add(homeVisibility, 'showHomeBox').name('Show Home Box').onChange(v => {
    const homeBox = document.querySelector('.home-container');
    if (homeBox) homeBox.style.display = v ? 'flex' : 'none';
    localStorage.setItem('devShowHomeBox', v ? 'true' : 'false');
    persistVisibilitySettings();
  });
  uiFolder.add(homeVisibility, 'hideHomeBox').name('Hide Home Box').onChange(v => {
    const homeBox = document.querySelector('.home-container');
    if (homeBox) homeBox.style.visibility = v ? 'hidden' : 'visible';
    localStorage.setItem('devHideHomeBox', v ? 'true' : 'false');
    persistVisibilitySettings();
  });
  uiFolder.add(homeVisibility, 'showStatusLine').name('Show Status Line').onChange(v => {
    const statusLine = document.querySelector('.status-line');
    if (statusLine) statusLine.style.display = v ? 'flex' : 'none';
    localStorage.setItem('devShowStatusLine', v ? 'true' : 'false');
    persistVisibilitySettings();
  });
  uiFolder.add(homeVisibility, 'showHeader').name('Show Header').onChange(v => {
    const header = document.querySelector('.home-logo-section');
    if (header) header.style.display = v ? 'block' : 'none';
    localStorage.setItem('devShowHeader', v ? 'true' : 'false');
    persistVisibilitySettings();
  });
  const versionVisibility = { showVersionInfo: savedShowVersionInfo };
  uiFolder.add(versionVisibility, 'showVersionInfo').name('Show Version Info').onChange(v => {
    localStorage.setItem('devShowVersionInfo', v ? 'true' : 'false');
    if (typeof window.__setVersionInfoVisible === 'function') {
      window.__setVersionInfoVisible();
    } else {
      const infoEl = document.getElementById('version-info');
      if (infoEl) infoEl.style.display = v ? 'flex' : 'none';
    }
    saveDeveloperSettings({
      ...tweakParams,
      showHomeBox: homeVisibility.showHomeBox,
      hideHomeBox: homeVisibility.hideHomeBox,
      showStatusLine: homeVisibility.showStatusLine,
      showHeader: homeVisibility.showHeader,
      showVersionInfo: versionVisibility.showVersionInfo
    });
  });

  // Hide mode folder
  const hideFolder = gui.addFolder('Hide Mode');
  const hideVisibility = {
    showStatusLine: savedHideShowStatusLine,
    showHeader: savedHideShowHeader
  };
  hideFolder.add(hideVisibility, 'showStatusLine').name('Show Status Line').onChange(v => {
    localStorage.setItem('devHideShowStatusLine', v ? 'true' : 'false');
    applyHideModeVisibility(hideVisibility);
    saveDeveloperSettings({
      ...tweakParams,
      hideShowStatusLine: hideVisibility.showStatusLine,
      hideShowHeader: hideVisibility.showHeader
    });
  });
  hideFolder.add(hideVisibility, 'showHeader').name('Show Header').onChange(v => {
    localStorage.setItem('devHideShowHeader', v ? 'true' : 'false');
    applyHideModeVisibility(hideVisibility);
    saveDeveloperSettings({
      ...tweakParams,
      hideShowStatusLine: hideVisibility.showStatusLine,
      hideShowHeader: hideVisibility.showHeader
    });
  });

  const overlayFolder = gui.addFolder('Overlay');
  const overlayGeneralFolder = overlayFolder.addFolder('  - General');
  const overlayWidgetsFolder = overlayFolder.addFolder('  - Widgets');
  const overlayWidgetsSharedFolder = overlayWidgetsFolder.addFolder('    - Shared');
  const overlayWidgetTopFolder = overlayWidgetsFolder.addFolder('    - 3top');
  const overlayWidgetFetchFolder = overlayWidgetsFolder.addFolder('    - 3fetch');
  const overlayWidgetSenseFolder = overlayWidgetsFolder.addFolder('    - Sense');
  const overlayWidgetImageFolder = overlayWidgetsFolder.addFolder('    - Image');

  overlayGeneralFolder.add(tweakParams, 'overlayShowStatusLine').name('Show Status Line').onChange(() => {
    saveDeveloperSettings(tweakParams);
  });
  overlayGeneralFolder.add(tweakParams, 'overlayShowStatusElementBoxes').name('Show Status Element Boxes').onChange(() => {
    saveDeveloperSettings(tweakParams);
  });
  overlayGeneralFolder.add(tweakParams, 'overlayShowHeader').name('Show Header').onChange(() => {
    saveDeveloperSettings(tweakParams);
  });
  overlayGeneralFolder.add(tweakParams, 'overlayPosition', {
    Top: 'top',
    Bottom: 'bottom'
  }).name('Position').onChange(() => {
    saveDeveloperSettings(tweakParams);
  });
  overlayGeneralFolder.add(tweakParams, 'overlayDimAlpha', 0, 0.9, 0.01).name('Scrim Dimming').onChange(() => {
    saveDeveloperSettings(tweakParams);
  });
  overlayGeneralFolder.add(tweakParams, 'overlayRunAutocompleteIconPosition', {
    Top: 'top',
    Bottom: 'bottom',
    Right: 'right'
  }).name('Run Icon Position').onChange(() => {
    saveDeveloperSettings(tweakParams);
  });
  overlayGeneralFolder.add(tweakParams, 'overlayBlurAmount', 0, 30, 1).name('Background Blur').onChange(() => {
    saveDeveloperSettings(tweakParams);
  });
  overlayGeneralFolder.add(tweakParams, 'overlayWindowSwitcherAlpha', 0, 0.95, 0.01).name('Window Switcher Alpha').onChange(() => {
    saveDeveloperSettings(tweakParams);
  });

  overlayWidgetsSharedFolder.add(tweakParams, 'overlayWidgetMatchAlpha').name('Match Alpha').onChange((value) => {
    if (value) {
      tweakParams.overlayWidgetTopAlpha = tweakParams.overlayWidgetAlpha;
      tweakParams.overlayWidgetFetchAlpha = tweakParams.overlayWidgetAlpha;
    }
    saveDeveloperSettings(tweakParams);
  });
  overlayWidgetsSharedFolder.add(tweakParams, 'overlayWidgetAlphaColor', {
    'Card Gray': 'card',
    Black: 'black',
    White: 'white'
  }).name('Alpha Color').onChange(() => {
    saveDeveloperSettings(tweakParams);
  });
  overlayWidgetsSharedFolder.add(tweakParams, 'overlayWidgetAlpha', 0, 0.95, 0.01).name('Widgets Alpha').onChange((value) => {
    if (tweakParams.overlayWidgetMatchAlpha) {
      tweakParams.overlayWidgetTopAlpha = value;
      tweakParams.overlayWidgetFetchAlpha = value;
    }
    saveDeveloperSettings(tweakParams);
  });

  overlayWidgetTopFolder.add(tweakParams, 'overlayWidgetShowTopTable').name('Show Top Table').onChange(() => {
    saveDeveloperSettings(tweakParams);
  });
  overlayWidgetTopFolder.add(tweakParams, 'overlayWidgetTopAlpha', 0, 0.95, 0.01).name('Box Alpha').onChange(() => {
    if (tweakParams.overlayWidgetMatchAlpha) {
      tweakParams.overlayWidgetTopAlpha = tweakParams.overlayWidgetAlpha;
      tweakParams.overlayWidgetFetchAlpha = tweakParams.overlayWidgetAlpha;
    }
    saveDeveloperSettings(tweakParams);
  });
  overlayWidgetTopFolder.add(tweakParams, 'overlay3topUsePxPlus').name('Use PxPlus Font').onChange(() => {
    saveDeveloperSettings(tweakParams);
  });
  overlayWidgetTopFolder.add(tweakParams, 'overlay3topBigLabels').name('Big Labels').onChange(() => {
    saveDeveloperSettings(tweakParams);
  });
  overlayWidgetTopFolder.add(tweakParams, 'overlay3topPixelBars').name('Pixel Bars').onChange(() => {
    saveDeveloperSettings(tweakParams);
  });
  overlayWidgetTopFolder.add(tweakParams, 'overlay3topPixelBarsFollowAccent').name('Pixel Follow Accent').onChange(() => {
    saveDeveloperSettings(tweakParams);
  });
  overlayWidgetTopFolder.add(tweakParams, 'overlay3topPixelSteps', 4, 24, 1).name('Pixel Size').onChange(() => {
    saveDeveloperSettings(tweakParams);
  });
  overlayWidgetTopFolder.addColor(tweakParams, 'overlay3topPixelColorA').name('Pixel Color A').onChange(() => {
    saveDeveloperSettings(tweakParams);
  });
  overlayWidgetTopFolder.addColor(tweakParams, 'overlay3topPixelColorB').name('Pixel Color B').onChange(() => {
    saveDeveloperSettings(tweakParams);
  });
  overlayWidgetTopFolder.add(tweakParams, 'overlay3topRefreshMs', 1000, 15000, 500).name('Refresh (ms)').onChange(() => {
    saveDeveloperSettings(tweakParams);
  });
  overlayWidgetTopFolder.add(tweakParams, 'overlay3topShowAllProcesses').name('Show All Processes').onChange(() => {
    saveDeveloperSettings(tweakParams);
  });
  overlayWidgetTopFolder.add(tweakParams, 'overlay3topProcessLimit', 1, 5000, 10).name('Process Limit').onChange(() => {
    saveDeveloperSettings(tweakParams);
  });

  overlayWidgetFetchFolder.add(tweakParams, 'overlayWidgetFetchAlpha', 0, 0.95, 0.01).name('Box Alpha').onChange(() => {
    if (tweakParams.overlayWidgetMatchAlpha) {
      tweakParams.overlayWidgetTopAlpha = tweakParams.overlayWidgetAlpha;
      tweakParams.overlayWidgetFetchAlpha = tweakParams.overlayWidgetAlpha;
    }
    saveDeveloperSettings(tweakParams);
  });
  overlayWidgetFetchFolder.add(tweakParams, 'overlay3fetchFontSize', 8, 20, 1).name('Font Size').onChange(() => {
    saveDeveloperSettings(tweakParams);
  });
  overlayWidgetFetchFolder.add(tweakParams, 'overlay3fetchFontFamily', {
    Default: 'default',
    'Px Plus': 'pxplus',
    'Helvetica Neue': 'helvetica'
  }).name('Font Family').onChange(() => {
    saveDeveloperSettings(tweakParams);
  });
  overlayWidgetFetchFolder.add(tweakParams, 'overlay3fetchBoldLabels').name('Bold Labels').onChange(() => {
    saveDeveloperSettings(tweakParams);
  });
  overlayWidgetFetchFolder.add(tweakParams, 'overlay3fetchBoldHeaders').name('Bold Headers').onChange(() => {
    saveDeveloperSettings(tweakParams);
  });
  overlayWidgetFetchFolder.add(tweakParams, 'overlay3fetchLogoSize', 72, 220, 1).name('Logo Size').onChange(() => {
    saveDeveloperSettings(tweakParams);
  });

  overlayWidgetSenseFolder.add(tweakParams, 'overlaySenseBoxAlpha', 0, 0.95, 0.01).name('Box Alpha').onChange(() => {
    saveDeveloperSettings(tweakParams);
  });
  overlayWidgetSenseFolder.addColor(tweakParams, 'overlaySenseGradientMid').name('Gradient Mid').onChange(() => {
    const derived = deriveSenseGradient(tweakParams.overlaySenseGradientMid);
    tweakParams.overlaySenseGradientTop = derived.top;
    tweakParams.overlaySenseGradientBottom = derived.bottom;
    saveDeveloperSettings(tweakParams);
  });
  overlayWidgetSenseFolder.add(tweakParams, 'overlaySenseDisableGlow').name('Disable Glow').onChange(() => {
    saveDeveloperSettings(tweakParams);
  });
  overlayWidgetSenseFolder.add(tweakParams, 'overlaySenseDisableGradient').name('Disable Gradient').onChange(() => {
    saveDeveloperSettings(tweakParams);
  });
  overlayWidgetSenseFolder.add(tweakParams, 'overlaySenseForecastOpaque').name('Forecast Opaque').onChange(() => {
    saveDeveloperSettings(tweakParams);
  });
  overlayWidgetSenseFolder.add(tweakParams, 'overlaySenseDisableUnderlay').name('Hide Underlay').onChange(() => {
    saveDeveloperSettings(tweakParams);
  });

  overlayWidgetImageFolder.add(tweakParams, 'overlayImageWidgetBorders').name('Show Borders').onChange(() => {
    saveDeveloperSettings(tweakParams);
  });
  overlayWidgetImageFolder.add(tweakParams, 'overlayImageWidgetCorners').name('Show Corners').onChange(() => {
    saveDeveloperSettings(tweakParams);
  });

  const timeOptions = { showTimeZone: localStorage.getItem('showTimeZone') !== 'false' };
  uiFolder.add(timeOptions, 'showTimeZone').name('Show Time Zone').onChange(v => {
    localStorage.setItem('showTimeZone', v ? 'true' : 'false');
    updateTimeDisplay();
    saveDeveloperSettings({
      ...tweakParams,
      showTimeZone: timeOptions.showTimeZone
    });
  });

  // Weather folder (debug)
  const weatherFolder = gui.addFolder('Weather');
  const weatherState = { condition: localStorage.getItem('debugWeatherKey') || '' };
  loadWeatherIconMap().then((map) => {
    if (!map) return;
    const options = Object.keys(map);
    if (!options.length) return;
    if (!options.includes(weatherState.condition)) {
      weatherState.condition = options[0];
    }
    weatherFolder.add(weatherState, 'condition', options).name('Condition').onChange(async (value) => {
      localStorage.setItem('debugWeatherKey', value);
      await setWeatherIcon(value);
    });
  });

  // Debug folder
  const debugFolder = gui.addFolder('Debug');
  const debugState = { showLogs: localStorage.getItem('showLogs') === 'true' };
  debugFolder.add(debugState, 'showLogs').name('Show Logs').onChange((value) => {
    localStorage.setItem('showLogs', value ? 'true' : 'false');
    setLogOverlayVisible(value);
    saveDeveloperSettings({
      ...tweakParams,
      showLogs: debugState.showLogs
    });
  });
  
  // Shader mode
  const shaderModeFolder = shaderFolder.addFolder('  - Mode');
  shaderModeFolder.add(tweakParams, 'daveHoskins').name('DAVE_HOSKINS (Procedural)').onChange(v => {
    mesh.material = v ? materialProcedural : materialTexture;
  });
  
  // Preset folder
  const presetFolder = gui.addFolder('Presets');
  // Use last selected preset if available, otherwise fall back to default
  const savedPreset = localStorage.getItem('lastPreset');
  let currentPreset = resolvePresetName(savedPreset);
  const presetOptions = Object.keys(availablePresets);

  const applyPresetByName = async (presetName, { dispatch = false } = {}) => {
    const presetFile = availablePresets[presetName];
    if (!presetFile) return;
    try {
      const response = await fetch(presetFile);
      if (!response.ok) return;
      const presetData = await response.json();
      applyPreset(presetData);
      currentPreset = presetName;
      localStorage.setItem('lastPreset', presetName);
      if (dispatch) {
        window.dispatchEvent(new CustomEvent('presetChanged', { detail: { presetName, presetData } }));
      }
    } catch (e) {
      console.error('Error loading preset:', e);
    }
  };
  
  // Preset dropdown - store controller reference for updates
  presetState = { preset: currentPreset };
  presetController = presetFolder.add(presetState, 'preset', presetOptions).name('Select Preset').onChange(async (presetName) => {
    if (isSyncingPreset) return;
    await applyPresetByName(presetName, { dispatch: true });
  });

  if (currentPreset && availablePresets[currentPreset]) {
    applyPresetByName(currentPreset).then(() => {
      if (presetState) {
        presetState.preset = currentPreset;
      }
      if (presetController) {
        presetController.updateDisplay();
      }
    });
  }

  // Reset to current preset
  presetFolder.add({ reset: async () => {
    try {
      const currentPresetName = presetState.preset;
      if (currentPresetName && availablePresets[currentPresetName]) {
        const response = await fetch(availablePresets[currentPresetName]);
        if (response.ok) {
          const presetData = await response.json();
          applyPreset(presetData);
          showToast(`Reset to ${currentPresetName}`);
        }
      }
    } catch (e) {
      console.error('Error resetting preset:', e);
    }
  }}, 'reset').name('Reset to Preset');
  
  // Reset to default
  presetFolder.add({ reset: async () => {
    try {
      const defaultId = appConfig.defaultPreset || 'default';
      const defaultPresetConfig = appConfig.presets.find(p => p.id === defaultId);
      const defaultFile = defaultPresetConfig ? defaultPresetConfig.file : 'presets/default.json';
      const response = await fetch(defaultFile);
      if (response.ok) {
        const defaultData = await response.json();
        applyPreset(defaultData);
        currentPreset = defaultPresetConfig ? defaultPresetConfig.name : 'Default';
        window.dispatchEvent(new CustomEvent('presetChanged', { detail: { presetName: currentPreset, presetData: defaultData } }));
      }
    } catch (e) {
      console.error('Error loading default preset:', e);
    }
  }}, 'reset').name('Reset to Default');
  
  // Download preset
  const downloadParams = { presetName: 'Custom Preset' };
  presetFolder.add(downloadParams, 'presetName').name('Preset Name');
  presetFolder.add({ download: () => {
    const presetName = downloadParams.presetName.trim() || 'Custom Preset';
    const fileName = presetName.replace(/\s+/g, '_').toLowerCase() + '.json';
    const presetData = { ...tweakParams, name: presetName };
    const blob = new Blob([JSON.stringify(presetData, null, 2)], { type: 'application/json' });
    const url = URL.createObjectURL(blob);
    const a = document.createElement('a');
    a.href = url;
    a.download = fileName;
    document.body.appendChild(a);
    a.click();
    document.body.removeChild(a);
    URL.revokeObjectURL(url);
  }}, 'download').name('Download Preset');
  
  // Upload preset
  const fileInput = document.createElement('input');
  fileInput.type = 'file';
  fileInput.accept = '.json';
  fileInput.style.display = 'none';
  fileInput.addEventListener('change', (e) => {
    const file = e.target.files[0];
    if (file) {
      const reader = new FileReader();
      reader.onload = (event) => {
        try {
          const presetData = JSON.parse(event.target.result);
          applyPreset(presetData);
          showToast('Preset loaded successfully!');
          const uploadedPresetName = presetData.name || currentPreset || 'Custom';
          window.dispatchEvent(new CustomEvent('presetChanged', { detail: { presetName: uploadedPresetName, presetData } }));
        } catch (err) {
          showToast('Error: Invalid JSON file', 3000);
        }
      };
      reader.readAsText(file);
    }
  });
  document.body.appendChild(fileInput);
  
  presetFolder.add({ upload: () => fileInput.click() }, 'upload').name('Upload Preset');
  
  // Close all folders
  [
    bgFolder,
    waveFolder,
    dustFolder,
    shaderModeFolder,
    imageFolder,
    uiFolder,
    hideFolder,
    overlayFolder,
    overlayGeneralFolder,
    overlayWidgetsFolder,
    overlayWidgetsSharedFolder,
    overlayWidgetTopFolder,
    overlayWidgetFetchFolder,
    overlayWidgetSenseFolder,
    overlayWidgetImageFolder,
    weatherFolder,
    debugFolder,
    shaderFolder,
    presetFolder
  ].forEach(f => f.close());
  
  // Listen for preset changes from theme switcher
  window.addEventListener('presetChanged', (e) => {
    const { presetName, presetData } = e.detail;
    if (presetName && presetController) {
      isSyncingPreset = true;
      presetState.preset = presetName;
      presetController.updateDisplay();
      isSyncingPreset = false;
    }
    if (presetData) {
      applyPreset(presetData);
    }
  });
}

function applyPreset(presetData) {
  const preservedBackgroundBlur = Number.isFinite(tweakParams.backgroundBlur)
    ? Math.max(0, Math.min(16, tweakParams.backgroundBlur))
    : null;
  const preservedHeaderPosition = ['low', 'med', 'high'].includes(tweakParams.headerPosition)
    ? tweakParams.headerPosition
    : null;

  const presetDefaults = {
    bgColor: '#261c38',
    bgDarken: 0.55,
    gradStrength: 0.5,
    waveMix: 0.7,
    waveContrast: 0.5,
    waveTint: '#bfb3d9',
    waveBoost: 0.28,
    dustEnabled: true,
    dustAmount: 0.12,
    daveHoskins: false,
    uiAccentPreset: 'cyan'
  };
  Object.assign(tweakParams, presetDefaults, presetData);
  if (preservedBackgroundBlur !== null) {
    tweakParams.backgroundBlur = preservedBackgroundBlur;
  }
  if (preservedHeaderPosition) {
    tweakParams.headerPosition = preservedHeaderPosition;
  }
  if (tweakParams.overlaySenseGradientMid) {
    const derived = deriveSenseGradient(tweakParams.overlaySenseGradientMid);
    tweakParams.overlaySenseGradientTop = derived.top;
    tweakParams.overlaySenseGradientBottom = derived.bottom;
  }
  applyUiAccentPreset(tweakParams.uiAccentPreset);
  applyCardsVisibility();
  applyStatusLineDecor();
  applyCardAlpha();
  applyBackgroundBlur();
  applyHeaderPosition();
  updateGuiDisplays(gui);
  
  uniforms.uBgColor.value.set(
    parseInt(tweakParams.bgColor.slice(1,3),16)/255,
    parseInt(tweakParams.bgColor.slice(3,5),16)/255,
    parseInt(tweakParams.bgColor.slice(5,7),16)/255
  );
  uniforms.uBgDarken.value = tweakParams.bgDarken;
  uniforms.uGradTilt.value.set(0.04 * tweakParams.gradStrength, 0.02 * tweakParams.gradStrength, 0.06 * tweakParams.gradStrength);
  uniforms.uWaveTint.value.set(
    parseInt(tweakParams.waveTint.slice(1,3),16)/255,
    parseInt(tweakParams.waveTint.slice(3,5),16)/255,
    parseInt(tweakParams.waveTint.slice(5,7),16)/255
  );
  uniforms.uWaveMix.value = tweakParams.waveMix;
  uniforms.uWaveBoost.value.set(0.02, tweakParams.waveBoost);
  uniforms.uDustOn.value = tweakParams.dustEnabled ? 1.0 : 0.0;
  uniforms.uDustAmt.value = tweakParams.dustAmount;
  mesh.material = tweakParams.daveHoskins ? materialProcedural : materialTexture;
  if (!Number.isFinite(tweakParams.backgroundBlur)) {
    tweakParams.backgroundBlur = Number.isFinite(appConfig.background?.blur) ? appConfig.background.blur : 0;
  }
  applyBackgroundBlur();
}
