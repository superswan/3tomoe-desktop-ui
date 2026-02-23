import { getApiBase } from './ui-utils.js';
import { appConfig } from './config.js';

const STATE_KEY = 'overlayWidgetsStateV2';
const DEV_SETTINGS_KEY = 'developerSettings';
const IMAGE_WIDGET_DATA_DEV_KEY = 'overlayWidgetImageData';
const DEV_SETTINGS_PERSIST_DELAY_MS = 650;

let state = {
  top: { visible: false, x: null, y: null },
  fetch: { visible: false, x: null, y: null },
  sense: { visible: false, x: null, y: null },
  images: []
};

let topTableEnabled = false;
let widgetMatchAlpha = false;
let widgetAlpha = 0.24;
let widgetTopAlpha = 0.24;
let widgetFetchAlpha = 0.0;
let widgetAlphaColor = 'card';
let fetchFontSize = 12;
let fetchFontFamily = 'default';
let fetchBoldLabels = true;
let fetchBoldHeaders = true;
let fetchLogoSize = 112;
let fetchLogoBorder = false;
let imageWidgetBorders = true;
let imageWidgetCorners = true;
let topUsePxPlus = false;
let topPixelBars = false;
let topPixelBarsFollowAccent = true;
let topPixelSteps = 14;
let topPixelColorA = '#14235a';
let topPixelColorB = '#dc50a0';
let topBigLabels = false;
let topRefreshMs = 3000;
let topShowAllProcesses = true;
let topProcessLimit = 240;
let overlayBlurAmount = 10;
let _suppressBlurSync = false;
let senseBoxAlpha = 0.24;
let senseGradientTop = '#e8f6ff';
let senseGradientMid = '#76a6d4';
let senseGradientBottom = '#142338';
let senseDisableGlow = false;
let senseDisableGradient = false;
let senseForecastOpaque = false;
let senseDisableUnderlay = false;
let liveTimer = null;
let liveInFlight = false;
let liveStream = null;
let liveStreamWatchdog = null;
let liveStreamLastMessageAt = 0;
let fetchTimer = null;
let fetchInFlight = false;
let senseTimer = null;
let senseInFlight = false;
let persistDevSettingsTimer = null;
let zCounter = 3400;
let lastTopProcesses = [];


let launcherBtn;
let launcherHost;
let menuModal;
let menuClose;
let menuWrapper;
let menuItemTop;
let menuItemFetch;
let menuItemImage;
let menuItemSense;

let topWidget;
let topClose;
let topDrag;
let topBars;
let topCpuRows;
let topGpuRows;
let topMemRows;
let topTable;
let topTableBody;

let fetchWidget;
let fetchClose;
let fetchDrag;
let fetchLines;
let fetchDisks;
let fetchLogo;

let senseWidget;
let senseClose;
let senseDrag;
let senseCurrentTemp;
let senseHighTemp;
let senseLowTemp;
let senseCity;
let senseCondition;
let sensePageIndicator;
let senseHeroMain;
let senseHeroForeground;
let senseHeroGlow;
let senseLayout;
let senseForecast;

let weatherIconMap = null;

const MAX_IMAGE_WIDGETS = 3;
const IMAGE_WIDGET_DATA_KEY_PREFIX = 'overlayWidget3imageDataUrl:';
const LEGACY_IMAGE_WIDGET_DATA_KEY = 'overlayWidget3imageDataUrl';
let imageTemplate;
let imageTemplateUsed = false;
let imageWidgets = [];
let imageWidgetDataStore = {};

function escapeHtml(value) {
  if (value === null || value === undefined) return '';
  return String(value)
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;')
    .replace(/'/g, '&#39;');
}

function clamp(value, min, max) {
  return Math.max(min, Math.min(max, value));
}

function normalizeHexColor(value, fallback) {
  const text = String(value || '').trim();
  if (/^#[0-9a-fA-F]{6}$/.test(text)) return text;
  if (/^#[0-9a-fA-F]{3}$/.test(text)) {
    const r = text[1];
    const g = text[2];
    const b = text[3];
    return `#${r}${r}${g}${g}${b}${b}`;
  }
  return fallback;
}

function rgbToHex(r, g, b) {
  const toHex = (v) => clamp(Math.round(v), 0, 255).toString(16).padStart(2, '0');
  return `#${toHex(r)}${toHex(g)}${toHex(b)}`;
}

function hexToRgba(hex, alpha) {
  const safe = normalizeHexColor(hex, '#66c6ff');
  const r = Number.parseInt(safe.slice(1, 3), 16);
  const g = Number.parseInt(safe.slice(3, 5), 16);
  const b = Number.parseInt(safe.slice(5, 7), 16);
  return `rgba(${r}, ${g}, ${b}, ${clamp(alpha, 0, 1).toFixed(3)})`;
}

function parseCssAccentRgb() {
  const raw = getComputedStyle(document.documentElement).getPropertyValue('--ui-accent-rgb') || '';
  const parts = raw.split(',').map((part) => Number.parseFloat(part.trim()));
  if (parts.length !== 3 || parts.some((part) => !Number.isFinite(part))) {
    return [102, 198, 255];
  }
  return [parts[0], parts[1], parts[2]];
}

function parseCssCardRgb() {
  const raw = getComputedStyle(document.documentElement).getPropertyValue('--card-glass-rgb') || '';
  const parts = raw.split(',').map((part) => Number.parseFloat(part.trim()));
  if (parts.length !== 3 || parts.some((part) => !Number.isFinite(part))) {
    return [255, 255, 255];
  }
  return [parts[0], parts[1], parts[2]];
}

function resolveWidgetBaseRgb() {
  if (widgetAlphaColor === 'black') return [20, 20, 20];
  if (widgetAlphaColor === 'white') return [243, 243, 243];
  return parseCssCardRgb();
}

function darkenHex(hex, amount = 0.55) {
  const safe = normalizeHexColor(hex, '#66c6ff');
  const r = Number.parseInt(safe.slice(1, 3), 16);
  const g = Number.parseInt(safe.slice(3, 5), 16);
  const b = Number.parseInt(safe.slice(5, 7), 16);
  return rgbToHex(r * amount, g * amount, b * amount);
}

function buildStepGradient(colorA, colorB, steps = 8) {
  const safeSteps = clamp(Math.round(steps), 2, 64);
  const a = normalizeHexColor(colorA, '#14235a');
  const b = normalizeHexColor(colorB, '#dc50a0');
  const ar = Number.parseInt(a.slice(1, 3), 16);
  const ag = Number.parseInt(a.slice(3, 5), 16);
  const ab = Number.parseInt(a.slice(5, 7), 16);
  const br = Number.parseInt(b.slice(1, 3), 16);
  const bg = Number.parseInt(b.slice(3, 5), 16);
  const bb = Number.parseInt(b.slice(5, 7), 16);

  const stops = [];
  for (let i = 0; i < safeSteps; i += 1) {
    const t = safeSteps <= 1 ? 0 : i / (safeSteps - 1);
    const r = Math.round(ar + (br - ar) * t);
    const g = Math.round(ag + (bg - ag) * t);
    const b2 = Math.round(ab + (bb - ab) * t);
    const start = (i / safeSteps) * 100;
    const end = ((i + 1) / safeSteps) * 100;
    const color = `rgb(${r}, ${g}, ${b2})`;
    stops.push(`${color} ${start.toFixed(3)}%`, `${color} ${end.toFixed(3)}%`);
  }
  return `linear-gradient(90deg, ${stops.join(', ')})`;
}

/**
 * Snap a 0-100 percentage to the right edge of whichever pixel step it falls in.
 * With `steps` bands each spanning 100/steps %, a value in band i snaps to (i+1)/steps * 100.
 * A value of 0 stays at 0 (no bar visible).
 */
function snapToPixelStep(pct, steps) {
  if (pct <= 0) return 0;
  const safeSteps = clamp(Math.round(steps), 2, 64);
  const bandWidth = 100 / safeSteps;
  const band = Math.min(Math.floor(pct / bandWidth), safeSteps - 1);
  return (band + 1) * bandWidth;
}

function getTopPollIntervalMs() {
  return clamp(Math.round(topRefreshMs), 1000, 15000);
}

function getTopProcessLimitParam() {
  if (topShowAllProcesses) return 0;
  return clamp(Math.round(topProcessLimit), 1, 5000);
}

function getTopWatchdogMs() {
  return Math.max(3000, (getTopPollIntervalMs() * 2) + 500);
}

function applyTopBarVisualMode() {
  if (!topWidget || !topBars) return;
  topWidget.classList.toggle('use-pxplus', topUsePxPlus === true);
  topWidget.classList.toggle('pixel-bars', topPixelBars === true);

  const [accR, accG, accB] = parseCssAccentRgb();
  const accentHex = rgbToHex(accR, accG, accB);
  const accentDarkHex = darkenHex(accentHex, 0.42);

  const colorA = topPixelBarsFollowAccent ? accentDarkHex : normalizeHexColor(topPixelColorA, '#14235a');
  const colorB = topPixelBarsFollowAccent ? accentHex : normalizeHexColor(topPixelColorB, '#dc50a0');
  const gradient = buildStepGradient(colorA, colorB, topPixelSteps);

  const fills = topBars.querySelectorAll('.w3top-bar-fill, .mem-used');
  fills.forEach((fill) => {
    if (topPixelBars) {
      fill.style.backgroundImage = gradient;
      fill.style.backgroundRepeat = 'no-repeat';
      // Set backgroundSize to the track's pixel width so bands stay uniform
      // even when the fill element is narrower than the track.
      const track = fill.closest('.w3top-bar-track');
      if (track) {
        const trackW = track.offsetWidth;
        if (trackW > 0) fill.style.backgroundSize = `${trackW}px 100%`;
      }
    } else {
      fill.style.backgroundImage = '';
      fill.style.backgroundSize = '';
      fill.style.backgroundRepeat = '';
    }
  });
}

function normalizeWidgetState(node) {
  return {
    visible: node?.visible === true,
    x: Number.isFinite(node?.x) ? node.x : null,
    y: Number.isFinite(node?.y) ? node.y : null
  };
}

function normalizeImageState(node, fallbackSlot) {
  const rawSlot = Number.isFinite(node?.slot) ? node.slot : fallbackSlot;
  const slot = Number.isFinite(rawSlot) ? clamp(Math.round(rawSlot), 1, MAX_IMAGE_WIDGETS) : null;
  if (!slot) return null;
  return {
    slot,
    visible: node?.visible !== false,
    x: Number.isFinite(node?.x) ? node.x : null,
    y: Number.isFinite(node?.y) ? node.y : null
  };
}

function loadDeveloperSettingsSource() {
  try {
    const raw = localStorage.getItem(DEV_SETTINGS_KEY);
    if (raw) {
      const parsed = JSON.parse(raw);
      if (parsed && typeof parsed === 'object') {
        return parsed;
      }
    }
  } catch {
  }

  if (appConfig?.developerPanelSettings && typeof appConfig.developerPanelSettings === 'object') {
    return appConfig.developerPanelSettings;
  }

  return {};
}

function queueDeveloperSettingsPersist(settings) {
  if (persistDevSettingsTimer) {
    clearTimeout(persistDevSettingsTimer);
  }
  persistDevSettingsTimer = setTimeout(async () => {
    try {
      await fetch('/api/config/site', {
        method: 'PATCH',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ developerPanelSettings: settings })
      });
    } catch {
    }
  }, DEV_SETTINGS_PERSIST_DELAY_MS);
}

