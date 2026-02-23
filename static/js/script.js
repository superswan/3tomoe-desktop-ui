document.addEventListener('DOMContentLoaded', function() {
  const logo = document.querySelector('.logo-emblem');
  const projectRows = document.querySelectorAll('.project-row');
  const previewContent = document.getElementById('preview-content');
  const detailPanel = document.getElementById('detail-panel');
  const detailOverlay = document.getElementById('detail-overlay');
  const detailClose = document.getElementById('detail-close');
  const detailTitle = document.getElementById('detail-title');
  const detailIntent = document.getElementById('detail-intent');
  const detailFacts = document.getElementById('detail-facts');
  const detailGallery = document.getElementById('detail-gallery');
  const detailNotes = document.getElementById('detail-notes');
  const navItems = document.querySelectorAll('.nav-item');
  const chips = document.querySelectorAll('.chip');
  const gapSelector = document.getElementById('gap-selector');
  const themeToggle = document.getElementById('theme-toggle');
  const colorSelector = document.getElementById('color-selector');

  const savedGap = localStorage.getItem('gap') || 'full';
  const savedTheme = localStorage.getItem('theme') || 'light';
  const savedColor = localStorage.getItem('color') || 'rgb';

  document.documentElement.setAttribute('data-gap', savedGap);
  document.documentElement.setAttribute('data-theme', savedTheme);
  document.documentElement.setAttribute('data-color', savedColor);

  updateGapSelectorUI(savedGap);
  updateColorSelectorUI(savedColor);

  if (logo) {
    logo.addEventListener('click', function() {
      this.classList.add('rotate');
      this.addEventListener('animationend', function handler() {
        this.classList.remove('rotate');
        this.removeEventListener('animationend', handler);
      });
    });
  }

  navItems.forEach(function(item) {
    item.addEventListener('click', function(e) {
      const href = this.getAttribute('href');
      if (href && !href.startsWith('#') && !href.startsWith('javascript')) {
        if (this.target !== '_blank') {
          return;
        }
      }
    });
  });

  chips.forEach(function(chip) {
    chip.addEventListener('click', function(e) {
      e.stopPropagation();
    });
  });

  projectRows.forEach(function(row) {
    row.addEventListener('mouseenter', function() {
      const name = this.querySelector('.project-name').textContent;
      const desc = this.dataset.desc || this.querySelector('.project-desc').textContent;
      const status = this.dataset.status || 'active';
      const stack = this.dataset.stack || 'Unknown';
      const project = this.dataset.project;

      updatePreview(name, desc, status, stack, project);
    });

    row.addEventListener('mouseleave', function() {
      clearPreview();
    });

    row.addEventListener('click', function(e) {
      if (e.target.classList.contains('chip') || e.target.closest('.chip')) return;
      
      const name = this.querySelector('.project-name').textContent;
      const desc = this.dataset.desc || this.querySelector('.project-desc').textContent;
      const status = this.dataset.status || 'active';
      const stack = this.dataset.stack || 'Unknown';
      const year = this.querySelector('.project-year').textContent;
      const project = this.dataset.project;
      
      openDetail(name, desc, status, stack, year, project);
    });
  });

  function updatePreview(name, desc, status, stack, project) {
    const statusClass = status === 'active' ? 'stamp-active' : 
                        status === 'archived' ? 'stamp-archived' : 'stamp-experiment';
    const statusText = status.toUpperCase();

    previewContent.innerHTML = 
      '<div class="preview-image" data-project="' + project + '"></div>' +
      '<div class="preview-title">' + name + '</div>' +
      '<div class="preview-facts">' +
        '<div class="preview-fact"><span class="preview-fact-label">Stack:</span>' + stack + '</div>' +
        '<div class="preview-fact"><span class="preview-fact-label">Status:</span>' + statusText + '</div>' +
      '</div>' +
      '<div class="preview-stamp ' + statusClass + '">' + statusText + '</div>';
    
    previewContent.classList.add('active');
  }

  function clearPreview() {
    previewContent.innerHTML = '<div class="preview-empty">Hover a project to preview</div>';
    previewContent.classList.remove('active');
  }

  function openDetail(name, desc, status, stack, year, project) {
    const statusClass = status === 'active' ? 'stamp-active' : 
                        status === 'archived' ? 'stamp-archived' : 'stamp-experiment';
    const statusText = status.toUpperCase();

    detailTitle.textContent = name;
    detailIntent.textContent = desc;
    
    detailFacts.innerHTML = 
      '<div class="detail-fact"><span class="detail-fact-label">Stack</span>' + stack + '</div>' +
      '<div class="detail-fact"><span class="detail-fact-label">Year</span>' + year + '</div>' +
      '<div class="detail-fact"><span class="detail-fact-label">Status</span>' + statusText + '</div>' +
      '<div class="detail-fact"><span class="detail-fact-label">ID</span>' + project.toUpperCase() + '</div>';

    detailGallery.innerHTML = 
      '<div class="gallery-item"></div>' +
      '<div class="gallery-item"></div>';

    detailNotes.textContent = 'Technical specifications and implementation notes for ' + name + '. Built with ' + stack + '.';

    detailOverlay.classList.add('open');
    detailPanel.classList.add('open');
    document.body.style.overflow = 'hidden';
  }

  function closeDetail() {
    detailOverlay.classList.remove('open');
    detailPanel.classList.remove('open');
    document.body.style.overflow = '';
  }

  if (detailClose) {
    detailClose.addEventListener('click', closeDetail);
  }

  if (detailOverlay) {
    detailOverlay.addEventListener('click', closeDetail);
  }

  document.addEventListener('keydown', function(e) {
    if (e.key === 'Escape' && detailPanel.classList.contains('open')) {
      closeDetail();
    }
  });

  const buildDate = document.getElementById('build-date');
  if (buildDate) {
    const now = new Date();
    const formatted = now.toISOString().split('T')[0];
    buildDate.textContent = formatted;
  }

  document.querySelectorAll('a[href^="http"]').forEach(function(link) {
    if (!link.hasAttribute('target')) {
      link.setAttribute('target', '_blank');
    }
    if (!link.hasAttribute('rel')) {
      link.setAttribute('rel', 'noopener noreferrer');
    }
  });

  const instrumentFrame = document.querySelector('.instrument-frame');
  const leftRail = document.querySelector('.left-rail');
  const mainCanvas = document.querySelector('.main-canvas');
  const previewRail = document.querySelector('.preview-rail');
  const topStrip = document.querySelector('.top-strip');
  
  if (instrumentFrame) {
    let mouseX = 0;
    let mouseY = 0;
    let targetRotateX = 0;
    let targetRotateY = 0;
    let currentRotateX = 0;
    let currentRotateY = 0;
    let leftRailTargetRotateY = -3;
    let previewRailTargetRotateY = 3;
    let leftRailCurrentRotateY = -3;
    let previewRailCurrentRotateY = 3;
    
    document.addEventListener('mousemove', function(e) {
      mouseX = (e.clientX / window.innerWidth - 0.5) * 2;
      mouseY = (e.clientY / window.innerHeight - 0.5) * 2;
      
      targetRotateY = mouseX * 4;
      targetRotateX = -mouseY * 3;
      
      const leftThreshold = window.innerWidth * 0.45;
      const rightThreshold = window.innerWidth * 0.55;
      
      if (e.clientX < leftThreshold) {
        const proximity = 1 - (e.clientX / leftThreshold);
        leftRailTargetRotateY = -3 + (proximity * 18);
      } else {
        leftRailTargetRotateY = -3;
      }
      
      if (e.clientX > rightThreshold) {
        const proximity = (e.clientX - rightThreshold) / (window.innerWidth - rightThreshold);
        previewRailTargetRotateY = 3 - (proximity * 18);
      } else {
        previewRailTargetRotateY = 3;
      }
    });
    
    function animatePanels() {
      currentRotateX += (targetRotateX - currentRotateX) * 0.15;
      currentRotateY += (targetRotateY - currentRotateY) * 0.15;
      leftRailCurrentRotateY += (leftRailTargetRotateY - leftRailCurrentRotateY) * 0.12;
      previewRailCurrentRotateY += (previewRailTargetRotateY - previewRailCurrentRotateY) * 0.12;
      
      const isLeftRailHovered = leftRail && leftRail.matches(':hover');
      const isPreviewRailHovered = previewRail && previewRail.matches(':hover');
      const isMainCanvasHovered = mainCanvas && mainCanvas.matches(':hover');
      
      if (leftRail && !isLeftRailHovered) {
        leftRail.style.transform = 'translateZ(10px) rotateY(' + leftRailCurrentRotateY + 'deg) rotateX(' + (currentRotateX * 0.3) + 'deg)';
      }
      if (mainCanvas && !isMainCanvasHovered) {
        mainCanvas.style.transform = 'translateZ(0px) rotateY(' + (currentRotateY * 0.3) + 'deg) rotateX(' + (currentRotateX * 0.2) + 'deg)';
      } else if (mainCanvas && isMainCanvasHovered) {
        mainCanvas.style.transform = 'translateZ(20px) rotateY(' + (currentRotateY * 0.3) + 'deg) rotateX(' + (currentRotateX * 0.2) + 'deg)';
      }
      if (previewRail && !isPreviewRailHovered) {
        previewRail.style.transform = 'translateZ(10px) rotateY(' + previewRailCurrentRotateY + 'deg) rotateX(' + (currentRotateX * 0.3) + 'deg)';
      }
      if (topStrip) {
        topStrip.style.transform = 'translateZ(20px) rotateX(' + (currentRotateX * 0.2) + 'deg)';
      }
      
      requestAnimationFrame(animatePanels);
    }
    
    animatePanels();
    
    document.addEventListener('mouseleave', function() {
      targetRotateX = 0;
      targetRotateY = 0;
      leftRailTargetRotateY = -3;
      previewRailTargetRotateY = 3;
    });
  }

  if (gapSelector) {
    const segments = gapSelector.querySelectorAll('.segment');
    segments.forEach(function(segment) {
      segment.addEventListener('click', function() {
        const gap = this.getAttribute('data-gap');
        document.documentElement.setAttribute('data-gap', gap);
        localStorage.setItem('gap', gap);
        updateGapSelectorUI(gap);
      });
    });
  }

  function updateGapSelectorUI(activeGap) {
    if (!gapSelector) return;
    const segments = gapSelector.querySelectorAll('.segment');
    segments.forEach(function(segment) {
      segment.classList.remove('active');
      if (segment.getAttribute('data-gap') === activeGap) {
        segment.classList.add('active');
      }
    });
  }

  if (themeToggle) {
    themeToggle.addEventListener('click', function() {
      const currentTheme = document.documentElement.getAttribute('data-theme');
      const newTheme = currentTheme === 'dark' ? 'light' : 'dark';
      document.documentElement.setAttribute('data-theme', newTheme);
      localStorage.setItem('theme', newTheme);
    });
  }

  if (colorSelector) {
    const segments = colorSelector.querySelectorAll('.segment');
    segments.forEach(function(segment) {
      segment.addEventListener('click', function() {
        const color = this.getAttribute('data-color');
        document.documentElement.setAttribute('data-color', color);
        localStorage.setItem('color', color);
        updateColorSelectorUI(color);
      });
    });
  }

  function updateColorSelectorUI(activeColor) {
    if (!colorSelector) return;
    const segments = colorSelector.querySelectorAll('.segment');
    segments.forEach(function(segment) {
      segment.classList.remove('active');
      if (segment.getAttribute('data-color') === activeColor) {
        segment.classList.add('active');
      }
    });
  }

  const projectNames = document.querySelectorAll('.project-name');
  projectNames.forEach(function(name) {
    name.addEventListener('mouseenter', function(e) {
      e.stopPropagation();
      const row = this.closest('.project-row');
      if (row) {
        row.dispatchEvent(new Event('mouseenter'));
      }
    });
  });

  // Header image handling
  const headerImage = document.getElementById('header-image');
  const visualFallback = document.querySelector('.header-fallback');
  
  if (headerImage) {
    headerImage.addEventListener('load', function() {
      if (visualFallback) {
        visualFallback.classList.add('hidden');
      }
    });
    
    headerImage.addEventListener('error', function() {
      if (visualFallback) {
        visualFallback.classList.remove('hidden');
      }
    });
    
    // Check if image is already loaded
    if (headerImage.complete && headerImage.naturalHeight !== 0) {
      if (visualFallback) {
        visualFallback.classList.add('hidden');
      }
    }
  }
});
