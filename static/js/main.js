// js/main.js - Main application entry point
import { loadConfig, appConfig, availablePresets } from './config.js';
import { initShaderBackground, applyPresetToUniforms } from './shader-background.js';
import { showToast, updateTimeDisplay, updateHomeScreen, initWeatherStatus, initLogOverlay } from './ui-utils.js';
import { initModals, updateAboutModal, getSystemInfoCachedData } from './modals.js';
import { initThemeSwitcher } from './theme-switcher.js';
import { initDeveloperPanel } from './developer-panel.js';
import { buildProjectUI, initCarousel, initMenuTilt } from './menu.js';
import { initMenu3Elements, openMenu3 } from './menu3.js';
import { initMenu3RunElements, openMenu3Run } from './menu3run.js';
import { initRouter } from './router.js';

const uiAccentPalette = {
  white: { rgb: '255, 255, 255' },
  cyan: { rgb: '102, 198, 255' },
  green: { rgb: '124, 255, 158' },
  amber: { rgb: '255, 176, 0' }
};

function applyCardAlphaFromSettings(settings) {
  const baseAlpha = Number.isFinite(settings?.cardAlpha) ? settings.cardAlpha : null;
  if (baseAlpha === null) return;
  const clamped = Math.max(0, Math.min(1, baseAlpha));
  const headerAlpha = Math.max(0, Math.min(1, clamped + 0.08));
  document.documentElement.style.setProperty('--card-panel-alpha', String(clamped));
  document.documentElement.style.setProperty('--card-header-alpha', String(headerAlpha));
}

function getDeveloperBoolean(storageKey, configKey, fallback) {
  const stored = localStorage.getItem(storageKey);
  if (stored !== null) return stored === 'true';
  const configValue = appConfig?.developerPanelSettings?.[configKey];
  if (typeof configValue === 'boolean') {
    localStorage.setItem(storageKey, configValue ? 'true' : 'false');
    return configValue;
  }
  return fallback;
}

function brightenRgb(rgbString, mix = 0.35) {
  const parts = rgbString.split(',').map((value) => Number.parseFloat(value.trim()));
  const [r, g, b] = parts.length === 3 ? parts : [102, 198, 255];
  const clamp = (value) => Math.max(0, Math.min(255, value));
  const bright = [r, g, b].map((value) => clamp(Math.round(value + (255 - value) * mix)));
  return bright.join(', ');
}

let bgTransitionTimer = null;

function triggerBackgroundTransition(mediaContainer, update) {
  if (!mediaContainer) return;
  if (bgTransitionTimer) {
    clearTimeout(bgTransitionTimer);
  }
  mediaContainer.classList.add('bg-fade-transition');
  const updateDelay = 120;
  bgTransitionTimer = setTimeout(() => {
    if (typeof update === 'function') {
      update();
    }
    requestAnimationFrame(() => {
      mediaContainer.classList.remove('bg-fade-transition');
    });
  }, updateDelay);
}

function applyBackgroundFromConfig(config, options = {}) {
  const bgConfig = config.background || {};
  const mediaContainer = document.getElementById('regular-bg-media');
  if (!mediaContainer) return;

  const headerPosition = bgConfig.headerPosition || 'low';
  document.body.setAttribute('data-header-position', headerPosition);

  const src = bgConfig.src;
  const setMedia = () => {
    mediaContainer.innerHTML = '';
    if (!src) return;
    const isVideo = src.match(/\.(mp4|webm|mov)$/i);

    if (isVideo) {
      const video = document.createElement('video');
      video.src = src;
      video.autoplay = bgConfig.videoAutoplay !== false;
      video.loop = bgConfig.videoLoop !== false;
      video.muted = bgConfig.videoMuted !== false;
      video.playsInline = true;
      video.style.cssText = `
        position: absolute;
        top: 0;
        left: 0;
        width: 100%;
        height: 100%;
        object-fit: ${bgConfig.fit || 'cover'};
        object-position: ${bgConfig.position || 'center'};
        opacity: ${bgConfig.opacity ?? 1};
        filter: blur(${bgConfig.blur || 0}px);
        transform: scale(${bgConfig.scale || 1});
      `;
      mediaContainer.appendChild(video);
    } else {
      const img = document.createElement('img');
      img.src = src;
      img.alt = '';
      img.style.cssText = `
        position: absolute;
        top: 0;
        left: 0;
        width: 100%;
        height: 100%;
        object-fit: ${bgConfig.fit || 'cover'};
        object-position: ${bgConfig.position || 'center'};
        opacity: ${bgConfig.opacity ?? 1};
        filter: blur(${bgConfig.blur || 0}px);
        transform: scale(${bgConfig.scale || 1});
      `;
      mediaContainer.appendChild(img);
    }
  };

  if (document.body.classList.contains('regular-mode') && !options.skipCrt) {
    triggerBackgroundTransition(mediaContainer, setMedia);
  } else {
    setMedia();
  }
}