function loadState() {
  try {
    let parsed = null;
    const raw = localStorage.getItem(STATE_KEY);
    if (raw) {
      parsed = JSON.parse(raw);
    }
    if (!parsed && appConfig?.developerPanelSettings?.overlayWidgetLayout) {
      parsed = appConfig.developerPanelSettings.overlayWidgetLayout;
    }
    if (!parsed || typeof parsed !== 'object') return;

    state.top = normalizeWidgetState(parsed.top || parsed.system || {});
    state.fetch = normalizeWidgetState(parsed.fetch || {});
    state.sense = normalizeWidgetState(parsed.sense || {});

    const images = [];
    const usedSlots = new Set();
    if (Array.isArray(parsed.images)) {
      parsed.images.forEach((node, index) => {
        const normalized = normalizeImageState(node, index + 1);
        if (!normalized || usedSlots.has(normalized.slot)) return;
        usedSlots.add(normalized.slot);
        if (normalized.visible) images.push(normalized);
      });
    } else if (parsed.image) {
      const legacy = normalizeImageState(parsed.image, 1);
      if (legacy && legacy.visible) images.push(legacy);
    }
    state.images = images;
  } catch {
  }
}

function saveState() {
  try {
    localStorage.setItem(STATE_KEY, JSON.stringify(state));
  } catch {
  }
  persistWidgetLayout();
}

function persistWidgetLayout() {
  const clonedState = JSON.parse(JSON.stringify(state));
  const imageData = { ...imageWidgetDataStore };

  let base = {};
  try {
    const source = loadDeveloperSettingsSource();
    base = source && typeof source === 'object' ? { ...source } : {};
  } catch {
    base = {};
  }

  base.overlayWidgetLayout = clonedState;
  if (Object.keys(imageData).length) {
    base[IMAGE_WIDGET_DATA_DEV_KEY] = imageData;
  } else {
    delete base[IMAGE_WIDGET_DATA_DEV_KEY];
  }

  try {
    localStorage.setItem(DEV_SETTINGS_KEY, JSON.stringify(base));
  } catch {
  }

  if (appConfig) {
    appConfig.developerPanelSettings = base;
  }

  queueDeveloperSettingsPersist(base);
}

function loadImageWidgetDataStore() {
  imageWidgetDataStore = {};

  const source = loadDeveloperSettingsSource();
  if (!source || typeof source !== 'object') return;

  const stored = source[IMAGE_WIDGET_DATA_DEV_KEY];
  if (!stored || typeof stored !== 'object') return;

  Object.entries(stored).forEach(([slotKey, value]) => {
    const slot = Number.parseInt(slotKey, 10);
    if (!Number.isFinite(slot) || slot < 1 || slot > MAX_IMAGE_WIDGETS) return;
    if (typeof value !== 'string' || !value) return;
    imageWidgetDataStore[String(slot)] = value;
  });
}

function deriveSenseGradient(mid) {
  const safe = normalizeHexColor(mid, '#76a6d4');
  const r = Number.parseInt(safe.slice(1, 3), 16);
  const g = Number.parseInt(safe.slice(3, 5), 16);
  const b = Number.parseInt(safe.slice(5, 7), 16);
  const toHsl = (rVal, gVal, bVal) => {
    const rr = rVal / 255;
    const gg = gVal / 255;
    const bb = bVal / 255;
    const max = Math.max(rr, gg, bb);
    const min = Math.min(rr, gg, bb);
    let h = 0;
    let s = 0;
    const l = (max + min) / 2;
    if (max !== min) {
      const d = max - min;
      s = l > 0.5 ? d / (2 - max - min) : d / (max + min);
      switch (max) {
        case rr:
          h = (gg - bb) / d + (gg < bb ? 6 : 0);
          break;
        case gg:
          h = (bb - rr) / d + 2;
          break;
        default:
          h = (rr - gg) / d + 4;
          break;
      }
      h /= 6;
    }
    return { h: h * 360, s: s * 100, l: l * 100 };
  };
  const toRgb = (h, s, l) => {
    const hue = (h % 360 + 360) % 360 / 360;
    const sat = Math.max(0, Math.min(100, s)) / 100;
    const light = Math.max(0, Math.min(100, l)) / 100;
    if (sat === 0) {
      const gray = Math.round(light * 255);
      return { r: gray, g: gray, b: gray };
    }
    const q = light < 0.5 ? light * (1 + sat) : light + sat - light * sat;
    const p = 2 * light - q;
    const hueToRgb = (t) => {
      let tt = t;
      if (tt < 0) tt += 1;
      if (tt > 1) tt -= 1;
      if (tt < 1 / 6) return p + (q - p) * 6 * tt;
      if (tt < 1 / 2) return q;
      if (tt < 2 / 3) return p + (q - p) * (2 / 3 - tt) * 6;
      return p;
    };
    return {
      r: Math.round(hueToRgb(hue + 1 / 3) * 255),
      g: Math.round(hueToRgb(hue) * 255),
      b: Math.round(hueToRgb(hue - 1 / 3) * 255)
    };
  };
  const toHex = (v) => clamp(Math.round(v), 0, 255).toString(16).padStart(2, '0');
  const { h, s, l } = toHsl(r, g, b);
  const top = toRgb(h, Math.min(100, s + 10), Math.min(95, l + 24));
  const bottom = toRgb(h, Math.max(0, s - 8), Math.max(8, l - 32));
  return {
    top: `#${toHex(top.r)}${toHex(top.g)}${toHex(top.b)}`,
    mid: safe,
    bottom: `#${toHex(bottom.r)}${toHex(bottom.g)}${toHex(bottom.b)}`
  };
}

function loadDevSettings() {
  const prevTopRefreshMs = topRefreshMs;
  const prevTopShowAllProcesses = topShowAllProcesses;
  const prevTopProcessLimit = topProcessLimit;

  try {
    let parsed = null;
    const raw = localStorage.getItem(DEV_SETTINGS_KEY);
    if (raw) {
      parsed = JSON.parse(raw);
    }
    if (!parsed && appConfig?.developerPanelSettings && typeof appConfig.developerPanelSettings === 'object') {
      parsed = appConfig.developerPanelSettings;
    }
    if (!parsed) {
      // Preserve current state rather than defaulting to false
      // This prevents the table from disappearing during overlay interactions
      widgetMatchAlpha = widgetMatchAlpha || false;
      widgetAlpha = widgetAlpha || 0.24;
      widgetTopAlpha = widgetTopAlpha || 0.24;
      widgetFetchAlpha = widgetFetchAlpha || 0.0;
      widgetAlphaColor = widgetAlphaColor || 'card';
      fetchFontSize = fetchFontSize || 12;
      fetchFontFamily = fetchFontFamily || 'default';
      fetchBoldLabels = fetchBoldLabels !== false;
      fetchBoldHeaders = fetchBoldHeaders !== false;
      fetchLogoSize = fetchLogoSize || 112;
      fetchLogoBorder = fetchLogoBorder || false;
      imageWidgetBorders = imageWidgetBorders !== false;
      imageWidgetCorners = imageWidgetCorners !== false;
      topUsePxPlus = topUsePxPlus || false;
      topPixelBars = topPixelBars || false;
      topPixelBarsFollowAccent = topPixelBarsFollowAccent !== false;
      topPixelSteps = topPixelSteps || 14;
      topPixelColorA = topPixelColorA || '#14235a';
      topPixelColorB = topPixelColorB || '#dc50a0';
      topBigLabels = topBigLabels || false;
      overlayBlurAmount = overlayBlurAmount || 10;
      senseBoxAlpha = senseBoxAlpha || 0.24;
      senseGradientTop = senseGradientTop || '#e8f6ff';
      senseGradientMid = senseGradientMid || '#76a6d4';
      senseGradientBottom = senseGradientBottom || '#142338';
      senseDisableGlow = senseDisableGlow || false;
      senseDisableGradient = senseDisableGradient || false;
      senseForecastOpaque = senseForecastOpaque || false;
      senseDisableUnderlay = senseDisableUnderlay || false;
      // Don't remove the class - let current state persist
      applyWidgetStyleSettings();
      return;
    }
    const parsedMid = typeof parsed?.overlaySenseGradientMid === 'string' ? parsed.overlaySenseGradientMid : '#76a6d4';
    const derived = deriveSenseGradient(parsedMid);
    // Only update when the key is explicitly present.
    // Some code paths persist partial developerSettings objects.
    if (Object.prototype.hasOwnProperty.call(parsed, 'overlayWidgetShowTopTable')) {
      topTableEnabled = parsed.overlayWidgetShowTopTable === true;
    }

    widgetMatchAlpha = parsed?.overlayWidgetMatchAlpha === true;
    const common = Number.parseFloat(parsed?.overlayWidgetAlpha);
    widgetAlpha = Number.isFinite(common) ? clamp(common, 0, 0.95) : 0.24;
    const alphaChoice = typeof parsed?.overlayWidgetAlphaColor === 'string' ? parsed.overlayWidgetAlphaColor : 'card';
    widgetAlphaColor = ['black', 'white', 'card'].includes(alphaChoice) ? alphaChoice : 'card';

    const top = Number.parseFloat(parsed?.overlayWidgetTopAlpha);
    const fetch = Number.parseFloat(parsed?.overlayWidgetFetchAlpha);
    widgetTopAlpha = Number.isFinite(top) ? clamp(top, 0, 0.95) : 0.24;
    widgetFetchAlpha = Number.isFinite(fetch) ? clamp(fetch, 0, 0.95) : 0.0;

    imageWidgetBorders = parsed?.overlayImageWidgetBorders !== false;
    imageWidgetCorners = parsed?.overlayImageWidgetCorners !== false;

    if (widgetMatchAlpha) {
      widgetTopAlpha = widgetAlpha;
      widgetFetchAlpha = widgetAlpha;
    }

    const size = Number.parseFloat(parsed?.overlay3fetchFontSize);
    fetchFontSize = Number.isFinite(size) ? clamp(size, 8, 20) : 12;

    const fontChoice = typeof parsed?.overlay3fetchFontFamily === 'string'
      ? parsed.overlay3fetchFontFamily
      : 'default';
    fetchFontFamily = ['default', 'pxplus', 'helvetica'].includes(fontChoice) ? fontChoice : 'default';
    fetchBoldLabels = parsed?.overlay3fetchBoldLabels !== false;
    fetchBoldHeaders = parsed?.overlay3fetchBoldHeaders !== false;

    const logo = Number.parseFloat(parsed?.overlay3fetchLogoSize);
    fetchLogoSize = Number.isFinite(logo) ? clamp(logo, 72, 220) : 112;

    fetchLogoBorder = parsed?.overlay3fetchLogoBorder === true;
    topUsePxPlus = parsed?.overlay3topUsePxPlus === true;
    topPixelBars = parsed?.overlay3topPixelBars === true;
    topPixelBarsFollowAccent = parsed?.overlay3topPixelBarsFollowAccent !== false;
    const parsedSteps = Number.parseInt(parsed?.overlay3topPixelSteps, 10);
    topPixelSteps = Number.isFinite(parsedSteps) ? clamp(parsedSteps, 4, 24) : 14;
    topPixelColorA = typeof parsed?.overlay3topPixelColorA === 'string' ? parsed.overlay3topPixelColorA : '#14235a';
    topPixelColorB = typeof parsed?.overlay3topPixelColorB === 'string' ? parsed.overlay3topPixelColorB : '#dc50a0';
    topBigLabels = parsed?.overlay3topBigLabels === true;
    const parsedTopRefreshMs = Number.parseInt(parsed?.overlay3topRefreshMs, 10);
    if (Number.isFinite(parsedTopRefreshMs)) {
      topRefreshMs = clamp(parsedTopRefreshMs, 1000, 15000);
    }
    if (typeof parsed?.overlay3topShowAllProcesses === 'boolean') {
      topShowAllProcesses = parsed.overlay3topShowAllProcesses;
    }
    const parsedTopProcessLimit = Number.parseInt(parsed?.overlay3topProcessLimit, 10);
    if (Number.isFinite(parsedTopProcessLimit)) {
      topProcessLimit = clamp(parsedTopProcessLimit, 1, 5000);
    }
    const parsedBlur = Number.parseFloat(parsed?.overlayBlurAmount);
    overlayBlurAmount = Number.isFinite(parsedBlur) ? clamp(parsedBlur, 0, 30) : 10;
    const parsedSenseAlpha = Number.parseFloat(parsed?.overlaySenseBoxAlpha);
    senseBoxAlpha = Number.isFinite(parsedSenseAlpha) ? clamp(parsedSenseAlpha, 0, 0.95) : 0.24;
    senseGradientTop = derived.top;
    senseGradientMid = derived.mid;
    senseGradientBottom = derived.bottom;
    senseDisableGlow = parsed?.overlaySenseDisableGlow === true;
    senseDisableGradient = parsed?.overlaySenseDisableGradient === true;
    senseForecastOpaque = parsed?.overlaySenseForecastOpaque === true;
    senseDisableUnderlay = parsed?.overlaySenseDisableUnderlay === true;
  } catch {
    // On error, preserve current topTableEnabled state to avoid flicker
    // Only set defaults for other properties that aren't critical for visibility
    widgetAlphaColor = widgetAlphaColor || 'card';
    fetchLogoBorder = fetchLogoBorder || false;
    fetchFontFamily = fetchFontFamily || 'default';
    fetchBoldLabels = fetchBoldLabels !== false;
    fetchBoldHeaders = fetchBoldHeaders !== false;
    topUsePxPlus = topUsePxPlus || false;
    topPixelBars = topPixelBars || false;
    topPixelBarsFollowAccent = topPixelBarsFollowAccent !== false;
    topPixelSteps = topPixelSteps || 14;
    topPixelColorA = topPixelColorA || '#14235a';
    topPixelColorB = topPixelColorB || '#dc50a0';
    topBigLabels = topBigLabels || false;
    overlayBlurAmount = overlayBlurAmount || 10;
    senseBoxAlpha = senseBoxAlpha || 0.24;
    senseGradientTop = senseGradientTop || '#e8f6ff';
    senseGradientMid = senseGradientMid || '#76a6d4';
    senseGradientBottom = senseGradientBottom || '#142338';
    senseDisableGlow = senseDisableGlow || false;
    senseDisableGradient = senseDisableGradient || false;
    senseForecastOpaque = senseForecastOpaque || false;
    senseDisableUnderlay = senseDisableUnderlay || false;
  }

  if (topWidget) {
    topWidget.classList.toggle('show-top-table', topTableEnabled);
  }

  applyWidgetStyleSettings();

  const topPollSettingsChanged =
    prevTopRefreshMs !== topRefreshMs
    || prevTopShowAllProcesses !== topShowAllProcesses
    || prevTopProcessLimit !== topProcessLimit;
  if (topPollSettingsChanged && widgetVisible('top')) {
    stopTopPollingIfIdle();
    startTopPolling();
  }
}

