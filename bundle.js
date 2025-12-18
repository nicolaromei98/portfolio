(function() {
  'use strict';

  // ============================================================================
  // GLOBAL VARIABLES
  // ============================================================================
  
  // Register ScrollTrigger plugin immediately
  if (typeof gsap !== 'undefined' && typeof ScrollTrigger !== 'undefined') {
    gsap.registerPlugin(ScrollTrigger);
  }
  
  // Store instances for cleanup
  let parallaxContext = null;
  let lenisInstance = null;
  let sketchInstance = null;
  let pixelateInstances = [];
  let mwgEffect005Cleanup = null;
  let aboutSliderCleanup = null;
  let homeCanvasCleanup = null;
  let homeTimeCleanup = null;
  let lenisRafId = null;
  let isTransitioning = false;

  function unlockScrollAfterLenisReady() {
    const finish = () => unlockScroll();
    if (!lenisInstance) {
      finish();
      return;
    }
    let attempts = 0;
    const tick = () => {
      attempts += 1;
      if (typeof lenisInstance.raf === 'function') {
        lenisInstance.raf(performance.now());
      }
      if (attempts >= 2) {
        finish();
        return;
      }
      requestAnimationFrame(tick);
    };
    requestAnimationFrame(tick);
  }

  function ensureLenisRunning() {
    if (!lenisInstance) return;
    if (typeof lenisInstance.start === 'function') {
      lenisInstance.start();
    }
    if (typeof lenisInstance.raf === 'function') {
      lenisInstance.raf(performance.now());
    }
    if (!lenisRafId) {
      const loop = (time) => {
        if (lenisInstance) {
          lenisInstance.raf(time);
        }
        lenisRafId = requestAnimationFrame(loop);
      };
      lenisRafId = requestAnimationFrame(loop);
    }
  }

  // ============================================================================
  // UTILITY FUNCTIONS
  // ============================================================================

function resetWebflow(data) {
  const parser = new DOMParser();
  const dom = parser.parseFromString(data.next.html, "text/html");
  const webflowPageId = dom.querySelector("html").getAttribute("data-wf-page");

  document.querySelector("html").setAttribute("data-wf-page", webflowPageId);

  if (window.Webflow) {
    try {
      window.Webflow.destroy();
      window.Webflow.ready();
      const ix2 = window.Webflow.require && window.Webflow.require("ix2");
      if (ix2 && typeof ix2.init === "function") {
        ix2.init();
      }
    } catch (e) {
      // Silently ignore if Webflow is not fully available
    }
  }
}



class Sketch {
  constructor(opts) {
    // Guard: ensure Three.js is loaded before using it
    if (typeof THREE === 'undefined') {
      return;
    }

    this.scene = new THREE.Scene();
    this.vertex = `varying vec2 vUv;void main() {vUv = uv;gl_Position = projectionMatrix * modelViewMatrix * vec4( position, 1.0 );}`;
    this.fragment = opts.fragment;
    this.uniforms = opts.uniforms;
    this.renderer = new THREE.WebGLRenderer();
    this.width = window.innerWidth;
    this.height = window.innerHeight;
    this.renderer.setPixelRatio(window.devicePixelRatio);
    this.renderer.setSize(this.width, this.height);
    this.renderer.setClearColor(0xeeeeee, 1);
    this.duration = opts.duration || 1;
    this.debug = opts.debug || false;
    this.easing = opts.easing || 'easeInOut';
    this.clicker = document.getElementById("next");
    this.clicker2 = document.getElementById("prev");
    this.container = document.getElementById("slider");
    
    if (!this.container) {
      return;
    }
    
    // Clean up any existing canvas in the container before adding new one
    const existingCanvas = this.container.querySelector('canvas');
    if (existingCanvas) {
      try {
        this.container.removeChild(existingCanvas);
      } catch (e) {
        // Canvas might already be removed
      }
    }
    
    // Ensure the container can anchor the canvas
    if (getComputedStyle(this.container).position === 'static') {
      this.container.style.position = 'relative';
    }

    // Make the renderer fill the container without affecting layout
    this.renderer.domElement.style.position = 'absolute';
    this.renderer.domElement.style.top = '0';
    this.renderer.domElement.style.left = '0';
    this.renderer.domElement.style.width = '100%';
    this.renderer.domElement.style.height = '100%';
    this.renderer.domElement.style.display = 'block';
    this.renderer.domElement.style.pointerEvents = 'none';

    this.images = JSON.parse(this.container.getAttribute('data-images'));
    this.width = this.container.offsetWidth;
    this.height = this.container.offsetHeight;
    this.container.appendChild(this.renderer.domElement);
    this.camera = new THREE.PerspectiveCamera(
      70,
      window.innerWidth / window.innerHeight,
      0.001,
      1000
    );
    this.camera.position.set(0, 0, 2);
    this.time = 0;
    this.current = 0;
    this.textures = [];
    this.paused = true;
    this.isRunning = false;
    
    this.initiate(() => {
      this.setupResize();
      this.settings();
      this.addObjects();
      this.resize();
      this.clickEvent();
      this.clickEvent2();
      this.play();
    });
  }

  initiate(cb) {
    const promises = [];
    let that = this;
    this.images.forEach((url, i) => {
      let promise = new Promise(resolve => {
        that.textures[i] = new THREE.TextureLoader().load(url, resolve);
      });
      promises.push(promise);
    });
    Promise.all(promises).then(() => {
      cb();
    });
  }

  clickEvent() {
    if (this.clicker) {
      this.nextHandler = () => this.next();
      this.clicker.addEventListener('click', this.nextHandler);
    }
  }

  clickEvent2() {
    if (this.clicker2) {
      this.prevHandler = () => this.prev();
      this.clicker2.addEventListener('click', this.prevHandler);
    }
  }

  settings() {
    let that = this;
    if (this.debug && window.dat) {
      this.gui = new dat.GUI();
    }
    this.settings = {
      progress: 0.5
    };
    Object.keys(this.uniforms).forEach((item) => {
      this.settings[item] = this.uniforms[item].value;
      if (this.debug && this.gui) {
        this.gui.add(this.settings, item, this.uniforms[item].min, this.uniforms[item].max, 0.01);
      }
    });
  }

  setupResize() {
    this.resizeHandler = this.resize.bind(this);
    window.addEventListener("resize", this.resizeHandler);
  }

  resize() {
    if (!this.container) return;
    
    this.width = this.container.offsetWidth;
    this.height = this.container.offsetHeight;
    this.renderer.setSize(this.width, this.height);
    this.camera.aspect = this.width / this.height;
    
    if (this.textures[0]) {
      // image cover
      this.imageAspect = this.textures[0].image.height / this.textures[0].image.width;
      let a1;
      let a2;
      if (this.height / this.width > this.imageAspect) {
        a1 = (this.width / this.height) * this.imageAspect;
        a2 = 1;
      } else {
        a1 = 1;
        a2 = (this.height / this.width) / this.imageAspect;
      }
      this.material.uniforms.resolution.value.x = this.width;
      this.material.uniforms.resolution.value.y = this.height;
      this.material.uniforms.resolution.value.z = a1;
      this.material.uniforms.resolution.value.w = a2;
    }
    
    const dist = this.camera.position.z;
    const height = 1;
    this.camera.fov = 2 * (180 / Math.PI) * Math.atan(height / (2 * dist));
    if (this.plane) {
      this.plane.scale.x = this.camera.aspect;
      this.plane.scale.y = 1;
    }
    this.camera.updateProjectionMatrix();
  }

  addObjects() {
    let that = this;
    this.material = new THREE.ShaderMaterial({
      extensions: {
        derivatives: "#extension GL_OES_standard_derivatives : enable"
      },
      side: THREE.DoubleSide,
      uniforms: {
        time: {
          type: "f",
          value: 0
        },
        progress: {
          type: "f",
          value: 0
        },
        border: {
          type: "f",
          value: 0
        },
        intensity: {
          type: "f",
          value: 0
        },
        scaleX: {
          type: "f",
          value: 40
        },
        scaleY: {
          type: "f",
          value: 40
        },
        transition: {
          type: "f",
          value: 40
        },
        swipe: {
          type: "f",
          value: 0
        },
        width: {
          type: "f",
          value: 0
        },
        radius: {
          type: "f",
          value: 0
        },
        texture1: {
          type: "f",
          value: this.textures[0]
        },
        texture2: {
          type: "f",
          value: this.textures[1]
        },
        displacement: {
          type: "f",
          value: new THREE.TextureLoader().load('https://uploads-ssl.webflow.com/5dc1ae738cab24fef27d7fd2/5dcae913c897156755170518_disp1.jpg')
        },
        resolution: {
          type: "v4",
          value: new THREE.Vector4()
        },
      },
      vertexShader: this.vertex,
      fragmentShader: this.fragment
    });
    this.geometry = new THREE.PlaneGeometry(1, 1, 2, 2);
    this.plane = new THREE.Mesh(this.geometry, this.material);
    this.scene.add(this.plane);
  }

  stop() {
    this.paused = true;
  }

  play() {
    this.paused = false;
    this.render();
  }

  next() {
    if (this.isRunning) return;
    this.isRunning = true;
    let len = this.textures.length;
    let nextTexture = this.textures[(this.current + 1) % len];
    this.material.uniforms.texture2.value = nextTexture;
    let tl = new TimelineMax();
    tl.to(this.material.uniforms.progress, this.duration, {
      value: 1,
      ease: Power2[this.easing],
      onComplete: () => {
        this.current = (this.current + 1) % len;
        this.material.uniforms.texture1.value = nextTexture;
        this.material.uniforms.progress.value = 0;
        this.isRunning = false;
      }
    });
  }

  prev() {
    if (this.isRunning) return;
    this.isRunning = true;
    let len = this.textures.length;
    const prevIndex = this.current === 0 ? len - 1 : this.current - 1;
    let prevTexture = this.textures[prevIndex];
    this.material.uniforms.texture2.value = prevTexture;
    let tl = new TimelineMax();
    tl.to(this.material.uniforms.progress, this.duration, {
      value: 1,
      ease: Power2[this.easing],
      onComplete: () => {
        this.current = prevIndex;
        this.material.uniforms.texture1.value = prevTexture;
        this.material.uniforms.progress.value = 0;
        this.isRunning = false;
      }
    });
  }

  render() {
    if (this.paused) return;
    this.time += 0.05;
    this.material.uniforms.time.value = this.time;
    Object.keys(this.uniforms).forEach((item) => {
      this.material.uniforms[item].value = this.settings[item];
    });
    requestAnimationFrame(this.render.bind(this));
    this.renderer.render(this.scene, this.camera);
  }

  destroy() {
    this.stop();
    
    // Remove event listeners
    if (this.clicker && this.nextHandler) {
      this.clicker.removeEventListener('click', this.nextHandler);
      this.nextHandler = null;
    }
    if (this.clicker2 && this.prevHandler) {
      this.clicker2.removeEventListener('click', this.prevHandler);
      this.prevHandler = null;
    }
    if (this.resizeHandler) {
      window.removeEventListener("resize", this.resizeHandler);
      this.resizeHandler = null;
    }
    
    // Remove canvas from DOM first
    if (this.container && this.renderer && this.renderer.domElement) {
      try {
        if (this.renderer.domElement.parentNode === this.container) {
          this.container.removeChild(this.renderer.domElement);
        }
      } catch (e) {
        // Ignore errors
      }
    }
    
    // Dispose Three.js resources
    if (this.renderer) {
      this.renderer.dispose();
      this.renderer = null;
    }
    if (this.material) {
      this.material.dispose();
      this.material = null;
    }
    if (this.geometry) {
      this.geometry.dispose();
      this.geometry = null;
    }
    if (this.textures) {
      this.textures.forEach(texture => {
        if (texture && texture.dispose) {
          texture.dispose();
        }
      });
      this.textures = [];
    }
    
    // Clear scene
    if (this.scene) {
      while(this.scene.children.length > 0) {
        this.scene.remove(this.scene.children[0]);
      }
      this.scene = null;
    }
  }
}


function initPixelateImageRenderEffect() {
  // Clean up existing instances
  destroyPixelateImageRenderEffect();
  
  let renderDuration = 100;  // Velocizzato leggermente per l'hover
  let renderSteps = 20;      // Più step per fluidità
  let renderColumns = 10;    // Blocchi iniziali

  const pixelateElements = document.querySelectorAll('[data-pixelate-render]');
  pixelateElements.forEach(setupPixelate);

  function setupPixelate(root) {
    const img = root.querySelector('[data-pixelate-render-img]');
    if (!img) return;

    // Selettore trigger (hover è il focus qui)
    const trigger = (root.getAttribute('data-pixelate-render-trigger') || 'load').toLowerCase();

    const durAttr = parseInt(root.getAttribute('data-pixelate-render-duration'), 10);
    const stepsAttr = parseInt(root.getAttribute('data-pixelate-render-steps'), 10);
    const colsAttr = parseInt(root.getAttribute('data-pixelate-render-columns'), 10);
    const fitMode = (root.getAttribute('data-pixelate-render-fit') || 'cover').toLowerCase();

    const elRenderDuration = Number.isFinite(durAttr) ? Math.max(16, durAttr) : renderDuration;
    const elRenderSteps = Number.isFinite(stepsAttr) ? Math.max(1, stepsAttr) : renderSteps;
    const elRenderColumns = Number.isFinite(colsAttr) ? Math.max(1, colsAttr) : renderColumns;

    const canvas = document.createElement('canvas');
    canvas.setAttribute('data-pixelate-canvas', '');
    canvas.style.position = 'absolute';
    canvas.style.inset = '0';
    canvas.style.width = '100%';
    canvas.style.height = '100%';
    canvas.style.pointerEvents = 'none'; // Importante: lascia passare il mouse all'img sotto
    root.style.position ||= 'relative';
    root.appendChild(canvas);

    const ctx = canvas.getContext('2d', { alpha: true });
    ctx.imageSmoothingEnabled = false;

    const back = document.createElement('canvas');
    const tiny = document.createElement('canvas');
    const bctx = back.getContext('2d', { alpha: true });
    const tctx = tiny.getContext('2d', { alpha: true });

    let naturalW = 0, naturalH = 0;
    let playing = false;
    let stageIndex = 0;
    let targetIndex = 0; // Dove vogliamo arrivare (0 = pixelato, MAX = nitido)
    let lastTime = 0;
    let backDirty = true, resizeTimeout = 0;
    let steps = [elRenderColumns];

    function fitCanvas() {
      const r = root.getBoundingClientRect();
      const dpr = Math.max(1, Math.floor(window.devicePixelRatio || 1));
      const w = Math.max(1, Math.round(r.width * dpr));
      const h = Math.max(1, Math.round(r.height * dpr));
      if (canvas.width !== w || canvas.height !== h) {
        canvas.width = w; canvas.height = h;
        back.width = w; back.height = h;
        backDirty = true;
      }
      regenerateSteps();
    }

    function regenerateSteps() {
      const cw = Math.max(1, canvas.width);
      const startCols = Math.min(elRenderColumns, cw);
      const total = Math.max(1, elRenderSteps);
      const use = Math.max(1, Math.floor(total * 0.9)); 
      const a = [];
      const ratio = Math.pow(cw / startCols, 1 / total);
      for (let i = 0; i < use; i++) {
        a.push(Math.max(1, Math.round(startCols * Math.pow(ratio, i))));
      }
      for (let i = 1; i < a.length; i++) if (a[i] <= a[i - 1]) a[i] = a[i - 1] + 1;
      steps = a.length ? a : [startCols];
    }

    function drawImageToBack() {
      if (!backDirty || !naturalW || !naturalH) return;
      const cw = back.width, ch = back.height;
      let dw = cw, dh = ch, dx = 0, dy = 0;
      if (fitMode !== 'stretch') {
        const s = fitMode === 'cover' ? Math.max(cw / naturalW, ch / naturalH) : Math.min(cw / naturalW, ch / naturalH);
        dw = Math.max(1, Math.round(naturalW * s));
        dh = Math.max(1, Math.round(naturalH * s));
        dx = ((cw - dw) >> 1);
        dy = ((ch - dh) >> 1);
      }
      bctx.clearRect(0, 0, cw, ch);
      bctx.imageSmoothingEnabled = true;
      bctx.drawImage(img, dx, dy, dw, dh);
      backDirty = false;
    }

    function pixelate(columns) {
      const cw = canvas.width, ch = canvas.height;
      const cols = Math.max(1, Math.floor(columns));
      const rows = Math.max(1, Math.round(cols * (ch / cw)));
      
      // Se siamo alla massima risoluzione, puliamo il canvas per mostrare l'IMG originale sotto
      // (Opzionale: rimuovi questo IF se vuoi che il canvas rimanga sempre sopra)
      if (stageIndex === steps.length - 1 && targetIndex === steps.length - 1) {
         ctx.clearRect(0, 0, cw, ch);
         return;
      }

      if (tiny.width !== cols || tiny.height !== rows) { tiny.width = cols; tiny.height = rows; }
      tctx.imageSmoothingEnabled = false;
      tctx.clearRect(0, 0, cols, rows);
      tctx.drawImage(back, 0, 0, cw, ch, 0, 0, cols, rows);
      ctx.imageSmoothingEnabled = false;
      ctx.clearRect(0, 0, cw, ch);
      ctx.drawImage(tiny, 0, 0, cols, rows, 0, 0, cw, ch);
    }

    function draw(stepCols) {
      if (!canvas.width || !canvas.height) return;
      drawImageToBack();
      pixelate(stepCols);
    }

    // Nuova logica di animazione bidirezionale
    function animate(t) {
      if (!playing) return;

      // Gestione del timing
      if (!lastTime) lastTime = t;
      const delta = t - lastTime;

      // Se è passato abbastanza tempo, facciamo un frame
      if (delta >= elRenderDuration) {
        if (stageIndex < targetIndex) {
            stageIndex++; // Andiamo verso il nitido
        } else if (stageIndex > targetIndex) {
            stageIndex--; // Torniamo verso il pixelato
        } else {
            // Siamo arrivati a destinazione
            playing = false;
            // Ultimo disegno per assicurarsi che sia pulito o pixelato
            draw(steps[stageIndex]);
            return; 
        }
        
        draw(steps[stageIndex]);
        lastTime = t;
      }
      
      requestAnimationFrame(animate);
    }

    function setTarget(isHovering) {
       // Se hover: target è l'ultimo step (nitido)
       // Se no hover: target è 0 (pixelato)
       targetIndex = isHovering ? steps.length - 1 : 0;
       
       if (!playing) {
           playing = true;
           lastTime = 0; // Reset timer
           requestAnimationFrame(animate);
       }
    }

    function init() {
        naturalW = img.naturalWidth; naturalH = img.naturalHeight;
        if (!naturalW || !naturalH) return;
        
        fitCanvas();
        
        // Stato Iniziale: Pixelato (stageIndex 0)
        stageIndex = 0;
        targetIndex = 0;
        backDirty = true;
        draw(steps[0]);
    }

    function onWindowResize() {
      clearTimeout(resizeTimeout);
      resizeTimeout = setTimeout(() => {
          fitCanvas();
          draw(steps[stageIndex]);
      }, 250);
    }

    // Gestione Trigger
    if (img.complete && img.naturalWidth) init(); 
    else img.addEventListener('load', init, { once: true });

    window.addEventListener('resize', onWindowResize);

    if (trigger === 'hover') {
      root.addEventListener('mouseenter', () => setTarget(true));
      root.addEventListener('mouseleave', () => setTarget(false));
    } else {
       // Se usi altri trigger (load, inview), facciamo solo l'entrata classica
       // ma manteniamo la struttura compatibile
       if(trigger === 'load') setTarget(true); // Parte subito
    }

    // Store instance for cleanup
    pixelateInstances.push({
      root,
      canvas,
      back,
      tiny,
      img,
      onWindowResize,
      setTarget,
      trigger
    });
  }
}

function destroyPixelateImageRenderEffect() {
  pixelateInstances.forEach(instance => {
    window.removeEventListener('resize', instance.onWindowResize);
    if (instance.canvas && instance.canvas.parentNode) {
      instance.canvas.parentNode.removeChild(instance.canvas);
    }
  });
  pixelateInstances = [];
}

// ================== mwg_effect005 EFFECT (NO ScrollTrigger) ==================
function initMWGEffect005NoST() {
  if (typeof gsap === 'undefined') return;

  // Clean previous
  destroyMWGEffect005NoST();

  const scope = document.querySelector('.mwg_effect005');
  if (!scope) return;
  const paragraph = scope.querySelector('.paragraph');
  if (paragraph && !paragraph.querySelector('.word')) {
    const text = (paragraph.textContent || '').trim();
    paragraph.innerHTML = text
      .split(/\s+/)
      .map((word) => `<span class="word">${word}</span>`)
      .join(' ');
  }

  const pinHeight = scope.querySelector('.pin-height');
  const container = scope.querySelector('.container');
  const words = scope.querySelectorAll('.word');
  if (!(pinHeight && container && words.length)) return;

  // Sticky pin
  container.style.position = 'sticky';
  container.style.top = '0';

  const clamp01 = (v) => (v < 0 ? 0 : v > 1 ? 1 : v);
  const easeInOut4 = (p) =>
    p < 0.5 ? 8 * p * p * p * p : 1 - Math.pow(-2 * p + 2, 4) / 2;
  const getTranslateX = (el) => {
    const t = getComputedStyle(el).transform;
    if (!t || t === 'none') return 0;
    if (t.startsWith('matrix(')) return parseFloat(t.split(',')[4]) || 0;
    if (t.startsWith('matrix3d(')) return parseFloat(t.split(',')[12]) || 0;
    return 0;
  };

  const baseX = Array.from(words, (el) => getTranslateX(el));
  baseX.forEach((x, i) => gsap.set(words[i], { x }));
  const setX = Array.from(words, (el) => gsap.quickSetter(el, 'x', 'px'));
  const setO = Array.from(words, (el) => gsap.quickSetter(el, 'opacity'));

  let startY = 0;
  let endY = 0;
  let range = 1;
  let ticking = false;

  function measure() {
    const rect = pinHeight.getBoundingClientRect();
    const y = window.scrollY;
    startY = y + rect.top - window.innerHeight * 0.7; // start: top 70%
    endY = y + rect.bottom - window.innerHeight; // end: bottom bottom
    range = Math.max(1, endY - startY);
  }

  function update() {
    ticking = false;
    const t = clamp01((window.scrollY - startY) / range);
    const n = words.length;
    const stagger = 0.02;
    const totalStagger = stagger * (n - 1);
    const animWindow = Math.max(0.0001, 1 - totalStagger);

    for (let i = 0; i < n; i++) {
      const localStart = i * stagger;
      const p = clamp01((t - localStart) / animWindow);
      const eased = easeInOut4(p);
      setX[i](baseX[i] * (1 - eased));
      setO[i](eased);
    }
  }

  function onScroll() {
    if (ticking) return;
    ticking = true;
    requestAnimationFrame(update);
  }

  function onResize() {
    measure();
    for (let i = 0; i < words.length; i++) {
      baseX[i] = getTranslateX(words[i]);
      gsap.set(words[i], { x: baseX[i] });
    }
    update();
  }

  measure();
  update();

  window.addEventListener('scroll', onScroll, { passive: true });
  window.addEventListener('resize', onResize);

  mwgEffect005Cleanup = () => {
    window.removeEventListener('scroll', onScroll, { passive: true });
    window.removeEventListener('resize', onResize);
    gsap.set(words, { clearProps: 'all' });
  };
}

function destroyMWGEffect005NoST() {
  if (mwgEffect005Cleanup) {
    mwgEffect005Cleanup();
    mwgEffect005Cleanup = null;
  }
}

function initLenisSmoothScroll() {
  // Destroy existing instance if any
  destroyLenisSmoothScroll();

  if (typeof Lenis === 'undefined') {
    return;
  }

  // Initialize a new Lenis instance for smooth scrolling
  lenisInstance = new Lenis({
    lerp: 0.1,
    smooth: true,
  });

  // Synchronize Lenis scrolling with GSAP's ScrollTrigger plugin
  lenisInstance.on('scroll', ScrollTrigger.update);

  // Create animation loop (single runner)
  const loop = (time) => {
    if (lenisInstance) {
      lenisInstance.raf(time);
    }
    lenisRafId = requestAnimationFrame(loop);
  };
  lenisRafId = requestAnimationFrame(loop);
}

function destroyLenisSmoothScroll() {
  // Destroy Lenis instance
  if (lenisRafId) {
    cancelAnimationFrame(lenisRafId);
    lenisRafId = null;
  }
  if (lenisInstance) {
    lenisInstance.destroy();
    lenisInstance = null;
  }
}

function initGlobalParallax() {
  // Destroy existing parallax context
  if (parallaxContext) {
    parallaxContext();
    parallaxContext = null;
  }

  if (typeof gsap === 'undefined' || typeof ScrollTrigger === 'undefined') {
    return;
  }

  // Ensure ScrollTrigger is registered with GSAP (needed on some setups)
  if (typeof gsap.registerPlugin === 'function') {
    try {
      gsap.registerPlugin(ScrollTrigger);
    } catch (e) {
      // Ignore if already registered
    }
  }

  const triggersCreated = [];

  const setupParallaxCore = (conditions) => {
    const { isMobile, isMobileLandscape, isTablet } = conditions || {};
    document.querySelectorAll('[data-parallax="trigger"]').forEach((trigger) => {
      const disable = trigger.getAttribute("data-parallax-disable");
      const disableMobile = disable === "mobile" && isMobile;
      const disableMobileLandscape = disable === "mobileLandscape" && isMobileLandscape;
      const disableTablet = disable === "tablet" && isTablet;
      if (disableMobile || disableMobileLandscape || disableTablet) {
        return;
      }

      const target = trigger.querySelector('[data-parallax="target"]') || trigger;
      const direction = trigger.getAttribute("data-parallax-direction") || "vertical";
      const prop = direction === "horizontal" ? "xPercent" : "yPercent";
      const scrubAttr = trigger.getAttribute("data-parallax-scrub");
      const scrub = scrubAttr ? parseFloat(scrubAttr) : true;
      const startAttr = trigger.getAttribute("data-parallax-start");
      const startVal = startAttr !== null ? parseFloat(startAttr) : 20;
      const endAttr = trigger.getAttribute("data-parallax-end");
      const endVal = endAttr !== null ? parseFloat(endAttr) : -20;
      const scrollStartRaw = trigger.getAttribute("data-parallax-scroll-start") || "top bottom";
      const scrollStart = `clamp(${scrollStartRaw})`;
      const scrollEndRaw = trigger.getAttribute("data-parallax-scroll-end") || "bottom top";
      const scrollEnd = `clamp(${scrollEndRaw})`;

      const tween = gsap.fromTo(
        target,
        { [prop]: startVal },
        {
          [prop]: endVal,
          ease: "none",
          scrollTrigger: {
            trigger,
            start: scrollStart,
            end: scrollEnd,
            scrub,
          },
        }
      );

      if (tween && tween.scrollTrigger) {
        triggersCreated.push(tween.scrollTrigger);
      }
    });
  };

  const cleanup = () => {
    triggersCreated.forEach(t => t.kill());
    triggersCreated.length = 0;
  };

  const hasMatchMedia = typeof gsap.matchMedia === 'function';
  const hasContext = typeof gsap.context === 'function';

  if (hasMatchMedia && hasContext) {
    const mm = gsap.matchMedia();
    mm.add(
      {
        isMobile: "(max-width:479px)",
        isMobileLandscape: "(max-width:767px)",
        isTablet: "(max-width:991px)",
        isDesktop: "(min-width:992px)"
      },
      (context) => {
        const destroyLocal = () => cleanup();
        gsap.context(() => {
          setupParallaxCore(context.conditions);
        });
        return () => {
          destroyLocal();
        };
      }
    );
    parallaxContext = () => {
      cleanup();
      mm.revert && mm.revert();
    };
  } else {
    // Fallback for older GSAP: single pass without context
    const simpleConditions = {
      isMobile: window.matchMedia("(max-width:479px)").matches,
      isMobileLandscape: window.matchMedia("(max-width:767px)").matches,
      isTablet: window.matchMedia("(max-width:991px)").matches,
    };
    setupParallaxCore(simpleConditions);
    parallaxContext = cleanup;
  }
}

function destroyGlobalParallax() {
  if (parallaxContext) {
    parallaxContext();
    parallaxContext = null;
  }
}

function initProjectTemplateAnimations() {
  // Initialize Lenis smooth scroll first
  initLenisSmoothScroll();

  // Initialize global parallax
  initGlobalParallax();

  // Initialize mwg_effect005 (no ScrollTrigger)
  initMWGEffect005NoST();

  // Initialize pixelate effect
  initPixelateImageRenderEffect();

  // Initialize Three.js Sketch (planetary effect)
  const sliderContainer = document.getElementById("slider");
  if (sliderContainer && typeof THREE !== 'undefined') {
    // Clean up container before creating new instance
    const existingCanvases = sliderContainer.querySelectorAll('canvas');
    if (existingCanvases.length > 0) {
      existingCanvases.forEach(canvas => {
        try {
          sliderContainer.removeChild(canvas);
        } catch (e) {
          // Ignore errors
        }
      });
    }
    
    sketchInstance = new Sketch({
      debug: false,
      uniforms: {
        intensity: { value: 1, type: 'f', min: 0., max: 3 }
      },
      fragment: `
        uniform float time;
        uniform float progress;
        uniform float intensity;
        uniform float width;
        uniform float scaleX;
        uniform float scaleY;
        uniform float transition;
        uniform float radius;
        uniform float swipe;
        uniform sampler2D texture1;
        uniform sampler2D texture2;
        uniform sampler2D displacement;
        uniform vec4 resolution;
        varying vec2 vUv;
        mat2 getRotM(float angle) {
            float s = sin(angle);
            float c = cos(angle);
            return mat2(c, -s, s, c);
        }
        const float PI = 3.1415;
        const float angle1 = PI *0.25;
        const float angle2 = -PI *0.75;

        void main()	{
          vec2 newUV = (vUv - vec2(0.5))*resolution.zw + vec2(0.5);

          vec4 disp = texture2D(displacement, newUV);
          vec2 dispVec = vec2(disp.r, disp.g);

          vec2 distortedPosition1 = newUV + getRotM(angle1) * dispVec * intensity * progress;
          vec4 t1 = texture2D(texture1, distortedPosition1);

          vec2 distortedPosition2 = newUV + getRotM(angle2) * dispVec * intensity * (1.0 - progress);
          vec4 t2 = texture2D(texture2, distortedPosition2);

          gl_FragColor = mix(t1, t2, progress);
        }
      `
    });
  }
}

function destroyProjectTemplateAnimations() {
  // Destroy Sketch instance
  if (sketchInstance) {
    sketchInstance.destroy();
    sketchInstance = null;
  }

  // Destroy pixelate effects
  destroyPixelateImageRenderEffect();

  // Destroy mwg_effect005 (no ScrollTrigger)
  destroyMWGEffect005NoST();

  // Destroy parallax
  destroyGlobalParallax();

  // Destroy Lenis
  destroyLenisSmoothScroll();
}

// ================== HOME PAGE (Canvas + Time) ==================
function initHomeCanvas() {
  destroyHomeCanvas();

  if (typeof THREE === 'undefined' || typeof gsap === 'undefined') return;

  const gridEl = document.querySelector('.js-grid');
  if (!gridEl) return;

  let ww = window.innerWidth;
  let wh = window.innerHeight;

  const isFirefox = navigator.userAgent.indexOf('Firefox') > -1;
  const isWindows = navigator.appVersion.indexOf("Win") !== -1;

  const mouseMultiplier = 0.6;
  const firefoxMultiplier = 20;

  const multipliers = {
    mouse: isWindows ? mouseMultiplier * 2 : mouseMultiplier,
    firefox: isWindows ? firefoxMultiplier * 2 : firefoxMultiplier
  };

  const loader = new THREE.TextureLoader();

  const vertexShader = `
precision mediump float;
uniform vec2 u_velo;
uniform vec2 u_viewSize;
varying vec2 vUv;
#define M_PI 3.1415926535897932384626433832795
void main(){
  vUv = uv;
  vec4 worldPos = modelMatrix * vec4(position, 1.0);
  float normalizedX = worldPos.x / u_viewSize.x;
  float curvature = cos(normalizedX * M_PI);
  worldPos.y -= curvature * u_velo.y * 0.6;
  gl_Position = projectionMatrix * viewMatrix * worldPos;
}
`;

  const fragmentShader = `
precision mediump float;
uniform vec2 u_res;
uniform vec2 u_size;
uniform vec2 u_velo; 
uniform sampler2D u_texture;
varying vec2 vUv;

float random(vec2 p) {
  return fract(sin(dot(p.xy, vec2(12.9898, 78.233))) * 43758.5453);
}

vec2 cover(vec2 screenSize, vec2 imageSize, vec2 uv) {
  float screenRatio = screenSize.x / screenSize.y;
  float imageRatio = imageSize.x / imageSize.y;
  vec2 newSize = screenRatio < imageRatio 
    ? vec2(imageSize.x * (screenSize.y / imageSize.y), screenSize.y)
    : vec2(screenSize.x, imageSize.y * (screenSize.x / imageSize.x));
  vec2 newOffset = (screenRatio < imageRatio 
    ? vec2((newSize.x - screenSize.x) / 2.0, 0.0) 
    : vec2(0.0, (newSize.y - screenSize.y) / 2.0)) / newSize;
  return uv * screenSize / newSize + newOffset;
}

void main() {
  vec2 uv = vUv;
  vec2 uvCover = cover(u_res, u_size, uv);
  vec2 rgbOffset = u_velo * 0.0002;
  float r = texture2D(u_texture, uvCover + rgbOffset).r;
  float g = texture2D(u_texture, uvCover).g;
  float b = texture2D(u_texture, uvCover - rgbOffset).b;
  vec4 color = vec4(r, g, b, 1.0);
  float noise = random(uvCover * 550.0); 
  color.rgb += (noise - 0.5) * 0.08;
  float dist = distance(vUv, vec2(0.5, 0.5));
  float vignette = smoothstep(0.8, 0.2, dist * 0.9);
  color.rgb *= vignette;
  gl_FragColor = color;
}
`;

  const geometry = new THREE.PlaneBufferGeometry(1, 1, 32, 32);
  const material = new THREE.ShaderMaterial({ fragmentShader, vertexShader });

  class Plane extends THREE.Object3D {
    init(el, i) {
      this.el = el;
      this.x = 0;
      this.y = 0;
      this.my = 1 - ((i % 5) * 0.1);
      this.geometry = geometry;
      this.material = material.clone();
      this.material.uniforms = {
        u_texture: { value: 0 },
        u_res: { value: new THREE.Vector2(1, 1) },
        u_size: { value: new THREE.Vector2(1, 1) }, 
        u_velo: { value: new THREE.Vector2(0, 0) },
        u_viewSize: { value: new THREE.Vector2(ww, wh) } 
      };
      this.texture = loader.load(this.el.dataset.src, (texture) => {
        texture.minFilter = THREE.LinearFilter;
        texture.generateMipmaps = false;
        const { naturalWidth, naturalHeight } = texture.image;
        const { u_size, u_texture } = this.material.uniforms;
        u_texture.value = texture;
        u_size.value.x = naturalWidth;
        u_size.value.y = naturalHeight;
      });
      this.mesh = new THREE.Mesh(this.geometry, this.material);
      this.add(this.mesh);
      this.resize();
    }
    update = (x, y, max, velo) => {
      const { right, bottom } = this.rect;
      const { u_velo } = this.material.uniforms;
      this.y = gsap.utils.wrap(-(max.y - bottom), bottom, y * this.my) - this.yOffset;
      this.x = gsap.utils.wrap(-(max.x - right), right, x) - this.xOffset;
      u_velo.value.x = velo.x;
      u_velo.value.y = velo.y;
      this.position.x = this.x;
      this.position.y = this.y;
    }
    resize() {
      this.rect = this.el.getBoundingClientRect();
      const { left, top, width, height } = this.rect;
      const { u_res, u_viewSize } = this.material.uniforms;
      this.xOffset = (left + (width / 2)) - (ww / 2);
      this.yOffset = (top + (height / 2)) - (wh / 2);
      this.position.x = this.xOffset;
      this.position.y = this.yOffset;
      u_res.value.x = width;
      u_res.value.y = height;
      u_viewSize.value.x = ww;
      u_viewSize.value.y = wh;
      this.mesh.scale.set(width, height, 1);
    }
  }

  class Core {
    constructor() {
      this.tx = 0;
      this.ty = 0;
      this.cx = 0;
      this.cy = 0;
      this.velo = { x: 0, y: 0 };
      this.diff = 0;
      this.wheel = { x: 0, y: 0 };
      this.on = { x: 0, y: 0 };
      this.max = { x: 0, y: 0 };
      this.isDragging = false;

      this.tl = gsap.timeline({ paused: true });

      this.el = gridEl;
      this.el.style.touchAction = 'none';

      this.scene = new THREE.Scene();
      this.camera = new THREE.OrthographicCamera(
        ww / -2, ww / 2, wh / 2, wh / -2, 1, 1000
      );
      this.camera.lookAt(this.scene.position);
      this.camera.position.z = 1;

      this.renderer = new THREE.WebGLRenderer({ antialias: true, alpha: true });
      this.renderer.setSize(ww, wh);
      this.renderer.setPixelRatio(gsap.utils.clamp(1, 1.5, window.devicePixelRatio));
      this.renderer.setClearColor(0xE7E7E7, 1);
      const canvasEl = this.renderer.domElement;
      // Keep canvas full-viewport, behind UI, and non-blocking
      canvasEl.style.position = 'fixed';
      canvasEl.style.top = '0';
      canvasEl.style.left = '0';
      canvasEl.style.width = '100%';
      canvasEl.style.height = '100%';
      canvasEl.style.pointerEvents = 'none';
      canvasEl.style.zIndex = '-1';
      if (canvasEl.parentNode) {
        canvasEl.parentNode.removeChild(canvasEl);
      }
      document.body.appendChild(canvasEl);

      this.addPlanes();
      this.addEvents();
      this.resize();
    }

    addEvents() {
      gsap.ticker.add(this.tick);
      window.addEventListener('mousemove', this.onMouseMove);
      window.addEventListener('mousedown', this.onMouseDown);
      window.addEventListener('mouseup', this.onMouseUp);
      window.addEventListener('wheel', this.onWheel, { passive: true });
      window.addEventListener('touchstart', this.onTouchStart, { passive: false });
      window.addEventListener('touchmove', this.onTouchMove, { passive: false });
      window.addEventListener('touchend', this.onTouchEnd);
      window.addEventListener('resize', this.resize);
    }

    addPlanes() {
      const planes = [...document.querySelectorAll('.js-plane')];
      this.planes = planes.map((el, i) => {
        const plane = new Plane();
        plane.init(el, i);
        this.scene.add(plane);
        return plane;
      });
    }

    tick = () => {
      const xDiff = this.tx - this.cx;
      const yDiff = this.ty - this.cy;

      this.cx += xDiff * 0.085;
      this.cx = Math.round(this.cx * 100) / 100;

      this.cy += yDiff * 0.085;
      this.cy = Math.round(this.cy * 100) / 100;

      this.diff = Math.max(
        Math.abs(yDiff * 0.0001), 
        Math.abs(xDiff * 0.0001)
      );

      const intensity = 0.025;
      this.velo.x = xDiff * intensity;
      this.velo.y = yDiff * intensity;

      this.planes && this.planes.forEach(plane => 
        plane.update(this.cx, this.cy, this.max, this.velo)
      );

      this.renderer.render(this.scene, this.camera);
    }

    onMouseMove = ({ clientX, clientY }) => {
      if (!this.isDragging) return;
      this.tx = this.on.x + clientX * 2.5;
      this.ty = this.on.y - clientY * 2.5;
    }

    onMouseDown = ({ clientX, clientY }) => {
      if (this.isDragging) return;
      this.isDragging = true;
      this.on.x = this.tx - clientX * 2.5;
      this.on.y = this.ty + clientY * 2.5;
    }

    onMouseUp = () => {
      if (!this.isDragging) return;
      this.isDragging = false;
    }

    onTouchStart = (e) => {
      if (this.isDragging) return;
      this.isDragging = true;
      this.on.x = this.tx - e.touches[0].clientX * 2.5;
      this.on.y = this.ty + e.touches[0].clientY * 2.5;
    }

    onTouchMove = (e) => {
      if (!this.isDragging) return;
      e.preventDefault();
      this.tx = this.on.x + e.touches[0].clientX * 2.5;
      this.ty = this.on.y - e.touches[0].clientY * 2.5;
    }

    onTouchEnd = () => {
      if (!this.isDragging) return;
      this.isDragging = false;
    }

    onWheel = (e) => {
      const { mouse, firefox } = multipliers;
      this.wheel.x = e.wheelDeltaX || e.deltaX * -1;
      this.wheel.y = e.wheelDeltaY || e.deltaY * -1;
      if (isFirefox && e.deltaMode === 1) {
        this.wheel.x *= firefox;
        this.wheel.y *= firefox;
      }
      this.wheel.y *= mouse;
      this.wheel.x *= mouse;
      this.tx += this.wheel.x;
      this.ty -= this.wheel.y;
    }

    resize = () => {
      ww = window.innerWidth;
      wh = window.innerHeight;
      const { bottom, right } = this.el.getBoundingClientRect();
      this.max.x = right;
      this.max.y = bottom;
      if (this.planes) {
        this.planes.forEach(plane => plane.resize());
      }
      this.renderer.setSize(ww, wh);
    }
  }

  const core = new Core();

  homeCanvasCleanup = () => {
    if (core) {
      gsap.ticker.remove(core.tick);
      window.removeEventListener('mousemove', core.onMouseMove);
      window.removeEventListener('mousedown', core.onMouseDown);
      window.removeEventListener('mouseup', core.onMouseUp);
      window.removeEventListener('wheel', core.onWheel, { passive: true });
      window.removeEventListener('touchstart', core.onTouchStart);
      window.removeEventListener('touchmove', core.onTouchMove);
      window.removeEventListener('touchend', core.onTouchEnd);
      window.removeEventListener('resize', core.resize);
      if (core.renderer && core.renderer.domElement && core.renderer.domElement.parentNode) {
        core.renderer.domElement.parentNode.removeChild(core.renderer.domElement);
      }
      if (core.el) {
        core.el.style.touchAction = '';
      }
    }
  };
}

function destroyHomeCanvas() {
  if (homeCanvasCleanup) {
    homeCanvasCleanup();
    homeCanvasCleanup = null;
  }
}

function initHomeTime() {
  destroyHomeTime();

  const defaultTimezone = "Europe/Amsterdam";
  const createFormatter = (timezone) => new Intl.DateTimeFormat([], {
    timeZone: timezone,
    timeZoneName: 'short',
    hour: '2-digit',
    minute: '2-digit',
    second: '2-digit',
    hour12: false,
  });

  const parseFormattedTime = (formattedDateTime) => {
    const match = formattedDateTime.match(/(\d+):(\d+):(\d+)\s*([\w+]+)/);
    if (match) {
      return { hours: match[1], minutes: match[2], seconds: match[3], timezone: match[4] };
    }
    return null;
  };

  const updateTime = () => {
    document.querySelectorAll('[data-current-time]').forEach((element) => {
      const timezone = element.getAttribute('data-current-time') || defaultTimezone;
      const formatter = createFormatter(timezone);
      const now = new Date();
      const formattedDateTime = formatter.format(now);
      const timeParts = parseFormattedTime(formattedDateTime);
      if (timeParts) {
        const { hours, minutes, seconds, timezone } = timeParts;
        const hoursElem = element.querySelector('[data-current-time-hours]');
        const minutesElem = element.querySelector('[data-current-time-minutes]');
        const secondsElem = element.querySelector('[data-current-time-seconds]');
        const timezoneElem = element.querySelector('[data-current-time-timezone]');
        if (hoursElem) hoursElem.textContent = hours;
        if (minutesElem) minutesElem.textContent = minutes;
        if (secondsElem) secondsElem.textContent = seconds;
        if (timezoneElem) timezoneElem.textContent = timezone;
      }
    });
  };

  updateTime();
  const intervalId = setInterval(updateTime, 1000);
  homeTimeCleanup = () => clearInterval(intervalId);
}

function destroyHomeTime() {
  if (homeTimeCleanup) {
    homeTimeCleanup();
    homeTimeCleanup = null;
  }
}

function initHomeAnimations() {
  destroyHomeAnimations();
  initHomeCanvas();
  initHomeTime();
}

function destroyHomeAnimations() {
  destroyHomeCanvas();
  destroyHomeTime();
}

// ================== ABOUT PAGE (Draggable Loop) ==================
function initDraggableInfiniteGSAPSlider() {
  if (typeof gsap === 'undefined' || typeof Draggable === 'undefined' || typeof InertiaPlugin === 'undefined') {
    return;
  }

  const wrapper = document.querySelector('[data-slider="list"]');
  if (!wrapper) return;

  const slides = gsap.utils.toArray('[data-slider="slide"]');
  if (!slides.length) return;

  // Cleanup existing
  destroyDraggableInfiniteGSAPSlider();

  let activeElement = null;
  let currentEl = null;
  let currentIndex = 0;

  // Responsive: decide which element is active
  const mq = window.matchMedia('(min-width: 992px)');
  let useNextForActive = mq.matches;

  const onMQChange = (e) => {
    useNextForActive = e.matches;
    if (currentEl) {
      applyActive(currentEl);
    }
  };
  mq.addEventListener('change', onMQChange);

  function resolveActive(el) {
    return useNextForActive ? (el.nextElementSibling || slides[0]) : el;
  }

  function applyActive(el) {
    if (activeElement) activeElement.classList.remove('active');
    const target = resolveActive(el);
    target.classList.add('active');
    activeElement = target;
  }

  // Helper: horizontal loop (simplified from provided code)
  function horizontalLoop(items, config) {
    items = gsap.utils.toArray(items);
    config = config || {};
    let tl = gsap.timeline({
      repeat: config.repeat,
      paused: config.paused,
      defaults: { ease: "none" },
      onUpdate: config.onChange && function () {
        const i = tl.closestIndex();
        if (tl._lastIndex !== i) {
          tl._lastIndex = i;
          config.onChange(items[i], i);
        }
      }
    });

    const snap = config.snap === false ? (v) => v : gsap.utils.snap(config.snap || 1);
    const center = config.center === true ? items[0].parentNode : gsap.utils.toArray(config.center)[0] || items[0].parentNode;
    const widths = [];
    const xPercents = [];
    let totalWidth;
    const pixelsPerSecond = (config.speed || 1) * 100;
    const times = [];
    let timeWrap;
    let curIndex = 0;
    let proxy;

    const populate = () => {
      const startX = items[0].offsetLeft;
      const spaceBefore = [];
      let b1 = center.getBoundingClientRect(), b2;
      items.forEach((el, i) => {
        widths[i] = parseFloat(gsap.getProperty(el, "width", "px"));
        xPercents[i] = snap(parseFloat(gsap.getProperty(el, "x", "px")) / widths[i] * 100 + gsap.getProperty(el, "xPercent"));
        b2 = el.getBoundingClientRect();
        spaceBefore[i] = b2.left - (i ? b1.right : b1.left);
        b1 = b2;
      });
      gsap.set(items, { xPercent: i => xPercents[i] });
      totalWidth = items[items.length - 1].offsetLeft + xPercents[items.length - 1] / 100 * widths[items.length - 1] - startX + spaceBefore[0] + items[items.length - 1].offsetWidth * gsap.getProperty(items[items.length - 1], "scaleX") + (parseFloat(config.paddingRight) || 0);
    };

    const populateTimeline = () => {
      tl.clear();
      times.length = 0;
      const startX = items[0].offsetLeft;
      items.forEach((item, i) => {
        const curX = xPercents[i] / 100 * widths[i];
        const distanceToStart = item.offsetLeft + curX - startX;
        const distanceToLoop = distanceToStart + widths[i] * gsap.getProperty(item, "scaleX");
        tl.to(item, { xPercent: snap((curX - distanceToLoop) / widths[i] * 100), duration: distanceToLoop / pixelsPerSecond }, 0)
          .fromTo(item, { xPercent: snap((curX - distanceToLoop + totalWidth) / widths[i] * 100) }, {
            xPercent: xPercents[i],
            duration: (curX - distanceToLoop + totalWidth - curX) / pixelsPerSecond,
            immediateRender: false
          }, distanceToLoop / pixelsPerSecond)
          .add("label" + i, distanceToStart / pixelsPerSecond);
        times[i] = distanceToStart / pixelsPerSecond;
      });
      timeWrap = gsap.utils.wrap(0, tl.duration());
    };

    populate();
    populateTimeline();

    const refresh = () => {
      const progress = tl.progress();
      tl.progress(0, true);
      populate();
      populateTimeline();
      tl.progress(progress, true);
    };

    const onResize = () => refresh(true);
    window.addEventListener("resize", onResize);

    function toIndex(index, vars) {
      vars = vars || {};
      if (Math.abs(index - curIndex) > items.length / 2) {
        index += index > curIndex ? -items.length : items.length;
      }
      let newIndex = gsap.utils.wrap(0, items.length, index);
      let time = times[newIndex];
      if ((time > tl.time()) !== (index > curIndex) && index !== curIndex) {
        time += tl.duration() * (index > curIndex ? 1 : -1);
      }
      if (time < 0 || time > tl.duration()) {
        vars.modifiers = { time: timeWrap };
      }
      curIndex = newIndex;
      vars.overwrite = true;
      gsap.killTweensOf(proxy);
      return vars.duration === 0 ? tl.time(timeWrap(time)) : tl.tweenTo(time, vars);
    }

    tl.toIndex = (index, vars) => toIndex(index, vars);
    tl.closestIndex = (setCurrent) => {
      let index = getClosest(times, tl.time(), tl.duration());
      if (setCurrent) {
        curIndex = index;
        tl._lastIndex = index;
      }
      return index;
    };
    tl.current = () => curIndex;

    function getClosest(values, value, wrap) {
      let i = values.length, closest = 1e10, index = 0, d;
      while (i--) {
        d = Math.abs(values[i] - value);
        if (d > wrap / 2) d = wrap - d;
        if (d < closest) {
          closest = d;
          index = i;
        }
      }
      return index;
    }

    // Draggable
    let draggable;
    let wasPlaying = false;
    let startProgress = 0;
    let ratio = 0;
    let initChangeX = 0;
    let lastSnap = 0;
    const wrap = gsap.utils.wrap(0, 1);

    proxy = document.createElement("div");

    draggable = Draggable.create(proxy, {
      trigger: items[0].parentNode,
      type: "x",
      onPressInit() {
        gsap.killTweensOf(tl);
        wasPlaying = !tl.paused();
        tl.pause();
        startProgress = tl.progress();
        refresh();
        ratio = 1 / totalWidth;
        initChangeX = (startProgress / -ratio) - this.x;
        gsap.set(proxy, { x: startProgress / -ratio });
      },
      onDrag() {
        align();
      },
      onThrowUpdate() {
        align();
      },
      overshootTolerance: 0,
      inertia: true,
      snap(value) {
        if (Math.abs(startProgress / -ratio - this.x) < 10) {
          return lastSnap + initChangeX;
        }
        let time = -(value * ratio) * tl.duration();
        let wrappedTime = timeWrap(time);
        let snapTime = times[getClosest(times, wrappedTime, tl.duration())];
        let dif = snapTime - wrappedTime;
        if (Math.abs(dif) > tl.duration() / 2) dif += dif < 0 ? tl.duration() : -tl.duration();
        lastSnap = (time + dif) / tl.duration() / -ratio;
        return lastSnap;
      },
      onRelease() {
        syncIndex();
        this.isThrowing && (tl._indexIsDirty = true);
      },
      onThrowComplete() {
        syncIndex();
        wasPlaying && tl.play();
      }
    })[0];

    function align() {
      tl.progress(wrap(startProgress + (draggable.startX - draggable.x) * ratio));
    }

    function syncIndex() {
      tl.closestIndex(true);
    }

    tl.draggable = draggable;
    tl.closestIndex(true);
    tl._lastIndex = curIndex;
    config.onChange && config.onChange(items[curIndex], curIndex);

    return () => {
      window.removeEventListener("resize", onResize);
      draggable && draggable.kill();
      tl && tl.kill();
    };
  }

  const loopCleanup = horizontalLoop(slides, {
    paused: true,
    draggable: true,
    center: false,
    onChange: (element, index) => {
      currentEl = element;
      currentIndex = index;
      applyActive(element);
    }
  });

  if (!currentEl && slides[0]) {
    currentEl = slides[0];
    currentIndex = 0;
    applyActive(currentEl);
  }

  aboutSliderCleanup = () => {
    if (loopCleanup) loopCleanup();
    mq.removeEventListener('change', onMQChange);
    if (activeElement) activeElement.classList.remove('active');
    activeElement = null;
    currentEl = null;
  };
}

function destroyDraggableInfiniteGSAPSlider() {
  if (aboutSliderCleanup) {
    aboutSliderCleanup();
    aboutSliderCleanup = null;
  }
}

function initAboutAnimations() {
  destroyAboutAnimations();
  initLenisSmoothScroll();
  initGlobalParallax();
  initDraggableInfiniteGSAPSlider();
}

function destroyAboutAnimations() {
  destroyDraggableInfiniteGSAPSlider();
  destroyGlobalParallax();
  destroyLenisSmoothScroll();
}

// REMOVED: initPageAnimations() - Not used, conflicts with Barba views
// REMOVED: destroyAllAnimations() - Conflicts with destroyProjectTemplateAnimations()

// Initialize on DOM ready (no Barba)
document.addEventListener("DOMContentLoaded", () => {
  const namespace = document.querySelector("[data-barba-namespace]")?.getAttribute("data-barba-namespace");
  const init = () => {
    if (namespace === 'project-template') {
      initProjectTemplateAnimations();
    } else if (namespace === 'about') {
      initAboutAnimations();
    } else if (namespace === 'home') {
      initHomeAnimations();
    }
    ensureLenisRunning();
    unlockScrollAfterLenisReady();
    if (typeof ScrollTrigger !== 'undefined') {
      ScrollTrigger.refresh();
    }
  };
  setTimeout(init, 200);
});



})();
