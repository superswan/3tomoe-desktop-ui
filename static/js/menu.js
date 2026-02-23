// js/menu.js - Main Menu Carousel System
import { appConfig } from './config.js';
import { pad, showToast, executeAppCommand } from './ui-utils.js';
import { openAbout, openSystemInfo } from './modals.js';

let totalCards = 0;
let cards, navPrev, navNext, indexDisplay, currentIndex = 0;
let carouselInitialized = false;
let menuTiltInitialized = false;

let menuModal, menuWrapper, menuClose, menuDragHandle;
let menuIsLocked = false;
let menuFollowAnimationId = null;
let menuMouseX = window.innerWidth / 2;
let menuMouseY = window.innerHeight / 2;
let menuModalX = window.innerWidth / 2;
let menuModalY = window.innerHeight / 2;
let menuPointerTrackingBound = false;
let menuLastPointerX = window.innerWidth / 2;
let menuLastPointerY = window.innerHeight / 2;

// Audio context for sound effects
let audioCtx, masterGain, lowPassFilter;
let soundUpBuffer, soundDownBuffer;

async function initAudio() {
  audioCtx = new (window.AudioContext || window.webkitAudioContext)();
  masterGain = audioCtx.createGain();
  lowPassFilter = audioCtx.createBiquadFilter();
  
  masterGain.gain.value = 0.43;
  lowPassFilter.type = 'lowpass';
  lowPassFilter.frequency.value = 8000;
  lowPassFilter.Q.value = 0;
  
  lowPassFilter.connect(masterGain);
  masterGain.connect(audioCtx.destination);
  
  try {
    const [upResponse, downResponse] = await Promise.all([
      fetch('/static/sounds/sound-up.ogg'),
      fetch('/static/sounds/sound-down.ogg')
    ]);
    
    const [upArrayBuffer, downArrayBuffer] = await Promise.all([
      upResponse.arrayBuffer(),
      downResponse.arrayBuffer()
    ]);
    
    [soundUpBuffer, soundDownBuffer] = await Promise.all([
      audioCtx.decodeAudioData(upArrayBuffer),
      audioCtx.decodeAudioData(downArrayBuffer)
    ]);
  } catch (e) {
    console.log('Error loading sounds:', e);
  }
}

function playSound(buffer) {
  if (!buffer || !audioCtx) return;
  
  if (audioCtx.state === 'suspended') {
    audioCtx.resume().then(() => {
      const source = audioCtx.createBufferSource();
      source.buffer = buffer;
      source.connect(lowPassFilter);
      source.start(0);
    }).catch(() => {});
  } else {
    const source = audioCtx.createBufferSource();
    source.buffer = buffer;
    source.connect(lowPassFilter);
    source.start(0);
  }
}

function resumeAudio() {
  if (audioCtx?.state === 'suspended') {
    audioCtx.resume();
  }
}

function trackMenuMouse(e) {
  menuMouseX = e.clientX;
  menuMouseY = e.clientY;
}

function trackMenuPointer(e) {
  menuLastPointerX = e.clientX;
  menuLastPointerY = e.clientY;
}

function menuFollowLoop() {
  if (!menuIsLocked || !menuModal?.classList.contains('active')) {
    menuFollowAnimationId = null;
    return;
  }

  const dx = menuMouseX - menuModalX;
  const dy = menuMouseY - menuModalY;

  menuModalX += dx * 0.12;
  menuModalY += dy * 0.12;

  const velocityX = dx * 0.12;
  const velocityY = dy * 0.12;
  const tiltAmountX = Math.max(-8, Math.min(8, velocityY * 2));
  const tiltAmountY = Math.max(-8, Math.min(8, -velocityX * 2));

  if (menuWrapper) {
    menuWrapper.style.left = menuModalX + 'px';
    menuWrapper.style.top = menuModalY + 'px';
    menuWrapper.style.transform = `translate(-50%, -50%) perspective(1000px) rotateX(${tiltAmountX}deg) rotateY(${tiltAmountY}deg)`;
  }

  localStorage.setItem('menuLeft', menuWrapper?.style.left || '50%');
  localStorage.setItem('menuTop', menuWrapper?.style.top || '50%');

  menuFollowAnimationId = requestAnimationFrame(menuFollowLoop);
}

