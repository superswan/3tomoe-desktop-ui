// js/ui-utils.js - UI Utility functions

import { appConfig } from './config.js';

function readCssPxVar(name, fallback) {
  try {
    const raw = getComputedStyle(document.documentElement).getPropertyValue(name).trim();
    if (!raw) return fallback;
    const parsed = Number.parseFloat(raw.replace('px', ''));
    return Number.isFinite(parsed) ? parsed : fallback;
  } catch {
    return fallback;
  }
}

function getVersionLineHeightPx() {
  const fallback = readCssPxVar('--version-line-height', 16);
  const ids = ['overlay-version-info', 'version-info'];
  for (const id of ids) {
    const el = document.getElementById(id);
    if (!el) continue;
    const rect = el.getBoundingClientRect();
    if (rect.height > 0) {
      return Math.max(fallback, rect.height);
    }
  }
  return fallback;
}

function applyToastBottomPosition(toast) {
  if (!toast) return;
  const debugBottom = readCssPxVar('--debug-bottom', 70);
  const versionGap = readCssPxVar('--toast-version-gap', 14);
  const versionHeight = getVersionLineHeightPx();
  toast.style.bottom = `${debugBottom + versionHeight + versionGap}px`;
}

export function showToast(message, duration = 2000) {
  const existing = document.getElementById('toast-notification');
  if (existing) existing.remove();
  
  const toast = document.createElement('div');
  toast.id = 'toast-notification';
  toast.className = 'toast-notification toast-blink-in';

  const frame = document.createElement('div');
  frame.className = 'toast-frame';

  ['tl', 'tr', 'bl', 'br'].forEach((corner) => {
    const cornerEl = document.createElement('span');
    cornerEl.className = `toast-corner ${corner}`;
    frame.appendChild(cornerEl);
  });

  const messageEl = document.createElement('span');
  messageEl.className = 'toast-message';
  messageEl.textContent = message;

  frame.appendChild(messageEl);
  toast.appendChild(frame);
  applyToastBottomPosition(toast);
  document.body.appendChild(toast);
  requestAnimationFrame(() => applyToastBottomPosition(toast));
  
  requestAnimationFrame(() => {
    toast.classList.add('toast-visible');
    setTimeout(() => toast.classList.remove('toast-blink-in'), 500);
  });
  
  setTimeout(() => {
    toast.classList.add('toast-blink-out');
    toast.classList.remove('toast-visible');
    setTimeout(() => toast.remove(), 300);
  }, duration);
}

function normalizeApiBase(value) {
  if (!value) return '';
  return value.replace(/\/+$/, '');
}

export function getApiBase() {
  const configBase = appConfig.apiBase || appConfig.apiBaseUrl || appConfig.commandApiBase || '';
  const normalized = normalizeApiBase(configBase);
  if (normalized) return normalized;

  const origin = window.location.origin;
  const hostname = window.location.hostname;
  const port = window.location.port;
  if (!origin || origin === 'null') {
    return 'http://localhost:5000';
  }

  if ((hostname === '127.0.0.1' || hostname === 'localhost') && port === '5500') {
    return 'http://127.0.0.1:5055';
  }

  return origin;
}

export async function executeAppCommand(cmd) {
  const base = getApiBase();
  const url = `${base}/api/execute-app?cmd=${encodeURIComponent(cmd)}`;

  const logLabel = `[Run] ${cmd}`;
  console.groupCollapsed(logLabel);
  console.log('Location:', window.location.href);
  console.log('API base:', base);
  console.log('Request URL:', url);

  try {
    const response = await fetch(url);
    const text = await response.text();
    let data = null;
    try {
      data = text ? JSON.parse(text) : null;
    } catch (e) {
      data = null;
    }

    console.log('Response status:', response.status, response.statusText);
    console.log('Response body:', text || '(empty)');

    if (!response.ok) {
      window.dispatchEvent(new CustomEvent('appCommandExecuted', {
        detail: {
          ok: false,
          cmd,
          message: data?.error || `Failed to launch: ${cmd}`
        }
      }));
      console.groupEnd();
      return {
        ok: false,
        message: data?.error || `Failed to launch: ${cmd}`
      };
    }

    window.dispatchEvent(new CustomEvent('appCommandExecuted', {
      detail: {
        ok: true,
        cmd,
        message: data?.message || `Launched: ${cmd}`
      }
    }));
    console.groupEnd();
    return {
      ok: true,
      message: data?.message || `Launched: ${cmd}`
    };
  } catch (error) {
    console.error('Request failed:', error);
    window.dispatchEvent(new CustomEvent('appCommandExecuted', {
      detail: {
        ok: false,
        cmd,
        message: 'Run service not reachable'
      }
    }));
    console.groupEnd();
    return {
      ok: false,
      message: 'Run service not reachable'
    };
  }
}

