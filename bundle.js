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
    uniform sampler2D fieldMap;
    uniform vec2 res1;
    uniform vec2 res2;
    uniform vec2 resolution;
    uniform float pixelRatio;
    uniform float progress;
    uniform float ditherSize;
    varying vec2 vUv;

    const float WIDTH = 0.28;   // spessore della nuvola
    const float BOIL = 0.12;    // turbolenza
    const float MARGIN = 0.36;  // WIDTH + turbolenza: la nuvola parte ed esce del tutto fuori

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

    vec3 image(vec2 uv, float useB) {
      return useB > 0.5
        ? texture2D(texture2, coverUV(uv, res2)).rgb
        : texture2D(texture1, coverUV(uv, res1)).rgb;
    }

    void main() {
      // Campo della nuvola (interpolato, bordi morbidi):
      // r = quando passa la nuvola (0 → 1), g/b = turbolenza
      vec4 f = texture2D(fieldMap, vUv);
      float front = mix(-MARGIN, 1.0 + MARGIN, progress);
      float boil = mix(f.g, f.b, progress) - 0.5;
      float dist = abs(f.r - front + boil * BOIL);
      float density = 1.0 - smoothstep(WIDTH * 0.35, WIDTH, dist);

      // Dietro la nuvola c'è già la nuova immagine
      float useB = step(f.r, front);
      vec3 clean = image(vUv, useB);

      // Griglia del dither in pixel del display
      vec2 cell = floor(gl_FragCoord.xy / ditherSize);

      // Bordo della nuvola sfumato con un Bayer trasposto (non si allinea al dither dell'immagine)
      if (bayer8(cell.yx + vec2(3.0, 5.0)) + 1.0 / 128.0 > density) {
        gl_FragColor = vec4(clean, 1.0);
        return;
      }

      // Dentro la nuvola: dither a 1 bit, bianco e nero
      vec2 cellUv = (cell + 0.5) * ditherSize / (resolution * pixelRatio);
      float lum = smoothstep(0.12, 0.88, luma(image(cellUv, useB)));
      gl_FragColor = vec4(vec3(step(bayer8(cell) + 1.0 / 128.0, lum)), 1.0);
    }
  `;

  // Rumore per il campo della nuvola (calcolato una volta per transizione, non per pixel)
  function createNoise(seed) {
    const hash = (x, y) => {
      const s = Math.sin(x * 127.1 + y * 311.7 + seed * 74.7) * 43758.5453;
      return s - Math.floor(s);
    };
    const smooth = (t) => t * t * (3 - 2 * t);
    const noise = (x, y) => {
      const xi = Math.floor(x), yi = Math.floor(y);
      const xf = smooth(x - xi), yf = smooth(y - yi);
      const a = hash(xi, yi), b = hash(xi + 1, yi);
      const c = hash(xi, yi + 1), d = hash(xi + 1, yi + 1);
      return (a + (b - a) * xf) + ((c + (d - c) * xf) - (a + (b - a) * xf)) * yf;
    };
    const fbm = (x, y) => {
      let v = 0, amp = 0.5;
      for (let i = 0; i < 4; i++) {
        v += amp * noise(x, y);
        x = x * 2.03 + 17.1;
        y = y * 2.03 + 17.1;
        amp *= 0.5;
      }
      return v / 0.9375;
    };
    return { noise, fbm };
  }

  class DitherSlider {
    constructor(container, opts = {}) {
      this.container = container;
      this.images = JSON.parse(container.getAttribute('data-images') || '[]');
      if (this.images.length < 2) return;

      this.duration = opts.duration || 1.2;
      this.ditherSize = opts.ditherSize || 1; // px del display per punto
      this.fieldCell = 6;                     // risoluzione della forma della nuvola (px CSS)
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
        fieldMap: { value: null },
        res1: { value: new THREE.Vector2(1, 1) },
        res2: { value: new THREE.Vector2(1, 1) },
        resolution: { value: new THREE.Vector2(1, 1) },
        pixelRatio: { value: 1 },
        progress: { value: 0 },
        ditherSize: { value: this.ditherSize }
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

    // Forma della nuvola su una griglia grossa: nuova forma a ogni transizione
    buildField() {
      const w = this.container.offsetWidth;
      const h = this.container.offsetHeight;
      const cols = Math.ceil(w / this.fieldCell);
      const rows = Math.ceil(h / this.fieldCell);
      const { noise, fbm } = createNoise(Math.random() * 100);
      const count = cols * rows;
      const raw = new Float32Array(count);
      const data = new Uint8Array(count * 4);

      for (let y = 0; y < rows; y++) {
        for (let x = 0; x < cols; x++) {
          const i = y * cols + x;
          raw[i] = fbm((x + 0.5) * this.fieldCell / h * 2.5, (y + 0.5) * this.fieldCell / h * 2.5);
          data[i * 4 + 1] = noise(x / cols * 6, y / rows * 6) * 255;
          data[i * 4 + 2] = noise(x / cols * 6 + 40, y / rows * 6 + 40) * 255;
          data[i * 4 + 3] = 255;
        }
      }

      // Equalizzazione: ogni zona ha un momento diverso (niente macchie che spariscono in blocco)
      const order = Array.from(raw.keys()).sort((a, b) => raw[a] - raw[b]);
      order.forEach((cellIndex, rank) => {
        data[cellIndex * 4] = Math.round((rank / (count - 1)) * 255);
      });

      // Filtro lineare: la nuvola è morbida anche se la griglia è grossa
      const texture = new THREE.DataTexture(data, cols, rows, THREE.RGBAFormat);
      texture.minFilter = THREE.LinearFilter;
      texture.magFilter = THREE.LinearFilter;
      texture.generateMipmaps = false;
      texture.needsUpdate = true;

      this.uniforms.fieldMap.value?.dispose();
      this.uniforms.fieldMap.value = texture;
    }

    goTo(index) {
      if (this.isRunning || !this.uniforms) return;
      this.isRunning = true;

      const nextIndex = (index + this.textures.length) % this.textures.length;
      this.setTexture(2, nextIndex);
      this.buildField();

      gsap.fromTo(this.uniforms.progress, { value: 0 }, {
        value: 1,
        duration: this.duration,
        ease: 'none',
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
      this.uniforms.pixelRatio.value = this.renderer.getPixelRatio();
      this.buildField();
      this.render();
    }

    render() {
      this.renderer.render(this.scene, this.camera);
    }
  }

  function initDitherSlider() {
    const slider = document.getElementById('slider');
    if (!slider || typeof THREE === 'undefined' || typeof gsap === 'undefined') return;
    new DitherSlider(slider, { duration: 1.2, ditherSize: 1 });
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
  // DITHER HOVER ([data-dither="full" | "lens"] wrapping a CMS <img>)
  // Optional overrides on the wrapper: data-dither-pixel, -block, -duration,
  // -steps, -tear, -sweep, -radius, -contrast, -ink, -paper, -accent, -invert
  // ============================================================================

  function initDitherHover() {
    if (!document.querySelector('[data-dither]') || window.__ditherHover) return;
    window.__ditherHover = true;
    var st = document.createElement('style');
    st.textContent = '[data-dither]{position:relative;overflow:hidden} [data-dither] img{display:block;width:100%;height:100%;object-fit:cover;object-position:50% 50%} .dither-cv{position:absolute;inset:0;width:100%;height:100%;pointer-events:none;opacity:0;transition:opacity .2s steps(2)} .dither-cv.is-on{opacity:1}';
    document.head.appendChild(st);
    var DEF = { pixel: 3, block: 24, duration: 0.7, steps: 10, tear: 28, sweep: 0.35, radius: 220, contrast: 1.4, ink: '#0E0E0E', paper: '#E9E7E1', accent: '#FF3B00', invert: false };
    var reduce = matchMedia('(prefers-reduced-motion: reduce)').matches;
    var canHover = matchMedia('(hover: hover) and (pointer: fine)').matches;

    var glc = document.createElement('canvas');
    var gl = glc.getContext('webgl', { antialias: false, premultipliedAlpha: false, preserveDrawingBuffer: true });
    if (!gl) return; // no WebGL: the plain image stays

    var FS = [
      'precision highp float;varying vec2 vUv;uniform sampler2D uTex;uniform vec2 uRes,uImg,uMouse;',
      'uniform float uP,uPx,uBlock,uMode,uRadius,uTime,uTear,uContrast,uInv,uSweep;uniform vec3 uInk,uPaper,uAcc;',
      'float b2(vec2 a){a=floor(a);return fract(dot(a,vec2(.5,a.y*.75)));}',
      'float b4(vec2 a){return b2(.5*a)*.25+b2(a);}float b8(vec2 a){return b4(.5*a)*.25+b2(a);}',
      'float h21(vec2 p){p=fract(p*vec2(123.34,456.21));p+=dot(p,p+45.32);return fract(p.x*p.y);}',
      'vec2 cover(vec2 uv){float rs=uRes.x/uRes.y,ri=uImg.x/uImg.y;vec2 s=rs<ri?vec2(rs/ri,1.):vec2(1.,ri/rs);return (uv-.5)*s+.5;}',
      'vec3 src(vec2 f){return texture2D(uTex,clamp(cover(f/uRes),0.,1.)).rgb;}',
      'vec3 dith(vec2 f,vec3 ink){vec2 c=floor(f/uPx);vec3 s=src((c+.5)*uPx);float l=clamp((dot(s,vec3(.299,.587,.114))-.5)*uContrast+.5,0.,1.);return l>b8(c)?uPaper:ink;}',
      'void main(){vec2 f=gl_FragCoord.xy;float m;',
      'if(uMode<.5)m=uP;else{float d=distance(f,uMouse)/uRadius;m=uP*(1.-smoothstep(.2,1.,d));}',
      'float act=clamp(m*(1.-m)*4.,0.,1.);float tq=floor(uTime*14.);float row=floor(f.y/max(uBlock*.5,2.));',
      'float sh=h21(vec2(row,tq))>.8?(h21(vec2(row+7.,tq))-.5)*2.*uTear*act:0.;vec2 g=vec2(f.x+sh,f.y);',
      'vec2 bid=floor(g/uBlock);float hb=h21(bid);float o=mix(b8(bid),hb,.5);',
      'if(uMode<.5)o=mix(o,1.-(bid.y*uBlock/uRes.y),uSweep);',
      'float t=m*1.12-.06;float rev=step(o,t);float edge=(step(o,t+.1)-rev)*step(.002,m)*step(m,.998);',
      'vec3 or=src(g),di=dith(g,uInk);vec3 col=mix(uInv>.5?or:di,uInv>.5?di:or,rev);',
      'if(edge>.5){if(hb>.55)col=dith(g+vec2(uPx*4.,0.),uAcc);else{float s=max(uBlock*.5,2.);col=floor(src((floor(g/s)+.5)*s)*3.99)/3.;}}',
      'gl_FragColor=vec4(col,1.);}'
    ].join('\n');
    var VS = 'attribute vec2 p;varying vec2 vUv;void main(){vUv=p*.5+.5;gl_Position=vec4(p,0.,1.);}';
    function sh(t, s) { var o = gl.createShader(t); gl.shaderSource(o, s); gl.compileShader(o); if (!gl.getShaderParameter(o, gl.COMPILE_STATUS)) console.warn('[dither]', gl.getShaderInfoLog(o)); return o; }
    var pr = gl.createProgram();
    gl.attachShader(pr, sh(gl.VERTEX_SHADER, VS)); gl.attachShader(pr, sh(gl.FRAGMENT_SHADER, FS));
    gl.linkProgram(pr); gl.useProgram(pr);
    gl.bindBuffer(gl.ARRAY_BUFFER, gl.createBuffer());
    gl.bufferData(gl.ARRAY_BUFFER, new Float32Array([-1, -1, 3, -1, -1, 3]), gl.STATIC_DRAW);
    var pl = gl.getAttribLocation(pr, 'p'); gl.enableVertexAttribArray(pl); gl.vertexAttribPointer(pl, 2, gl.FLOAT, false, 0, 0);
    var L = {};
    'uTex uRes uImg uMouse uP uPx uBlock uMode uRadius uTime uTear uContrast uInv uSweep uInk uPaper uAcc'.split(' ').forEach(function (n) { L[n] = gl.getUniformLocation(pr, n); });
    gl.pixelStorei(gl.UNPACK_FLIP_Y_WEBGL, true);

    function rgb(h) { h = String(h).replace('#', ''); if (h.length === 3) h = h.replace(/./g, '$&$&'); var n = parseInt(h, 16) || 0; return [(n >> 16 & 255) / 255, (n >> 8 & 255) / 255, (n & 255) / 255]; }
    function opts(el) {
      var o = {}, k;
      for (k in DEF) {
        var v = el.getAttribute('data-dither-' + k);
        o[k] = v == null ? DEF[k] : (typeof DEF[k] === 'number' ? parseFloat(v) : typeof DEF[k] === 'boolean' ? v !== 'false' : v);
      }
      if (reduce) { o.steps = 1; o.tear = 0; o.duration = 0.001; }
      o.ink = rgb(o.ink); o.paper = rgb(o.paper); o.accent = rgb(o.accent);
      return o;
    }
    // pick the srcset candidate that fits the rendered size (Webflow CMS images ship a srcset)
    function pickSrc(img, w) {
      var ss = img.getAttribute('srcset'), best = img.currentSrc || img.src, bw = 0;
      if (!ss) return best;
      ss.split(',').forEach(function (s) {
        var p = s.trim().split(/\s+/), cw = parseInt(p[1], 10) || 0;
        if (!bw || (bw < w && cw > bw) || (cw >= w && cw < bw)) { best = p[0]; bw = cw; }
      });
      return best;
    }

    var items = [], running = false, last = 0;

    function setup(el) {
      if (el.__dither) return;
      var img = el.querySelector('img'); if (!img) return;
      var cv = document.createElement('canvas'); cv.className = 'dither-cv'; cv.setAttribute('aria-hidden', 'true');
      el.appendChild(cv);
      var it = el.__dither = { el: el, img: img, cv: cv, ctx: cv.getContext('2d'), o: opts(el), mode: el.getAttribute('data-dither') === 'lens' && canHover ? 1 : 0, p: 0, hover: false, mouse: [0.5, 0.5], sm: [0.5, 0.5], dirty: true, tex: null, iw: 1, ih: 1 };
      items.push(it);
      if (canHover) {
        el.addEventListener('pointerenter', function (e) { pt(it, e); if (it.p <= 0) it.sm = it.mouse.slice(); it.hover = true; kick(); });
        el.addEventListener('pointerleave', function () { it.hover = false; kick(); });
        el.addEventListener('pointermove', function (e) { pt(it, e); if (it.mode) kick(); });
      }
      io.observe(el); ro.observe(el);
    }
    function pt(it, e) { var r = it.el.getBoundingClientRect(); it.mouse = [(e.clientX - r.left) / r.width, 1 - (e.clientY - r.top) / r.height]; }

    function load(it) {
      if (it.loading) return; it.loading = true;
      var dpr = Math.min(devicePixelRatio || 1, 2);
      var im = new Image(); im.crossOrigin = 'anonymous'; im.decoding = 'async';
      im.onload = function () {
        var t = gl.createTexture(); gl.bindTexture(gl.TEXTURE_2D, t);
        [gl.TEXTURE_WRAP_S, gl.TEXTURE_WRAP_T].forEach(function (k) { gl.texParameteri(gl.TEXTURE_2D, k, gl.CLAMP_TO_EDGE); });
        gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_MIN_FILTER, gl.LINEAR); gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_MAG_FILTER, gl.LINEAR);
        try { gl.texImage2D(gl.TEXTURE_2D, 0, gl.RGBA, gl.RGBA, gl.UNSIGNED_BYTE, im); }
        catch (err) { console.warn('[dither] CORS blocked', im.src); it.cv.remove(); return; }
        it.tex = t; it.iw = im.naturalWidth; it.ih = im.naturalHeight; it.dirty = true; kick();
      };
      im.onerror = function () { it.cv.remove(); };
      var s = pickSrc(it.img, it.el.clientWidth * dpr);
      im.src = s + (s.indexOf('?') < 0 ? '?' : '&') + 'cors=1'; // own cache key, avoids a non-CORS cached copy
    }

    var io = new IntersectionObserver(function (es) {
      es.forEach(function (e) {
        var it = e.target.__dither; if (!it) return;
        it.visible = e.isIntersecting;
        if (e.isIntersecting) { load(it); it.dirty = true; }
        if (!canHover) it.hover = e.intersectionRatio > 0.5; // touch: reveal when scrolled in
        kick();
      });
    }, { rootMargin: '200px 0px', threshold: [0, 0.5] });
    var ro = new ResizeObserver(function (es) { es.forEach(function (e) { var it = e.target.__dither; if (it) { it.dirty = true; } }); kick(); });

    function kick() { if (!running) { running = true; last = -1; requestAnimationFrame(frame); } }

    function frame(now) {
      // rAF timestamps can be older than performance.now() at kick: never let dt go negative
      var dt = last < 0 ? 1 / 60 : Math.min(0.05, Math.max(0, (now - last) / 1000)); last = now;
      var any = false;
      items.forEach(function (it) {
        if (!it.tex || !it.visible) return;
        var o = it.o, prev = it.p;
        it.p = Math.max(0, Math.min(1, it.p + (it.hover ? 1 : -1) * dt / o.duration));
        var k = Math.min(1, dt * 14), dx = it.mouse[0] - it.sm[0], dy = it.mouse[1] - it.sm[1];
        it.sm[0] += dx * k; it.sm[1] += dy * k;
        var moving = it.p !== prev || (it.mode && it.p > 0 && (Math.abs(dx) + Math.abs(dy) > 0.0005));
        var mid = it.p > 0 && it.p < 1;
        if (!moving && !mid && !it.dirty && !(it.mode && it.p > 0)) return;
        any = any || moving || mid || (it.mode && it.p > 0);
        draw(it, now);
        it.dirty = false;
      });
      if (any) requestAnimationFrame(frame); else running = false;
    }

    function draw(it, now) {
      var o = it.o, dpr = Math.min(devicePixelRatio || 1, 2);
      var W = Math.max(1, Math.round(it.el.clientWidth * dpr)), H = Math.max(1, Math.round(it.el.clientHeight * dpr));
      if (it.cv.width !== W || it.cv.height !== H) { it.cv.width = W; it.cv.height = H; }
      if (glc.width !== W || glc.height !== H) { glc.width = W; glc.height = H; }
      var x = it.p, e = x < 0.5 ? 4 * x * x * x : 1 - Math.pow(-2 * x + 2, 3) / 2;
      var q = o.steps > 0 ? Math.floor(e * o.steps + 1e-4) / o.steps : e;
      gl.viewport(0, 0, W, H);
      gl.bindTexture(gl.TEXTURE_2D, it.tex);
      gl.uniform1i(L.uTex, 0);
      gl.uniform2f(L.uRes, W, H); gl.uniform2f(L.uImg, it.iw, it.ih);
      gl.uniform2f(L.uMouse, it.sm[0] * W, it.sm[1] * H);
      gl.uniform1f(L.uP, q);
      gl.uniform1f(L.uPx, Math.max(1, Math.round(o.pixel * dpr)));
      gl.uniform1f(L.uBlock, Math.max(2, o.block * dpr));
      gl.uniform1f(L.uMode, it.mode);
      gl.uniform1f(L.uRadius, o.radius * dpr);
      gl.uniform1f(L.uTime, now / 1000);
      gl.uniform1f(L.uTear, o.tear * dpr);
      gl.uniform1f(L.uContrast, o.contrast);
      gl.uniform1f(L.uInv, o.invert ? 1 : 0);
      gl.uniform1f(L.uSweep, o.sweep);
      gl.uniform3fv(L.uInk, o.ink); gl.uniform3fv(L.uPaper, o.paper); gl.uniform3fv(L.uAcc, o.accent);
      gl.drawArrays(gl.TRIANGLES, 0, 3);
      it.ctx.clearRect(0, 0, W, H);
      it.ctx.drawImage(glc, 0, 0);
      it.cv.classList.add('is-on');
    }

    function scan(root) { (root.querySelectorAll ? root : document).querySelectorAll('[data-dither]').forEach(setup); }
    scan(document);
    // CMS pagination / "load more" (e.g. Finsweet) adds items later
    new MutationObserver(function (ms) { ms.forEach(function (m) { m.addedNodes.forEach(function (n) { if (n.nodeType === 1) { if (n.matches('[data-dither]')) setup(n); scan(n); } }); }); })
      .observe(document.body, { childList: true, subtree: true });
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

    // su tutte le pagine: no-op se non c'è nessun [data-dither]
    initDitherHover();

    if (typeof ScrollTrigger !== 'undefined') {
      ScrollTrigger.refresh();
    }
  });

})();