function startMenuFollowModeAt(x, y) {
  if (!menuWrapper) return;

  if (Number.isFinite(x) && Number.isFinite(y)) {
    menuModalX = x;
    menuModalY = y;
    menuWrapper.style.left = `${x}px`;
    menuWrapper.style.top = `${y}px`;
  } else {
    const rect = menuWrapper.getBoundingClientRect();
    menuModalX = rect.left + rect.width / 2;
    menuModalY = rect.top + rect.height / 2;
  }

  menuMouseX = menuModalX;
  menuMouseY = menuModalY;

  document.addEventListener('mousemove', trackMenuMouse);
  if (!menuFollowAnimationId) {
    menuFollowAnimationId = requestAnimationFrame(menuFollowLoop);
  }
}

function enableMenuFollowModeAt(x, y) {
  if (!menuWrapper) return;
  menuIsLocked = true;
  menuWrapper.classList.add('follow-mode');
  const dragLine = menuDragHandle?.querySelector('.drag-line');
  if (dragLine) dragLine.style.background = '#ffffff';
  startMenuFollowModeAt(x, y);
}

function disableMenuFollowMode() {
  if (menuIsLocked) {
    menuIsLocked = false;
    menuWrapper?.classList.remove('follow-mode');
    const dragLine = menuDragHandle?.querySelector('.drag-line');
    if (dragLine) dragLine.style.background = '';
  }
  document.removeEventListener('mousemove', trackMenuMouse);
  if (menuFollowAnimationId) {
    cancelAnimationFrame(menuFollowAnimationId);
    menuFollowAnimationId = null;
  }
  if (menuWrapper) {
    menuWrapper.style.transform = 'translate(-50%, -50%)';
  }
}

