// js/modals.js - Modal systems (About and Image)
import { appConfig } from './config.js';
import { getApiBase } from './ui-utils.js';

export function updateAboutModal(config) {
  const logoImg = document.getElementById('about-logo-img');
  const logoText = document.getElementById('about-logo-text');
  const aboutFooter = document.getElementById('about-footer');
  const aboutVersion = document.getElementById('about-version');
  const aboutBuildDate = document.getElementById('about-build-date');
  const aboutUrl = document.getElementById('about-url');
  const aboutCopyright = document.getElementById('about-copyright');
  
  if (config.logoImage && logoImg) {
    logoImg.src = config.logoImage;
    logoImg.style.display = 'block';
    if (config.logoInvert) {
      logoImg.classList.add('inverted');
    } else {
      logoImg.classList.remove('inverted');
    }
  } else if (logoImg) {
    logoImg.style.display = 'none';
  }
  
  if (logoText) {
    logoText.textContent = config.logo || '3 TOMOE';
  }
  
  if (aboutFooter) {
    if (config.version || config.buildDate || config.siteUrl || config.copyright) {
      aboutFooter.style.display = 'block';
      if (aboutVersion) aboutVersion.textContent = config.version || '';
      if (aboutBuildDate) aboutBuildDate.textContent = config.buildDate || '';
      if (aboutUrl) aboutUrl.textContent = config.siteUrl || '';
      if (aboutCopyright) aboutCopyright.textContent = config.copyright || '';
    } else {
      aboutFooter.style.display = 'none';
    }
  }
}

export function openAbout() {
  const aboutModal = document.getElementById('about-modal');
  if (aboutModal) {
    updateAboutModal(appConfig);
    aboutModal.classList.add('active');
  }
}

export function closeAbout() {
  const aboutModal = document.getElementById('about-modal');
  if (aboutModal) {
    aboutModal.classList.remove('active');
  }
}

async function fetchSystemInfo() {
  const apiBase = getApiBase();
  const response = await fetch(`${apiBase}/api/system-info`, { cache: 'no-store' });
  if (!response.ok) {
    throw new Error('System info request failed');
  }
  return response.json();
}

const SYSTEM_INFO_CACHE_TTL_MS = 30000;
const SYSTEM_INFO_DISK_CACHE_KEY = 'systemInfoCacheV1';
let systemInfoCachedData = null;
let systemInfoCachedAt = 0;
let systemInfoInFlight = null;

function readSystemInfoDiskCache() {
  try {
    const raw = localStorage.getItem(SYSTEM_INFO_DISK_CACHE_KEY);
    if (!raw) return null;
    const parsed = JSON.parse(raw);
    if (!parsed || typeof parsed !== 'object') return null;
    if (typeof parsed.cachedAt !== 'number' || !parsed.data || typeof parsed.data !== 'object') {
      return null;
    }
    return parsed;
  } catch {
    return null;
  }
}

function writeSystemInfoDiskCache(data, cachedAt) {
  try {
    localStorage.setItem(SYSTEM_INFO_DISK_CACHE_KEY, JSON.stringify({ data, cachedAt }));
  } catch {
    // Ignore storage failures.
  }
}

function getCachedSystemInfo(options = {}) {
  const allowStale = options.allowStale === true;

  if (!systemInfoCachedData) return null;
  if (!allowStale && Date.now() - systemInfoCachedAt > SYSTEM_INFO_CACHE_TTL_MS) return null;
  return systemInfoCachedData;
}

function getCachedSystemInfoFromDisk(options = {}) {
  const allowStale = options.allowStale === true;
  const disk = readSystemInfoDiskCache();
  if (!disk) return null;
  if (!allowStale && Date.now() - disk.cachedAt > SYSTEM_INFO_CACHE_TTL_MS) return null;

  systemInfoCachedData = disk.data;
  systemInfoCachedAt = disk.cachedAt;
  return disk.data;
}

async function getSystemInfoCached(options = {}) {
  const memoryCached = getCachedSystemInfo(options);
  if (memoryCached) return memoryCached;

  const diskCached = getCachedSystemInfoFromDisk(options);
  if (diskCached) return diskCached;

  if (systemInfoInFlight) {
    return systemInfoInFlight;
  }

  systemInfoInFlight = fetchSystemInfo()
    .then((data) => {
      systemInfoCachedData = data || {};
      systemInfoCachedAt = Date.now();
      writeSystemInfoDiskCache(systemInfoCachedData, systemInfoCachedAt);
      return systemInfoCachedData;
    })
    .finally(() => {
      systemInfoInFlight = null;
    });

  return systemInfoInFlight;
}

export async function getSystemInfoCachedData(options = {}) {
  return getSystemInfoCached(options);
}

