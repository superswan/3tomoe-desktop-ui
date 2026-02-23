// js/theme-switcher.js - Theme and preset switching
import { appConfig, availablePresets } from './config.js';
import { showToast } from './ui-utils.js';

let themeSwitcher = null;
let styleTag = null;
const PAGE_SIZE = 10;
const pagedDropdowns = new Set();
let pagingKeyHandlerBound = false;

function removeThemeSwitcher() {
  const existing = document.getElementById('theme-switcher');
  if (existing) existing.remove();
  if (styleTag) {
    styleTag.remove();
    styleTag = null;
  }
  themeSwitcher = null;
  pagedDropdowns.clear();
}

function handlePagingKeys(e) {
  const active = Array.from(pagedDropdowns).find((entry) => entry.dropdown?.classList.contains('open'));
  if (!active || !active.hasMultiplePages()) return;
  if (e.key === 'ArrowDown' || e.key === 'PageDown') {
    e.preventDefault();
    active.nextPage();
  } else if (e.key === 'ArrowUp' || e.key === 'PageUp') {
    e.preventDefault();
    active.prevPage();
  } else if (e.key === 'Home') {
    e.preventDefault();
    active.setPage(0);
  } else if (e.key === 'End') {
    e.preventDefault();
    active.setPage(active.getPageCount() - 1);
  }
}

function bindPagingKeys() {
  if (pagingKeyHandlerBound) return;
  document.addEventListener('keydown', handlePagingKeys);
  pagingKeyHandlerBound = true;
}

function createPagedDropdown({ dropdown, content, pageLabel, items, renderItem }) {
  const state = {
    items: Array.isArray(items) ? items : [],
    page: 0
  };

  const getPageCount = () => Math.max(1, Math.ceil(state.items.length / PAGE_SIZE));
  const clampPage = (value) => Math.max(0, Math.min(getPageCount() - 1, value));

  const render = () => {
    content.innerHTML = '';
    const start = state.page * PAGE_SIZE;
    const slice = state.items.slice(start, start + PAGE_SIZE);
    slice.forEach((item) => content.appendChild(renderItem(item)));
    if (pageLabel) {
      pageLabel.textContent = `${state.page + 1} / ${getPageCount()}`;
    }
  };

  const setPage = (value) => {
    state.page = clampPage(value);
    render();
  };

  const nextPage = () => setPage(state.page + 1);
  const prevPage = () => setPage(state.page - 1);
  const hasMultiplePages = () => state.items.length > PAGE_SIZE;

  if (dropdown) {
    dropdown.tabIndex = -1;
    dropdown.addEventListener('wheel', (e) => {
      if (!dropdown.classList.contains('open') || !hasMultiplePages()) return;
      e.preventDefault();
      if (e.deltaY > 0) nextPage();
      else prevPage();
    }, { passive: false });
  }

  bindPagingKeys();

  const entry = { dropdown, hasMultiplePages, nextPage, prevPage, setPage, getPageCount, render };
  pagedDropdowns.add(entry);
  return entry;
}