function applyWidgetStyleSettings() {
  const root = document.documentElement;
  if (!root) return;

  const [baseR, baseG, baseB] = resolveWidgetBaseRgb();
  const baseRgba = (alpha) => `rgba(${baseR}, ${baseG}, ${baseB}, ${clamp(alpha, 0, 1).toFixed(3)})`;

  root.style.setProperty('--widget-top-alpha', String(widgetTopAlpha));
  root.style.setProperty('--widget-fetch-alpha', String(widgetFetchAlpha));
  root.style.setProperty('--widget-3fetch-font-size', `${fetchFontSize}px`);
  root.style.setProperty('--widget-3fetch-logo-size', `${fetchLogoSize}px`);
  root.style.setProperty('--widget-3fetch-label-weight', fetchBoldLabels ? '700' : '400');
  root.style.setProperty('--widget-3fetch-header-weight', fetchBoldHeaders ? '700' : '400');
  root.style.setProperty('--sense-grad-top', hexToRgba(senseGradientTop, 0.82));
  root.style.setProperty('--sense-grad-mid', hexToRgba(senseGradientMid, 0.46));
  root.style.setProperty('--sense-grad-bottom', hexToRgba(senseGradientBottom, 0.66));

  if (fetchFontFamily === 'default') {
    root.style.removeProperty('--widget-3fetch-font-family');
  } else if (fetchFontFamily === 'helvetica') {
    root.style.setProperty('--widget-3fetch-font-family', '"HelveticaNeue", "Helvetica Neue", sans-serif');
  } else {
    root.style.setProperty('--widget-3fetch-font-family', '"pxplus-ibm-vga8", "SF Mono", monospace');
  }

  if (topWidget) {
    topWidget.classList.toggle('use-pxplus', topUsePxPlus === true);
    topWidget.classList.toggle('big-labels', topBigLabels === true);
    const topShell = topWidget.querySelector('.widget-shell');
    if (topShell) {
      topShell.style.background = baseRgba(widgetTopAlpha);
      if (widgetTopAlpha <= 0.01) {
        topShell.style.backdropFilter = 'none';
        topShell.style.webkitBackdropFilter = 'none';
      } else {
        topShell.style.backdropFilter = 'blur(16px) saturate(130%)';
        topShell.style.webkitBackdropFilter = 'blur(16px) saturate(130%)';
      }
    }

    if (topTable) {
      if (widgetTopAlpha <= 0.01) {
        topTable.style.setProperty('--w3table-bg', 'transparent');
        topTable.style.setProperty('--w3table-border', 'transparent');
        topTable.style.setProperty('--w3table-divider', 'transparent');
      } else {
        const borderAlpha = clamp(widgetTopAlpha * 0.55, 0.04, 0.26);
        const dividerAlpha = clamp(widgetTopAlpha * 0.35, 0.03, 0.16);
        topTable.style.setProperty('--w3table-bg', baseRgba(widgetTopAlpha));
        topTable.style.setProperty('--w3table-border', `rgba(255, 255, 255, ${borderAlpha.toFixed(3)})`);
        topTable.style.setProperty('--w3table-divider', `rgba(255, 255, 255, ${dividerAlpha.toFixed(3)})`);
      }
    }
  }

  applyTopBarVisualMode();

  if (fetchWidget) {
    const fetchShell = fetchWidget.querySelector('.widget-shell');
    if (fetchShell) {
      fetchShell.style.background = baseRgba(widgetFetchAlpha);
      if (widgetFetchAlpha <= 0.01) {
        fetchShell.style.backdropFilter = 'none';
        fetchShell.style.webkitBackdropFilter = 'none';
      } else {
        fetchShell.style.backdropFilter = 'blur(16px) saturate(130%)';
        fetchShell.style.webkitBackdropFilter = 'blur(16px) saturate(130%)';
      }
    }

    if (fetchDisks) {
      if (widgetFetchAlpha <= 0.01) {
        fetchDisks.style.background = 'transparent';
        fetchDisks.style.border = 'none';
        fetchDisks.style.padding = '2px 0 0';
      } else {
        fetchDisks.style.background = 'var(--w3table-bg)';
        fetchDisks.style.border = '1px solid var(--w3table-border)';
        fetchDisks.style.padding = '8px';
      }

      const disksSize = clamp(fetchFontSize - 1, 8, 19);
      fetchDisks.style.fontSize = `${Math.round(disksSize)}px`;
    }

    if (fetchLines) {
      fetchLines.style.fontSize = `${Math.round(fetchFontSize)}px`;
      fetchLines.style.lineHeight = '1.28';
    }

    if (fetchLogo) {
      fetchLogo.style.width = `${Math.round(fetchLogoSize)}px`;
      fetchLogo.style.height = `${Math.round(fetchLogoSize)}px`;
    }

    const computedWidth = 590 + (fetchFontSize - 12) * 30 + (fetchLogoSize - 112) * 1.5;
    const widthPx = clamp(computedWidth, 540, 980);
    fetchWidget.style.width = `min(${Math.round(widthPx)}px, 95vw)`;

    const minHeight = clamp(300 + (fetchFontSize - 12) * 12 + (fetchLogoSize - 112) * 0.9, 280, 620);
    const shell = fetchWidget.querySelector('.widget-shell');
    if (shell) {
      shell.style.minHeight = `${Math.round(minHeight)}px`;
    }

    applySavedPosition('fetch', fetchWidget);
  }

  if (senseWidget) {
    const senseShell = senseWidget.querySelector('.widget-shell');
    if (senseShell) {
      senseShell.style.background = baseRgba(senseBoxAlpha);
      if (senseBoxAlpha <= 0.01) {
        senseShell.style.backdropFilter = 'none';
        senseShell.style.webkitBackdropFilter = 'none';
      } else {
        senseShell.style.backdropFilter = 'blur(16px) saturate(130%)';
        senseShell.style.webkitBackdropFilter = 'blur(16px) saturate(130%)';
      }
    }

    if (senseLayout) {
      senseLayout.style.background = senseDisableGradient ? 'transparent' : '';
    }

    if (senseHeroGlow) {
      senseHeroGlow.style.display = senseDisableGlow ? 'none' : '';
      senseHeroGlow.style.opacity = senseDisableGlow ? '0' : '';
    }

    if (senseHeroForeground) {
      senseHeroForeground.style.display = senseDisableUnderlay ? 'none' : '';
      senseHeroForeground.style.opacity = senseDisableGlow ? '0.28' : '';
    }

    if (senseForecast) {
      if (senseForecastOpaque) {
        senseForecast.style.background = 'linear-gradient(180deg, rgba(10, 20, 35, 1) 0%, rgba(7, 15, 30, 1) 100%)';
      } else {
        senseForecast.style.background = '';
      }
    }
  }

  applyImageWidgetDecor();
}