export const pad = (n) => String(n).padStart(2, '0');

export function sortLinks(links) {
  const order = { img: 0, vid: 1, git: 2 };
  return [...(links || [])].sort((a, b) => (order[a.type] ?? 99) - (order[b.type] ?? 99));
}

export function updateTimeDisplay() {
  const dateEl = document.getElementById('status-date');
  const timeEl = document.getElementById('status-time');
  
  if (!dateEl || !timeEl) return;
  
  const now = new Date();
  const showTimeZone = localStorage.getItem('showTimeZone') !== 'false';
  
  const dateStr = now.toLocaleDateString('en-US', {
    month: '2-digit',
    day: '2-digit',
    year: 'numeric'
  });

  const timeOptions = {
    hour12: false,
    hour: '2-digit',
    minute: '2-digit',
    second: '2-digit'
  };

  let timeStr;
  if (showTimeZone && typeof Intl !== 'undefined' && Intl.DateTimeFormat) {
    const formatter = new Intl.DateTimeFormat('en-US', { ...timeOptions, timeZoneName: 'short' });
    if (formatter.formatToParts) {
      const parts = formatter.formatToParts(now);
      const timeParts = [];
      let zone = '';
      parts.forEach((part) => {
        if (part.type === 'timeZoneName') {
          zone = part.value;
        } else {
          timeParts.push(part.value);
        }
      });
      timeStr = zone ? `${timeParts.join('')} ${zone}` : timeParts.join('');
    } else {
      timeStr = formatter.format(now);
    }
  } else {
    timeStr = now.toLocaleTimeString('en-US', timeOptions);
  }
  
  dateEl.textContent = dateStr;
  timeEl.textContent = timeStr;
}

let weatherIconMapCache = null;
let weatherTimer = null;
let weatherInFlight = false;
let weatherCoords = null;
let weatherGeoAttempted = false;

function parseWeatherIconMap(text) {
  const map = {};
  const lines = text.split('\n');
  const pattern = /"([^"]+)"\s*:\s*\{\s*key:\s*"([^"]+)"\s*,\s*label:\s*"([^"]+)"\s*\}/;
  lines.forEach((line) => {
    const match = line.match(pattern);
    if (match) {
      const file = match[1];
      const key = match[2];
      const label = match[3];
      map[key] = { file, label };
    }
  });
  return map;
}

export async function loadWeatherIconMap() {
  if (weatherIconMapCache) return weatherIconMapCache;
  try {
    const response = await fetch('static/image/weather-icons/icon-map');
    if (!response.ok) throw new Error('Failed to load weather icon map');
    const text = await response.text();
    weatherIconMapCache = parseWeatherIconMap(text);
    return weatherIconMapCache;
  } catch (err) {
    console.error('Weather icon map load failed:', err);
    return null;
  }
}

export async function setWeatherIcon(weatherKey) {
  const map = await loadWeatherIconMap();
  if (!map) return;
  const key = weatherKey || localStorage.getItem('debugWeatherKey') || Object.keys(map)[0];
  const entry = map[key];
  if (!entry) return;

  const iconEl = document.getElementById('status-weather-icon');
  if (iconEl) {
    iconEl.src = `static/image/weather-icons/${entry.file}`;
    iconEl.alt = entry.label;
    iconEl.title = entry.label;
  }
}

const DEGREE_SYMBOL = '\u00b0';

function normalizeUnits(value) {
  const units = String(value || '').trim().toLowerCase();
  if (units === 'c' || units === 'celsius' || units === 'metric') return 'celsius';
  return 'fahrenheit';
}