function initMenuDrag() {
  if (!menuWrapper) return;
  menuWrapper.style.position = 'absolute';
  menuWrapper.style.left = '50%';
  menuWrapper.style.top = '50%';
  menuWrapper.style.transform = 'translate(-50%, -50%)';

  const modalContent = menuWrapper.querySelector('.menu-modal');
  const dragLine = menuDragHandle?.querySelector('.drag-line');

  menuWrapper.addEventListener('dblclick', (e) => {
    if (e.target.closest('.menu-close') || e.target.closest('.data-card')) return;
    if (menuIsLocked) {
      disableMenuFollowMode();
      return;
    }
    enableMenuFollowModeAt(menuLastPointerX, menuLastPointerY);
  });

  let isDragging = false;
  let startX, startY;
  let initialLeft, initialTop;
  let lastX, lastY, lastTime;
  let velocityX = 0, velocityY = 0;
  let tiltX = 0, tiltY = 0;
  let animationId = null;

  function applyTilt() {
    if (!modalContent) return;
    const targetTiltX = Math.max(-15, Math.min(15, velocityY * 0.5));
    const targetTiltY = Math.max(-15, Math.min(15, -velocityX * 0.5));
    tiltX += (targetTiltX - tiltX) * 0.15;
    tiltY += (targetTiltY - tiltY) * 0.15;
    const transform = `translate(-50%, -50%) perspective(1000px) rotateX(${tiltX}deg) rotateY(${tiltY}deg)`;
    menuWrapper.style.transform = transform;
    velocityX *= 0.92;
    velocityY *= 0.92;
    if (Math.abs(velocityX) > 0.01 || Math.abs(velocityY) > 0.01 || Math.abs(tiltX) > 0.1 || Math.abs(tiltY) > 0.1) {
      animationId = requestAnimationFrame(applyTilt);
    } else {
      menuWrapper.style.transform = 'translate(-50%, -50%)';
      tiltX = 0;
      tiltY = 0;
      animationId = null;
    }
  }

  function startDrag(e) {
    if (e.button !== 0) return; // Only left-click starts a drag
    if (menuIsLocked) return;
    if (e.target.closest('.menu-close') || e.target.closest('.data-card') || e.target.closest('.nav-btn')) return;
    isDragging = true;
    startX = e.clientX;
    startY = e.clientY;
    initialLeft = parseFloat(menuWrapper.style.left) || window.innerWidth / 2;
    initialTop = parseFloat(menuWrapper.style.top) || window.innerHeight / 2;
    lastX = startX;
    lastY = startY;
    lastTime = performance.now();
    menuWrapper.style.cursor = 'grabbing';
    menuWrapper.classList.add('dragging');
    menuDragHandle?.classList.add('dragging');
    if (dragLine) dragLine.style.background = '#ffffff';
    document.addEventListener('mousemove', onDrag);
    document.addEventListener('mouseup', stopDrag);
  }

  function onDrag(e) {
    if (!isDragging || !menuWrapper) return;
    const dx = e.clientX - startX;
    const dy = e.clientY - startY;
    menuWrapper.style.left = (initialLeft + dx) + 'px';
    menuWrapper.style.top = (initialTop + dy) + 'px';

    const now = performance.now();
    const dt = now - lastTime || 16;
    velocityX = (e.clientX - lastX) / dt * 16;
    velocityY = (e.clientY - lastY) / dt * 16;
    lastX = e.clientX;
    lastY = e.clientY;
    lastTime = now;

    if (!animationId) {
      animationId = requestAnimationFrame(applyTilt);
    }
  }

  function stopDrag() {
    if (!isDragging || !menuWrapper) return;
    isDragging = false;
    menuWrapper.style.cursor = '';
    menuWrapper.classList.remove('dragging');
    menuDragHandle?.classList.remove('dragging');
    if (dragLine) dragLine.style.background = '';
    localStorage.setItem('menuLeft', menuWrapper.style.left);
    localStorage.setItem('menuTop', menuWrapper.style.top);
    document.removeEventListener('mousemove', onDrag);
    document.removeEventListener('mouseup', stopDrag);
  }

  menuDragHandle?.addEventListener('mousedown', startDrag);
  menuWrapper.addEventListener('mousedown', startDrag);
}

function initMenuModalElements() {
  menuModal = document.getElementById('menu-modal');
  menuClose = document.getElementById('menu-close');
  menuWrapper = menuModal?.querySelector('.menu-modal-wrapper');
  menuDragHandle = document.getElementById('menu-drag-handle');

  if (!menuPointerTrackingBound) {
    document.addEventListener('mousemove', trackMenuPointer, { passive: true });
    menuPointerTrackingBound = true;
  }

  if (menuClose) {
    menuClose.addEventListener('click', closeMenuModal);
  }

  // Scrim click does not close settings - use Escape or close button instead.

  if (menuWrapper && menuDragHandle) {
    initMenuDrag();
  }
}

