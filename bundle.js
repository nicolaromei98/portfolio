(function () {
  'use strict';

  // ============================================================================
  // SETUP
  // ============================================================================

  // FORZA IL BROWSER A TORNARE IN CIMA AL REFRESH PER EVITARE GLITCH DI CALCOLO
  if ('scrollRestoration' in history) {
    history.scrollRestoration = 'manual';
  }
  window.scrollTo(0, 0);

  if (typeof gsap !== 'undefined' && typeof ScrollTrigger !== 'undefined') {
    gsap.registerPlugin(ScrollTrigger);
  }

  // ============================================================================
  // LENIS SMOOTH SCROLL
  // ============================================================================

  function initLenisSmoothScroll() {
    if (typeof Lenis === 'undefined') return;

    const lenis = new Lenis({ lerp: 0.1 });
    if (typeof ScrollTrigger !== 'undefined') {
      lenis.on('scroll', ScrollTrigger.update);
    }

    const loop = (time) => {
      lenis.raf(time);
      requestAnimationFrame(loop);
    };
    requestAnimationFrame(loop);
  }

  // ============================================================================
  // GLOBAL PARALLAX ([data-parallax="trigger"])
  // ============================================================================

  function initGlobalParallax() {
    if (typeof gsap === 'undefined' || typeof ScrollTrigger === 'undefined') return;

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

        document.querySelectorAll('[data-parallax="trigger"]').forEach((trigger) => {
          const disable = trigger.getAttribute("data-parallax-disable");
          if (
            (disable === "mobile" && isMobile) ||
            (disable === "mobileLandscape" && isMobileLandscape) ||
            (disable === "tablet" && isTablet)
          ) {
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
          const scrollStart = `clamp(${trigger.getAttribute("data-parallax-scroll-start") || "top bottom"})`;
          const scrollEnd = `clamp(${trigger.getAttribute("data-parallax-scroll-end") || "bottom top"})`;

          gsap.fromTo(
            target,
            { [prop]: startVal },
            {
              [prop]: endVal,
              ease: "none",
              scrollTrigger: { trigger, start: scrollStart, end: scrollEnd, scrub }
            }
          );
        });
      }
    );
  }

  // ============================================================================
  // PROJECT TEMPLATE – DITHER SLIDER (#slider, #next, #prev)
  // ============================================================================

  const DITHER_VERTEX = `
    varying vec2 vUv;
    void main() {
      vUv = uv;
      gl_Position = projectionMatrix * modelViewMatrix * vec4(position, 1.0);
    }
  `;

  const DITHER_FRAGMENT = `
    precision highp float;
    uniform sampler2D texture1;
    uniform sampler2D texture2;
    uniform vec2 res1;
    uniform vec2 res2;
    uniform vec2 resolution;
    uniform float progress;
    uniform float pixelSize;
    varying vec2 vUv;

    vec2 coverUV(vec2 uv, vec2 imgRes) {
      float rs = (resolution.x / resolution.y) / (imgRes.x / imgRes.y);
      vec2 s = rs > 1.0 ? vec2(1.0, 1.0 / rs) : vec2(rs, 1.0);
      return (uv - 0.5) * s + 0.5;
    }

    float luma(vec3 c) { return dot(c, vec3(0.299, 0.587, 0.114)); }

    // Matrici di Bayer (ordered dither)
    float bayer2(vec2 a) { a = floor(a); return fract(a.x * 0.5 + a.y * a.y * 0.75); }
    float bayer4(vec2 a) { return bayer2(0.5 * a) * 0.25 + bayer2(a); }
    float bayer8(vec2 a) { return bayer4(0.5 * a) * 0.25 + bayer2(a); }

    float hash(vec2 p) { return fract(sin(dot(p, vec2(12.9898, 78.233))) * 43758.5453); }

    // Luminosità di una cella: ogni cella passa da A a B in un momento casuale
    float cellLum(vec2 cell, float flip) {
      vec2 uv = (cell + 0.5) * pixelSize / resolution;
      float a = luma(texture2D(texture1, coverUV(uv, res1)).rgb);
      float b = luma(texture2D(texture2, coverUV(uv, res2)).rgb);
      return smoothstep(0.12, 0.88, mix(a, b, step(hash(cell), flip)));
    }

    void main() {
      vec2 pos = vUv * resolution;
      vec2 cell = floor(pos / pixelSize);

      // 0 → 0.3: entra il dither | 0.3 → 0.7: i punti passano da A a B | 0.7 → 1: esce il dither
      float amount = smoothstep(0.0, 0.3, progress) * (1.0 - smoothstep(0.7, 1.0, progress));
      float flip = smoothstep(0.3, 0.7, progress);

      // Punti LED con glow (somma delle celle vicine 3x3)
      float light = 0.0;
      for (int x = -1; x <= 1; x++) {
        for (int y = -1; y <= 1; y++) {
          vec2 c = cell + vec2(float(x), float(y));
          float on = step(bayer4(c) + 0.03, cellLum(c, flip));
          float d = length(pos / pixelSize - (c + 0.5));
          light += on * (smoothstep(0.34, 0.16, d) + 0.5 * exp(-d * d * 2.2));
        }
      }
      vec3 dither = vec3(1.0 - exp(-light * 1.6));

      vec3 clean = progress < 0.5
        ? texture2D(texture1, coverUV(vUv, res1)).rgb
        : texture2D(texture2, coverUV(vUv, res2)).rgb;

      // Passaggio immagine ↔ dither cella per cella:
      // entrata con pattern ordinato (Bayer), uscita con ordine casuale
      float order = progress < 0.5 ? bayer8(cell) : hash(cell + 17.31);
      float m = 1.0 - step(amount, order);
      gl_FragColor = vec4(mix(clean, dither, m), 1.0);
    }
  `;

  class DitherSlider {
    constructor(container, opts = {}) {
      this.container = container;
      this.images = JSON.parse(container.getAttribute('data-images') || '[]');
      if (this.images.length < 2) return;

      this.duration = opts.duration || 1.6;
      this.pixelSize = opts.pixelSize || 6;
      this.current = 0;
      this.isRunning = false;

      this.scene = new THREE.Scene();
      this.camera = new THREE.OrthographicCamera(-0.5, 0.5, 0.5, -0.5, -1, 1);
      this.renderer = new THREE.WebGLRenderer();
      this.renderer.setPixelRatio(Math.min(window.devicePixelRatio, 2));
      this.renderer.setClearColor(0xeeeeee, 1);

      const canvas = this.renderer.domElement;
      Object.assign(canvas.style, {
        position: 'absolute', top: '0', left: '0',
        width: '100%', height: '100%',
        display: 'block', pointerEvents: 'none'
      });
      if (getComputedStyle(container).position === 'static') {
        container.style.position = 'relative';
      }
      container.querySelectorAll('canvas').forEach((c) => c.remove());
      container.appendChild(canvas);

      this.loadTextures().then(() => {
        this.addObjects();
        this.resize();
        window.addEventListener('resize', () => this.resize());
        document.getElementById('next')?.addEventListener('click', () => this.goTo(this.current + 1));
        document.getElementById('prev')?.addEventListener('click', () => this.goTo(this.current - 1));
      });
    }

    loadTextures() {
      const loader = new THREE.TextureLoader();
      return Promise.all(
        this.images.map((url) => new Promise((resolve) => {
          loader.load(url, (texture) => {
            texture.minFilter = THREE.LinearFilter;
            texture.generateMipmaps = false;
            resolve(texture);
          });
        }))
      ).then((textures) => {
        this.textures = textures;
      });
    }

    addObjects() {
      this.uniforms = {
        texture1: { value: null },
        texture2: { value: null },
        res1: { value: new THREE.Vector2(1, 1) },
        res2: { value: new THREE.Vector2(1, 1) },
        resolution: { value: new THREE.Vector2(1, 1) },
        progress: { value: 0 },
        pixelSize: { value: this.pixelSize }
      };
      this.setTexture(1, 0);
      this.setTexture(2, 1);

      const material = new THREE.ShaderMaterial({
        uniforms: this.uniforms,
        vertexShader: DITHER_VERTEX,
        fragmentShader: DITHER_FRAGMENT
      });
      this.scene.add(new THREE.Mesh(new THREE.PlaneGeometry(1, 1), material));
    }

    setTexture(slot, index) {
      const texture = this.textures[index];
      this.uniforms[`texture${slot}`].value = texture;
      this.uniforms[`res${slot}`].value.set(texture.image.width, texture.image.height);
    }

    goTo(index) {
      if (this.isRunning || !this.uniforms) return;
      this.isRunning = true;

      const nextIndex = (index + this.textures.length) % this.textures.length;
      this.setTexture(2, nextIndex);

      gsap.fromTo(this.uniforms.progress, { value: 0 }, {
        value: 1,
        duration: this.duration,
        ease: 'power1.inOut',
        onUpdate: () => this.render(),
        onComplete: () => {
          this.current = nextIndex;
          this.setTexture(1, nextIndex);
          this.uniforms.progress.value = 0;
          this.render();
          this.isRunning = false;
        }
      });
    }

    resize() {
      const w = this.container.offsetWidth;
      const h = this.container.offsetHeight;
      this.renderer.setSize(w, h);
      this.uniforms.resolution.value.set(w, h);
      this.render();
    }

    render() {
      this.renderer.render(this.scene, this.camera);
    }
  }

  function initDitherSlider() {
    const slider = document.getElementById('slider');
    if (!slider || typeof THREE === 'undefined' || typeof gsap === 'undefined') return;
    new DitherSlider(slider, { duration: 1.6, pixelSize: 6 });
  }

  // ============================================================================
  // HOME – INFINITE WEBGL GRID (.js-grid / .js-plane)
  // ============================================================================

  function initHomeCanvas() {
    if (typeof THREE === 'undefined' || typeof gsap === 'undefined') return;

    const gridEl = document.querySelector('.js-grid');
    if (!gridEl) return;

    // BLOCCA LO SWIPE AVANTI/INDIETRO DEL BROWSER
    document.body.style.overscrollBehavior = 'none';
    document.documentElement.style.overscrollBehavior = 'none';

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
        // POSIZIONE ASSOLUTA NELLA PAGINA (CON SCROLL), NON NEL VIEWPORT
        this.rect = this.el.getBoundingClientRect();
        const width = this.rect.width;
        const height = this.rect.height;
        const left = this.rect.left + window.scrollX;
        const top = this.rect.top + window.scrollY;

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
        this.wheel = { x: 0, y: 0 };
        this.on = { x: 0, y: 0 };
        this.max = { x: 0, y: 0 };
        this.isDragging = false;

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
        Object.assign(canvasEl.style, {
          position: 'fixed', top: '0', left: '0',
          width: '100%', height: '100%',
          pointerEvents: 'none', zIndex: '-1'
        });
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
        // PASSIVE: FALSE PER BLOCCARE LO SWIPE INDIETRO
        window.addEventListener('wheel', this.onWheel, { passive: false });
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
        this.isDragging = false;
      }

      onWheel = (e) => {
        // BLOCCA LO SWIPE AVANTI/INDIETRO SU MAC SE IL MOVIMENTO È ORIZZONTALE
        if (Math.abs(e.deltaX) > Math.abs(e.deltaY)) {
          e.preventDefault();
        }

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

        this.camera.left = ww / -2;
        this.camera.right = ww / 2;
        this.camera.top = wh / 2;
        this.camera.bottom = wh / -2;
        this.camera.updateProjectionMatrix();

        this.renderer.setSize(ww, wh);

        const { bottom, right } = this.el.getBoundingClientRect();
        this.max.x = right;
        this.max.y = bottom;

        if (this.planes) {
          this.planes.forEach(plane => plane.resize());
        }
      }
    }

    new Core();
  }

  // ============================================================================
  // ABOUT – DRAGGABLE INFINITE SLIDER ([data-slider="list"])
  // ============================================================================

  function initDraggableInfiniteGSAPSlider() {
    if (typeof gsap === 'undefined' || typeof Draggable === 'undefined' || typeof InertiaPlugin === 'undefined') {
      return;
    }
    const wrapper = document.querySelector('[data-slider="list"]');
    if (!wrapper) return;
    const slides = gsap.utils.toArray('[data-slider="slide"]');
    if (!slides.length) return;

    let activeElement = null;
    let currentEl = null;
    const mq = window.matchMedia('(min-width: 992px)');
    let useNextForActive = mq.matches;

    mq.addEventListener('change', (e) => {
      useNextForActive = e.matches;
      if (currentEl) applyActive(currentEl);
    });

    function resolveActive(el) {
      return useNextForActive ? (el.nextElementSibling || slides[0]) : el;
    }

    function applyActive(el) {
      if (activeElement) activeElement.classList.remove('active');
      const target = resolveActive(el);
      target.classList.add('active');
      activeElement = target;
    }

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
      window.addEventListener("resize", refresh);
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
      let wasPlaying = false;
      let startProgress = 0;
      let ratio = 0;
      let initChangeX = 0;
      let lastSnap = 0;
      const wrap = gsap.utils.wrap(0, 1);
      proxy = document.createElement("div");
      const draggable = Draggable.create(proxy, {
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
      return tl;
    }

    horizontalLoop(slides, {
      paused: true,
      center: false,
      onChange: (element) => {
        currentEl = element;
        applyActive(element);
      }
    });

    if (!currentEl && slides[0]) {
      currentEl = slides[0];
      applyActive(currentEl);
    }
  }

  // ============================================================================
  // INIT PER PAGINA (data-barba-namespace)
  // ============================================================================

  document.addEventListener("DOMContentLoaded", () => {
    const namespace = document.querySelector("[data-barba-namespace]")?.getAttribute("data-barba-namespace");

    if (namespace === 'home') {
      initHomeCanvas();
    } else if (namespace === 'about') {
      initLenisSmoothScroll();
      initGlobalParallax();
      initDraggableInfiniteGSAPSlider();
    } else if (namespace === 'project-template') {
      initLenisSmoothScroll();
      initGlobalParallax();
      initDitherSlider();
    }

    if (typeof ScrollTrigger !== 'undefined') {
      ScrollTrigger.refresh();
    }
  });

})();