function getUnitSymbol(units) {
  return units === 'celsius' ? `${DEGREE_SYMBOL}C` : `${DEGREE_SYMBOL}F`;
}

function getConfigCoords(config) {
  const weather = (config && config.weather) || {};
  const lat = Number.parseFloat(weather.latitude);
  const lon = Number.parseFloat(weather.longitude);
  if (Number.isFinite(lat) && Number.isFinite(lon)) {
    return { lat, lon };
  }
  return null;
}

function shouldUseGeolocation(config, hasConfigCoords) {
  const weather = (config && config.weather) || {};
  if (weather.useGeolocation === true) return true;
  if (weather.useGeolocation === false) return false;
  return !hasConfigCoords;
}

function getWeatherApiBase(config) {
  const weather = (config && config.weather) || {};
  const apiBase = (weather.apiBase || '').trim();
  if (apiBase) return apiBase.replace(/\/$/, '');
  if (window.location.protocol === 'file:') return 'http://localhost:5055';
  return '';
}

function setWeatherPlaceholder(units) {
  const textEl = document.getElementById('status-weather-text');
  if (textEl) {
    textEl.textContent = `--${getUnitSymbol(units)}`;
  }
  const iconEl = document.getElementById('status-weather-icon');
  if (iconEl) {
    iconEl.removeAttribute('src');
    iconEl.alt = '';
    iconEl.title = '';
    iconEl.style.display = 'none';
  }
}

function buildWeatherText(data, unitsFallback) {
  const units = normalizeUnits(data.units || unitsFallback);
  const unitSymbol = getUnitSymbol(units);
  const temperature = Number.isFinite(data.temperature) ? Math.round(data.temperature) : null;
  const parts = [];
  if (temperature !== null) parts.push(`${temperature}${unitSymbol}`);
  if (data.condition) parts.push(String(data.condition).toUpperCase());
  return parts.length ? parts.join(' / ') : `--${unitSymbol}`;
}

async function resolveWeatherCoords(config) {
  if (weatherCoords) return weatherCoords;
  const configCoords = getConfigCoords(config);
  const useGeo = shouldUseGeolocation(config, Boolean(configCoords));
  if (!useGeo) return configCoords;
  if (weatherGeoAttempted) return configCoords;
  weatherGeoAttempted = true;

  if (!navigator.geolocation) return configCoords;

  try {
    const coords = await new Promise((resolve, reject) => {
      const timeoutMs = 6000;
      let settled = false;
      const timeoutId = setTimeout(() => {
        if (settled) return;
        settled = true;
        reject(new Error('Geolocation timeout'));
      }, timeoutMs);

      navigator.geolocation.getCurrentPosition(
        (pos) => {
          if (settled) return;
          settled = true;
          clearTimeout(timeoutId);
          resolve({ lat: pos.coords.latitude, lon: pos.coords.longitude });
        },
        (err) => {
          if (settled) return;
          settled = true;
          clearTimeout(timeoutId);
          reject(err);
        },
        { enableHighAccuracy: false, maximumAge: 10 * 60 * 1000, timeout: timeoutMs }
      );
    });
    weatherCoords = coords;
    return coords;
  } catch (err) {
    return configCoords;
  }
}

async function fetchWeatherData(config, coords, units) {
  const apiBase = getWeatherApiBase(config);
  const params = new URLSearchParams();
  if (coords) {
    params.set('lat', coords.lat.toFixed(4));
    params.set('lon', coords.lon.toFixed(4));
  }
  if (units) params.set('units', units);

  const weather = (config && config.weather) || {};
  if (weather.label) params.set('label', weather.label);

  const query = params.toString();
  const url = `${apiBase}/api/weather${query ? `?${query}` : ''}`;
  const response = await fetch(url, { cache: 'no-store' });
  if (!response.ok) {
    throw new Error(`Weather request failed (${response.status})`);
  }
  const data = await response.json();
  if (data.error) {
    throw new Error(data.error);
  }
  return data;
}

