/**
 * Animations & Transitions Bundle
 * Single file bundle for Webflow integration via CDN
 * 
 * Usage:
 * <script src="https://cdn.jsdelivr.net/gh/yourusername/yourrepo@main/bundle.js"></script>
 */

(function() {
  'use strict';

function resetWebflow(data) {
  const parser = new DOMParser();
  const dom = parser.parseFromString(data.next.html, "text/html");
  const webflowPageId = dom.querySelector("html").getAttribute("data-wf-page");

  document.querySelector("html").setAttribute("data-wf-page", webflowPageId);

  if (window.Webflow) {
    window.Webflow.destroy();
    window.Webflow.ready();
    window.Webflow.require("ix2").init();
  }
}


function playMainTransition(data) {
  const tl = gsap.timeline();

  // Animate current page out
  tl.to(data.current.container, {
    opacity: 0.5,
    y: "-12vh",
    x: "12vw",
    rotation: 4,
    ease: "power4.out",
    duration: 0.8,
  })
  // Change background color
  .to(data.current.container.closest(".page-wrapper"), {
    backgroundColor: "rgba(0, 0, 0, 0.5)",
  }, "0")
  // Animate next page in
  .from(data.next.container, {
    duration: 1,
    y: "100vh",
    x: "-50vw",
    ease: "power4.out",
    rotation: -4,
  }, "0");

  return tl;
}


class Sketch {
  constructor(opts) {
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
      console.warn('Sketch: slider container not found');
      return;
    }
    
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
      console.log(this.textures);
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
        console.log('FINISH');
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
        console.log('FINISH');
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
    if (this.clicker && this.nextHandler) {
      this.clicker.removeEventListener('click', this.nextHandler);
    }
    if (this.clicker2 && this.prevHandler) {
      this.clicker2.removeEventListener('click', this.prevHandler);
    }
    if (this.resizeHandler) {
      window.removeEventListener("resize", this.resizeHandler);
    }
    if (this.renderer) {
      this.renderer.dispose();
    }
    if (this.material) {
      this.material.dispose();
    }
    if (this.geometry) {
      this.geometry.dispose();
    }
    if (this.textures) {
      this.textures.forEach(texture => texture.dispose());
    }
    if (this.container && this.renderer && this.renderer.domElement) {
      try {
        this.container.removeChild(this.renderer.domElement);
      } catch (e) {
        // Element might already be removed
      }
    }
  }
}


let pixelateInstances = [];

function initPixelateImageRenderEffect() {
  // Clean up existing instances
  destroyPixelateImageRenderEffect();
  
  let renderDuration = 100;  // Velocizzato leggermente per l'hover
  let renderSteps = 20;      // Più step per fluidità
  let renderColumns = 10;    // Blocchi iniziali

  const pixelateElements = document.querySelectorAll('[data-pixelate-render]');
  console.log('🎨 Pixelate elements found:', pixelateElements.length);
  
  if (pixelateElements.length === 0) {
    console.warn('⚠️ No pixelate elements found ([data-pixelate-render])');
  }
  
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

let lenisInstance = null;

function initLenisSmoothScroll() {
  // Destroy existing instance if any
  destroyLenisSmoothScroll();

  if (typeof Lenis === 'undefined') {
    console.warn('⚠️ Lenis is not loaded');
    return;
  }

  // Initialize a new Lenis instance for smooth scrolling
  lenisInstance = new Lenis({
    lerp: 0.1,
    smooth: true,
  });

  // Synchronize Lenis scrolling with GSAP's ScrollTrigger plugin
  lenisInstance.on('scroll', ScrollTrigger.update);

  // Create animation loop (as per Lenis documentation)
  const loop = (time) => {
    if (lenisInstance) {
      lenisInstance.raf(time);
    }
    requestAnimationFrame(loop);
  };
  requestAnimationFrame(loop);

  console.log('✅ Lenis smooth scroll initialized');
}

function destroyLenisSmoothScroll() {
  // Destroy Lenis instance
  if (lenisInstance) {
    lenisInstance.destroy();
    lenisInstance = null;
  }
}

function wrapWordsInSpan(element) {
  const text = element.textContent;
  element.innerHTML = text
    .split(' ')
    .map(word => `<span class="word">${word}</span>`)
    .join(' ');
}

function initScrollAnimations() {
  console.log('📜 Initializing scroll animations...');
  
  // Register ScrollTrigger plugin
  if (typeof gsap !== 'undefined' && typeof ScrollTrigger !== 'undefined') {
    gsap.registerPlugin(ScrollTrigger);
    console.log('✅ ScrollTrigger registered');
  } else {
    console.error('❌ GSAP or ScrollTrigger not loaded!');
    return;
  }

  const paragraph = document.querySelector(".mwg_effect005 .paragraph");
  if (paragraph) {
    console.log('✅ Paragraph found, wrapping words...');
    wrapWordsInSpan(paragraph);
  } else {
    console.warn('⚠️ Paragraph (.mwg_effect005 .paragraph) not found');
  }

  const pinHeight = document.querySelector(".mwg_effect005 .pin-height");
  const container = document.querySelector(".mwg_effect005 .container");
  const words = document.querySelectorAll(".mwg_effect005 .word");

  console.log('🔍 Elements check:', {
    pinHeight: !!pinHeight,
    container: !!container,
    wordsCount: words.length
  });

  if (!pinHeight || !container || !words.length) {
    console.error('❌ Scroll animations: Missing required elements!');
    if (!pinHeight) console.error('  - Missing: .mwg_effect005 .pin-height');
    if (!container) console.error('  - Missing: .mwg_effect005 .container');
    if (!words.length) console.error('  - Missing: .mwg_effect005 .word elements');
    return;
  }
  
  console.log('✅ All elements found, creating ScrollTriggers...');

  // Set initial state for words
  gsap.set(words, { x: 50, opacity: 0 });
  
  // Create animation timeline
  const timeline = gsap.to(words, {
    x: 0,
    opacity: 1,
    stagger: 0.02,
    ease: 'power4.inOut',
  });

  // --- 1. IL TRIGGER CHE BLOCCA (PIN) ---
  // Questo deve rimanere 'top top' per non lasciare spazi vuoti sopra
  const pinInstance = ScrollTrigger.create({
    trigger: pinHeight,
    start: 'top top',     // Blocca in cima
    end: 'bottom bottom', // Sblocca alla fine
    pin: container,       // Cosa bloccare
    scrub: true,
    // markers: true // Attivali per debuggare il PIN
  });
  scrollTriggerInstances.push(pinInstance);
  console.log('✅ Pin ScrollTrigger created');

  // --- 2. IL TRIGGER CHE ANIMA (MOVIMENTO) ---
  // Qui puoi decidere liberamente quando far partire l'animazione
  const animationInstance = ScrollTrigger.create({
    animation: timeline,
    trigger: pinHeight,
    start: 'top 70%',
    end: 'bottom bottom',
    scrub: true,
    // markers: true // Attivali per debuggare l'ANIMAZIONE
  });
  scrollTriggerInstances.push(animationInstance);
  console.log('✅ Words animation ScrollTrigger created');
  console.log('✅ Scroll animations initialized successfully');
}

function destroyScrollAnimations() {
  // Kill all ScrollTriggers related to this section
  if (typeof ScrollTrigger !== 'undefined') {
    // Kill instances from scrollTriggerInstances array
    scrollTriggerInstances.forEach(instance => {
      try {
        if (instance && instance.kill) {
          instance.kill();
        }
      } catch (e) {
        // Ignore errors
      }
    });
    scrollTriggerInstances = [];
    
    // Also kill any remaining ScrollTriggers related to mwg_effect005
    ScrollTrigger.getAll().forEach(trigger => {
      try {
        if (trigger.vars && trigger.vars.trigger) {
          const triggerEl = trigger.vars.trigger;
          if (triggerEl && triggerEl.closest && triggerEl.closest('.mwg_effect005')) {
            trigger.kill();
          }
        }
      } catch (e) {
        // If trigger is already destroyed, continue
      }
    });
    // Refresh ScrollTrigger after cleanup
    ScrollTrigger.refresh();
  }
}

// Global Parallax Context
let parallaxContext = null;

function initGlobalParallax() {
  console.log('🌊 Initializing global parallax...');
  
  // Clean up existing parallax context
  if (parallaxContext) {
    parallaxContext.revert();
    parallaxContext = null;
  }
  
  // Register ScrollTrigger plugin
  if (typeof gsap !== 'undefined' && typeof ScrollTrigger !== 'undefined') {
    gsap.registerPlugin(ScrollTrigger);
  }
  
  const mm = gsap.matchMedia();

  mm.add(
    {
      isMobile: "(max-width:479px)",
      isMobileLandscape: "(max-width:767px)",
      isTablet: "(max-width:991px)",
      isDesktop: "(min-width:992px)"
    },
    (context) => {
      const { isMobile, isMobileLandscape, isTablet } = context.conditions;

      parallaxContext = gsap.context(() => {
        const parallaxElements = document.querySelectorAll('[data-parallax="trigger"]');
        console.log('🌊 Parallax elements found:', parallaxElements.length);
        
        parallaxElements.forEach((trigger) => {
            // Check if this trigger has to be disabled on smaller breakpoints
            const disable = trigger.getAttribute("data-parallax-disable");
            if (
              (disable === "mobile" && isMobile) ||
              (disable === "mobileLandscape" && isMobileLandscape) ||
              (disable === "tablet" && isTablet)
            ) {
              return;
            }
            
            // Optional: you can target an element inside a trigger if necessary 
            const target = trigger.querySelector('[data-parallax="target"]') || trigger;

            // Get the direction value to decide between xPercent or yPercent tween
            const direction = trigger.getAttribute("data-parallax-direction") || "vertical";
            const prop = direction === "horizontal" ? "xPercent" : "yPercent";
            
            // Get the scrub value, our default is 'true' because that feels nice with Lenis
            const scrubAttr = trigger.getAttribute("data-parallax-scrub");
            const scrub = scrubAttr ? parseFloat(scrubAttr) : true;
            
            // Get the start position in % 
            const startAttr = trigger.getAttribute("data-parallax-start");
            const startVal = startAttr !== null ? parseFloat(startAttr) : 20;
            
            // Get the end position in %
            const endAttr = trigger.getAttribute("data-parallax-end");
            const endVal = endAttr !== null ? parseFloat(endAttr) : -20;
            
            // Get the start value of the ScrollTrigger
            const scrollStartRaw = trigger.getAttribute("data-parallax-scroll-start") || "top bottom";
            const scrollStart = `clamp(${scrollStartRaw})`;
            
           // Get the end value of the ScrollTrigger  
            const scrollEndRaw = trigger.getAttribute("data-parallax-scroll-end") || "bottom top";
            const scrollEnd = `clamp(${scrollEndRaw})`;

            gsap.fromTo(
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
          });
      });

      return () => {
        if (parallaxContext) {
          parallaxContext.revert();
          parallaxContext = null;
        }
      };
    }
  );
  
  console.log('✅ Global parallax initialized');
}

function destroyGlobalParallax() {
  if (parallaxContext) {
    console.log('🧹 Destroying global parallax...');
    parallaxContext.revert();
    parallaxContext = null;
  }
}

let sketchInstance = null;

function initProjectTemplateAnimations() {
  console.log('🎬 Initializing project-template animations...');
  
  // Initialize Lenis smooth scroll first
  initLenisSmoothScroll();

  // Initialize global parallax
  initGlobalParallax();

  // Initialize ScrollTrigger animations
  initScrollAnimations();

  // Initialize pixelate effect
  console.log('🎨 Initializing pixelate effect...');
  initPixelateImageRenderEffect();

  // Initialize Three.js Sketch (planetary effect)
  const sliderContainer = document.getElementById("slider");
  if (sliderContainer) {
    console.log('✅ Slider container found, initializing Sketch...');
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
  } else {
    console.warn('⚠️ Slider container (#slider) not found');
  }
  
  console.log('✅ Project-template animations initialized');
}

function destroyProjectTemplateAnimations() {
  console.log('🧹 Destroying project-template animations...');
  
  // Destroy Sketch instance
  if (sketchInstance) {
    sketchInstance.destroy();
    sketchInstance = null;
  }

  // Destroy scroll animations
  destroyScrollAnimations();

  // Destroy pixelate effects
  destroyPixelateImageRenderEffect();

  // Destroy global parallax
  destroyGlobalParallax();

  // Destroy Lenis
  destroyLenisSmoothScroll();
  
  console.log('✅ All animations destroyed');
}

// Store current namespace and cleanup function
let currentNamespace = null;
let currentCleanup = null;

function initPageAnimations(namespace) {
  console.log('🎯 initPageAnimations called with namespace:', namespace);
  
  // Always clean up previous animations, even if namespace is the same
  // This ensures animations are properly reinitialized when navigating between pages with the same namespace
  if (currentCleanup) {
    console.log('🧹 Cleaning up previous animations...');
    currentCleanup();
    currentCleanup = null;
    currentNamespace = null;
  }

  // Initialize animations based on namespace
  if (namespace === "project-template") {
    console.log('🚀 Initializing project-template animations...');
    // Use requestAnimationFrame to ensure DOM is ready, then add a delay
    requestAnimationFrame(() => {
      setTimeout(() => {
        // Force ScrollTrigger refresh before initializing
        if (typeof ScrollTrigger !== 'undefined') {
          ScrollTrigger.refresh();
        }
        
        // Initialize animations
        initProjectTemplateAnimations();
        
        // Force ScrollTrigger refresh after initializing with multiple attempts
        if (typeof ScrollTrigger !== 'undefined') {
          setTimeout(() => {
            ScrollTrigger.refresh();
          }, 100);
          setTimeout(() => {
            ScrollTrigger.refresh();
          }, 300);
        }
        
        currentCleanup = destroyProjectTemplateAnimations;
        currentNamespace = namespace;
      }, 300);
    });
  } else {
    currentNamespace = namespace;
    currentCleanup = null;
  }
}

function destroyAllAnimations() {
  if (currentCleanup) {
    currentCleanup();
    currentCleanup = null;
    currentNamespace = null;
  }
}

// Store ScrollTrigger instances for cleanup
let scrollTriggerInstances = [];

function setupBarbaTransitions() {
  // Initialize Barba with Views (recommended way)
  barba.init({
    preventRunning: true,
    transitions: [
      {
        name: "main-transition",
        sync: true,
        enter(data) {
          // Lock page wrapper
          const pageWrapper = document.querySelector(".page-wrapper");
          if (pageWrapper) {
            gsap.set(pageWrapper, { overflow: "hidden" });
          }
          
          // Position next page container
          gsap.set(data.next.container, {
            position: "fixed",
            top: 0,
            left: 0,
            width: "100%",
          });
          
          // Play transition animation
          return playMainTransition(data);
        },
        afterEnter(data) {
          console.log('✅ Transition afterEnter - page transition completed');
          
          // Reset container position
          gsap.set(data.next.container, { position: "relative" });
          
          // Scroll to top
          window.scrollTo(0, 0);
          
          // Reset Webflow
          resetWebflow(data);
        },
        beforeLeave(data) {
          // Destroy animations from current page
          console.log('🧹 Cleaning up animations before leaving...');
          destroyAllAnimations();
        }
      },
    ],
    views: [
      {
        namespace: 'project-template',
        beforeEnter() {
          console.log('🎯 project-template beforeEnter - cleaning up...');
          // Destroy all animations before entering
          destroyProjectTemplateAnimations();
          
          // Clean up any remaining ScrollTriggers
          if (typeof ScrollTrigger !== 'undefined') {
            ScrollTrigger.getAll().forEach(trigger => {
              try {
                trigger.kill();
              } catch (e) {
                // Ignore errors
              }
            });
            ScrollTrigger.refresh();
          }
        },
        afterEnter() {
          console.log('🎯 project-template afterEnter - initializing animations...');
          
          // Wait for DOM to be ready and ensure Webflow is initialized
          requestAnimationFrame(() => {
            setTimeout(() => {
              // Register ScrollTrigger plugin
              if (typeof gsap !== 'undefined' && typeof ScrollTrigger !== 'undefined') {
                gsap.registerPlugin(ScrollTrigger);
              }
              
              // Refresh ScrollTrigger before initializing
              if (typeof ScrollTrigger !== 'undefined') {
                ScrollTrigger.refresh();
              }
              
              // Initialize all animations (includes parallax)
              initProjectTemplateAnimations();
              
              // Force ScrollTrigger refresh after initializing with multiple attempts
              if (typeof ScrollTrigger !== 'undefined') {
                setTimeout(() => {
                  ScrollTrigger.refresh();
                }, 150);
                setTimeout(() => {
                  ScrollTrigger.refresh();
                }, 400);
                setTimeout(() => {
                  ScrollTrigger.refresh();
                }, 600);
              }
            }, 300);
          });
        },
        afterLeave() {
          console.log('🧹 project-template afterLeave - destroying animations...');
          destroyProjectTemplateAnimations();
        }
      }
    ],
    // Global hooks for all pages (including parallax cleanup/reinit)
    hooks: {
      afterEnter() {
        // Reinitialize parallax for all pages after transition
        console.log('🌊 Reinitializing parallax after transition...');
        destroyGlobalParallax();
        setTimeout(() => {
          initGlobalParallax();
        }, 100);
      },
      beforeLeave() {
        // Clean up parallax before leaving
        console.log('🧹 Cleaning up parallax before leaving...');
        destroyGlobalParallax();
      }
    }
  });
}

// Initialize on DOM ready
document.addEventListener("DOMContentLoaded", () => {
  console.log('📦 DOM Content Loaded - Initializing...');
  
  // Register ScrollTrigger plugin
  if (typeof gsap !== 'undefined' && typeof ScrollTrigger !== 'undefined') {
    gsap.registerPlugin(ScrollTrigger);
  }
  
  // Setup Barba.js transitions
  setupBarbaTransitions();
  
  // Initialize global parallax (works on all pages)
  initGlobalParallax();
  
  // Initialize page-specific animations for initial page load
  const namespace = document.querySelector("[data-barba-namespace]")?.getAttribute("data-barba-namespace");
  console.log('🔍 Initial namespace found:', namespace);
  if (namespace) {
    // Add a small delay to ensure everything is ready
    setTimeout(() => {
      initPageAnimations(namespace);
    }, 200);
  }
});



})();