export function openMenuModal(options = {}) {
  if (!menuModal) initMenuModalElements();
  if (!menuModal) return;
  window.dispatchEvent(new Event('closeMenu3'));
  window.dispatchEvent(new Event('closeMenu3Run'));
  menuModal.classList.add('active');

  if (menuWrapper) {
    if (options.randomize) {
      requestAnimationFrame(() => {
        const rect = menuWrapper.getBoundingClientRect();
        const width = rect.width || 720;
        const height = rect.height || 420;
        const margin = 24;
        const spread = 180;
        const maxOffsetX = Math.max(0, Math.min(spread, window.innerWidth / 2 - margin - width / 2));
        const maxOffsetY = Math.max(0, Math.min(spread, window.innerHeight / 2 - margin - height / 2));
        const offsetX = (Math.random() * 2 - 1) * maxOffsetX;
        const offsetY = Math.random() * maxOffsetY;
        const left = window.innerWidth / 2 + offsetX;
        const top = window.innerHeight / 2 + offsetY;
        menuWrapper.style.left = `${left}px`;
        menuWrapper.style.top = `${top}px`;
        menuWrapper.style.transform = 'translate(-50%, -50%)';
      });
    } else {
      const leftPos = localStorage.getItem('menuLeft') || '50%';
      const topPos = localStorage.getItem('menuTop') || '50%';
      menuWrapper.style.left = leftPos;
      menuWrapper.style.top = topPos;
      menuWrapper.style.transform = 'translate(-50%, -50%)';
    }
  }

  if (options.lockToCursor) {
    const x = Number.isFinite(options.x) ? options.x : menuLastPointerX;
    const y = Number.isFinite(options.y) ? options.y : menuLastPointerY;
    enableMenuFollowModeAt(x, y);
  } else {
    disableMenuFollowMode();
  }
}

export function closeMenuModal() {
  disableMenuFollowMode();
  if (menuModal) menuModal.classList.remove('active');
}

export function buildProjectUI() {
  const projects = appConfig.menu || [];
  const showAbout = appConfig.showAbout !== false;
  
  const displayItems = showAbout 
    ? [...projects, { id: 'about', title: 'About', desc: appConfig.about || 'Creative development lab', command: '', isAbout: true }]
    : projects;
  
  totalCards = displayItems.length;
  
  const stackEl = document.getElementById('card-stack');
  
  if (stackEl) stackEl.innerHTML = '';
  
  // Build 3D cards
  displayItems.forEach((proj, i) => {
    const command = proj.command || proj.url || '';
    const isSystemInfo = proj.url === '/sysinfo' || proj.command === '/sysinfo' || proj.id === 'sysinfo';
    
    if (stackEl) {
      stackEl.insertAdjacentHTML('beforeend', `
        <div class="data-card chamfer ${proj.isAbout ? 'about-card' : ''}" data-index="${i}" data-cmd="${command}" data-is-about="${proj.isAbout || false}" data-is-system="${isSystemInfo}">
          <div class="edge-mark tl"></div>
          <div class="edge-mark tr"></div>
          <div class="edge-mark bl"></div>
          <div class="edge-mark br"></div>
          <div class="card-header">
            <div class="card-header-content">
              <div class="card-meta">
                <span class="card-index">${pad(i + 1)}</span>
                <span class="card-title">${proj.title}</span>
              </div>
              <span class="card-counter">${pad(i + 1)} / ${pad(totalCards)}</span>
            </div>
          </div>
          <div class="card-body">
            <div class="paper-panel">
              <p class="card-desc">${proj.desc}</p>
            </div>
          </div>
        </div>
      `);
    }
  });
  
  const totalCountEl = document.getElementById('total-count');
  if (totalCountEl) totalCountEl.textContent = pad(totalCards);
}