async function applyWeatherData(data, unitsFallback) {
  const textEl = document.getElementById('status-weather-text');
  if (textEl) {
    textEl.textContent = buildWeatherText(data, unitsFallback);
  }

  const iconEl = document.getElementById('status-weather-icon');
  const debugKey = localStorage.getItem('debugWeatherKey');
  const iconKey = data.iconKey || debugKey;

  if (iconEl) {
    if (iconKey) {
      iconEl.style.display = '';
      await setWeatherIcon(iconKey);
    } else {
      iconEl.style.display = 'none';
    }
  }
}

export function initWeatherStatus(config = {}) {
  const units = normalizeUnits((config.weather || {}).units);
  const refreshSecondsRaw = Number.parseFloat((config.weather || {}).refreshSeconds);
  const refreshMinutesRaw = Number.parseFloat((config.weather || {}).refreshMinutes);
  let refreshMs = 5 * 60 * 1000;
  if (Number.isFinite(refreshSecondsRaw)) {
    refreshMs = Math.max(5, refreshSecondsRaw) * 1000;
  } else if (Number.isFinite(refreshMinutesRaw)) {
    refreshMs = Math.max(0.5, refreshMinutesRaw) * 60 * 1000;
  }

  if (weatherTimer) {
    clearInterval(weatherTimer);
    weatherTimer = null;
  }

  setWeatherPlaceholder(units);

  const update = async () => {
    if (weatherInFlight) return;
    weatherInFlight = true;
    try {
      const coords = await resolveWeatherCoords(config);
      const data = await fetchWeatherData(config, coords, units);
      await applyWeatherData(data, units);
    } catch (err) {
      console.warn('Weather update failed:', err);
      setWeatherPlaceholder(units);
    } finally {
      weatherInFlight = false;
    }
  };

  update();
  weatherTimer = setInterval(update, refreshMs);

  const statusLine = document.getElementById('status-line');
  if (statusLine && !statusLine.dataset.weatherRefreshBound) {
    statusLine.addEventListener('click', () => update());
    statusLine.dataset.weatherRefreshBound = 'true';
  }
}

export function updateHomeScreen(config) {
  const homeLogo = document.getElementById('home-site-logo');
  const homeTagline = document.getElementById('home-site-tagline');
  
  if (homeLogo) homeLogo.textContent = config.logo || '3 TOMOE';
  if (homeTagline) homeTagline.textContent = config.tagline || 'Systems Research Lab';
}

let logTimer = null;
let logVisible = false;
let lastLogText = '';
let logApiBase = '';

function resolveLogApiBase(config) {
  const apiBase = (config && config.apiBase) || (config && config.weather && config.weather.apiBase) || '';
  if (apiBase) return apiBase.replace(/\/$/, '');
  if (window.location.protocol === 'file:') return 'http://localhost:5055';
  return '';
}

async function fetchLogs() {
  if (!logVisible) return;
  const output = document.getElementById('log-output');
  if (!output) return;
  try {
    const response = await fetch(`${logApiBase}/api/logs?limit=120`, { cache: 'no-store' });
    if (!response.ok) return;
    const data = await response.json();
    const lines = Array.isArray(data.lines) ? data.lines : [];
    const text = lines.join('\n');
    if (text !== lastLogText) {
      output.textContent = text;
      lastLogText = text;
      output.scrollTop = output.scrollHeight;
    }
  } catch (err) {
    return;
  }
}

function startLogPolling() {
  if (logTimer) return;
  fetchLogs();
  logTimer = setInterval(fetchLogs, 1000);
}

function stopLogPolling() {
  if (!logTimer) return;
  clearInterval(logTimer);
  logTimer = null;
}

export function setLogOverlayVisible(show) {
  const overlay = document.getElementById('log-overlay');
  if (!overlay) return;
  logVisible = Boolean(show);
  overlay.classList.toggle('hidden', !logVisible);
  localStorage.setItem('showLogs', logVisible ? 'true' : 'false');
  if (logVisible) {
    startLogPolling();
  } else {
    stopLogPolling();
  }
}

export function initLogOverlay(config) {
  logApiBase = resolveLogApiBase(config);
  const showLogs = localStorage.getItem('showLogs') === 'true';
  setLogOverlayVisible(showLogs);
}
