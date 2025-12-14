/**
 * Animations & Transitions Bundle
 * Single file bundle for Webflow integration via CDN
 * 
 * Usage:
 * <script src="https://cdn.jsdelivr.net/gh/yourusername/yourrepo@main/bundle.js"></script>
 */

(function() {
  'use strict';

  // ============================================================================
  // UTILITY FUNCTIONS
  // ============================================================================

  // Webflow Utilities
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

  // ============================================================================
  // TRANSITION ANIMATIONS
  // ============================================================================

  function playMainTransition(data) {
    const tl = gsap.timeline();

    tl.to(data.current.container, {
      opacity: 0.5,
      y: "-12vh",
      x: "12vw",
      rotation: 4,
      ease: "power4.out",
      duration: 0.8,
    }).to(data.current.container.closest(".page-wrapper"), {
      backgroundColor: "rgba(0, 0, 0, 0.5)",
    }, "0").from(data.next.container, {
      duration: 1,
      y: "100vh",
      x: "-50vw",
      ease: "power4.out",
      rotation: -4,
    }, "0");

    return tl;
  }

  // ============================================================================
  // THREE.JS SKETCH CLASS
  // ============================================================================

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
          time: { type: "f", value: 0 },
          progress: { type: "f", value: 0 },
          border: { type: "f", value: 0 },
          intensity: { type: "f", value: 0 },
          scaleX: { type: "f", value: 40 },
          scaleY: { type: "f", value: 40 },
          transition: { type: "f", value: 40 },
          swipe: { type: "f", value: 0 },
          width: { type: "f", value: 0 },
          radius: { type: "f", value: 0 },
          texture1: { type: "f", value: this.textures[0] },
          texture2: { type: "f", value: this.textures[1] },
          displacement: {
            type: "f",
            value: new THREE.TextureLoader().load('https://uploads-ssl.webflow.com/5dc1ae738cab24fef27d7fd2/5dcae913c897156755170518_disp1.jpg')
          },
          resolution: { type: "v4", value: new THREE.Vector4() },
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

  // ============================================================================
  // SCROLL ANIMATIONS
  // ============================================================================

  function wrapWordsInSpan(element) {
    const text = element.textContent;
    element.innerHTML = text
      .split(' ')
      .map(word => `<span class="word">${word}</span>`)
      .join(' ');
  }

  function initScrollAnimations() {
    const paragraph = document.querySelector(".mwg_effect005 .paragraph");
    if (paragraph) {
      wrapWordsInSpan(paragraph);
    }

    const pinHeight = document.querySelector(".mwg_effect005 .pin-height");
    const container = document.querySelector(".mwg_effect005 .container");
    const words = document.querySelectorAll(".mwg_effect005 .word");

    if (!pinHeight || !container || !words.length) {
      return;
    }

    ScrollTrigger.create({
      trigger: pinHeight,
      start: 'top top',
      end: 'bottom bottom',
      pin: container,
      scrub: true,
    });

    gsap.to(words, {
      x: 0,
      opacity: 1,
      stagger: 0.02,
      ease: 'power4.inOut',
      scrollTrigger: {
        trigger: pinHeight,
        start: 'top 70%',
        end: 'bottom bottom',
        scrub: true,
      }
    });
  }

  function destroyScrollAnimations() {
    if (typeof ScrollTrigger !== 'undefined') {
      ScrollTrigger.getAll().forEach(trigger => {
        try {
          if (trigger.vars && trigger.vars.trigger) {
            const triggerEl = trigger.vars.trigger;
            if (triggerEl && triggerEl.closest && triggerEl.closest('.mwg_effect005')) {
              trigger.kill();
            }
          }
        } catch (e) {
          console.warn('ScrollTrigger cleanup warning:', e);
        }
      });
      ScrollTrigger.refresh();
    }
  }

  // ============================================================================
  // PIXELATE EFFECT
  // ============================================================================

  let pixelateInstances = [];

  function initPixelateImageRenderEffect() {
    destroyPixelateImageRenderEffect();

    let renderDuration = 100;
    let renderSteps = 20;
    let renderColumns = 10;

    document.querySelectorAll('[data-pixelate-render]').forEach(setupPixelate);

    function setupPixelate(root) {
      const img = root.querySelector('[data-pixelate-render-img]');
      if (!img) return;

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
      canvas.style.pointerEvents = 'none';
      if (!root.style.position) root.style.position = 'relative';
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
      let targetIndex = 0;
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

      function animate(t) {
        if (!playing) return;
        if (!lastTime) lastTime = t;
        const delta = t - lastTime;

        if (delta >= elRenderDuration) {
          if (stageIndex < targetIndex) {
            stageIndex++;
          } else if (stageIndex > targetIndex) {
            stageIndex--;
          } else {
            playing = false;
            draw(steps[stageIndex]);
            return;
          }
          draw(steps[stageIndex]);
          lastTime = t;
        }
        requestAnimationFrame(animate);
      }

      function setTarget(isHovering) {
        targetIndex = isHovering ? steps.length - 1 : 0;
        if (!playing) {
          playing = true;
          lastTime = 0;
          requestAnimationFrame(animate);
        }
      }

      function init() {
        naturalW = img.naturalWidth; naturalH = img.naturalHeight;
        if (!naturalW || !naturalH) return;
        fitCanvas();
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

      if (img.complete && img.naturalWidth) init();
      else img.addEventListener('load', init, { once: true });

      window.addEventListener('resize', onWindowResize);

      if (trigger === 'hover') {
        root.addEventListener('mouseenter', () => setTarget(true));
        root.addEventListener('mouseleave', () => setTarget(false));
      } else {
        if (trigger === 'load') setTarget(true);
      }

      pixelateInstances.push({
        root, canvas, back, tiny, img, onWindowResize, setTarget, trigger
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

  // ============================================================================
  // LENIS SMOOTH SCROLL
  // ============================================================================

  let lenisInstance = null;
  let lenisTickerFunction = null;

  function initLenisSmoothScroll() {
    destroyLenisSmoothScroll();
    if (typeof Lenis === 'undefined') {
      console.warn('Lenis is not loaded');
      return;
    }
    lenisInstance = new Lenis();
    lenisInstance.on('scroll', ScrollTrigger.update);
    
    // Create ticker function with null check
    lenisTickerFunction = (time) => {
      if (lenisInstance) {
        lenisInstance.raf(time * 1000);
      }
    };
    
    gsap.ticker.add(lenisTickerFunction);
    gsap.ticker.lagSmoothing(0);
  }

  function destroyLenisSmoothScroll() {
    // Remove ticker function first
    if (lenisTickerFunction) {
      gsap.ticker.remove(lenisTickerFunction);
      lenisTickerFunction = null;
    }
    
    // Then destroy Lenis instance
    if (lenisInstance) {
      lenisInstance.destroy();
      lenisInstance = null;
    }
  }

  // ============================================================================
  // PROJECT TEMPLATE ANIMATIONS
  // ============================================================================

  let sketchInstance = null;

  function initProjectTemplateAnimations() {
    initLenisSmoothScroll();
    initScrollAnimations();
    initPixelateImageRenderEffect();

    const sliderContainer = document.getElementById("slider");
    if (sliderContainer && typeof THREE !== 'undefined') {
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
    if (sketchInstance) {
      sketchInstance.destroy();
      sketchInstance = null;
    }
    destroyScrollAnimations();
    destroyPixelateImageRenderEffect();
    destroyLenisSmoothScroll();
  }

  // ============================================================================
  // PAGE ANIMATIONS MANAGER
  // ============================================================================

  let currentNamespace = null;
  let currentCleanup = null;

  function initPageAnimations(namespace) {
    if (currentNamespace && currentNamespace !== namespace && currentCleanup) {
      currentCleanup();
    }

    if (namespace === "project-template") {
      setTimeout(() => {
        initProjectTemplateAnimations();
        currentCleanup = destroyProjectTemplateAnimations;
        currentNamespace = namespace;
      }, 100);
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

  // ============================================================================
  // BARBA.JS SETUP
  // ============================================================================

  function setupBarbaTransitions() {
    if (typeof barba === 'undefined') {
      console.warn('Barba.js is not loaded');
      return;
    }

    barba.hooks.beforeLeave(data => {
      destroyAllAnimations();
    });

    barba.hooks.enter(data => {
      gsap.set(document.querySelector(".page-wrapper"), { overflow: "hidden" });
      // Update cursor to show loading state on all links
      gsap.set("a[href]", { cursor: "progress" });
      gsap.set(data.next.container, {
        position: "fixed",
        top: 0,
        left: 0,
        width: "100%",
      });
    });

    barba.hooks.after(data => {
      gsap.set(data.next.container, { position: "relative" });
      window.scrollTo(0, 0);
      // Reset cursor on all links
      gsap.set("a[href]", { cursor: "pointer" });
      resetWebflow(data);
      
      const namespace = data.next.container.querySelector("[data-barba-namespace]")?.getAttribute("data-barba-namespace");
      if (namespace) {
        initPageAnimations(namespace);
      }
    });

    const barbaConfig = {
      preventRunning: true,
      // Prevent transitions only for external links, target="_blank", or data-barba="false"
      prevent: ({ el }) => {
        // Don't prevent if it's a link with data-barba="false"
        if (el.hasAttribute('data-barba') && el.getAttribute('data-barba') === 'false') {
          return true;
        }
        // Don't prevent if it's an external link
        if (el.href && !el.href.includes(window.location.origin)) {
          return true;
        }
        // Don't prevent if it has target="_blank"
        if (el.target === '_blank') {
          return true;
        }
        // Allow all other internal links
        return false;
      },
      transitions: [
        {
          name: "main-transition",
          sync: true,
          enter: playMainTransition,
        },
      ],
    };

    barba.init(barbaConfig);
  }

  // ============================================================================
  // INITIALIZATION
  // ============================================================================

  function init() {
    setupBarbaTransitions();
    
    const namespace = document.querySelector("[data-barba-namespace]")?.getAttribute("data-barba-namespace");
    if (namespace) {
      initPageAnimations(namespace);
    }
  }

  // Wait for DOM and dependencies
  if (document.readyState === 'loading') {
    document.addEventListener('DOMContentLoaded', init);
  } else {
    // DOM already loaded, wait a bit for external scripts
    setTimeout(init, 100);
  }

})();