function applyImageWidgetDecor() {
  const showBorders = imageWidgetBorders !== false;
  const showCorners = imageWidgetCorners !== false;
  const applyTo = (el) => {
    if (!el) return;
    const shell = el.querySelector('.widget-shell');
    if (shell) shell.style.border = showBorders ? '' : 'none';
    el.querySelectorAll('.modal-corner').forEach((corner) => {
      corner.style.display = showCorners ? '' : 'none';
    });
  };

  applyTo(imageTemplate);
  imageWidgets.forEach((entry) => applyTo(entry.el));
}

export function refreshOverlayWidgetSettings() {
  loadDevSettings();
}

function getDefaultPosition(which) {
  if (which === 'top') {
    return { x: window.innerWidth - 520, y: 92 };
  }
  if (which === 'sense') {
    return { x: window.innerWidth - 610, y: 120 };
  }
  return { x: window.innerWidth - 520, y: 440 };
}

function getImageDefaultPosition(slot) {
  const base = { x: window.innerWidth - 520, y: 760 };
  const offset = (Math.max(1, slot) - 1) * 24;
  return { x: base.x - offset, y: base.y + offset };
}

function setWidgetPosition(el, x, y) {
  if (!el) return;
  const rect = el.getBoundingClientRect();
  const width = rect.width || 480;
  const height = rect.height || 300;
  const margin = 20;
  const px = clamp(x, margin, window.innerWidth - width - margin);
  const py = clamp(y, margin, window.innerHeight - height - margin);
  el.style.left = `${px}px`;
  el.style.top = `${py}px`;
}

function applySavedPosition(which, el) {
  if (!el) return;
  const s = state[which];
  const def = getDefaultPosition(which);
  setWidgetPosition(el, s.x ?? def.x, s.y ?? def.y);
}

function bringToFront(el) {
  if (!el) return;
  zCounter += 1;
  el.style.zIndex = String(zCounter);
}

function widgetVisible(which) {
  if (which === 'image') return imageWidgets.length > 0;
  return state[which]?.visible === true;
}

function hasAnyWidgetVisible() {
  return widgetVisible('top') || widgetVisible('fetch') || widgetVisible('sense') || widgetVisible('image');
}

function setMenuItemState(item, which) {
  if (!item) return;
  const open = widgetVisible(which);
  item.classList.toggle('active', open);
  const status = item.querySelector('.widgets-item-status');
  if (status) status.textContent = open ? 'OPEN' : 'CLOSED';
}

function setImageMenuState() {
  if (!menuItemImage) return;
  const count = imageWidgets.length;
  menuItemImage.classList.toggle('active', count > 0);
  const status = menuItemImage.querySelector('.widgets-item-status');
  if (status) status.textContent = `${count}/${MAX_IMAGE_WIDGETS}`;
}

function renderMenuState() {
  setMenuItemState(menuItemTop, 'top');
  setMenuItemState(menuItemFetch, 'fetch');
  setMenuItemState(menuItemSense, 'sense');
  setImageMenuState();
}

function getWidgetEl(which) {
  if (which === 'top') return topWidget;
  if (which === 'fetch') return fetchWidget;
  if (which === 'sense') return senseWidget;
  return null;
}

function setVisible(which, visible) {
  const el = getWidgetEl(which);
  if (!el) return;
  state[which].visible = visible;
  saveState();

  if (visible) {
    el.classList.add('active');
    bringToFront(el);
    applySavedPosition(which, el);
  } else {
    el.classList.remove('active');
  }

  if (which === 'top') {
    if (visible) startTopPolling(); else stopTopPollingIfIdle();
  } else if (which === 'fetch') {
    if (visible) startFetchPolling(); else stopFetchPollingIfIdle();
  } else if (which === 'sense') {
    if (visible) startSensePolling(); else stopSensePollingIfIdle();
  }

  renderMenuState();
  syncOverlayBlur();
}

function closeWidgetsMenu() {
  if (!menuModal) return;
  menuModal.classList.remove('active');
  syncOverlayBlur();
}

function openWidgetsMenu() {
  if (!menuModal) return;

  renderMenuState();
  menuModal.classList.add('active');
  syncOverlayBlur();

  requestAnimationFrame(() => {
    placeWidgetsMenuNearLauncher();
  });
}

function getBaseBackgroundBlur() {
  try {
    const raw = localStorage.getItem(DEV_SETTINGS_KEY);
    if (raw) {
      const parsed = JSON.parse(raw);
      const localBlur = Number.parseFloat(parsed?.backgroundBlur);
      if (Number.isFinite(localBlur)) {
        return Math.max(0, localBlur);
      }
    }
  } catch {
  }

  const panelBlur = Number.parseFloat(appConfig?.developerPanelSettings?.backgroundBlur);
  if (Number.isFinite(panelBlur)) {
    return Math.max(0, panelBlur);
  }

  const backgroundBlur = Number.parseFloat(appConfig?.background?.blur);
  return Number.isFinite(backgroundBlur) ? Math.max(0, backgroundBlur) : 0;
}

function postOverlayBlur(blur) {
  if (window.chrome && window.chrome.webview) {
    try { window.chrome.webview.postMessage(`overlay-blur:${blur}`); } catch {}
  }
}

function syncOverlayBlur() {
  if (_suppressBlurSync) return;
  const menuActive = !!menuModal?.classList.contains('active');
  const widgetActive = hasAnyWidgetVisible();
  const overlayModalActive = !!document.querySelector('.menu-modal-overlay.active, .about-modal-overlay.active, .menu3-modal-overlay.active, .menu3run-modal-overlay.active, .quickmenu-modal-overlay.active, .system-modal-overlay.active');
  const overlayOnlyActive = document.body?.classList.contains('overlay-showonly') === true;
  const active = overlayOnlyActive || overlayModalActive || menuActive || widgetActive;
  if (active) {
    const baseBlur = getBaseBackgroundBlur();
    postOverlayBlur(Math.max(baseBlur, overlayBlurAmount));
  } else {
    postOverlayBlur(0);
  }
}

function pxVar(name, fallback = 0) {
  const raw = getComputedStyle(document.documentElement).getPropertyValue(name).trim();
  const parsed = Number.parseFloat(raw);
  return Number.isFinite(parsed) ? parsed : fallback;
}

function placeLauncherButton() {
  if (!launcherBtn || !launcherHost) return;

  const anchorLeft = pxVar('--overlay-anchor-left', 0);
  const anchorTop = pxVar('--overlay-anchor-top', 0);
  const anchorHeight = pxVar('--overlay-anchor-height', window.innerHeight);
  const debugLeft = pxVar('--debug-left', 20);
  const debugBottom = pxVar('--debug-bottom', 70);
  const btnW = launcherBtn.offsetWidth || 44;
  const btnH = launcherBtn.offsetHeight || 44;

  const x = clamp(anchorLeft + debugLeft, 8, window.innerWidth - btnW - 8);
  const y = clamp(anchorTop + anchorHeight - debugBottom - btnH, 8, window.innerHeight - btnH - 8);

  launcherHost.style.left = `${Math.round(x)}px`;
  launcherHost.style.top = `${Math.round(y)}px`;
}

function placeWidgetsMenuNearLauncher() {
  if (!menuWrapper || !launcherBtn || !menuModal?.classList.contains('active')) return;

  const btnRect = launcherBtn.getBoundingClientRect();
  const wrapRect = menuWrapper.getBoundingClientRect();
  const margin = 10;

  let left = btnRect.left;
  left = clamp(left, 12, window.innerWidth - wrapRect.width - 12);

  let top = btnRect.top - wrapRect.height - margin;
  top = clamp(top, 12, window.innerHeight - wrapRect.height - 12);

  menuWrapper.style.left = `${Math.round(left)}px`;
  menuWrapper.style.top = `${Math.round(top)}px`;
  menuWrapper.style.transform = 'translate(0, 0)';
}

function bindDrag(which, widgetEl, dragEl) {
  if (!widgetEl || !dragEl) return;
  let dragging = false;
  let offsetX = 0;
  let offsetY = 0;

  const startDrag = (e) => {
    if (e.button !== 0) return;
    if (e.target.closest('.widget-close, button, input, textarea, select, a')) return;

    dragging = true;
    const rect = widgetEl.getBoundingClientRect();
    offsetX = e.clientX - rect.left;
    offsetY = e.clientY - rect.top;
    widgetEl.classList.add('dragging');
    const line = dragEl.querySelector('.drag-line');
    if (line) line.style.background = '#ffffff';
    bringToFront(widgetEl);
    e.preventDefault();
  };

  dragEl.addEventListener('mousedown', startDrag);
  widgetEl.addEventListener('mousedown', startDrag);

  document.addEventListener('mousemove', (e) => {
    if (!dragging) return;
    setWidgetPosition(widgetEl, e.clientX - offsetX, e.clientY - offsetY);
  });

  document.addEventListener('mouseup', () => {
    if (!dragging) return;
    dragging = false;
    widgetEl.classList.remove('dragging');
    const line = dragEl.querySelector('.drag-line');
    if (line) line.style.background = '';
    const rect = widgetEl.getBoundingClientRect();
    state[which].x = Math.round(rect.left);
    state[which].y = Math.round(rect.top);
    saveState();
  });
}

function pct(value) {
  const parsed = Number.isFinite(value) ? value : Number.parseFloat(value);
  if (!Number.isFinite(parsed)) return '0%';
  return `${Math.round(parsed)}%`;
}

function pctCell(value) {
  const parsed = Number.isFinite(value) ? value : Number.parseFloat(value);
  if (!Number.isFinite(parsed)) return '0.0%';
  if (parsed > 0 && parsed < 0.1) return '<0.1%';
  return `${parsed.toFixed(1)}%`;
}

function formatBytes(value) {
  if (!Number.isFinite(value)) return '--';
  const units = ['B', 'KB', 'MB', 'GB', 'TB'];
  let size = Math.max(0, value);
  let unitIndex = 0;
  while (size >= 1024 && unitIndex < units.length - 1) {
    size /= 1024;
    unitIndex += 1;
  }
  const precision = unitIndex === 0 ? 0 : (size >= 100 ? 0 : size >= 10 ? 1 : 2);
  return `${size.toFixed(precision)}${units[unitIndex]}`;
}

function formatGiB(value) {
  if (!Number.isFinite(value)) return null;
  const gib = value / (1024 * 1024 * 1024);
  if (!Number.isFinite(gib)) return null;
  return `${gib.toFixed(1)}G`;
}