export function initCarousel() {
  if (carouselInitialized) return;
  carouselInitialized = true;
  initMenuModalElements();
  
  initAudio();
  
  // Resume audio on interaction
  document.addEventListener('click', resumeAudio, { once: true });
  document.addEventListener('keydown', resumeAudio, { once: true });
  document.addEventListener('touchstart', resumeAudio, { once: true });
  
  cards = document.querySelectorAll('.data-card');
  navPrev = document.getElementById('nav-prev');
  navNext = document.getElementById('nav-next');
  indexDisplay = document.getElementById('current-index');
  
  function getCardPosition(index) {
    const diff = (index - currentIndex + totalCards) % totalCards;
    if (diff === 0) return 'active';
    if (diff === 1) return 'next-1';
    if (diff === 2) return 'next-2';
    if (diff === 3 && totalCards >= 7) return 'next-3';
    if (diff === 4 && totalCards >= 8) return 'next-4';
    if (diff === totalCards - 1) return 'prev-1';
    if (diff === totalCards - 2) return 'prev-2';
    if (diff === totalCards - 3 && totalCards >= 7) return 'prev-3';
    if (diff === totalCards - 4 && totalCards >= 8) return 'prev-4';
    return 'hidden';
  }
  
  function updateCards() {
    cards.forEach((card, index) => {
      const position = getCardPosition(index);
      card.className = 'data-card chamfer ' + position;
    });
    if (indexDisplay) indexDisplay.textContent = pad(currentIndex + 1);
  }
  
  function nextCard() { 
    currentIndex = (currentIndex + 1) % totalCards; 
    updateCards(); 
    playSound(soundDownBuffer);
  }
  
  function prevCard() { 
    currentIndex = (currentIndex - 1 + totalCards) % totalCards; 
    updateCards(); 
    playSound(soundUpBuffer);
  }
  
  if (navPrev) navPrev.addEventListener('click', prevCard);
  if (navNext) navNext.addEventListener('click', nextCard);
  
  // Keyboard navigation
  document.addEventListener('keydown', (e) => { 
    if (!isMenuInteractive()) return;
    const target = e.target;
    const isTyping = target && (
      target.tagName === 'INPUT' ||
      target.tagName === 'TEXTAREA' ||
      target.tagName === 'SELECT' ||
      target.isContentEditable
    );
    if (isTyping) return;
    if (e.key === 'Escape') {
      if (menuIsLocked) {
        e.preventDefault();
        e.stopImmediatePropagation();
        disableMenuFollowMode();
        return;
      }
      closeMenuModal();
      return;
    }
    if (!e.ctrlKey && !e.altKey && !e.metaKey && /^[0-9]$/.test(e.key)) {
      if (!totalCards) return;
      e.preventDefault();
      const targetIndex = e.key === '0' ? (totalCards - 1) : (Number.parseInt(e.key, 10) - 1);
      if (targetIndex >= 0 && targetIndex < totalCards) {
        currentIndex = targetIndex;
        updateCards();
      }
      return;
    }
    if (e.key === 'ArrowUp' || e.key === 'k' || e.key === 'K') prevCard(); 
    if (e.key === 'ArrowDown' || e.key === 'j' || e.key === 'J') nextCard();
    if (e.key === 'Enter') {
      const activeCard = cards[currentIndex];
      if (activeCard) {
        const cmd = activeCard.dataset.cmd || '';
        const isAbout = activeCard.dataset.isAbout === 'true';
        const isSystem = activeCard.dataset.isSystem === 'true';
        if (isAbout) {
          closeMenuModal();
          openAbout();
        } else if (isSystem) {
          closeMenuModal();
          openSystemInfo();
        } else if (cmd) {
          executeAppCommand(cmd).then((result) => showToast(result.message));
          closeMenuModal();
        }
      }
    }
  });
  
  // Delegated click handler for 3D cards
  const cardStackEl = document.getElementById('card-stack');
  if (cardStackEl) {
    cardStackEl.addEventListener('click', (e) => {
      const card = e.target.closest('.data-card');
      if (!card) return;
      if (!isMenuInteractive()) return;
      
      const index = parseInt(card.dataset.index);
      const diff = (index - currentIndex + totalCards) % totalCards;
      const cmd = card.dataset.cmd || '';
      const isAbout = card.dataset.isAbout === 'true';
      const isSystem = card.dataset.isSystem === 'true';
      
      if (diff === 0) {
        if (isAbout) {
          closeMenuModal();
          openAbout();
        } else if (isSystem) {
          closeMenuModal();
          openSystemInfo();
        } else if (cmd) {
          executeAppCommand(cmd).then((result) => showToast(result.message));
          closeMenuModal();
        }
      } else if (diff === 1 || diff === totalCards - 1) {
        if (diff === 1) nextCard(); else prevCard();
      }
    });
  }
  
  // Wheel navigation
  let wheelTimeout;
  document.addEventListener('wheel', (e) => { 
    if (!isMenuInteractive()) return;
    clearTimeout(wheelTimeout); 
    wheelTimeout = setTimeout(() => { 
      if (e.deltaY > 0) nextCard(); 
      else prevCard(); 
    }, 50); 
  }, { passive: true });
  
  // Touch navigation
  let touchStartY = 0;
  document.addEventListener('touchstart', (e) => { 
    if (!isMenuInteractive()) return;
    touchStartY = e.touches[0].clientY; 
  }, { passive: true });
  
  document.addEventListener('touchend', (e) => { 
    if (!isMenuInteractive()) return;
    const diff = touchStartY - e.changedTouches[0].clientY; 
    if (Math.abs(diff) > 50) { 
      if (diff > 0) nextCard(); 
      else prevCard(); 
    } 
  }, { passive: true });
  
  updateCards();
}