function resolveBackgroundBlurFromSettings() {
  try {
    const raw = localStorage.getItem('developerSettings');
    if (raw) {
      const parsed = JSON.parse(raw);
      const devBlur = Number.parseFloat(parsed?.backgroundBlur);
      if (Number.isFinite(devBlur)) return Math.max(0, devBlur);
    }
  } catch {
  }

  const panelBlur = Number.parseFloat(appConfig?.developerPanelSettings?.backgroundBlur);
  if (Number.isFinite(panelBlur)) return Math.max(0, panelBlur);

  const configBlur = Number.parseFloat(appConfig?.background?.blur);
  return Number.isFinite(configBlur) ? Math.max(0, configBlur) : 0;
}

function reapplyBackgroundBlur() {
  const mediaContainer = document.getElementById('regular-bg-media');
  if (!mediaContainer) return;
  const blur = resolveBackgroundBlurFromSettings();
  mediaContainer.querySelectorAll('img, video').forEach((node) => {
    node.style.filter = `blur(${blur}px)`;
  });
}



function applyBackgroundFromLibrary(name, options = {}) {
  if (!name) return false;
  const library = appConfig.backgroundLibrary || [];
  const item = library.find((entry) => entry.name === name);
  if (!item) return false;
  appConfig.background = {
    ...appConfig.background,
    src: item.image,
    fit: item.fit || appConfig.background?.fit || 'cover'
  };
  applyBackgroundFromConfig(appConfig, options);
  return true;
}

window.applyBackgroundSelection = function(name) {
  const item = (appConfig.backgroundLibrary || []).find((entry) => entry.name === name);
  if (!item) return;
  
  const bgConfig = {
    ...appConfig.background,
    src: item.image,
    fit: item.fit || 'cover'
  };
  
  appConfig.background = bgConfig;
  applyBackgroundFromConfig({ ...appConfig, background: bgConfig });
  if (document.body.classList.contains('regular-mode')) {
    showToast(`Background: ${item.name}`);
  }
};

function applyHomeImage(config) {
  const homeImage = document.getElementById('home-image');
  if (!homeImage) return;

  if (config.homeImage) {
    homeImage.src = config.homeImage;
    homeImage.style.objectFit = config.homeImageFit || 'cover';
    homeImage.style.objectPosition = `${config.homeImageCropX || 50}% ${config.homeImageCropY || 50}%`;
    homeImage.style.opacity = config.homeImageOpacity ?? 0.7;
    homeImage.style.transform = `scale(${config.homeImageZoom || 1})`;
    homeImage.style.display = 'block';
  } else {
    homeImage.style.display = 'none';
  }
}

function applyModeToggleOffset(config) {
  const offset = config.accountForWindowsVersionInfo ? 16 : 0;
  document.documentElement.style.setProperty('--mode-toggle-offset', `${offset}px`);
}

function applyVersionInfoVisibility() {
  const infoEl = document.getElementById('version-info');
  if (!infoEl) return;
  const show = localStorage.getItem('devShowVersionInfo') === 'true';
  infoEl.style.display = show ? 'flex' : 'none';
}

