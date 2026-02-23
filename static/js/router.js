// js/router.js - View routing system
import { updateTimeDisplay } from './ui-utils.js';
import { openMenu3 } from './menu3.js';
import { openMenuModal, closeMenuModal } from './menu.js';

const homeView = document.getElementById('home-view');
const menuModal = document.getElementById('menu-modal');
const debugToMenuBtn = document.getElementById('debug-to-menu');
const debugOpen3MenuBtn = document.getElementById('debug-open-3menu');

export function showHome() {
  document.body.classList.add('home-mode');
  closeMenuModal();
  // Check saved mode preference
  const savedMode = localStorage.getItem('displayMode');
  const mode3d = document.getElementById('mode-3d');
  const modeRegular = document.getElementById('mode-regular');
  
  if (savedMode === 'image') {
    document.body.classList.add('regular-mode');
    if (mode3d && modeRegular) {
      modeRegular.classList.add('active');
      mode3d.classList.remove('active');
    }
  } else {
    document.body.classList.remove('regular-mode');
    if (mode3d && modeRegular) {
      mode3d.classList.add('active');
      modeRegular.classList.remove('active');
    }
  }
  window.location.hash = '#/home';
  updateTimeDisplay();
}

export function showMenu() {
  openMenuModal({ randomize: true });
}

export function handleRoute() {
  const hash = window.location.hash;
  if (hash === '#/home') {
    showHome();
  } else {
    showHome();
  }
}

export function initRouter() {
  // Debug button on home screen
  if (debugToMenuBtn) {
    debugToMenuBtn.addEventListener('click', showMenu);
  }
  
  // 3Menu button on home screen
  if (debugOpen3MenuBtn) {
    debugOpen3MenuBtn.addEventListener('click', () => openMenu3({ randomize: true }));
  }

  document.addEventListener('keydown', (e) => {
    if (e.altKey && (e.key === '`' || e.code === 'Backquote')) {
      e.preventDefault();
      if (menuModal?.classList.contains('active')) {
        closeMenuModal();
      } else {
        openMenuModal({ lockToCursor: true });
      }
    }
  });
  
  window.addEventListener('hashchange', handleRoute);
  
  // Update time every second when on home screen
  setInterval(() => {
    if (document.body.classList.contains('home-mode')) {
      updateTimeDisplay();
    }
  }, 1000);
  
  // Initial route handling
  handleRoute();
}