function createBarRow(key, label) {
  const row = document.createElement('div');
  row.className = 'w3top-bar-row';
  row.dataset.key = key;
  row.innerHTML = `
    <div class="w3top-bar-label">${escapeHtml(label)}</div>
    <div class="w3top-bar-stack">
      <div class="w3top-bar-track"><div class="w3top-bar-fill"></div><div class="w3top-bar-cut"></div></div>
      <div class="w3top-bar-marker-line"><div class="w3top-bar-marker"></div></div>
    </div>
    <div class="w3top-bar-value">--</div>
  `;
  return row;
}

function createMemRow() {
  const row = document.createElement('div');
  row.className = 'w3top-bar-row mem-row big-label';
  row.dataset.key = 'mem';
  row.innerHTML = `
    <div class="w3top-bar-label">MEM</div>
    <div class="w3top-bar-stack">
      <div class="w3top-bar-track mem-stack">
        <div class="mem-seg mem-used"></div>
        <div class="mem-seg mem-cache"></div>
        <div class="mem-seg mem-free"></div>
        <div class="w3top-bar-cut"></div>
      </div>
      <div class="w3top-bar-marker-line"><div class="w3top-bar-marker"></div></div>
    </div>
    <div class="w3top-bar-value">--</div>
  `;
  return row;
}

function setBarRowValue(row, value, valueText = null) {
  if (!row) return;
  const fill = row.querySelector('.w3top-bar-fill');
  const track = row.querySelector('.w3top-bar-track');
  let cut = row.querySelector('.w3top-bar-cut');
  if (!cut && track) {
    cut = document.createElement('div');
    cut.className = 'w3top-bar-cut';
    track.appendChild(cut);
  }
  const marker = row.querySelector('.w3top-bar-marker');
  const valueEl = row.querySelector('.w3top-bar-value');
  const width = Number.isFinite(value) ? clamp(value, 0, 100) : 0;
  if (fill) {
    if (topPixelBars) {
      const snapped = snapToPixelStep(width, topPixelSteps);
      fill.style.width = `${snapped}%`;
      // backgroundSize must span the full track so pixel bands stay uniform
      if (track) {
        const trackW = track.offsetWidth;
        if (trackW > 0) fill.style.backgroundSize = `${trackW}px 100%`;
      }
    } else {
      fill.style.width = `${width}%`;
    }
  }
  if (cut) {
    cut.style.display = 'none';
    cut.style.transform = 'translateX(100%)';
  }
  const markerPos = topPixelBars ? snapToPixelStep(width, topPixelSteps) : width;
  if (marker) marker.style.left = `calc(${markerPos}% - 4px)`;
  if (valueEl) valueEl.textContent = valueText || pct(value);
}

function setMemRowValue(row, mem) {
  if (!row || !mem) return;
  const used = Number.isFinite(mem.usedPercent) ? clamp(mem.usedPercent, 0, 100) : 0;
  const cache = Number.isFinite(mem.cachePercent) ? clamp(mem.cachePercent, 0, 100) : 0;
  const freeRaw = Number.isFinite(mem.freePercent) ? clamp(mem.freePercent, 0, 100) : Math.max(0, 100 - used - cache);
  const total = used + cache + freeRaw;
  const norm = total > 0 ? 100 / total : 0;
  const usedPct = used * norm;
  const cachePct = cache * norm;
  const freePct = freeRaw * norm;

  const usedEl = row.querySelector('.mem-used');
  const cacheEl = row.querySelector('.mem-cache');
  const freeEl = row.querySelector('.mem-free');
  const track = row.querySelector('.w3top-bar-track.mem-stack') || row.querySelector('.w3top-bar-track');
  let cut = row.querySelector('.w3top-bar-cut');
  if (!cut && track) {
    cut = document.createElement('div');
    cut.className = 'w3top-bar-cut';
    track.appendChild(cut);
  }
  if (topPixelBars) {
    const snapped = snapToPixelStep(usedPct, topPixelSteps);
    if (usedEl) {
      usedEl.style.width = `${snapped}%`;
      // backgroundSize must span the full track so pixel bands stay uniform
      if (track) {
        const trackW = track.offsetWidth;
        if (trackW > 0) usedEl.style.backgroundSize = `${trackW}px 100%`;
      }
    }
    if (cacheEl) cacheEl.style.width = '0%';
    if (freeEl) freeEl.style.width = '0%';
    if (cut) {
      cut.style.display = 'none';
      cut.style.transform = 'translateX(100%)';
    }
  } else {
    if (usedEl) usedEl.style.width = `${usedPct}%`;
    if (cacheEl) cacheEl.style.width = `${cachePct}%`;
    if (freeEl) freeEl.style.width = `${freePct}%`;
    if (cut) {
      cut.style.display = 'none';
      cut.style.transform = 'translateX(100%)';
    }
  }

  const marker = row.querySelector('.w3top-bar-marker');
  if (marker) {
    const markerPos = topPixelBars ? snapToPixelStep(usedPct, topPixelSteps) : clamp(usedPct + cachePct, 0, 100);
    marker.style.left = `calc(${markerPos}% - 4px)`;
  }

  const valueEl = row.querySelector('.w3top-bar-value');
  if (valueEl) {
    const usedGiB = formatGiB(mem.usedBytes);
    const totalGiB = formatGiB(mem.totalBytes);
    if (usedGiB && totalGiB) {
      valueEl.textContent = `${usedGiB} / ${totalGiB}`;
    } else {
      valueEl.textContent = pct(mem.usedPercent);
    }
  }
}

function ensureBarRows(container, rowsSpec) {
  if (!container) return [];
  const existing = Array.from(container.querySelectorAll('.w3top-bar-row'));
  const keepKeys = new Set(rowsSpec.map((row) => row.key));
  existing.forEach((row) => {
    if (!keepKeys.has(row.dataset.key)) {
      row.remove();
    }
  });

  const rowMap = new Map();
  Array.from(container.querySelectorAll('.w3top-bar-row')).forEach((row) => {
    rowMap.set(row.dataset.key, row);
  });

  const ordered = [];
  rowsSpec.forEach((spec) => {
    let row = rowMap.get(spec.key);
    if (!row) {
      row = spec.type === 'mem' ? createMemRow() : createBarRow(spec.key, spec.label);
      container.appendChild(row);
    } else if (spec.type !== 'mem') {
      const labelEl = row.querySelector('.w3top-bar-label');
      if (labelEl) labelEl.textContent = spec.label;
    }
    if (spec.bigLabel) {
      row.classList.add('big-label');
    } else {
      row.classList.remove('big-label');
    }
    ordered.push(row);
  });

  return ordered;
}

function renderTopTable(rows) {
  if (!topTable || !topTableBody) return;
  if (!topTableEnabled) {
    topTable.style.display = 'none';
    return;
  }
  // Force explicit display when enabled so visibility does not depend
  // on transient class state updates.
  topTable.style.display = 'block';
  const safeRows = Array.isArray(rows) ? rows : [];
  if (!safeRows.length) {
    topTableBody.innerHTML = '<tr><td>--</td><td>--</td><td>--</td><td>--</td><td>--</td><td>Loading process data...</td></tr>';
    return;
  }

  topTableBody.innerHTML = safeRows.map((row) => `
    <tr>
      <td>${row?.pid ?? '--'}</td>
      <td class="user-cell">${escapeHtml((row?.user || row?.username || '--').toString())}</td>
      <td class="cpu-cell">${pctCell(row?.cpuPercent)}</td>
      <td class="mem-cell">${pctCell(row?.memPercent)}</td>
      <td class="rss-cell">${formatBytes(row?.rssBytes)}</td>
      <td class="command-cell">${escapeHtml(row.command || row.name || '')}</td>
    </tr>
  `).join('');
}

function renderTopBars(data) {
  if (!topBars) return;
  const cpuCores = Array.isArray(data?.cpuCores) ? data.cpuCores : [];
  const cpuRowsSpec = [
    { key: 'cpu-total', label: 'CPU', type: 'bar', bigLabel: true },
    ...cpuCores.map((_, index) => ({ key: `cpu-core-${index}`, label: `C${index + 1}`, type: 'bar', bigLabel: false }))
  ];

  const gpuAdapters = Array.isArray(data?.gpuAdapters) ? data.gpuAdapters : [];
  const gpuRowsSpec = gpuAdapters.length
    ? gpuAdapters.map((gpu, index) => ({
        key: `gpu-${index}`,
        label: gpu?.name ? `GPU${index + 1}` : 'GPU',
        type: 'bar',
        bigLabel: true
      }))
    : [{ key: 'gpu-total', label: 'GPU', type: 'bar', bigLabel: true }];

  const memRowsSpec = [{ key: 'mem', label: 'MEM', type: 'mem', bigLabel: true }];

  const cpuRows = ensureBarRows(topCpuRows, cpuRowsSpec);
  const gpuRows = ensureBarRows(topGpuRows, gpuRowsSpec);
  const memRows = ensureBarRows(topMemRows, memRowsSpec);

  const cpuTotal = Number.isFinite(data?.cpuTotal) ? data.cpuTotal : data?.cpuPercent;
  setBarRowValue(cpuRows[0], cpuTotal);
  cpuCores.forEach((value, index) => {
    setBarRowValue(cpuRows[index + 1], value);
  });

  if (gpuAdapters.length) {
    gpuAdapters.forEach((gpu, index) => {
      setBarRowValue(gpuRows[index], gpu?.percent);
    });
  } else {
    setBarRowValue(gpuRows[0], data?.gpuTotal ?? data?.gpuPercent);
  }

  setMemRowValue(memRows[0], data?.mem);
  applyTopBarVisualMode();
}

function renderTopLive(data) {
  const incomingRows = Array.isArray(data?.topProcesses) ? data.topProcesses : [];
  if (incomingRows.length > 0) {
    lastTopProcesses = incomingRows;
  }
  const rowsToRender = incomingRows.length > 0 ? incomingRows : lastTopProcesses;
  renderTopBars(data);
  renderTopTable(rowsToRender);
}

async function pollTop() {
  if (!widgetVisible('top') || liveInFlight) return;
  liveInFlight = true;
  try {
    const base = getApiBase();
    const limit = getTopProcessLimitParam();
    const response = await fetch(`${base}/api/system-live?limit=${limit}`, { cache: 'no-store' });
    if (!response.ok) return;
    const data = await response.json();
    renderTopLive(data || {});
  } catch {
  } finally {
    liveInFlight = false;
  }
}