function renderSystemInfo(data) {
  const metaEl = document.getElementById('system-info-meta');
  const listEl = document.getElementById('system-info-list');
  if (metaEl) metaEl.textContent = data.userHost || '';
  if (!listEl) return;

  const escapeHtml = (value) => {
    if (value === null || value === undefined) return '';
    return String(value)
      .replace(/&/g, '&amp;')
      .replace(/</g, '&lt;')
      .replace(/>/g, '&gt;')
      .replace(/"/g, '&quot;')
      .replace(/'/g, '&#39;');
  };

  const rows = [
    { label: 'OS', value: data.os },
    { label: 'Host', value: data.host },
    { label: 'Kernel', value: data.kernel },
    { label: 'Uptime', value: data.uptime },
    { label: 'Display', value: data.display },
    { label: 'CPU', value: data.cpu },
    { label: 'GPU', value: Array.isArray(data.gpu) ? data.gpu[0] : data.gpu },
    { label: 'Memory', value: data.memory },
    { label: 'Local IP', value: data.localIp }
  ];

  const hasValue = (value) => {
    if (Array.isArray(value)) return value.length > 0;
    if (value && typeof value === 'object') return Boolean(value.name || value.driver || value.sub);
    return Boolean(value);
  };

  const disks = Array.isArray(data.disks) ? data.disks : [];
  let diskBlock = '';
  if (disks.length) {
    diskBlock = `
      <div class="system-info-row system-info-disks-row">
        <div class="system-info-label">Disks</div>
        <div class="system-info-value">
          <div class="diskTable">
            <div class="diskRow diskHead">
              <div>VOL</div><div>USED</div><div>TOTAL</div><div>%</div><div>FS</div><div>TAG</div>
            </div>
            ${disks.map((disk) => `
              <div class="diskRow">
                <div>${escapeHtml(disk.vol || '')}</div>
                <div>${escapeHtml(disk.used || '')}</div>
                <div>${escapeHtml(disk.total || '')}</div>
                <div>${escapeHtml(disk.pct || '')}</div>
                <div>${escapeHtml(disk.fs || '')}</div>
                <div>${escapeHtml(disk.tag || '')}</div>
              </div>
            `).join('')}
          </div>
        </div>
      </div>
    `;
  }

  const formatValue = (value) => {
    if (typeof value === 'object' && value !== null) {
      if (Array.isArray(value)) {
        return escapeHtml(value.join(' / '));
      }
      const model = escapeHtml(value.name || '');
      const driver = escapeHtml(value.driver || '');
      const sub = escapeHtml(value.sub || '');
      if (model && driver) {
        return `${model}<div class="system-info-sub">Driver ${driver}</div>`;
      }
      if (model && sub) {
        return `${model}<div class="system-info-sub">${sub}</div>`;
      }
      return model || driver || sub || '';
    }
    return escapeHtml(value);
  };

  listEl.innerHTML = [
    ...rows.filter((row) => hasValue(row.value)).map((row) => (
      `<div class="system-info-row">
        <div class="system-info-label">${escapeHtml(row.label)}</div>
        <div class="system-info-value">${formatValue(row.value)}</div>
      </div>`
    )),
    diskBlock
  ].join('');
}

export async function openSystemInfo() {
  const systemModal = document.getElementById('system-info-modal');
  if (systemModal) {
    systemModal.classList.add('active');
  }

  const staleCached = getCachedSystemInfo({ allowStale: true }) || getCachedSystemInfoFromDisk({ allowStale: true });
  if (staleCached) {
    renderSystemInfo(staleCached);
  }

  try {
    const data = await getSystemInfoCached();
    renderSystemInfo(data || {});
  } catch (err) {
    if (staleCached) {
      renderSystemInfo(staleCached);
      return;
    }
    renderSystemInfo({ userHost: '', disks: [], localIp: '', os: '', host: '', kernel: '', uptime: '', display: '', cpu: '', gpu: '', memory: 'Unavailable' });
  }
}

export function closeSystemInfo() {
  const systemModal = document.getElementById('system-info-modal');
  if (systemModal) {
    systemModal.classList.remove('active');
  }
}

export function openImageModal(url, title) {
  const imageModal = document.getElementById('image-modal');
  const imageDisplay = document.getElementById('image-display');
  const imageTitle = document.getElementById('image-title');
  
  if (imageDisplay) imageDisplay.src = url;
  if (imageTitle) imageTitle.textContent = title || 'Image';
  if (imageModal) imageModal.classList.add('active');
}

export function closeImageModal() {
  const imageModal = document.getElementById('image-modal');
  if (imageModal) {
    imageModal.classList.remove('active');
  }
}

export function initModals() {
  // Close about modal on close button click
  const aboutClose = document.getElementById('about-close');
  if (aboutClose) {
    aboutClose.addEventListener('click', closeAbout);
  }
  
  // Close about modal when clicking outside
  const aboutModal = document.getElementById('about-modal');
  // Scrim click does not close about - use Escape or close button instead.
  
  // Close about modal on Escape key
  document.addEventListener('keydown', (e) => {
    if (e.key === 'Escape' && aboutModal?.classList.contains('active')) {
      closeAbout();
    }
  });

  const systemClose = document.getElementById('system-close');
  if (systemClose) {
    systemClose.addEventListener('click', closeSystemInfo);
  }

  const systemModal = document.getElementById('system-info-modal');
  // Scrim click does not close system info - use Escape or close button instead.

  document.addEventListener('keydown', (e) => {
    if (e.key === 'Escape' && systemModal?.classList.contains('active')) {
      closeSystemInfo();
    }
  });
  
  // Image modal close handlers
  const imageClose = document.getElementById('image-close');
  const imageModal = document.getElementById('image-modal');
  
  if (imageClose) {
    imageClose.addEventListener('click', closeImageModal);
  }
  
  // Scrim click does not close image modal - use Escape or close button instead.
  
  document.addEventListener('keydown', (e) => {
    if (e.key === 'Escape' && imageModal?.classList.contains('active')) {
      closeImageModal();
    }
  });
}