async function updateVersionInfo() {
  const infoEl = document.getElementById('version-info');
  if (!infoEl) return;

  const osEl = document.getElementById('version-os');
  const appEl = document.getElementById('version-app');

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

window.__setVersionInfoVisible = applyVersionInfoVisibility;

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

async function applyPresetByName(presetName, shaderRefs) {
  const presetFile = availablePresets[presetName];
  if (!presetFile || !shaderRefs) return false;
  try {
    const response = await fetch(presetFile);
    if (!response.ok) return false;
    const presetData = await response.json();
    applyPresetToUniforms(presetData, shaderRefs.uniforms, shaderRefs.mesh, shaderRefs.materialProcedural, shaderRefs.materialTexture);
    return true;
  } catch (e) {
    console.error('Error loading preset:', e);
    return false;
  }
}

function initModeToggle() {
  const mode3d = document.getElementById('mode-3d');
  const modeRegular = document.getElementById('mode-regular');

  if (!mode3d || !modeRegular) return;

  mode3d.addEventListener('click', () => {
    document.body.classList.remove('regular-mode');
    mode3d.classList.add('active');
    modeRegular.classList.remove('active');
    localStorage.setItem('displayMode', 'shader');
    initThemeSwitcher();
  });

  modeRegular.addEventListener('click', () => {
    document.body.classList.add('regular-mode');
    modeRegular.classList.add('active');
    mode3d.classList.remove('active');
    localStorage.setItem('displayMode', 'image');
    const lastBackground = localStorage.getItem('lastBackground') || appConfig.defaultBackground || '';
    if (!applyBackgroundFromLibrary(lastBackground, { skipCrt: true })) {
      applyBackgroundFromConfig(appConfig, { skipCrt: true });
    }
    initThemeSwitcher();
  });
}

function initGlobalShortcuts() {
  const handler = (e) => {
    if (e.repeat) return;
    const altPressed = e.altKey || e.getModifierState?.('AltGraph');
    if (!altPressed) return;
    const target = e.target;
    const tag = target?.tagName;
    if (target?.isContentEditable || tag === 'INPUT' || tag === 'TEXTAREA' || tag === 'SELECT') {
      return;
    }

    const key = e.key?.toLowerCase?.() || '';
    const code = e.code || '';
    if (key === 'r') {
      e.preventDefault();
      openMenu3Run({ lockToCursor: true });
      return;
    }

    if (key === '3' || code === 'Digit3' || code === 'Numpad3') {
      e.preventDefault();
      openMenu3({ lockToCursor: true });
    }
  };

  window.addEventListener('keydown', handler, true);
}

async function init() {
  await loadConfig();

  applyModeToggleOffset(appConfig);

  const shaderRefs = initShaderBackground();

  initModals();
  buildProjectUI();
  initCarousel();
  initMenuTilt();
  initMenu3Elements();
  initMenu3RunElements();
  initRouter();
  initModeToggle();
  initGlobalShortcuts();
  initThemeSwitcher();

  if (appConfig.devMode && shaderRefs) {
    initDeveloperPanel(shaderRefs);
  }

  const siteLogo = document.getElementById('site-logo');
  const siteTagline = document.getElementById('site-tagline');
  if (siteLogo) siteLogo.textContent = appConfig.logo || '3 TOMOE';
  if (siteTagline) siteTagline.textContent = appConfig.tagline || 'Desktop Experience';
  updateHomeScreen(appConfig);
  updateAboutModal(appConfig);
  document.getElementById('about-text').textContent = appConfig.about || 'Creative development lab exploring the intersection of design and technology.';
  getDeveloperBoolean('devShowVersionInfo', 'showVersionInfo', false);
  getDeveloperBoolean('showTimeZone', 'showTimeZone', true);
  getDeveloperBoolean('showLogs', 'showLogs', false);
  applyVersionInfoVisibility();
  void updateVersionInfo();

  initWeatherStatus(appConfig);
  initLogOverlay(appConfig);

  const showHomeBox = localStorage.getItem('devShowHomeBox') !== 'false';
  const showStatusLine = localStorage.getItem('devShowStatusLine') !== 'false';
  const showHeader = localStorage.getItem('devShowHeader') !== 'false';
  const showHomeBoxResolved = getDeveloperBoolean('devShowHomeBox', 'showHomeBox', showHomeBox);
  const showStatusLineResolved = getDeveloperBoolean('devShowStatusLine', 'showStatusLine', showStatusLine);
  const showHeaderResolved = getDeveloperBoolean('devShowHeader', 'showHeader', showHeader);

  const homeBox = document.querySelector('.home-container');
  const statusLine = document.querySelector('.status-line');
  const header = document.querySelector('.home-logo-section');

  if (homeBox) homeBox.style.display = showHomeBoxResolved ? 'flex' : 'none';
  if (statusLine) statusLine.style.display = showStatusLineResolved ? 'flex' : 'none';
  if (header) header.style.display = showHeaderResolved ? 'block' : 'none';

  const lastBackground = localStorage.getItem('lastBackground');
  const fallbackBackground = appConfig.defaultBackground || '';
  const resolvedBackground = lastBackground || fallbackBackground;
  if (!applyBackgroundFromLibrary(resolvedBackground, { skipCrt: true })) {
    applyBackgroundFromConfig(appConfig, { skipCrt: true });
  }
  reapplyBackgroundBlur();
  applyHomeImage(appConfig);

  const savedSettingsStr = localStorage.getItem('developerSettings');
  const configSettings = appConfig?.developerPanelSettings;
  if (!savedSettingsStr && configSettings && typeof configSettings === 'object') {
    try {
      localStorage.setItem('developerSettings', JSON.stringify(configSettings));
    } catch (e) {
    }
  }
  const settingsSource = savedSettingsStr || (configSettings ? JSON.stringify(configSettings) : '');
  if (settingsSource) {
    try {
      const savedSettings = JSON.parse(settingsSource);
      if (savedSettings.uiAccentPreset) {
        const palette = uiAccentPalette[savedSettings.uiAccentPreset] || uiAccentPalette.cyan;
        document.documentElement.style.setProperty('--ui-accent-rgb', palette.rgb);
        document.documentElement.style.setProperty('--ui-accent-bright-rgb', brightenRgb(palette.rgb));
      }
      applyCardAlphaFromSettings(savedSettings);
    } catch (e) {
      console.error('Error loading saved developer settings:', e);
    }
  }

  const savedPresetName = localStorage.getItem('lastPreset');
  const presetToApply = resolvePresetName(savedPresetName);

  if (presetToApply && shaderRefs) {
    localStorage.setItem('lastPreset', presetToApply);
    await applyPresetByName(presetToApply, shaderRefs);
  }

  updateTimeDisplay();

  window.addEventListener('applyPreset', (e) => {
    if (shaderRefs && e.detail) {
      applyPresetToUniforms(e.detail, shaderRefs.uniforms, shaderRefs.mesh, shaderRefs.materialProcedural, shaderRefs.materialTexture);
    }
  });

}

init().catch(console.error);