async function pollFetch() {
  if (!widgetVisible('fetch') || fetchInFlight) return;
  fetchInFlight = true;
  try {
    const base = getApiBase();
    const response = await fetch(`${base}/api/system-info`, { cache: 'no-store' });
    if (!response.ok) return;
    const data = await response.json();
    if (!fetchLines) return;

    const gpu = Array.isArray(data?.gpu)
      ? (data.gpu[0]?.name || data.gpu[0] || '--')
      : (data?.gpu?.name || data?.gpu || '--');

    const lines = [
      ['OS', data?.os || '--'],
      ['HOST', data?.host || '--'],
      ['KERNEL', data?.kernel || '--'],
      ['UPTIME', data?.uptime || '--'],
      ['CPU', data?.cpu?.name || data?.cpu || '--'],
      ['GPU', gpu],
      ['MEMORY', data?.memory || '--'],
      ['LOCAL IP', data?.localIp || '--']
    ];
    fetchLines.innerHTML = lines.map(([k, v]) => `<div class="line"><b>${escapeHtml(k)}</b>: ${escapeHtml(v)}</div>`).join('');

    if (fetchDisks) {
      const disks = Array.isArray(data?.disks) ? data.disks : [];
      if (!disks.length) {
        fetchDisks.innerHTML = '<div class="line"><b>DISKS</b>: --</div>';
      } else {
        fetchDisks.innerHTML = `
          <table>
            <thead>
              <tr><th>VOL</th><th>USED</th><th>TOTAL</th><th>%</th><th>FS</th><th>TAG</th></tr>
            </thead>
            <tbody>
              ${disks.map((disk) => `
                <tr>
                  <td>${escapeHtml(disk?.vol || '')}</td>
                  <td>${escapeHtml(disk?.used || '')}</td>
                  <td>${escapeHtml(disk?.total || '')}</td>
                  <td>${escapeHtml(disk?.pct || '')}</td>
                  <td>${escapeHtml(disk?.fs || '')}</td>
                  <td>${escapeHtml(disk?.tag || '')}</td>
                </tr>
              `).join('')}
            </tbody>
          </table>
        `;
      }
    }
  } catch {
  } finally {
    fetchInFlight = false;
  }
}

function senseFormatTemp(value) {
  const parsed = Number.isFinite(value) ? value : Number.parseFloat(value);
  if (!Number.isFinite(parsed)) return '--';
  return String(Math.round(parsed));
}

function senseUnitToken(units) {
  return String(units || '').trim().toLowerCase().startsWith('c') ? 'celsius' : 'fahrenheit';
}

function senseUnitSymbol(units) {
  return senseUnitToken(units) === 'celsius' ? 'C' : 'F';
}

function senseMapWeatherCode(code, isDay) {
  const day = isDay !== false;
  if (code === 0) return day ? 'clear_day' : 'clear_night';
  if (code === 1) return day ? 'mostly_sunny' : 'partly_cloudy_night';
  if (code === 2) return day ? 'partly_cloudy_day' : 'partly_cloudy_night';
  if (code === 3) return day ? 'overcast' : 'overcast_night';
  if (code === 45 || code === 48) return 'fog';
  if (code === 51 || code === 53 || code === 55) return day ? 'showers_day' : 'showers_night';
  if (code === 56 || code === 57) return 'freezing_rain';
  if (code === 61 || code === 63) return day ? 'rain' : 'rain_night';
  if (code === 65) return 'heavy_rain';
  if (code === 66 || code === 67) return 'freezing_rain';
  if (code === 71 || code === 73) return day ? 'snow' : 'snow_night';
  if (code === 75) return day ? 'heavy_snow' : 'heavy_snow_night';
  if (code === 77) return day ? 'snow' : 'snow_night';
  if (code === 80 || code === 81) return day ? 'showers_day' : 'showers_night';
  if (code === 82) return day ? 'rain_day' : 'rain_night';
  if (code === 85) return day ? 'snow_showers_day' : 'snow_night';
  if (code === 86) return day ? 'heavy_snow' : 'heavy_snow_night';
  if (code === 95) return day ? 'thunderstorm' : 'thunder_night';
  if (code === 96 || code === 99) return day ? 'hail_day' : 'hail';
  return day ? 'cloudy' : 'cloudy_night';
}

function normalizeSenseCity(raw) {
  const text = String(raw || '').trim();
  if (!text) return 'Unknown';
  if (!text.includes(',')) return text;
  return text.split(',')[0].trim() || text;
}

function truncateCoord(value, digits = 2) {
  const n = Number.isFinite(value) ? value : Number.parseFloat(value);
  if (!Number.isFinite(n)) return null;
  const factor = 10 ** digits;
  const truncated = Math.trunc(n * factor) / factor;
  return truncated.toFixed(digits);
}

function senseCoordsLabel(coords) {
  if (!coords) return 'Unknown';
  const lat = truncateCoord(coords.lat, 2);
  const lon = truncateCoord(coords.lon, 2);
  if (lat === null || lon === null) return 'Unknown';
  return `${lat}, ${lon}`;
}

function resolveSenseLocationName(current, weather, coords) {
  const preferNames = weather?.useLocationNames === true;
  if (!preferNames) return senseCoordsLabel(coords);
  const named = normalizeSenseCity(current?.location || weather?.label || '');
  if (named && named !== 'Unknown') return named;
  return senseCoordsLabel(coords);
}

function getSenseLocationCount(weather, coords) {
  const list = Array.isArray(weather?.locations)
    ? weather.locations
    : Array.isArray(weather?.savedLocations)
      ? weather.savedLocations
      : Array.isArray(weather?.cities)
        ? weather.cities
        : [];
  if (list.length > 0) return list.length;
  if (coords) return 1;
  if (String(weather?.label || '').trim()) return 1;
  return 1;
}

function forecastDayLabel(dateString, index) {
  if (!dateString) {
    const labels = ['Sun', 'Mon', 'Tue', 'Wed', 'Thu', 'Fri', 'Sat'];
    return labels[index % labels.length];
  }
  const parsed = new Date(`${dateString}T12:00:00`);
  if (Number.isNaN(parsed.getTime())) return dateString;
  return parsed.toLocaleDateString('en-US', { weekday: 'short' });
}

async function loadSenseIconMap() {
  if (weatherIconMap) return weatherIconMap;
  try {
    const response = await fetch('static/image/weather-icons/icon-map', { cache: 'no-store' });
    if (!response.ok) throw new Error('icon-map fetch failed');
    const text = await response.text();
    const map = {};
    const lines = text.split('\n');
    const pattern = /"([^"]+)"\s*:\s*\{\s*key:\s*"([^"]+)"\s*,\s*label:\s*"([^"]+)"\s*\}/;
    lines.forEach((line) => {
      const match = line.match(pattern);
      if (!match) return;
      map[match[2]] = { file: match[1], label: match[3] };
    });
    weatherIconMap = map;
    return map;
  } catch {
    weatherIconMap = { partly_cloudy_day: { file: '03.png', label: 'Partly cloudy' } };
    return weatherIconMap;
  }
}

async function senseIconSrcForKey(iconKey) {
  const map = await loadSenseIconMap();
  const fallback = map?.partly_cloudy_day?.file || '03.png';
  const file = map?.[iconKey]?.file || fallback;
  return `static/image/weather-icons/${file}`;
}

function senseDemoData() {
  return {
    temperature: 72,
    condition: 'Partly cloudy',
    iconKey: 'partly_cloudy_day',
    city: '41.82, -71.42',
    units: 'fahrenheit',
    high: 79,
    low: 63,
    pager: '1/1',
    forecast: [
      { day: 'Sun', iconKey: 'partly_cloudy_day', high: 79, low: 63 },
      { day: 'Mon', iconKey: 'mostly_sunny', high: 82, low: 66 },
      { day: 'Tue', iconKey: 'showers_day', high: 74, low: 61 },
      { day: 'Wed', iconKey: 'rain_day', high: 71, low: 59 },
      { day: 'Thu', iconKey: 'clear_day', high: 77, low: 62 }
    ]
  };
}

function getSenseCoords() {
  const weather = appConfig?.weather || {};
  const lat = Number.parseFloat(weather.latitude ?? weather.lat);
  const lon = Number.parseFloat(weather.longitude ?? weather.lon);
  if (!Number.isFinite(lat) || !Number.isFinite(lon)) return null;
  return { lat, lon };
}

async function fetchSenseLiveData() {
  const base = getApiBase();
  const weather = appConfig?.weather || {};
  const coords = getSenseCoords();
  const locationCount = getSenseLocationCount(weather, coords);
  const units = senseUnitToken(weather.units);
  const params = new URLSearchParams();
  if (coords) {
    params.set('lat', coords.lat.toFixed(4));
    params.set('lon', coords.lon.toFixed(4));
  }
  params.set('units', units);
  if (weather.label) params.set('label', String(weather.label));

  const currentResponse = await fetch(`${base}/api/weather?${params.toString()}`, { cache: 'no-store' });
  if (!currentResponse.ok) throw new Error(`current weather failed (${currentResponse.status})`);
  const current = await currentResponse.json();

  let forecast = [];
  if (coords) {
    const dailyParams = new URLSearchParams({
      latitude: coords.lat.toFixed(4),
      longitude: coords.lon.toFixed(4),
      daily: 'weather_code,temperature_2m_max,temperature_2m_min',
      temperature_unit: units === 'celsius' ? 'celsius' : 'fahrenheit',
      timezone: 'auto',
      forecast_days: '6'
    });
    const dailyResponse = await fetch(`https://api.open-meteo.com/v1/forecast?${dailyParams.toString()}`, { cache: 'no-store' });
    if (dailyResponse.ok) {
      const dailyPayload = await dailyResponse.json();
      const daily = dailyPayload?.daily || {};
      const days = Array.isArray(daily.time) ? daily.time : [];
      const highs = Array.isArray(daily.temperature_2m_max) ? daily.temperature_2m_max : [];
      const lows = Array.isArray(daily.temperature_2m_min) ? daily.temperature_2m_min : [];
      const codes = Array.isArray(daily.weather_code) ? daily.weather_code : [];
      forecast = days.slice(1, 6).map((day, index) => ({
        day: forecastDayLabel(day, index),
        iconKey: senseMapWeatherCode(codes[index + 1], true),
        high: highs[index + 1],
        low: lows[index + 1]
      }));
    }
  }

  const todayHigh = Array.isArray(forecast) && forecast.length ? forecast[0].high : null;
  const todayLow = Array.isArray(forecast) && forecast.length ? forecast[0].low : null;

  return {
    temperature: current.temperature,
    condition: current.condition || 'Unknown',
    iconKey: current.iconKey || 'partly_cloudy_day',
    city: resolveSenseLocationName(current, weather, coords),
    units: current.units || units,
    high: Number.isFinite(todayHigh) ? todayHigh : Number.isFinite(current.temperature) ? current.temperature + 4 : 0,
    low: Number.isFinite(todayLow) ? todayLow : Number.isFinite(current.temperature) ? current.temperature - 5 : 0,
    pager: `1/${locationCount}`,
    forecast
  };
}