export function initThemeSwitcher() {
  removeThemeSwitcher();

  const isRegularMode = document.body.classList.contains('regular-mode');
  const savedTheme = localStorage.getItem('themeMode');
  if (isRegularMode) {
    if (savedTheme === 'light') {
      document.body.classList.add('light-theme');
    } else if (savedTheme === 'dark') {
      document.body.classList.remove('light-theme');
    }
  }

  themeSwitcher = document.createElement('div');
  themeSwitcher.id = 'theme-switcher';
  themeSwitcher.classList.toggle('regular-mode', isRegularMode);

  if (isRegularMode) {
    const savedDimLevel = localStorage.getItem('bgDimLevel') || '0';
    document.body.setAttribute('data-dim-level', savedDimLevel);
    themeSwitcher.innerHTML = `
      <button id="ui-visibility-btn" title="Hide UI" aria-pressed="false">
        <svg viewBox="0 0 24 24" width="20" height="20">
          <path d="M1.5 12s4-6.5 10.5-6.5S22.5 12 22.5 12 18.5 18.5 12 18.5 1.5 12 1.5 12Z" fill="none" stroke="currentColor" stroke-width="2"/>
          <circle cx="12" cy="12" r="3" fill="currentColor"/>
        </svg>
      </button>
      <button id="dimmer-btn" title="Dim Background">
        <svg viewBox="0 0 24 24" width="18" height="18">
          <path d="M9 21h6v-2H9v2zm3-20C8.14 1 5 4.14 5 8c0 2.38 1.19 4.47 3 5.74V17c0 .55.45 1 1 1h6c.55 0 1-.45 1-1v-3.26c1.81-1.27 3-3.36 3-5.74 0-3.86-3.14-7-7-7z" fill="currentColor"/>
        </svg>
      </button>
      <button id="bg-btn" title="Background Library">
        <svg viewBox="0 0 24 24" width="20" height="20">
          <rect x="3" y="4" width="18" height="14" rx="2" ry="2" fill="none" stroke="currentColor" stroke-width="2"/>
          <circle cx="8.5" cy="9" r="1.5" fill="currentColor"/>
          <path d="M21 15l-5-5L5 21" stroke="currentColor" stroke-width="2" fill="none"/>
        </svg>
      </button>
      <div id="dimmer-dropdown" class="dimmer-dropdown">
        <div class="dimmer-dropdown-frame">
          <div class="nav-frame">
            <div class="nav-corner tl"></div>
            <div class="nav-corner tr"></div>
            <div class="nav-corner bl"></div>
            <div class="nav-corner br"></div>
          </div>
          <div class="dimmer-dropdown-content">
            <button class="dimmer-option" data-dim="0">Off</button>
            <button class="dimmer-option" data-dim="20">Low</button>
            <button class="dimmer-option" data-dim="40">Medium</button>
            <button class="dimmer-option" data-dim="60">High</button>
            <button class="dimmer-option" data-dim="80">Dark</button>
          </div>
        </div>
      </div>
      <div id="bg-dropdown" class="theme-dropdown bg-dropdown">
        <div class="theme-dropdown-frame">
          <div class="nav-frame">
            <div class="nav-corner tl"></div>
            <div class="nav-corner tr"></div>
            <div class="nav-corner bl"></div>
            <div class="nav-corner br"></div>
          </div>
          <div class="theme-dropdown-content" id="bg-dropdown-content"></div>
          <div class="dropdown-page" id="bg-page"></div>
        </div>
      </div>
    `;
  } else {
    themeSwitcher.innerHTML = `
      <button id="ui-visibility-btn" title="Hide UI" aria-pressed="false">
        <svg viewBox="0 0 24 24" width="20" height="20">
          <path d="M1.5 12s4-6.5 10.5-6.5S22.5 12 22.5 12 18.5 18.5 12 18.5 1.5 12 1.5 12Z" fill="none" stroke="currentColor" stroke-width="2"/>
          <circle cx="12" cy="12" r="3" fill="currentColor"/>
        </svg>
      </button>
      <button id="theme-btn" title="Change Theme">
        <svg viewBox="0 0 24 24" width="20" height="20">
          <circle cx="12" cy="12" r="5" fill="none" stroke="currentColor" stroke-width="2"/>
          <path d="M12 1v2M12 21v2M4.22 4.22l1.42 1.42M18.36 18.36l1.42 1.42M1 12h2M21 12h2M4.22 19.78l1.42-1.42M18.36 5.64l1.42-1.42" stroke="currentColor" stroke-width="2" fill="none"/>
        </svg>
      </button>
      <div id="theme-dropdown" class="theme-dropdown">
        <div class="theme-dropdown-frame">
          <div class="nav-frame">
            <div class="nav-corner tl"></div>
          <div class="nav-corner tr"></div>
          <div class="nav-corner bl"></div>
          <div class="nav-corner br"></div>
        </div>
          <div class="theme-dropdown-content" id="theme-dropdown-content"></div>
          <div class="dropdown-page" id="theme-page"></div>
        </div>
      </div>
    `;
  }

  document.body.appendChild(themeSwitcher);

  styleTag = document.createElement('style');
  styleTag.textContent = `
    #theme-switcher { position: fixed; top: 40px; right: 40px; z-index: 1000; display: flex; }
    #ui-visibility-btn { background: transparent; border: 1px solid rgba(var(--ui-accent-rgb), 0.5); color: rgba(var(--ui-accent-rgb), 0.8); cursor: pointer; border-radius: 0; transition: all 0.2s; display: flex; align-items: center; justify-content: center; width: 44px; height: 44px; padding: 0; margin-right: 8px; }
    #theme-switcher.regular-mode #ui-visibility-btn { margin-right: var(--debug-gear-offset); }
    #ui-visibility-btn:hover { border-color: rgba(var(--ui-accent-rgb), 0.8); color: var(--ui-accent); }
    #theme-btn { background: transparent; border: 1px solid rgba(var(--ui-accent-rgb), 0.5); color: rgba(var(--ui-accent-rgb), 0.8); cursor: pointer; border-radius: 0; transition: all 0.2s; display: flex; align-items: center; justify-content: center; width: 44px; height: 44px; padding: 0; }
    #theme-btn:hover { border-color: rgba(var(--ui-accent-rgb), 0.8); color: var(--ui-accent); }
    #dimmer-btn { background: transparent; border: 1px solid rgba(var(--ui-accent-rgb), 0.5); color: rgba(var(--ui-accent-rgb), 0.8); cursor: pointer; border-radius: 0; transition: all 0.2s; display: flex; align-items: center; justify-content: center; width: 44px; height: 44px; padding: 0; margin-right: 8px; }
    #dimmer-btn:hover { border-color: rgba(var(--ui-accent-rgb), 0.8); color: var(--ui-accent); }
    #bg-btn { background: transparent; border: 1px solid rgba(var(--ui-accent-rgb), 0.5); color: rgba(var(--ui-accent-rgb), 0.8); cursor: pointer; border-radius: 0; transition: all 0.2s; display: flex; align-items: center; justify-content: center; width: 44px; height: 44px; padding: 0; margin-right: 8px; }
    #bg-btn:hover { border-color: rgba(var(--ui-accent-rgb), 0.8); color: var(--ui-accent); }
    #bg-btn:disabled { opacity: 0.4; cursor: not-allowed; }
    body.ui-hidden #theme-btn,
    body.ui-hidden #dimmer-btn,
    body.ui-hidden #bg-btn,
    body.ui-hidden #theme-dropdown,
    body.ui-hidden #dimmer-dropdown,
    body.ui-hidden #bg-dropdown { display: none; }
    .dimmer-dropdown { position: absolute; top: 56px; right: 0; z-index: 1001; opacity: 0; transform: translateY(-8px); pointer-events: none; transition: opacity 0.2s ease, transform 0.2s ease; }
    .dimmer-dropdown.open { opacity: 1; transform: translateY(0); pointer-events: auto; }
    .dimmer-dropdown.closing { opacity: 0; transform: translateY(-8px); pointer-events: none; }
    .dimmer-dropdown-frame { position: relative; padding: 16px 14px; min-width: 180px; }
    .dimmer-dropdown-content { position: relative; background: transparent; border: none; box-shadow: none; }
    .dimmer-option { display: block; width: 100%; padding: 10px 16px; background: transparent; border: 1px solid rgba(var(--ui-accent-rgb), 0.8); color: rgba(var(--ui-accent-rgb), 0.95); text-align: center; cursor: pointer; font-size: 12px; letter-spacing: 0.15em; text-transform: uppercase; margin-bottom: 8px; transition: all 0.25s ease; font-family: 'Inter', sans-serif; font-weight: 600; }
    .dimmer-option:last-child { margin-bottom: 0; }
    .dimmer-option:hover { border-color: rgba(var(--ui-accent-rgb), 0.95); color: var(--ui-accent); transform: translateX(4px); }
    .dimmer-option.active { background: rgba(var(--ui-accent-rgb), 0.2); }
    .theme-dropdown { position: absolute; top: 56px; right: 0; z-index: 1001; opacity: 0; transform: translateY(-8px); pointer-events: none; transition: opacity 0.2s ease, transform 0.2s ease; }
    .theme-dropdown.open { opacity: 1; transform: translateY(0); pointer-events: auto; }
    .theme-dropdown.closing { opacity: 0; transform: translateY(-8px); pointer-events: none; }
    .theme-dropdown-frame { position: relative; padding: 16px 14px; min-width: 220px; display: flex; flex-direction: column; gap: 10px; }
    .theme-dropdown-content { position: relative; background: transparent; border: none; box-shadow: none; display: flex; flex-direction: column; }
    .dropdown-page { font-family: 'SF Mono', monospace; font-size: 10px; letter-spacing: 0.2em; text-transform: uppercase; color: rgba(var(--ui-accent-rgb), 0.6); text-align: center; }
    .theme-option { display: block; width: 100%; padding: 12px 20px; background: transparent; border: 1px solid rgba(var(--ui-accent-rgb), 0.8); color: rgba(var(--ui-accent-rgb), 0.95); text-align: center; cursor: pointer; font-size: 13px; letter-spacing: 0.15em; text-transform: uppercase; margin-bottom: 10px; transition: all 0.25s ease; font-family: 'Inter', sans-serif; font-weight: 600; opacity: 0; transform: translateY(-8px); }
    .theme-option:last-child { margin-bottom: 0; }
    .theme-option.active { background: rgba(var(--ui-accent-rgb), 0.2); }
    .theme-dropdown.open .theme-option { opacity: 1; transform: translateY(0); }
    .theme-dropdown.open .theme-option:nth-child(1) { transition-delay: 0.02s; }
    .theme-dropdown.open .theme-option:nth-child(2) { transition-delay: 0.06s; }
    .theme-dropdown.open .theme-option:nth-child(3) { transition-delay: 0.10s; }
    .theme-dropdown.open .theme-option:nth-child(4) { transition-delay: 0.14s; }
    .theme-dropdown.open .theme-option:nth-child(5) { transition-delay: 0.18s; }
    .theme-dropdown.open .theme-option:nth-child(6) { transition-delay: 0.22s; }
    .theme-dropdown.open .theme-option:nth-child(7) { transition-delay: 0.26s; }
    .theme-dropdown.open .theme-option:nth-child(8) { transition-delay: 0.30s; }
    .theme-dropdown.open .theme-option:nth-child(9) { transition-delay: 0.34s; }
    .theme-dropdown.open .theme-option:nth-child(10) { transition-delay: 0.38s; }
    .theme-dropdown.closing .theme-option { opacity: 0; transform: translateY(-8px); }
    .theme-dropdown.closing .theme-option:nth-child(1) { transition-delay: 0.38s; }
    .theme-dropdown.closing .theme-option:nth-child(2) { transition-delay: 0.34s; }
    .theme-dropdown.closing .theme-option:nth-child(3) { transition-delay: 0.30s; }
    .theme-dropdown.closing .theme-option:nth-child(4) { transition-delay: 0.26s; }
    .theme-dropdown.closing .theme-option:nth-child(5) { transition-delay: 0.22s; }
    .theme-dropdown.closing .theme-option:nth-child(6) { transition-delay: 0.18s; }
    .theme-dropdown.closing .theme-option:nth-child(7) { transition-delay: 0.14s; }
    .theme-dropdown.closing .theme-option:nth-child(8) { transition-delay: 0.10s; }
    .theme-dropdown.closing .theme-option:nth-child(9) { transition-delay: 0.06s; }
    .theme-dropdown.closing .theme-option:nth-child(10) { transition-delay: 0.02s; }
    .theme-option:hover { border-color: rgba(var(--ui-accent-rgb), 0.95); color: var(--ui-accent); transform: translateX(4px); }
    .theme-option:active { transform: translateX(2px); }
  `;
  document.head.appendChild(styleTag);

  const themeBtn = document.getElementById('theme-btn');
  const uiVisibilityBtn = document.getElementById('ui-visibility-btn');
  const dropdown = document.getElementById('theme-dropdown');
  const themeDropdownContent = document.getElementById('theme-dropdown-content');
  const themePage = document.getElementById('theme-page');
  const dimmerBtn = document.getElementById('dimmer-btn');
  const dimmerDropdown = document.getElementById('dimmer-dropdown');
  const bgBtn = document.getElementById('bg-btn');
  const bgDropdown = document.getElementById('bg-dropdown');
  const bgDropdownContent = document.getElementById('bg-dropdown-content');
  const bgPage = document.getElementById('bg-page');
  const launcherBtn = document.getElementById('launcher-btn');
  const launcherDropdown = document.getElementById('launcher-dropdown');
  const launcherGroup = launcherBtn?.closest('.launcher-group');
  const launcherIcon = launcherBtn?.querySelector('.launcher-icon');

  if (launcherIcon) {
    const isImageIcon = launcherIcon.tagName === 'IMG';
    if (isImageIcon && appConfig.logoInvert) {
      launcherIcon.classList.add('inverted');
    } else {
      launcherIcon.classList.remove('inverted');
    }
  }

  const closeDropdown = (target) => {
    if (!target) return;
    if (target.classList.contains('open')) {
      target.classList.remove('open');
      target.classList.add('closing');
      setTimeout(() => target.classList.remove('closing'), 420);
    }
  };

  const closeDropdowns = (...targets) => targets.forEach(closeDropdown);

  const openDropdown = (target, ...others) => {
    if (!target) return;
    closeDropdowns(...others);
    target.classList.remove('closing');
    target.classList.add('open');
    if (typeof target.focus === 'function') {
      target.focus({ preventScroll: true });
    }
  };

  let presetPager = null;
  let currentPreset = '';
  if (dropdown && themeDropdownContent) {
    const presetItems = (appConfig.presets || []).map((preset) => ({ name: preset.name }));
    const presetNames = presetItems.map((item) => item.name);
    const savedPreset = localStorage.getItem('lastPreset');
    const defaultPresetConfig = appConfig.presets?.find((preset) => (
      preset.id === appConfig.defaultPreset || preset.name === appConfig.defaultPreset
    ));
    if (savedPreset && presetNames.includes(savedPreset)) {
      currentPreset = savedPreset;
    } else if (defaultPresetConfig && presetNames.includes(defaultPresetConfig.name)) {
      currentPreset = defaultPresetConfig.name;
    } else if (appConfig.defaultPreset && presetNames.includes(appConfig.defaultPreset)) {
      currentPreset = appConfig.defaultPreset;
    } else {
      currentPreset = presetNames[0] || '';
    }

    presetPager = createPagedDropdown({
      dropdown,
      content: themeDropdownContent,
      pageLabel: themePage,
      items: presetItems,
      renderItem: (item) => {
        const option = document.createElement('button');
        option.className = 'theme-option';
        option.dataset.preset = item.name;
        option.textContent = item.name;
        if (item.name === currentPreset) {
          option.classList.add('active');
        }
        option.addEventListener('click', async () => {
          currentPreset = item.name;
          await applyPreset(item.name);
          presetPager?.render();
          closeDropdown(dropdown);
        });
        return option;
      }
    });
    const activeIndex = presetItems.findIndex((item) => item.name === currentPreset);
    if (activeIndex >= 0) {
      presetPager.setPage(Math.floor(activeIndex / PAGE_SIZE));
    } else {
      presetPager.render();
    }
  }

  let backgroundPager = null;
  let currentBackground = localStorage.getItem('lastBackground') || appConfig.defaultBackground || '';
  const backgroundItems = (appConfig.backgroundLibrary || [])
    .filter((entry) => entry && entry.name && entry.image)
    .map((entry) => ({ name: entry.name, image: entry.image, fit: entry.fit }));
  const hasCurrent = backgroundItems.some((item) => item.name === currentBackground);
  if ((!currentBackground || !hasCurrent) && appConfig.background?.src) {
    const match = backgroundItems.find((item) => item.image === appConfig.background.src);
    if (match) currentBackground = match.name;
  }
  if (!backgroundItems.some((item) => item.name === currentBackground)) {
    currentBackground = '';
  }

  if (bgBtn && !backgroundItems.length) {
    bgBtn.disabled = true;
  }

  if (bgDropdown && bgDropdownContent && backgroundItems.length) {
    backgroundPager = createPagedDropdown({
      dropdown: bgDropdown,
      content: bgDropdownContent,
      pageLabel: bgPage,
      items: backgroundItems,
      renderItem: (item) => {
        const option = document.createElement('button');
        option.className = 'theme-option';
        option.dataset.background = item.name;
        option.textContent = item.name;
        if (item.name === currentBackground) {
          option.classList.add('active');
        }
        option.addEventListener('click', () => {
          currentBackground = item.name;
          localStorage.setItem('lastBackground', item.name);
          window.applyBackgroundSelection?.(item.name);
          backgroundPager?.render();
          closeDropdown(bgDropdown);
        });
        return option;
      }
    });
    const activeIndex = backgroundItems.findIndex((item) => item.name === currentBackground);
    if (activeIndex >= 0) {
      backgroundPager.setPage(Math.floor(activeIndex / PAGE_SIZE));
    } else {
      backgroundPager.render();
    }
  }

  if (themeBtn) {
    themeBtn.addEventListener('click', () => {
      if (isRegularMode) {
        document.body.classList.toggle('light-theme');
        const icon = document.getElementById('theme-icon');
        if (icon) {
          icon.textContent = document.body.classList.contains('light-theme') ? '☾' : '☼';
        }
        localStorage.setItem('themeMode', document.body.classList.contains('light-theme') ? 'light' : 'dark');
      } else if (dropdown) {
        if (dropdown.classList.contains('open')) {
          closeDropdown(dropdown);
        } else {
          openDropdown(dropdown, launcherDropdown, bgDropdown, dimmerDropdown);
        }
      }
    });
  }

  const openEyeSvg = `
    <svg viewBox="0 0 24 24" width="20" height="20">
      <path d="M1.5 12s4-6.5 10.5-6.5S22.5 12 22.5 12 18.5 18.5 12 18.5 1.5 12 1.5 12Z" fill="none" stroke="currentColor" stroke-width="2"/>
      <circle cx="12" cy="12" r="3" fill="currentColor"/>
    </svg>
  `;
  const closedEyeSvg = `
    <svg viewBox="0 0 24 24" width="20" height="20">
      <path d="M2 12s4-6 10-6 10 6 10 6-4 6-10 6-10-6-10-6Z" fill="none" stroke="currentColor" stroke-width="2"/>
      <path d="M4 4l16 16" stroke="currentColor" stroke-width="2"/>
    </svg>
  `;

  const applyUiVisibility = (hidden) => {
    document.body.classList.toggle('ui-hidden', hidden);
    if (uiVisibilityBtn) {
      uiVisibilityBtn.innerHTML = hidden ? closedEyeSvg : openEyeSvg;
      uiVisibilityBtn.title = hidden ? 'Show UI' : 'Hide UI';
      uiVisibilityBtn.setAttribute('aria-pressed', hidden ? 'true' : 'false');
    }
    if (hidden) {
      closeDropdowns(dropdown, launcherDropdown, dimmerDropdown, bgDropdown);
    }
  };

  // Allow host-side callers (wv2wall overlay flow) to keep icon state in sync
  // when UI hidden mode is toggled programmatically.
  window.__setUiHiddenState = applyUiVisibility;

  const savedUiHidden = localStorage.getItem('uiHidden') === 'true';
  applyUiVisibility(savedUiHidden);

  if (uiVisibilityBtn) {
    uiVisibilityBtn.addEventListener('click', () => {
      const nextHidden = !document.body.classList.contains('ui-hidden');
      localStorage.setItem('uiHidden', nextHidden ? 'true' : 'false');
      applyUiVisibility(nextHidden);
    });
  }

  // Dimmer button functionality
  if (dimmerBtn && dimmerDropdown && isRegularMode) {
    dimmerBtn.addEventListener('click', () => {
      if (dimmerDropdown.classList.contains('open')) {
        closeDropdown(dimmerDropdown);
      } else {
        openDropdown(dimmerDropdown, dropdown, bgDropdown, launcherDropdown);
      }
    });

    // Update active state based on saved dim level
    const savedDimLevel = localStorage.getItem('bgDimLevel') || '0';
    dimmerDropdown.querySelectorAll('.dimmer-option').forEach(option => {
      if (option.dataset.dim === savedDimLevel) {
        option.classList.add('active');
      }
    });

    dimmerDropdown.querySelectorAll('.dimmer-option').forEach(option => {
      option.addEventListener('click', () => {
        const dimLevel = option.dataset.dim;
        document.body.setAttribute('data-dim-level', dimLevel);
        localStorage.setItem('bgDimLevel', dimLevel);
        
        // Update active state
        dimmerDropdown.querySelectorAll('.dimmer-option').forEach(opt => opt.classList.remove('active'));
        option.classList.add('active');
        
        closeDropdown(dimmerDropdown);
      });
    });
  }

  if (bgBtn && bgDropdown && isRegularMode) {
    bgBtn.addEventListener('click', () => {
      if (bgDropdown.classList.contains('open')) {
        closeDropdown(bgDropdown);
      } else if (!bgBtn.disabled) {
        openDropdown(bgDropdown, dimmerDropdown, dropdown, launcherDropdown);
      }
    });
  }

  if (launcherBtn && launcherDropdown) {
    if (!launcherBtn.dataset.bound) {
      launcherBtn.addEventListener('click', () => {
        if (launcherDropdown.classList.contains('open')) {
          closeDropdown(launcherDropdown);
        } else {
          openDropdown(launcherDropdown, dropdown, dimmerDropdown, bgDropdown);
        }
      });
      launcherBtn.dataset.bound = 'true';
    }

    if (!launcherDropdown.dataset.bound) {
      launcherDropdown.querySelectorAll('.theme-option').forEach(option => {
        option.addEventListener('click', () => {
          closeDropdown(launcherDropdown);
        });
      });
      launcherDropdown.dataset.bound = 'true';
    }
  }

  document.addEventListener('click', (e) => {
    const clickedTheme = themeSwitcher && themeSwitcher.contains(e.target);
    const clickedLauncher = launcherGroup && launcherGroup.contains(e.target);
    if (!clickedTheme && !clickedLauncher) {
      closeDropdowns(dropdown, launcherDropdown, dimmerDropdown, bgDropdown);
    }
  });
}

async function applyPreset(presetName) {
  const presetFile = availablePresets[presetName];
  if (presetFile) {
    showToast(`Loading preset: ${presetName}`);
    try {
      const response = await fetch(presetFile);
      if (response.ok) {
        const presetData = await response.json();
        localStorage.setItem('lastPreset', presetName);
        window.dispatchEvent(new CustomEvent('applyPreset', { detail: presetData }));
        window.dispatchEvent(new CustomEvent('presetChanged', { detail: { presetName, presetData } }));
      }
    } catch (e) {
      console.error('Error loading preset:', e);
    }
  }
}