function isMenu3Active() {
  const modal = document.getElementById('menu3-modal');
  return !!(modal && modal.classList.contains('active'));
}

function isMenuActive() {
  return !!(menuModal && menuModal.classList.contains('active')) && !isMenu3Active();
}

function isMenuInteractive() {
  return isMenuActive();
}

export function initMenuTilt() {
  if (menuTiltInitialized) return;
  menuTiltInitialized = true;

  const menuView = document.getElementById('menu-modal');
  if (!menuView || !menuWrapper) return;

  let targetX = 0;
  let targetY = 0;
  let currentX = 0;
  let currentY = 0;

  const maxTiltX = 10;
  const maxTiltY = 14;

  const clamp = (v, min, max) => Math.min(max, Math.max(min, v));

  function getTargetRect() {
    const activeCard = cards && cards[currentIndex];
    if (activeCard) return activeCard.getBoundingClientRect();
    return menuWrapper.getBoundingClientRect();
  }

  function applyTransform(x, y) {
    menuWrapper.style.transform = `translate(-50%, -50%) perspective(1200px) rotateX(${x}deg) rotateY(${y}deg)`;
  }

  function update() {
    if (!isMenuInteractive() || menuIsLocked || menuWrapper.classList.contains('dragging')) {
      if (!menuIsLocked) {
        menuWrapper.style.transform = 'translate(-50%, -50%)';
      }
    } else {
      currentX += (targetX - currentX) * 0.08;
      currentY += (targetY - currentY) * 0.08;
      applyTransform(currentX, currentY);
    }

    requestAnimationFrame(update);
  }

  function onMove(e) {
    if (!isMenuInteractive()) return;
    if (menuIsLocked || menuWrapper.classList.contains('dragging')) return;

    const rect = getTargetRect();
    const centerX = rect.left + rect.width / 2;
    const centerY = rect.top + rect.height / 2;

    const dx = (e.clientX - centerX) / (rect.width / 2);
    const dy = (e.clientY - centerY) / (rect.height / 2);

    const dist = Math.hypot(e.clientX - centerX, e.clientY - centerY);
    const maxDist = Math.max(rect.width, rect.height) * 0.75;
    const proximity = 1 - Math.min(1, dist / maxDist);
    const boost = 0.5 + proximity * 0.9;

    const tiltY = clamp(dx * maxTiltY * boost, -maxTiltY * 1.4, maxTiltY * 1.4);
    const tiltX = clamp(-dy * maxTiltX * boost, -maxTiltX * 1.4, maxTiltX * 1.4);

    targetY = tiltY;
    targetX = tiltX;
  }

  function onLeave() {
    // Keep last tilt to avoid reset in wv2wall
  }

  menuWrapper.style.transformStyle = 'preserve-3d';
  menuView.addEventListener('mousemove', onMove);
  // No mouseleave reset to preserve last tilt
  update();
}