async function renderSenseWidget(data) {
  if (!senseWidget) return;
  const current = data || senseDemoData();
  const degree = '\u00b0';
  const unit = senseUnitSymbol(current.units);
  if (senseCurrentTemp) {
    senseCurrentTemp.innerHTML = `${escapeHtml(senseFormatTemp(current.temperature))}<span class="sense-current-unit">${degree}</span>`;
  }

  if (senseHighTemp) senseHighTemp.textContent = `H ${senseFormatTemp(current.high)}${degree}${unit}`;
  if (senseLowTemp) senseLowTemp.textContent = `L ${senseFormatTemp(current.low)}${degree}${unit}`;
  if (senseCity) senseCity.textContent = current.city || 'Unknown';
  if (senseCondition) senseCondition.textContent = current.condition || 'Unknown';
  if (sensePageIndicator) sensePageIndicator.textContent = current.pager || '1/1';

  const heroSrc = await senseIconSrcForKey(current.iconKey || 'partly_cloudy_day');
  if (senseHeroMain) senseHeroMain.src = heroSrc;
  if (senseHeroForeground) senseHeroForeground.src = heroSrc;

  if (senseForecast) {
    const rows = Array.isArray(current.forecast) ? current.forecast.slice(0, 5) : [];
    if (!rows.length) {
      const fallback = senseDemoData();
      senseForecast.innerHTML = await Promise.all(fallback.forecast.map(async (item) => {
        const src = await senseIconSrcForKey(item.iconKey);
        return `<div class="sense-forecast-day"><div class="sense-forecast-label">${escapeHtml(item.day)}</div><img class="sense-forecast-icon" src="${escapeHtml(src)}" alt="${escapeHtml(item.day)} weather"><div class="sense-forecast-range">${escapeHtml(senseFormatTemp(item.high))}${degree}/${escapeHtml(senseFormatTemp(item.low))}${degree}</div></div>`;
      })).then((parts) => parts.join(''));
      return;
    }
    senseForecast.innerHTML = await Promise.all(rows.map(async (item) => {
      const src = await senseIconSrcForKey(item.iconKey);
      return `<div class="sense-forecast-day"><div class="sense-forecast-label">${escapeHtml(item.day)}</div><img class="sense-forecast-icon" src="${escapeHtml(src)}" alt="${escapeHtml(item.day)} weather"><div class="sense-forecast-range">${escapeHtml(senseFormatTemp(item.high))}${degree}/${escapeHtml(senseFormatTemp(item.low))}${degree}</div></div>`;
    })).then((parts) => parts.join(''));
  }
}

async function pollSense() {
  if (!widgetVisible('sense') || senseInFlight) return;
  senseInFlight = true;
  try {
    const live = await fetchSenseLiveData();
    await renderSenseWidget(live);
  } catch {
    await renderSenseWidget(senseDemoData());
  } finally {
    senseInFlight = false;
  }
}

function startTopPolling() {
  if (liveStream || liveTimer) return;
  const intervalMs = getTopPollIntervalMs();
  const limit = getTopProcessLimitParam();
  if (typeof EventSource === 'function') {
    const base = getApiBase();
    const url = `${base}/api/system-live-stream?limit=${limit}&interval=${intervalMs}&_ts=${Date.now()}`;
    try {
      liveStream = new EventSource(url);
      liveStreamLastMessageAt = Date.now();
      liveStream.addEventListener('message', (event) => {
        try {
          const payload = JSON.parse(event.data);
          renderTopLive(payload || {});
          liveStreamLastMessageAt = Date.now();
          if (liveTimer) {
            clearInterval(liveTimer);
            liveTimer = null;
          }
        } catch {
        }
      });
      liveStream.addEventListener('error', () => {
        stopTopPollingIfIdle();
        if (!widgetVisible('top')) return;
        if (!liveTimer) {
          liveTimer = setInterval(pollTop, intervalMs);
        }
        pollTop();
      });

      liveStreamWatchdog = setInterval(() => {
        if (!liveStream) return;
        if (Date.now() - liveStreamLastMessageAt > getTopWatchdogMs()) {
          try { liveStream.close(); } catch {}
          liveStream = null;
          if (!liveTimer) {
            liveTimer = setInterval(pollTop, intervalMs);
            pollTop();
          }
        }
      }, 1000);
      return;
    } catch {
      liveStream = null;
    }
  }
  pollTop();
  liveTimer = setInterval(pollTop, intervalMs);
}

function stopTopPollingIfIdle() {
  if (liveStream) {
    try { liveStream.close(); } catch {}
    liveStream = null;
  }
  if (liveStreamWatchdog) {
    clearInterval(liveStreamWatchdog);
    liveStreamWatchdog = null;
  }
  if (!liveTimer) return;
  if (widgetVisible('top')) return;
  clearInterval(liveTimer);
  liveTimer = null;
}

function startFetchPolling() {
  if (fetchTimer) return;
  pollFetch();
  fetchTimer = setInterval(pollFetch, 5000);
}

function stopFetchPollingIfIdle() {
  if (!fetchTimer) return;
  if (widgetVisible('fetch')) return;
  clearInterval(fetchTimer);
  fetchTimer = null;
}

function startSensePolling() {
  if (senseTimer) return;
  void pollSense();
  senseTimer = setInterval(() => {
    void pollSense();
  }, 10 * 60 * 1000);
}

function stopSensePollingIfIdle() {
  if (!senseTimer) return;
  if (widgetVisible('sense')) return;
  clearInterval(senseTimer);
  senseTimer = null;
}

function getNextImageSlot() {
  const used = new Set(imageWidgets.map((entry) => entry.slot));
  for (let i = 1; i <= MAX_IMAGE_WIDGETS; i += 1) {
    if (!used.has(i)) return i;
  }
  return null;
}

function findImageState(slot) {
  let entry = state.images.find((node) => node.slot === slot);
  if (!entry) {
    entry = { slot, visible: true, x: null, y: null };
    state.images.push(entry);
  } else {
    entry.visible = true;
  }
  return entry;
}

function applyImagePosition(entry) {
  if (!entry?.el || !entry.state) return;
  const def = getImageDefaultPosition(entry.slot);
  setWidgetPosition(entry.el, entry.state.x ?? def.x, entry.state.y ?? def.y);
}

function bindImageDrag(entry) {
  if (!entry?.el || !entry.drag) return;
  let dragging = false;
  let offsetX = 0;
  let offsetY = 0;

  const startDrag = (e) => {
    if (e.button !== 0) return;
    if (e.target.closest('.widget-close, button, input, textarea, select, a')) return;

    dragging = true;
    const rect = entry.el.getBoundingClientRect();
    offsetX = e.clientX - rect.left;
    offsetY = e.clientY - rect.top;
    entry.el.classList.add('dragging');
    const line = entry.drag.querySelector('.drag-line');
    if (line) line.style.background = '#ffffff';
    bringToFront(entry.el);
    e.preventDefault();
  };

  entry.drag.addEventListener('mousedown', startDrag);
  entry.el.addEventListener('mousedown', startDrag);

  document.addEventListener('mousemove', (e) => {
    if (!dragging) return;
    setWidgetPosition(entry.el, e.clientX - offsetX, e.clientY - offsetY);
  });

  document.addEventListener('mouseup', () => {
    if (!dragging) return;
    dragging = false;
    entry.el.classList.remove('dragging');
    const line = entry.drag.querySelector('.drag-line');
    if (line) line.style.background = '';
    const rect = entry.el.getBoundingClientRect();
    entry.state.x = Math.round(rect.left);
    entry.state.y = Math.round(rect.top);
    saveState();
  });
}

function bindImageWidget(entry) {
  if (!entry?.el) return;
  entry.el.addEventListener('mousedown', () => bringToFront(entry.el));

  if (entry.placeholder) {
    entry.placeholder.addEventListener('mousedown', (e) => e.stopPropagation());
    entry.placeholder.addEventListener('click', () => openImagePicker(entry));
  }
  if (entry.view) {
    entry.view.addEventListener('mousedown', (e) => e.stopPropagation());
    entry.view.addEventListener('click', () => openImagePicker(entry));
  }
  if (entry.input) {
    entry.input.addEventListener('change', () => handleImageInputChange(entry));
  }
  if (entry.close) {
    entry.close.addEventListener('click', () => destroyImageWidget(entry));
  }
  bindImageDrag(entry);
}

function createImageWidget(slot) {
  if (!imageTemplate) return null;
  let el;
  if (!imageTemplateUsed) {
    el = imageTemplate;
    imageTemplateUsed = true;
  } else {
    el = imageTemplate.cloneNode(true);
    el.removeAttribute('id');
    el.querySelectorAll('[id]').forEach((node) => node.removeAttribute('id'));
    const parent = imageTemplate.parentNode || document.body;
    parent.appendChild(el);
  }

  el.dataset.imageSlot = String(slot);
  const entry = {
    slot,
    el,
    close: el.querySelector('.widget-close'),
    drag: el.querySelector('.menu3run-drag-handle'),
    input: el.querySelector('input[type="file"]'),
    view: el.querySelector('.widget-image-view'),
    placeholder: el.querySelector('.widget-image-placeholder'),
    dataKey: `${IMAGE_WIDGET_DATA_KEY_PREFIX}${slot}`,
    objectUrl: null,
    state: findImageState(slot)
  };

  bindImageWidget(entry);
  restoreImageWidgetFromStorage(entry);
  entry.el.classList.add('active');
  bringToFront(entry.el);
  requestAnimationFrame(() => applyImagePosition(entry));
  imageWidgets.push(entry);
  applyImageWidgetDecor();
  saveState();
  renderMenuState();
  return entry;
}

function initImageWidgetsFromState() {
  if (!imageTemplate || !state.images.length) {
    renderMenuState();
    return;
  }
  state.images
    .slice(0, MAX_IMAGE_WIDGETS)
    .sort((a, b) => a.slot - b.slot)
    .forEach((node) => {
      if (node?.visible !== false) createImageWidget(node.slot);
    });
  renderMenuState();
}

function addImageWidget() {
  const slot = getNextImageSlot();
  if (!slot) {
    const last = imageWidgets[imageWidgets.length - 1];
    if (last?.el) bringToFront(last.el);
    return;
  }
  createImageWidget(slot);
}

function destroyImageWidget(entry) {
  if (!entry) return;
  resetImageWidget(entry, true);
  entry.el?.remove();
  imageWidgets = imageWidgets.filter((item) => item !== entry);
  state.images = state.images.filter((node) => node.slot !== entry.slot);
  saveState();
  renderMenuState();
}

function loadImageFromDataUrl(dataUrl) {
  return new Promise((resolve, reject) => {
    const img = new Image();
    img.onload = () => resolve(img);
    img.onerror = reject;
    img.src = dataUrl;
  });
}

function sampleEdgeBackground(data, width, height) {
  const step = Math.max(1, Math.floor(Math.min(width, height) / 80));
  let sumR = 0;
  let sumG = 0;
  let sumB = 0;
  let sumSqR = 0;
  let sumSqG = 0;
  let sumSqB = 0;
  let count = 0;
  const sampleAt = (x, y) => {
    const idx = (y * width + x) * 4;
    const r = data[idx];
    const g = data[idx + 1];
    const b = data[idx + 2];
    sumR += r;
    sumG += g;
    sumB += b;
    sumSqR += r * r;
    sumSqG += g * g;
    sumSqB += b * b;
    count += 1;
  };

  for (let x = 0; x < width; x += step) {
    sampleAt(x, 0);
    sampleAt(x, height - 1);
  }
  for (let y = step; y < height - step; y += step) {
    sampleAt(0, y);
    sampleAt(width - 1, y);
  }

  const avgR = sumR / Math.max(1, count);
  const avgG = sumG / Math.max(1, count);
  const avgB = sumB / Math.max(1, count);
  const varR = sumSqR / Math.max(1, count) - avgR * avgR;
  const varG = sumSqG / Math.max(1, count) - avgG * avgG;
  const varB = sumSqB / Math.max(1, count) - avgB * avgB;
  return {
    r: avgR,
    g: avgG,
    b: avgB,
    variance: varR + varG + varB
  };
}

