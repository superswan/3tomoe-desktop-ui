// js/config.js - Configuration management
export let appConfig = { devMode: true, defaultPreset: 'default', presets: [] };
export let availablePresets = {};

export async function loadConfig() {
  try {
    const response = await fetch('config.json');
    if (!response.ok) throw new Error('Failed to load config');
    const config = await response.json();
    appConfig = { ...appConfig, ...config };
    
    // Build available presets map
    availablePresets = {};
    if (appConfig.presets) {
      appConfig.presets.forEach(p => {
        availablePresets[p.name] = p.file;
      });
    }
    
    return appConfig;
  } catch (error) {
    console.error('Error loading config:', error);
    return appConfig;
  }
}

export function updateConfig(newConfig) {
  appConfig = { ...appConfig, ...newConfig };
}

export function getConfig() {
  return appConfig;
}

export function updateAvailablePresets() {
  availablePresets = {};
  if (appConfig.presets) {
    appConfig.presets.forEach(p => {
      availablePresets[p.name] = p.file;
    });
  }
  // Notify listeners that presets have been updated
  window.dispatchEvent(new CustomEvent('presetListUpdated'));
}