function removeWhiteBackgroundIfNeeded(dataUrl) {
  return loadImageFromDataUrl(dataUrl)
    .then((img) => {
      const width = img.naturalWidth || img.width;
      const height = img.naturalHeight || img.height;
      if (!width || !height) return dataUrl;

      const canvas = document.createElement('canvas');
      const ctx = canvas.getContext('2d', { willReadFrequently: true });
      if (!ctx) return dataUrl;
      canvas.width = width;
      canvas.height = height;
      ctx.drawImage(img, 0, 0);

      const imageData = ctx.getImageData(0, 0, width, height);
      const bg = sampleEdgeBackground(imageData.data, width, height);
      const brightness = (bg.r + bg.g + bg.b) / 3;
      if (brightness < 235 || bg.variance > 500) return dataUrl;

      const data = imageData.data;
      const maxDiff = 22;
      const minBright = 230;
      for (let i = 0; i < data.length; i += 4) {
        const r = data[i];
        const g = data[i + 1];
        const b = data[i + 2];
        const pixelBright = (r + g + b) / 3;
        const diff = Math.abs(r - bg.r) + Math.abs(g - bg.g) + Math.abs(b - bg.b);
        const spread = Math.max(r, g, b) - Math.min(r, g, b);
        if (pixelBright >= minBright && diff <= maxDiff * 3 && spread < 18) {
          data[i + 3] = 0;
        }
      }
      ctx.putImageData(imageData, 0, 0);
      return canvas.toDataURL('image/png');
    })
    .catch(() => dataUrl);
}

function restoreImageWidgetFromStorage(entry) {
  if (!entry?.view || !entry.placeholder) return;
  let dataUrl = imageWidgetDataStore[String(entry.slot)] || '';

  if (!dataUrl) {
    try {
      dataUrl = sessionStorage.getItem(entry.dataKey) || '';
      if (!dataUrl && entry.slot === 1) {
        dataUrl = sessionStorage.getItem(LEGACY_IMAGE_WIDGET_DATA_KEY) || '';
        if (dataUrl) {
          try { sessionStorage.setItem(entry.dataKey, dataUrl); } catch {}
          try { sessionStorage.removeItem(LEGACY_IMAGE_WIDGET_DATA_KEY); } catch {}
        }
      }
      if (dataUrl) {
        imageWidgetDataStore[String(entry.slot)] = dataUrl;
        persistWidgetLayout();
      }
    } catch {
      dataUrl = '';
    }
  }

  if (!dataUrl) {
    entry.view.removeAttribute('src');
    entry.view.classList.remove('active');
    entry.placeholder.classList.remove('hidden');
    return;
  }
  entry.view.src = dataUrl;
  entry.view.classList.add('active');
  entry.placeholder.classList.add('hidden');
}

function resetImageWidget(entry, clearStored = true) {
  if (!entry) return;
  if (entry.objectUrl) {
    try { URL.revokeObjectURL(entry.objectUrl); } catch {}
    entry.objectUrl = null;
  }
  if (clearStored) {
    delete imageWidgetDataStore[String(entry.slot)];
    persistWidgetLayout();
    try { sessionStorage.removeItem(entry.dataKey); } catch {}
    if (entry.slot === 1) {
      try { sessionStorage.removeItem(LEGACY_IMAGE_WIDGET_DATA_KEY); } catch {}
    }
  }
  if (entry.input) entry.input.value = '';
  if (entry.view) {
    entry.view.removeAttribute('src');
    entry.view.classList.remove('active');
  }
  if (entry.placeholder) {
    entry.placeholder.classList.remove('hidden');
  }
}

function openImagePicker(entry) {
  if (!entry?.input) return;
  entry.input.click();
}

function handleImageInputChange(entry) {
  if (!entry?.input || !entry.view || !entry.placeholder) return;
  const file = entry.input.files && entry.input.files[0] ? entry.input.files[0] : null;
  if (!file) return;

  const reader = new FileReader();
  reader.onload = async () => {
    const dataUrl = typeof reader.result === 'string' ? reader.result : '';
    if (!dataUrl) return;
    const processed = await removeWhiteBackgroundIfNeeded(dataUrl);
    imageWidgetDataStore[String(entry.slot)] = processed;
    persistWidgetLayout();
    try { sessionStorage.setItem(entry.dataKey, processed); } catch {}
    entry.view.src = processed;
    entry.view.classList.add('active');
    entry.placeholder.classList.add('hidden');
    bringToFront(entry.el);
  };
  reader.readAsDataURL(file);
}

function openOrFocus(which) {
  if (which === 'image') {
    addImageWidget();
    return;
  }
  if (widgetVisible(which)) {
    const el = getWidgetEl(which);
    bringToFront(el);
    return;
  }
  setVisible(which, true);
}

function bindUi() {
  window.addEventListener('storage', (event) => {
    if (event.key !== DEV_SETTINGS_KEY) return;
    loadDevSettings();
  });

  launcherBtn?.addEventListener('click', () => {
    if (menuModal?.classList.contains('active')) closeWidgetsMenu();
    else openWidgetsMenu();
  });

  menuClose?.addEventListener('click', closeWidgetsMenu);
  menuModal?.addEventListener('click', (e) => {
    if (e.target.closest('#widgets-menu-content')) return;
    closeWidgetsMenu();
  });

  menuItemTop?.addEventListener('click', () => {
    openOrFocus('top');
    closeWidgetsMenu();
  });

  menuItemFetch?.addEventListener('click', () => {
    openOrFocus('fetch');
    closeWidgetsMenu();
  });

  menuItemImage?.addEventListener('click', () => {
    addImageWidget();
    closeWidgetsMenu();
  });

  menuItemSense?.addEventListener('click', () => {
    openOrFocus('sense');
    closeWidgetsMenu();
  });

  topClose?.addEventListener('click', () => setVisible('top', false));
  fetchClose?.addEventListener('click', () => setVisible('fetch', false));
  senseClose?.addEventListener('click', () => setVisible('sense', false));

  topWidget?.addEventListener('mousedown', () => bringToFront(topWidget));
  fetchWidget?.addEventListener('mousedown', () => bringToFront(fetchWidget));
  senseWidget?.addEventListener('mousedown', () => bringToFront(senseWidget));

  document.addEventListener('keydown', (e) => {
    if (e.key !== 'Escape') return;
    if (menuModal?.classList.contains('active')) {
      closeWidgetsMenu();
    }
  });

  window.addEventListener('resize', () => {
    placeLauncherButton();
    placeWidgetsMenuNearLauncher();
  });

  window.addEventListener('overlayViewportChanged', () => {
    placeLauncherButton();
    placeWidgetsMenuNearLauncher();
  });
}

export function initOverlayWidgets() {
  launcherBtn = document.getElementById('overlay-widgets-btn');
  launcherHost = document.querySelector('.overlay-widgets-launcher');
  menuModal = document.getElementById('widgets-menu-modal');
  menuClose = document.getElementById('widgets-menu-close');
  menuWrapper = menuModal?.querySelector('.menu3run-modal-wrapper') || null;
  menuItemTop = document.getElementById('widgets-item-3top');
  menuItemFetch = document.getElementById('widgets-item-3fetch');
  menuItemImage = document.getElementById('widgets-item-3image');
  menuItemSense = document.getElementById('widgets-item-sense');

  topWidget = document.getElementById('widget-3top');
  topClose = document.getElementById('widget-3top-close');
  topDrag = document.getElementById('widget-3top-drag-handle');
  topBars = document.getElementById('widget-3top-bars');
  topCpuRows = document.getElementById('widget-3top-cpu-rows');
  topGpuRows = document.getElementById('widget-3top-gpu-rows');
  topMemRows = document.getElementById('widget-3top-mem-rows');
  topTable = document.getElementById('widget-3top-table');
  topTableBody = document.getElementById('widget-3top-table-body');

  fetchWidget = document.getElementById('widget-3fetch');
  fetchClose = document.getElementById('widget-3fetch-close');
  fetchDrag = document.getElementById('widget-3fetch-drag-handle');
  fetchLines = document.getElementById('widget-3fetch-lines');
  fetchDisks = document.getElementById('widget-3fetch-disks');
  fetchLogo = document.querySelector('#widget-3fetch .widget-fetch-logo-large');

  senseWidget = document.getElementById('widget-sense-weather');
  senseClose = document.getElementById('widget-sense-close');
  senseDrag = document.getElementById('widget-sense-drag-handle');
  senseCurrentTemp = document.getElementById('sense-current-temp');
  senseHighTemp = document.getElementById('sense-high-temp');
  senseLowTemp = document.getElementById('sense-low-temp');
  senseCity = document.getElementById('sense-city');
  senseCondition = document.getElementById('sense-condition');
  sensePageIndicator = document.getElementById('sense-page-indicator');
  senseHeroMain = document.getElementById('sense-hero-main');
  senseHeroForeground = document.getElementById('sense-hero-foreground');
  senseHeroGlow = document.getElementById('sense-hero-glow');
  senseLayout = senseWidget?.querySelector('.sense-weather-layout') || null;
  senseForecast = document.getElementById('sense-forecast');

  imageTemplate = document.getElementById('widget-3image');

  loadState();
  loadImageWidgetDataStore();
  loadDevSettings();
  bindUi();
  bindDrag('top', topWidget, topDrag);
  bindDrag('fetch', fetchWidget, fetchDrag);
  bindDrag('sense', senseWidget, senseDrag);

  renderTopLive({});
  void renderSenseWidget(senseDemoData());
  initImageWidgetsFromState();

  placeLauncherButton();

  applySavedPosition('top', topWidget);
  applySavedPosition('fetch', fetchWidget);
  applySavedPosition('sense', senseWidget);

  setVisible('top', state.top.visible === true);
  setVisible('fetch', state.fetch.visible === true);
  setVisible('sense', state.sense.visible === true);
  renderMenuState();
  syncOverlayBlur();
}

export function hasVisibleWidgets() {
  return hasAnyWidgetVisible();
}

export function closeOverlayWidgetsMenu() {
  closeWidgetsMenu();
}

export function isOverlayWidgetsMenuOpen() {
  return !!menuModal?.classList.contains('active');
}

export function setOverlayBlurActive(active) {
  if (active) {
    const baseBlur = getBaseBackgroundBlur();
    postOverlayBlur(Math.max(baseBlur, overlayBlurAmount));
  } else {
    postOverlayBlur(0);
  }
}

export function suppressBlurSync(suppress) {
  _suppressBlurSync = !!suppress;
}
