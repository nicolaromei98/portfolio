// =====================================================================
// NICOLA ROMEI — PORTFOLIO
// Barba.js page transitions (dither band) + every site animation, in one
// file, served by Cloudflare Pages and loaded with <script type="module"> once
// the page has been parsed: nothing here waits for a page load event, and
// barba.init() runs last (see START at the bottom of the file).
//
// Needs, in Webflow Site settings > Footer code, BEFORE this script:
// GSAP 3.15 with ScrollTrigger, SplitText and ScrambleText (Webflow GSAP integration),
// Lenis 1.3.15, @barba/core 2.10.3, Howler 2.2.4 and the Webflow-hosted three.min (r109).
// =====================================================================

// -----------------------------------------
// OSMO PAGE TRANSITION BOILERPLATE
// -----------------------------------------

gsap.registerPlugin(ScrollTrigger, SplitText);

history.scrollRestoration = "manual";
// ScrollTrigger stores scrollRestoration when it loads ("auto") and writes it back on every
// refresh (the one on window load too): keep it manual, or a reload jumps back down mid-intro
ScrollTrigger.clearScrollMemory("manual");

let lenis = null;
let nextPage = document;
let onceFunctionsInitialized = false;
let oldTriggers = [];

const hasLenis = typeof window.Lenis !== "undefined";
const hasScrollTrigger = typeof window.ScrollTrigger !== "undefined";

const rmMQ = window.matchMedia("(prefers-reduced-motion: reduce)");
let reducedMotion = rmMQ.matches;
rmMQ.addEventListener?.("change", e => (reducedMotion = e.matches));
rmMQ.addListener?.(e => (reducedMotion = e.matches));

const has = (s) => !!nextPage.querySelector(s);

// No gsap.defaults() here: every site animation was written for GSAP's own
// defaults (power1.out, 0.5s), the transition sets its eases explicitly

// Page cleanup: whatever a page starts that outlives its DOM (loops, window
// listeners, WebGL) registers here. Cleanups are kept per container,
// so the old page's afterLeave never runs the new page's ones
const pageCleanups = new Map();

function onPageLeave(fn) {
  const page = nextPage;
  if (!pageCleanups.has(page)) pageCleanups.set(page, []);
  pageCleanups.get(page).push(fn);
}

function runPageCleanups(container) {
  const fns = pageCleanups.get(container) || [];
  pageCleanups.delete(container);
  fns.forEach(fn => {
    try { fn(); } catch (e) { console.warn(e); }
  });
}

// Line breaks depend on the web fonts: split text only once they are in. Webflow's
// WebFont loader adds the Google Fonts stylesheet asynchronously, so document.fonts can
// report "loaded" before Host Grotesk is even requested (Safari split headings in the
// fallback font): wait for the loader's wf-active / wf-inactive class on <html> first
function whenFontsReady(fn) {
  const html = document.documentElement;
  const afterFontFaces = () => {
    if (!document.fonts || document.fonts.status === "loaded") return fn();
    document.fonts.ready.then(fn);
  };
  if (!html.classList.contains("wf-loading")) return afterFontFaces();
  // The loader always settles (active, or inactive after its timeout)
  const observer = new MutationObserver(() => {
    if (html.classList.contains("wf-loading")) return;
    observer.disconnect();
    afterFontFaces();
  });
  observer.observe(html, { attributes: true, attributeFilter: ["class"] });
}

// The page's text only needs Host Grotesk (500, the first screen's weight). whenFontsReady
// also waits for document.fonts.ready, i.e. every face of the Typekit kit, which none of
// these pages uses and which can land seconds later. The loader's per-variant class is the
// signal: it is only set once the Google stylesheet is in, so no fallback-font split
function whenTextFontsReady(fn) {
  const html = document.documentElement;
  let done = false;
  const settled = () => /\bwf-hostgrotesk-n5-(in)?active\b/.test(html.className) ||
    html.classList.contains("wf-inactive");
  const observer = new MutationObserver(() => { if (settled()) go(); });
  const go = () => {
    if (done) return;
    done = true;
    observer.disconnect();
    fn();
  };
  if (settled()) return go();
  observer.observe(html, { attributes: true, attributeFilter: ["class"] });
  whenFontsReady(go); // never later than before
}

// Layers during a transition, above every z-index the site uses (CRT overlay: 9999).
// The old page is never touched: on iOS a new stacking context on it (isolation)
// can make its fixed WebGL canvases disappear
const Z_SHADE = 10000; // dims the old page
const Z_NEXT_PAGE = 10001; // incoming container
const Z_BAND = 10002; // dither band canvas

// Pages that Lenis leaves alone (they never had smooth scroll): it ignores the wheel/touch
// events that start inside them (data-lenis-prevent on the container). Home is one screen:
// on short screens it scrolls a few px, natively. The AI Exploration fullscreen slider
// drives its own input. Don't keep Lenis stopped there instead: its .lenis-stopped class
// puts overflow: clip on <html>
const scrollLockedNamespaces = ["home", "ai-exploration"];

function lockScrollFor(container) {
  if (scrollLockedNamespaces.includes(container?.dataset?.barbaNamespace)) {
    container.setAttribute("data-lenis-prevent", "");
  }
}

function startLenis() {
  if (lenis) lenis.start();
}

// -----------------------------------------
// DITHER TRANSITION CONFIG
// -----------------------------------------

const ditherConfig = {
  // Grid
  cellSize: 20, // tile size in px (desktop)
  cellSizeMobile: 14, // tile size in px (< 768px)
  gap: 1, // px between tiles, drawn in the ink colour

  // Colours (site tokens: --tech-red, --matte-black)
  color: "#ff564a", // tile colour
  ink: "#202020", // glyphs + grid lines
  accent: "#202020", // second tile colour (black patches), null to disable
  accentInk: "#ff564a", // glyphs on the accent tiles
  accentAmount: 0.08, // share of the screen that uses the accent colour

  // Glyphs
  fontFamily: '"Geist Mono", ui-monospace, SFMono-Regular, Menlo, monospace',
  fontWeight: 600,
  glyphScale: 0.6, // glyph size relative to the tile
  glyphs: "ABCDEFGHIJKLMNOPQRSTUVWXYZ0123456789!?%#$@&*+=<>/",
  ramp: ".:-=+*#", // ASCII density ramp on the band edges (light → dense)
  blankRatio: 0.12, // share of tiles without a glyph
  scrambleInterval: 60, // ms between glyph swaps

  // Decode: the tiles spell the next page's name (data-transition-title on the container,
  // otherwise the last part of its <title>), scrambled at the front, locked deeper in
  decode: true,
  separator: " / ", // between repeats of the name
  rowShift: 5, // chars each row is shifted by, so letters don't stack in columns
  lockDepth: [0.04, 0.16], // how far behind the front a letter locks (viewport heights)

  // Preview: red / black tiles form a 1-bit dither of the next page's first screen
  // (its visible images at their real position), so the page develops from its own dither
  preview: true,
  previewContrast: 1.6,
  previewMaxImages: 12,

  // Band
  bandHeight: 0.4, // band height, as a fraction of the viewport height
  edge: 0.12, // raggedness of each edge, fraction of the viewport height
  ghost: 0.035, // depth of the glyph-only fringe on both edges
  noiseScale: 0.07, // size of the noise blobs (lower = bigger drips)

  // Timing
  duration: 1.5, // full sweep, band enters at one edge and leaves at the other
  ease: "power2.inOut",
  direction: "down", // "down" | "up"
  reverseOnBack: true, // browser back sweeps the other way (bottom → top)

  // Extras
  dimOldPage: true, // darken the old page while the band runs over it
  revealOnLoad: false, // hard loads: the page intro (PAGE INTRO) is the reveal
};

// -----------------------------------------
// FUNCTION REGISTRY
// -----------------------------------------

function initOnceFunctions() {
  initLenis();
  Dither.init();
  if (onceFunctionsInitialized) return;
  onceFunctionsInitialized = true;

  // Runs once on first load (persistent, outside the container)
  run(initClickSound);
}

function initBeforeEnterFunctions(next) {
  nextPage = next || document;
  debugLog(`— ${nextPage.dataset?.barbaNamespace || "page"} · before enter`);

  // Runs before the page becomes visible (the band uncovers it): DOM prep, hidden start
  // states, entry reveals and WebGL, never ScrollTriggers. Text edits come first
  if (has('[data-nf]')) run(
  initNotFound); // 404: the path is text, written before anything reads it
  if (has('[data-case-slides]') && !has('[data-pp]')) run(
  initCaseStudy); // before the heading split and the slider
  if (has('.preloader')) run(initContainerPreloaderHide);
  if (has('[data-current-time]')) run(initDynamicCurrentTime);
  if (has('[data-split="heading"]')) run(initHeadingSplit);
  if (has('[data-dither]')) run(initDitherHoverState);
  if (has('.ai__slider')) run(initAiSliderInitialState);

  // WebGL built while the band runs, so the page is uncovered already drawn
  if (has('[data-dither]')) run(initDitherHover);
  if (has('#slider[data-images]') && !has('[data-pp]')) run(initDitherSlider);
  if (has('[data-pp]')) run(initProjectPage); // the project page: three columns, its own prints
  if (has('[data-works-head]')) run(initWorksHead); // before the preview measures its box
  if (has('[data-works-folder]')) run(initWorksGrid); // the "new project" cell joins the grid
  if (has('[data-works-preview]')) run(initWorksPreview);
  if (has('[data-home-hero]')) run(initHomeDither);
  if (has('[data-lab]')) run(initLab); // /lab: WebGL, the sheet waits for its first cluster
  if (has('.pm[data-decor]')) run(initPrintMarks); // after the works preview: it sets data-active
  if (has('[data-plate]')) run(initHomePlates); // after the marks: they size the statement
  if (has('[data-pf-dither]')) run(initProfileDither); // the Profile's face, a dither point cloud
  else if (has('[data-portrait]')) run(
  initProfilePortrait); // WebGL: the sheet waits for its first frame
  if (has('[data-tv]')) run(
  initProfileTv); // the dark screen at once, the channels when the Works page is read
}

function initAfterEnterFunctions(next) {
  nextPage = next || document;
  debugLog(`— ${nextPage.dataset?.barbaNamespace || "page"} · after enter`);

  // Runs after the transition: listeners, ScrollTriggers, loops
  if (has('[data-split="heading"]')) run(initHeadingScrollReveal);
  if (has('.ai__slider')) run(initAiExplorationSlider);
  if (has('.copy-email-button')) run(initCopyPromptClipboard);
  if (has('[data-home-header]')) run(initHomeHeader);
}

// Every registered animation runs on its own: if one throws, the others still start
function run(fn) {
  try {
    fn();
    debugLog(`✓ ${fn.name}`);
  } catch (e) {
    console.error(`[${fn.name}]`, e);
    debugLog(`✗ ${fn.name}: ${e && e.message}`, true);
  }
}

// ?debug in the URL: started animations and errors listed on screen (for phones,
// where there is no console). Does nothing without it
const DEBUG = /[?&]debug\b/.test(location.search);
let debugPanel = null;

function debugLog(message, isError = false) {
  if (!DEBUG) return;
  if (!debugPanel) {
    debugPanel = document.createElement("pre");
    Object.assign(debugPanel.style, {
      position: "fixed",
      left: "8px",
      right: "8px",
      bottom: "8px",
      zIndex: "2147483647",
      maxHeight: "40vh",
      overflow: "auto",
      margin: "0",
      padding: "8px",
      font: "11px/1.35 ui-monospace, Menlo, monospace",
      whiteSpace: "pre-wrap",
      background: "rgba(0, 0, 0, 0.85)",
      color: "#9f9",
      pointerEvents: "auto",
    });
    document.body.appendChild(debugPanel);
  }
  const line = document.createElement("div");
  line.textContent = message;
  if (isError) line.style.color = "#ff564a";
  debugPanel.appendChild(line);
  debugPanel.scrollTop = debugPanel.scrollHeight;
}

if (DEBUG) {
  window.addEventListener("error", (e) => debugLog(
    `✗ ${e.message} (${(e.filename || "").split("/").pop()}:${e.lineno})`, true));
  window.addEventListener("unhandledrejection", (e) => debugLog(
    `✗ ${(e.reason && e.reason.message) || e.reason}`, true));
}

// Last safety net around a whole registry
function runRegistry(registry, container) {
  try {
    registry(container);
  } catch (e) {
    console.error("[registry]", e);
  }
}

// -----------------------------------------
// PAGE TRANSITIONS
// -----------------------------------------

function runPageOnceAnimation(next) {
  applyThemeFrom(next);

  // Hard load: the intro is the reveal. Settle the container now and resolve right away:
  // page functions start underneath the sheet, entry reveals wait for the handover
  // through onPageReveal()
  if (shouldPlayIntro()) {
    resetPage(next);
    runPageIntro(next);
    return Promise.resolve();
  }

  // No intro (reduced motion, or the sheet was already hidden): drop the sheet at once
  hideIntroSheet();

  const tl = gsap.timeline();

  if (ditherConfig.revealOnLoad && !reducedMotion) {
    tl.add(Dither.sweep({ to: next }), 0.1);
  }

  tl.add("pageReady");
  tl.call(resetPage, [next], "pageReady");

  return tl;
}

function runPageLeaveAnimation(current, next, trigger, label = "") {
  let shade = null;
  const tl = gsap.timeline({
    onComplete: () => {
      current.remove();
      shade?.remove();
    }
  });

  if (reducedMotion) {
    // Immediate swap behavior if user prefers reduced motion
    return tl.set(current, { autoAlpha: 0 });
  }

  // One sweep drives everything: the band, the old page below it
  // and the new page uncovered above it
  tl.add(Dither.sweep({
    from: current,
    to: next,
    direction: sweepDirection(trigger),
    onSwap: () => applyThemeFrom(next), // fires while the band covers the top of the page
    label,
  }), 0);

  if (ditherConfig.dimOldPage) {
    // A plain black layer between the two pages. No filter on the old container (it would
    // re-anchor its fixed children) and no backdrop-filter (iOS can drop a WebGL canvas under it)
    shade = document.createElement("div");
    shade.style.cssText =
      `position:fixed;inset:0;pointer-events:none;background:#000;opacity:0;z-index:${Z_SHADE}`;
    next.before(shade);
    tl.to(shade, {
      opacity: 0.45,
      duration: ditherConfig.duration * 0.6,
      ease: "power1.out",
    }, 0);
  }

  return tl;
}

function runPageEnterAnimation(next) {
  const tl = gsap.timeline();

  if (reducedMotion) {
    // Immediate swap behavior if user prefers reduced motion
    tl.set(next, { autoAlpha: 1 });
    tl.call(applyThemeFrom, [next]);
    tl.add("pageReady")
    tl.call(resetPage, [next], "pageReady");
    return new Promise(resolve => tl.call(resolve, null, "pageReady"));
  }

  // The new page is uncovered by the sweep started in leave,
  // settle it once the band has left the screen
  tl.add("pageReady", ditherConfig.duration);
  tl.call(resetPage, [next], "pageReady");

  return new Promise(resolve => {
    tl.call(resolve, null, "pageReady");
  });
}

// Name the band decodes: data-transition-title on the container, otherwise the last part
// of the page <title> ("Nicola Romei | The Archive | Salesforce" → "SALESFORCE")
function pageLabel(next) {
  const custom = next?.container?.dataset?.transitionTitle;
  const decoder = document.createElement("textarea");
  decoder.innerHTML = custom || /<title>([^<]*)<\/title>/i.exec(next?.html || "")?.[1] || "";
  const parts = decoder.value.split("|").map((part) => part.trim()).filter(Boolean);
  const label = custom ? decoder.value.trim() : parts[parts.length - 1] || next?.namespace || "";
  return label.toUpperCase();
}

function sweepDirection(trigger) {
  const dir = ditherConfig.direction;
  if (ditherConfig.reverseOnBack && trigger === "back") return dir === "up" ? "down" : "up";
  return dir;
}

// Barba's own back/forward detection resets on every full page load,
// so keep our position in history.state instead
let navPos = history.state?.navPos ?? 0;
let navIsBack = false;

function stampNavPos() {
  history.replaceState({ ...(history.state || {}), navPos }, "");
}

function trackNavDirection(data) {
  const p = data.event?.state?.navPos;
  navIsBack = typeof p === "number" && p < navPos;
  navPos = typeof p === "number" ? p : navPos + 1;
}

// -----------------------------------------
// BARBA HOOKS
// -----------------------------------------

barba.hooks.before(trackNavDirection);

barba.hooks.beforeEnter(data => {
  // Position new container on top of the old page (and its z-indexed elements),
  // at least one screen tall
  gsap.set(data.next.container, {
    position: "fixed",
    top: 0,
    left: 0,
    right: 0,
    minHeight: "100vh",
    zIndex: Z_NEXT_PAGE,
  });

  // Keep the new page hidden until the sweep uncovers it.
  // First load: the intro (or nothing) is the reveal
  const isFirstLoad = !onceFunctionsInitialized;
  if (!reducedMotion && (!isFirstLoad || (ditherConfig.revealOnLoad && !
      shouldPlayIntro()))) {
    Dither.hide(data.next.container);
  }

  if (lenis && typeof lenis.stop === "function") {
    lenis.stop();
  }

  // Snapshot the old page's ScrollTriggers before the new page creates any
  if (hasScrollTrigger) oldTriggers = ScrollTrigger.getAll();

  // First load: decide about the intro now, entry reveals wait for it
  if (isFirstLoad) shouldPlayIntro();

  lockScrollFor(data.next.container);

  runRegistry(initBeforeEnterFunctions, data.next.container);
});

barba.hooks.afterLeave(data => {
  // The old container is gone: stop everything it left running
  runPageCleanups(data.current.container);
  oldTriggers.forEach(trigger => trigger.kill());
  oldTriggers = [];

  syncBodyClass(data.next.html);
});

barba.hooks.afterEnter(data => {
  // Run page functions
  runRegistry(initAfterEnterFunctions, data.next.container);

  // Settle
  if (hasLenis && lenis) {
    lenis.resize();
    startLenis();
  }

  if (hasScrollTrigger) {
    ScrollTrigger.refresh();
  }
});

// Hold a back/forward press while a transition runs: Barba would hard-reload instead
let queuedPop = null;
window.addEventListener("popstate", e => {
  if (window.barba?.transitions?.isRunning) {
    e.stopImmediatePropagation();
    queuedPop = e;
  }
});

function replayPop() {
  if (!queuedPop) return;
  const e = queuedPop;
  queuedPop = null;
  // After Barba clears its running flag (right after the after/afterOnce hooks)
  setTimeout(() => barba.go(location.href, "popstate", e));
}

barba.hooks.after(() => {
  stampNavPos();
  replayPop();
});
barba.hooks.afterOnce(replayPop);

// -----------------------------------------
// GENERIC + HELPERS
// -----------------------------------------

const themeConfig = {
  light: {
    nav: "dark",
    transition: "light"
  },
  dark: {
    nav: "light",
    transition: "dark"
  }
};

function applyThemeFrom(container) {
  const pageTheme = container?.dataset?.pageTheme || "light";
  const config = themeConfig[pageTheme] || themeConfig.light;

  document.body.dataset.pageTheme = pageTheme;
  const transitionEl = document.querySelector('[data-theme-transition]');
  if (transitionEl) {
    transitionEl.dataset.themeTransition = config.transition;
  }

  const nav = document.querySelector('[data-theme-nav]');
  if (nav) {
    nav.dataset.themeNav = config.nav;
  }
}

// Global Lenis, created once and driven by the GSAP ticker.
// lerp 0.1 keeps the feel the site always had
function initLenis() {
  if (lenis) return; // already created
  if (!hasLenis) return;

  lenis = new Lenis({ lerp: 0.1 });

  if (hasScrollTrigger) {
    lenis.on("scroll", ScrollTrigger.update);
  }

  gsap.ticker.add((time) => {
    lenis.raf(time * 1000);
  });

  gsap.ticker.lagSmoothing(0);
}

function resetPage(container) {
  window.scrollTo(0, 0);
  gsap.set(container, { clearProps: "position,top,left,right,minHeight,zIndex" });

  if (hasLenis && lenis) {
    lenis.scrollTo(0, { immediate: true, force: true });
    lenis.resize();
    startLenis();
  }
}

// Webflow puts page combo classes on <body> (.is--ai locks the overflow), and Barba
// never swaps <body>: take them from the incoming page
let pageBodyClasses = [...document.body.classList];

function syncBodyClass(html) {
  const match = /<body[^>]*\sclass="([^"]*)"/i.exec(html || "");
  const next = match ? match[1].split(/\s+/).filter(Boolean) : [];
  if (pageBodyClasses.length) document.body.classList.remove(...pageBodyClasses);
  if (next.length) document.body.classList.add(...next);
  pageBodyClasses = next;
}

function debounceOnWidthChange(fn, ms) {
  let last = innerWidth,
    timer;
  return function (...args) {
    clearTimeout(timer);
    timer = setTimeout(() => {
      if (innerWidth !== last) {
        last = innerWidth;
        fn.apply(this, args);
      }
    }, ms);
  };
}

// -----------------------------------------
// DITHER / ASCII TRANSITION
// -----------------------------------------
// A band of ASCII tiles (~40% of the viewport) runs across the screen on a
// fixed canvas grid. Below the band the old page is still visible, above it
// the new page is already uncovered: the new container is clipped by a
// straight line that always runs through the band's solid core, so the cut
// is never visible. Each cell has its own jitter on both edges (value noise +
// Bayer 4x4 + random), which makes the edges ragged and dithered, with an
// ASCII density ramp (. : - = + * #) as the outer fringe. Glyphs are
// pre-rendered into a sprite atlas, so a frame is one drawImage per cell.

const Dither = (() => {
  const cfg = ditherConfig;
  const BAYER = [0, 8, 2, 10, 12, 4, 14, 6, 3, 11, 1, 9, 15, 7, 13, 5].map(v => (v + 0.5) / 16);
  const state = { p: 0 };

  let wrap = null,
    canvas = null,
    ctx = null,
    atlas = null;
  let dpr = 1,
    cellPx = 0,
    cssCell = 0,
    cols = 0,
    rows = 0,
    vh = 1,
    gridTop = 0;
  let lead, trail, glyphs, accents, rowU;
  // Decode + preview, per cell: letter of the name, depth where it locks, dark tile (1-bit preview)
  let target, lockAt, tone;
  // Atlas glyphs: the random set first, then any letter the page names need
  const glyphSet = [...cfg.glyphs];
  // Name and page of the current sweep, preview images decoded once per session
  let sweepLabel = "",
    sweepPage = null,
    decoding = false,
    previewToken = 0;
  const previewImages = new Map();
  let running = false,
    lastScramble = 0,
    activeSweep = null,
    sweepSeed = 1;
  // Entry reveals waiting for the band: queued in beforeEnter, armed when the sweep starts
  let uncoverQueue = [],
    uncoverPending = [];
  // Page hidden in beforeEnter, waiting for its sweep to start
  let expectedPage = null;

  // Current sweep
  let dir = cfg.direction,
    toEl = null,
    onSwap = null,
    swapY = 0,
    filled = [];
  // Band geometry, in viewport heights along the sweep direction
  let H = 0.4,
    J = 0.1,
    G = 0.03,
    F0 = 0,
    F1 = 1;

  // Integer hash → 0..1
  function hash(x, y, s) {
    let h = (Math.imul(x, 374761393) + Math.imul(y, 668265263) + Math.imul(s, 1442695041)) | 0;
    h = Math.imul(h ^ (h >>> 13), 1274126177);
    return ((h ^ (h >>> 16)) >>> 0) / 4294967295;
  }

  // Smooth 2D value noise → 0..1
  function noise(x, y, s) {
    const xi = Math.floor(x),
      yi = Math.floor(y);
    const xf = x - xi,
      yf = y - yi;
    const u = xf * xf * (3 - 2 * xf),
      v = yf * yf * (3 - 2 * yf);
    const a = hash(xi, yi, s),
      b = hash(xi + 1, yi, s);
    const c = hash(xi, yi + 1, s),
      d = hash(xi + 1, yi + 1, s);
    return a + (b - a) * u + (c - a) * v + (a - b - c + d) * u * v;
  }

  function randomGlyph() {
    return Math.random() < cfg.blankRatio ? 0 : 1 + ((Math.random() * cfg.glyphs.length) | 0);
  }

  function fontString() {
    return `${cfg.fontWeight} ${Math.round(cellPx * cfg.glyphScale)}px ${cfg.fontFamily}`;
  }

  const isClear = (c) => !c || c === "transparent" || /rgba\(.*,\s*0\)$/.test(c);

  function init() {
    if (ctx) return;

    // Works without the div too, it only loses the first-paint cover
    wrap = document.querySelector("[data-transition-dither]");
    if (!wrap) {
      wrap = document.createElement("div");
      wrap.setAttribute("data-transition-dither", "");
      Object.assign(wrap.style, {
        position: "fixed",
        inset: "0",
        zIndex: String(Z_BAND),
        pointerEvents: "none",
        overflow: "hidden",
      });
      document.body.appendChild(wrap);
    }

    canvas = document.createElement("canvas");
    canvas.setAttribute("aria-hidden", "true");
    Object.assign(canvas.style, {
      position: "absolute",
      display: "block",
      pointerEvents: "none"
    });
    wrap.appendChild(canvas);
    ctx = canvas.getContext("2d");

    build();
    // The wrapper may carry a solid background to hide the very first paint
    wrap.style.background = "transparent";

    let timer;
    window.addEventListener("resize", () => {
      clearTimeout(timer);
      // Mid-sweep the grid has to follow the viewport right away
      if (running) {
        if (build()) render();
        return;
      }
      timer = setTimeout(build, 120);
    });

    // Redraw the atlas once the web font is actually available
    document.fonts?.load(fontString()).then(buildAtlas).catch(() => {});
  }

  // Size the grid to the viewport, returns true if anything changed
  function build() {
    const vw = window.innerWidth;
    const nextVh = window.innerHeight;
    const nextDpr = Math.min(window.devicePixelRatio || 1, 2);
    const nextCell = Math.max(4, Math.round((vw < 768 ? cfg.cellSizeMobile : cfg.cellSize) *
      nextDpr));
    const nextCss = nextCell / nextDpr;
    const nextCols = Math.ceil(vw / nextCss);
    const nextRows = Math.ceil(nextVh / nextCss);

    const left = `${(vw - nextCols * nextCss) / 2}px`;
    if (nextCell === cellPx && nextCols === cols && nextRows === rows && nextDpr === dpr &&
      nextVh === vh) {
      canvas.style.left = left; // the width can change without changing the grid
      return false;
    }
    dpr = nextDpr;
    cellPx = nextCell;
    cssCell = nextCss;
    cols = nextCols;
    rows = nextRows;
    vh = nextVh;
    gridTop = (vh - rows * cssCell) / 2;

    canvas.width = cols * cellPx;
    canvas.height = rows * cellPx;
    // Centre the grid so cropped cells are split evenly on both edges
    Object.assign(canvas.style, {
      width: `${cols * cssCell}px`,
      height: `${rows * cssCell}px`,
      left,
      top: `${gridTop}px`,
    });

    const n = cols * rows;
    lead = new Float32Array(n);
    trail = new Float32Array(n);
    glyphs = new Uint8Array(n);
    accents = new Uint8Array(n);
    target = new Uint8Array(n);
    lockAt = new Float32Array(n);
    tone = new Uint8Array(n);
    rowU = new Float32Array(rows);

    buildAtlas();
    seed();
    return true;
  }

  // Sprite sheet, one cell per glyph:
  // row 0 = tiles, row 1 = accent tiles, row 2 = ramp glyphs, row 3 = accent ramp glyphs
  function buildAtlas() {
    if (!cellPx) return;
    const S = cellPx;
    const tileCount = glyphSet.length + 1; // index 0 = blank tile
    const rampCount = cfg.ramp.length;
    const gap = cfg.gap > 0 ? Math.max(1, Math.round(cfg.gap * dpr)) : 0;

    atlas = atlas || document.createElement("canvas");
    atlas.width = Math.max(tileCount, rampCount) * S;
    atlas.height = S * 4;

    const a = atlas.getContext("2d");
    a.clearRect(0, 0, atlas.width, atlas.height);
    a.font = fontString();
    a.textAlign = "center";
    a.textBaseline = "middle";

    const cx = (S - gap) / 2;
    const cy = (S - gap) / 2 + S * 0.04; // caps sit slightly high on "middle"
    const sets = [
      [cfg.color, cfg.ink],
      cfg.accent ? [cfg.accent, cfg.accentInk] : [cfg.color, cfg.ink],
    ];

    sets.forEach(([bg, fg], row) => {
      for (let k = 0; k < tileCount; k++) {
        const x = k * S,
          y = row * S;
        a.fillStyle = cfg.ink;
        a.fillRect(x, y, S, S);
        a.fillStyle = bg;
        a.fillRect(x, y, S - gap, S - gap);
        if (k > 0) {
          a.fillStyle = fg;
          a.fillText(glyphSet[k - 1], x + cx, y + cy);
        }
      }
      for (let k = 0; k < rampCount; k++) {
        a.fillStyle = bg;
        a.fillText(cfg.ramp[k], k * S + cx, (row + 2) * S + cy);
      }
    });
  }

  // Band geometry + per-cell edge jitter for the current direction
  function seed() {
    if (!lead) return;
    const s = sweepSeed;
    const f = cfg.noiseScale;
    const cellHalf = cssCell / 2 / vh;

    // Keep a fully solid core in the middle of the band: the clip line that
    // uncovers the new page runs through it, so the cut is never visible
    H = cfg.bandHeight;
    G = Math.max(0, Math.min(cfg.ghost, H / 2 - cellHalf - 0.01));
    J = Math.max(0, Math.min(cfg.edge, H / 2 - G - cellHalf - 0.01));
    // From "nothing on screen yet" to "everything has passed"
    F0 = -J - 0.02;
    F1 = 1 + H + J + 0.02;

    for (let y = 0; y < rows; y++) {
      const u = (gridTop + (y + 0.5) * cssCell) / vh;
      rowU[y] = dir === "up" ? 1 - u : u;
    }

    const jitter = (x, y, k) => {
      const blob = noise(x * f, y * f, k) * 0.65 + noise(x * f * 3, y * f * 3, k + 7) * 0.35;
      const mix = blob * 0.6 + BAYER[(y & 3) * 4 + (x & 3)] * 0.15 + hash(x, y, k + 13) *
        0.25;
      const v = (mix - 0.5) * 1.8; // stretch the mid-heavy mix towards -1..1
      return J * (v < -1 ? -1 : v > 1 ? 1 : v);
    };

    for (let y = 0, i = 0; y < rows; y++) {
      for (let x = 0; x < cols; x++, i++) {
        lead[i] = jitter(x, y, s);
        trail[i] = jitter(x, y, s + 101);
        glyphs[i] = randomGlyph();
      }
    }

    seedAccents(s + 202);
    seedDecode(sweepLabel);
    seedPreview(sweepPage);
  }

  // Letters of the next page's name, repeated along every row (each row shifted)
  function seedDecode(label) {
    target.fill(0);
    decoding = !!(cfg.decode && label);
    if (!decoding) return;

    let grew = false;
    const letters = [...(label + cfg.separator)].map((ch) => {
      if (ch === " ") return 0;
      let k = glyphSet.indexOf(ch);
      if (k === -1 && glyphSet.length < 254) {
        glyphSet.push(ch);
        k = glyphSet.length - 1;
        grew = true;
      }
      return k + 1; // 0 (blank) if the atlas is full
    });
    if (grew) buildAtlas();

    const L = letters.length;
    const [l0, l1] = cfg.lockDepth;
    for (let y = 0, i = 0; y < rows; y++) {
      const offset = (y * cfg.rowShift) % L;
      for (let x = 0; x < cols; x++, i++) {
        target[i] = letters[(x + offset) % L];
        lockAt[i] = l0 + (l1 - l0) * hash(x, y, sweepSeed + 303);
      }
    }
  }

  // 1-bit dither of the incoming page's first screen: its visible images painted at their
  // real position on a canvas with one pixel per cell, the page background elsewhere.
  // Images load once per session; the tones update as they arrive
  function seedPreview(page) {
    tone.set(accents); // no preview: the noise patches
    const token = ++previewToken;
    if (!cfg.preview || !page) return;

    const sources = previewSources(page);
    if (!sources.length) return;

    const pc = document.createElement("canvas");
    pc.width = cols;
    pc.height = rows;
    const pctx = pc.getContext("2d", { willReadFrequently: true });
    const left = parseFloat(canvas.style.left) || 0;
    // Draw in CSS px, land in cells
    pctx.setTransform(1 / cssCell, 0, 0, 1 / cssCell, -left / cssCell, -gridTop / cssCell);

    let bg = getComputedStyle(page).backgroundColor;
    if (isClear(bg)) bg = getComputedStyle(document.body).backgroundColor;
    pctx.fillStyle = isClear(bg) ? "#ffffff" : bg;
    pctx.fillRect(left, gridTop, cols * cssCell, rows * cssCell);
    updateTone(pctx);

    sources.forEach(({ url, rect, clip }) => {
      loadPreviewImage(url).then((img) => {
        if (!img || token !== previewToken) return; // a newer sweep or resize took over
        if (clip) {
          pctx.save();
          pctx.beginPath();
          pctx.rect(clip.left, clip.top, clip.width, clip.height);
          pctx.clip();
        }
        drawCover(pctx, img, rect);
        if (clip) pctx.restore();
        updateTone(pctx);
      });
    });
  }

  // Dark cells of the preview become black tiles, through a Bayer threshold
  function updateTone(pctx) {
    let data;
    try {
      data = pctx.getImageData(0, 0, cols, rows).data;
    } catch (e) {
      return;
    }
    const c = cfg.previewContrast;
    for (let y = 0, i = 0; y < rows; y++) {
      for (let x = 0; x < cols; x++, i++) {
        const o = i * 4;
        const l = ((data[o] * 0.299 + data[o + 1] * 0.587 + data[o + 2] * 0.114) / 255 - 0.5) *
          c + 0.5;
        tone[i] = l < BAYER[(y & 3) * 4 + (x & 3)] ? 1 : 0;
      }
    }
  }

  // Images in the first screen of the page, biggest first. WebGL features have no <img>:
  // the project slider (data-images) counts too
  function previewSources(page) {
    const vw = window.innerWidth;
    const inView = (r) => r.width > 2 && r.height > 2 && r.bottom > 0 && r.top < vh && r.right >
      0 && r.left < vw;
    const out = [];

    page.querySelectorAll("[data-images]").forEach((el) => {
      try {
        // A video slide counts through its image (a bare video URL has none)
        const entry = JSON.parse(el.getAttribute("data-images"))[0];
        const first = typeof entry === "string" ? (isVideoUrl(entry) ? "" : entry) : entry
          ?.image;
        const rect = el.getBoundingClientRect();
        if (first && inView(rect)) out.push({ url: first, rect });
      } catch (e) {}
    });

    page.querySelectorAll("img").forEach((img) => {
      const rect = img.getBoundingClientRect();
      if (!inView(rect) || getComputedStyle(img).visibility === "hidden") return;
      const url = smallSrc(img, rect.width);
      // A picture zoomed inside a clipping box (the Profile portrait) shows only the box
      const box = img.parentElement;
      const bs = box && getComputedStyle(box);
      const clip = bs && (bs.overflowX !== "visible" || bs.overflowY !== "visible") ? box
        .getBoundingClientRect() : null;
      if (url) out.push({ url, rect, clip });
    });

    return out
      .sort((a, b) => b.rect.width * b.rect.height - a.rect.width * a.rect.height)
      .slice(0, cfg.previewMaxImages);
  }

  // Smallest srcset candidate that still covers the element (or 320px): plenty for a cell grid
  function smallSrc(img, width) {
    let best = img.getAttribute("src") || img.currentSrc;
    let bestWidth = Infinity;
    (img.getAttribute("srcset") || "").split(",").forEach((part) => {
      const [url, descriptor] = part.trim().split(/\s+/);
      const w = parseInt(descriptor, 10);
      if (url && w >= Math.min(320, width) && w < bestWidth) {
        best = url;
        bestWidth = w;
      }
    });
    return best;
  }

  // CORS-enabled copy of the image (the Webflow CDN allows it), cached for the session
  function loadPreviewImage(url) {
    if (!previewImages.has(url)) {
      previewImages.set(url, new Promise((resolve) => {
        const im = new Image();
        im.crossOrigin = "anonymous";
        im.decoding = "async";
        im.addEventListener("load", () => resolve(im), { once: true });
        im.addEventListener("error", () => resolve(null), { once: true });
        im.src = url;
      }));
    }
    return previewImages.get(url);
  }

  // object-fit: cover into the element's rect
  function drawCover(pctx, img, r) {
    const iw = img.naturalWidth,
      ih = img.naturalHeight;
    if (!iw || !ih) return;
    const scale = Math.max(r.width / iw, r.height / ih);
    const sw = r.width / scale,
      sh = r.height / scale;
    pctx.drawImage(img, (iw - sw) / 2, (ih - sh) / 2, sw, sh, r.left, r.top, r.width, r.height);
  }

  // Accent patches come from their own noise field, top N% of it
  function seedAccents(s) {
    accents.fill(0);
    if (!cfg.accent || cfg.accentAmount <= 0) return;

    const n = cols * rows;
    const f = cfg.noiseScale * 0.8;
    const field = new Float32Array(n);
    for (let y = 0, i = 0; y < rows; y++) {
      for (let x = 0; x < cols; x++, i++) field[i] = noise(x * f, y * f, s);
    }
    const cut = field.slice().sort()[Math.min(n - 1, Math.floor((1 - cfg.accentAmount) * n))];
    for (let i = 0; i < n; i++) accents[i] = field[i] >= cut ? 1 : 0;
  }

  function render() {
    if (!ctx) return;
    const now = performance.now();
    const scramble = now - lastScramble > cfg.scrambleInterval;
    if (scramble) lastScramble = now;

    ctx.clearRect(0, 0, canvas.width, canvas.height);

    const F = F0 + (F1 - F0) * state.p; // leading edge
    const B = F - H; // trailing edge
    const S = cellPx,
      R = cfg.ramp.length;

    for (let y = 0; y < rows; y++) {
      const u = rowU[y];
      if (u >= F + J || u <= B - J) continue; // row outside the band

      const dy = y * S;
      for (let x = 0, i = y * cols; x < cols; x++, i++) {
        const a = F + lead[i] - u; // how far the leading edge is past the cell
        if (a <= 0) continue;
        const b = u - B - trail[i]; // how far the trailing edge still is
        if (b <= 0) continue;

        // < 1: ASCII fringe, >= 1: solid tile. Dark preview cells use the black tile row
        const d = (a < b ? a : b) / G;
        const row = tone[i];
        if (d >= 1) {
          if (decoding && a >= G + lockAt[i]) {
            // Deep enough into the band: the letter of the page name is locked
            ctx.drawImage(atlas, target[i] * S, row * S, S, S, x * S, dy, S, S);
          } else {
            // Front of the band: scrambling glyphs (the core only flickers when not decoding)
            if (scramble && Math.random() < (d < 3 ? 0.35 : 0.05)) glyphs[i] = randomGlyph();
            ctx.drawImage(atlas, glyphs[i] * S, row * S, S, S, x * S, dy, S, S);
          }
        } else {
          const k = Math.min(R - 1, (d * R) | 0);
          ctx.drawImage(atlas, k * S, (row + 2) * S, S, S, x * S, dy, S, S);
        }
      }
    }

    updateClip(F);
  }

  // Uncover the new page up to the middle of the band
  function updateClip(F) {
    if (!toEl) return;
    const c = (F - H / 2) * vh; // px from the edge the sweep starts at

    if (c <= 0) toEl.style.clipPath = "inset(0 0 100% 0)";
    else if (c >= vh) toEl.style.clipPath = "none";
    else if (dir === "up") toEl.style.clipPath =
      `polygon(0 ${vh - c}px, 100% ${vh - c}px, 100% ${vh}px, 0 ${vh}px)`;
    else toEl.style.clipPath = `polygon(0 0, 100% 0, 100% ${c}px, 0 ${c}px)`;

    if (onSwap && (dir === "up" ? vh - c <= swapY : c >= swapY)) {
      const fn = onSwap;
      onSwap = null;
      fn();
    }

    // Entry reveals start as soon as the uncovered area reaches them
    if (uncoverPending.length) {
      const reached = uncoverPending.filter(it => (dir === "up" ? vh - c <= it.bottom : c >= it
        .top));
      if (reached.length) {
        uncoverPending = uncoverPending.filter(it => !reached.includes(it));
        reached.forEach(it => it.fn());
      }
    }
  }

  function armUncover(it) {
    const r = it.el.getBoundingClientRect();
    uncoverPending.push({ fn: it.fn, top: r.top, bottom: r.bottom });
  }

  // Play fn when the band uncovers el (el lives in the page the next sweep brings in)
  function onUncover(el, fn) {
    const it = { el, fn };
    if (running && toEl && toEl.contains(el)) armUncover(it);
    else uncoverQueue.push(it);
  }

  function flushUncover() {
    const fns = uncoverPending.map(it => it.fn);
    uncoverPending = [];
    fns.forEach(fn => fn());
  }

  // The line the band has to pass before the theme flips: the nav's far edge
  function swapLine() {
    const r = document.querySelector("[data-theme-nav]")?.getBoundingClientRect();
    if (!r || !r.height) return vh / 2;
    return dir === "up" ? r.top : r.bottom;
  }

  // Both pages are on screen during the sweep while the body carries only one theme.
  // Pin each container's own background (if transparent) and text colour, read
  // with the body temporarily set to that container's theme.
  function fill(el) {
    if (!el) return;
    const body = document.body;
    const prev = body.dataset.pageTheme;
    const transition = body.style.transition;
    body.style.transition = "none"; // a body colour transition would return the start value
    if (el.dataset.pageTheme) body.dataset.pageTheme = el.dataset.pageTheme;

    const cs = getComputedStyle(el);
    const color = cs.color;
    const pinBg = isClear(cs.backgroundColor);
    let bg = cs.backgroundColor;
    for (let p = el.parentElement; p && isClear(bg); p = p.parentElement) bg = getComputedStyle(
      p).backgroundColor;
    if (isClear(bg)) bg = "#ffffff";

    if (prev === undefined) delete body.dataset.pageTheme;
    else body.dataset.pageTheme = prev;
    getComputedStyle(body).color; // flush before restoring the transition
    body.style.transition = transition;

    if (pinBg) el.style.backgroundColor = bg;
    el.style.color = color;
    filled.push(el);
  }

  function hide(el) {
    if (!el) return;
    el.style.clipPath = "inset(0 0 100% 0)";
    expectedPage = el; // the next sweep uncovers it
  }

  // True while el sits in the page the band is uncovering, or about to
  function willUncover(el) {
    const page = running && toEl ? toEl : expectedPage;
    return !!(page && page.contains(el));
  }

  function finish() {
    activeSweep = null;
    running = false;
    gsap.ticker.remove(render);
    ctx?.clearRect(0, 0, canvas.width, canvas.height);

    toEl?.style.removeProperty("clip-path");
    // Whatever the band didn't reach (or a cut-short sweep) plays now
    flushUncover();
    filled.forEach(el => {
      el.style.removeProperty("background-color");
      el.style.removeProperty("color");
    });
    filled = [];
    toEl = null;
    sweepLabel = "";
    sweepPage = null;
    expectedPage = null;
    previewToken++; // late preview images are for a band that's gone

    // Never leave the theme behind, even if the band didn't reach the nav
    if (onSwap) {
      const fn = onSwap;
      onSwap = null;
      fn();
    }
  }

  // One full pass of the band. `from` stays visible below it, `to` is
  // uncovered above it. Returns the tween so it can sit in a timeline.
  function sweep({
    from = null,
    to = null,
    direction = cfg.direction,
    onSwap: swapFn = null,
    label = ""
  } = {}) {
    hide(to);

    return gsap.fromTo(state, { p: 0 }, {
      p: 1,
      duration: cfg.duration,
      ease: cfg.ease,
      immediateRender: false,
      onStart() {
        init();
        // Wrap up a sweep that is somehow still running
        if (activeSweep && activeSweep !== this) {
          activeSweep.kill();
          finish();
        }
        activeSweep = this;

        dir = direction === "up" ? "up" : "down";
        toEl = to;
        onSwap = swapFn;

        expectedPage = null;
        // Arm the entry reveals of the incoming page, drop stale ones
        const queued = uncoverQueue;
        uncoverQueue = [];
        queued.forEach(it => {
          if (to && to.contains(it.el)) armUncover(it);
          else if (it.el.isConnected) it.fn();
        });
        swapY = swapLine();
        fill(from);
        fill(to);
        sweepSeed = (Math.random() * 1e9) | 0;
        sweepLabel = label;
        sweepPage = to;
        seed();

        // onStart runs before the tween writes p, don't render a stale value
        state.p = 0;
        if (!running) {
          running = true;
          gsap.ticker.add(render);
        }
      },
      onComplete: finish,
    });
  }

  return { init, sweep, hide, onUncover, willUncover, state };
})();

// -----------------------------------------
// PAGE INTRO (hard loads)
// -----------------------------------------

// No loading bar. Every template carries a .preloader that covers the page from the first
// paint in the page colour (#f3f3f3), so nothing shows before this file runs. Once the web
// fonts are in, that sheet goes and the elements of the first screen fade in one by one,
// in random order. Barba navigations keep the dither band.

// Session flag of the old preloader: when set, the Site head script hides the sheet from
// the first paint. Written only when the intro plays once per tab session
const PRELOADER_SEEN_KEY = "preloader_seen_session";

const PAGE_INTRO = {
  oncePerSession: false, // true: only the first hard load of the tab session composes
  spread: 0.9, // s, every element starts at a random time within this window
  boxSpread: 0.15, // s, big boxes (over a quarter of the screen) start within this
  fade: 0.45, // s, fade-in of each element
  ease: "power1.out",
  nestGap: 0.08, // s, nothing starts before the box it sits in
  readyWait: 2.5, // s, longest wait for the web fonts and the held page work (holdIntro)
  imageWait: 1.2, // s, longest extra wait for an image that is still loading
};

// Never faded as a whole: the sheet and the overlays, and the texts with their own entry
// reveal (those start at a random slot through revealOnEntry instead)
const INTRO_SKIP = ".preloader, .crt-overlay, [data-intro-skip], [data-split='heading']";

// Shown in one piece: links and buttons (cards, the TV keys) and media
const INTRO_UNIT = /^(A|BUTTON|IMG|PICTURE|VIDEO|CANVAS|IFRAME|svg|INPUT|TEXTAREA|SELECT)$/;

// null until decided, then true/false for this hard load
let introWillPlay = null;

// The running intro, { page, slotFor(el), elapsed() }, null otherwise
let intro = null;

// Promise while the sheet still covers the page on a hard load, null otherwise
let pageRevealPending = null;
let revealPage = null;

// Work the sheet waits for on a hard load (WebGL setup, the media of the first screen),
// registered from beforeEnter through holdIntro(). null once the intro took it
let introHolds = [];

// sessionStorage can throw when storage is blocked: never let that break the first load
function writeSessionFlag(key) {
  try { sessionStorage.setItem(key, "1"); } catch (e) {}
}

// The intro plays on hard loads where the sheet is showing (the session flag can hide it
// from the first paint) and motion is welcome. Decided once per hard load
function shouldPlayIntro() {
  if (introWillPlay === null) {
    const sheet = document.querySelector(".preloader");
    const sheetShowing = !!sheet && getComputedStyle(sheet).display !== "none";
    introWillPlay = sheetShowing && !reducedMotion;

    // Every hard load composes: drop a flag left by the old preloader
    if (!PAGE_INTRO.oncePerSession) {
      try { sessionStorage.removeItem(PRELOADER_SEEN_KEY); } catch (e) {}
    }

    // Entry reveals registered before the intro starts wait for its handover
    if (introWillPlay) pageRevealPending = new Promise(resolve => { revealPage = resolve; });
  }
  return introWillPlay;
}

// Runs fn when the page is actually in view: right away on Barba navigations, at the
// intro handover on hard loads. For entry reveals that would otherwise play unseen
// behind the sheet.
function onPageReveal(fn, page = nextPage) {
  if (!pageRevealPending) return fn();

  pageRevealPending.then(() => {
    // Skip if Barba already swapped this page out
    if (page.isConnected) fn();
  });
}

// True when the element sits in the first screen of its page. Measured in beforeEnter,
// where the new container is already laid out at the top (position: fixed, top 0)
function isAboveFold(el) {
  const r = el.getBoundingClientRect();
  return r.bottom > 0 && r.top < window.innerHeight;
}

// Entry reveal for an element in the first screen: it plays while the band uncovers it
// (Barba navigation) or at its slot in the intro (hard load).
// Call from beforeEnter. Elements further down use ScrollTrigger in afterEnter instead.
function revealOnEntry(el, fn, page = nextPage) {
  // Only wait for the band when it is really about to uncover this page. The heading split
  // waits for the web fonts, which on phones often land after a hard load is already done
  if (Dither.willUncover(el)) return Dither.onUncover(el, fn);
  onPageReveal(() => atIntroSlot(el, fn), page);
}

// Keeps the sheet up until work is done (a WebGL scene drawn, an image in), so the page
// doesn't compose half-built. Hard loads only, capped by PAGE_INTRO.readyWait
function holdIntro(work) {
  if (!introWillPlay || !introHolds) return;
  introHolds.push(Promise.resolve(work).catch(() => {}));
}

// While the intro runs, an entry reveal starts at the element's own random slot
function atIntroSlot(el, fn) {
  if (!intro || !intro.page.contains(el)) return fn();
  const wait = intro.slotFor(el) - intro.elapsed();
  if (wait <= 0) return fn();
  gsap.delayedCall(wait, () => {
    if (el.isConnected) fn();
  });
}

const isTransparent = (color) => color === "transparent" || /,\s*0\)$/.test(color);

// Own text, and nothing inside but inline bits (links, spans, <br>): one piece of text
function isTextLeaf(el) {
  let hasText = false;
  for (const node of el.childNodes) {
    if (node.nodeType === 3) {
      if (node.textContent.trim()) hasText = true;
    } else if (node.nodeType === 1 && node.tagName !== "BR" &&
      !getComputedStyle(node).display.startsWith("inline")) {
      return false;
    }
  }
  return hasText;
}

// A box that paints something of its own on the page: fill, image, shadow or border
function isPainted(s, pageBg) {
  if (s.backgroundImage !== "none" || s.boxShadow !== "none") return true;
  if (!isTransparent(s.backgroundColor) && s.backgroundColor !== pageBg) return true;
  return ["Top", "Right", "Bottom", "Left"].some((side) =>
    parseFloat(s[`border${side}Width`]) > 0 && s[`border${side}Style`] !== "none" &&
    !isTransparent(s[`border${side}Color`]));
}

function inFirstScreen(el) {
  const r = el.getBoundingClientRect();
  return r.width > 0 && r.height > 0 && r.bottom > 0 && r.right > 0 &&
    r.top < window.innerHeight && r.left < window.innerWidth;
}

// A CSS transition on opacity would ease the hide (and every GSAP frame)
function transitionsOpacity(s) {
  const durations = s.transitionDuration.split(",");
  return s.transitionProperty.split(",").some((prop, i) =>
    /^\s*(all|opacity)\s*$/.test(prop) && parseFloat(durations[i % durations.length]) > 0);
}

// What the intro fades in: texts, media, links and painted boxes of the first screen,
// in document order (a box comes before what sits in it)
function collectIntroTargets(page) {
  const pageBg = getComputedStyle(page).backgroundColor;
  const targets = [];

  // walk(el, box): box is the nearest target that el sits in
  const walk = (el, box) => {
    for (const child of el.children) {
      if (child.matches(INTRO_SKIP)) continue;
      const s = getComputedStyle(child);
      if (s.display === "none" || s.visibility === "hidden" || parseFloat(s.opacity) < 0.05) {
        continue;
      }

      // [data-intro-unit]: a text made of blocks that still composes as one (the home statement)
      const unit = INTRO_UNIT.test(child.tagName) || isTextLeaf(child) ||
        child.hasAttribute("data-intro-unit");
      // Opacity driven by another script: leave it alone, what sits in it still composes
      const owned = child.style.opacity !== "" || child.style.visibility !== "";
      let target = !owned && (unit || isPainted(s, pageBg)) && inFirstScreen(child);
      // A box that hides the box it sits in (an opaque fill over nearly all of it) fades in
      // with it, as one: on its own it would come later, and the backdrop under it (never
      // seen on the finished page) would flash through first
      if (target && !unit && box && coversBox(child, s, box)) target = false;
      if (target) targets.push(child);
      if (!unit) walk(child, target ? child : box);
    }
  };

  walk(page, null);
  return targets;
}

// An opaque fill over at least 90% of the on-screen part of box
function coversBox(el, s, box) {
  if (!/^rgba?\(/.test(s.backgroundColor) || isTransparent(s.backgroundColor)) return false;
  const alpha = s.backgroundColor.match(/,\s*([\d.]+)\)$/);
  if (s.backgroundColor.startsWith("rgba") && alpha && parseFloat(alpha[1]) < 1) return false;
  const visible = (r) => Math.max(0, Math.min(r.right, window.innerWidth) - Math.max(r.left, 0)) *
    Math.max(0, Math.min(r.bottom, window.innerHeight) - Math.max(r.top, 0));
  const boxArea = visible(box.getBoundingClientRect());
  return boxArea > 0 && visible(el.getBoundingClientRect()) >= 0.9 * boxArea;
}

// The sheet goes for good: also hides the copies every Barba page brings in (Site head CSS)
function hideIntroSheet() {
  const sheet = document.querySelector(".preloader");
  if (sheet) sheet.style.display = "none";
  document.documentElement.classList.add("preloader-seen");
  if (PAGE_INTRO.oncePerSession) writeSessionFlag(PRELOADER_SEEN_KEY);
}

// One element: fade in at its slot. An image still loading waits for it (up to
// imageWait) so it never fades in empty
function fadeIntroItem(item, elapsed) {
  const C = PAGE_INTRO;
  const { el } = item;

  const play = () => gsap.to(el, {
    opacity: item.to,
    duration: C.fade,
    ease: C.ease,
    delay: Math.max(0, item.slot - elapsed()),
    onComplete: () => {
      // Back to the stylesheet, which gives the same value
      el.style.opacity = item.opacity;
      el.style.transition = item.transition;
    },
  });

  if (el.tagName === "IMG" && !el.complete) {
    let played = false;
    const go = () => {
      if (played) return;
      played = true;
      play();
    };
    el.addEventListener("load", go, { once: true });
    el.addEventListener("error", go, { once: true });
    gsap.delayedCall(item.slot + C.imageWait, go);
  } else {
    play();
  }
}

// Hard load: the sheet stays until the fonts are in and the held work is done (or
// readyWait), then the first screen composes itself, element by element in random order
function runPageIntro(next) {
  const C = PAGE_INTRO;
  let started = false;

  const start = () => {
    if (started) return;
    started = true;

    const targets = collectIntroTargets(next);

    // Lenis turns GSAP's lag smoothing off: a long frame (a texture upload, a shader
    // compile) would then jump past every delay and pop the whole page in at once.
    // On for the intro, timed on the same clock as the delays
    gsap.ticker.lagSmoothing(100, 33);
    const t0 = gsap.ticker.time;
    const elapsed = () => gsap.ticker.time - t0;
    const slots = new Map();

    // The panels of the page: over a quarter of the screen, or a full-height column
    const isBig = (el) => {
      const r = el.getBoundingClientRect();
      return r.width * r.height > 0.25 * window.innerWidth * window.innerHeight ||
        r.height > 0.8 * window.innerHeight;
    };

    // Elements with their own reveal (headings, blink texts) ask on demand: a
    // random start within what is left of the window after the box around them starts
    const slotFor = (el) => {
      if (slots.has(el)) return slots.get(el);
      let after = 0;
      for (let p = el.parentElement; p && p !== next; p = p.parentElement) {
        if (slots.has(p)) {
          after = slots.get(p) + C.nestGap;
          break;
        }
      }
      const range = isBig(el) ? C.boxSpread : Math.max(C.spread - after, C.nestGap);
      const slot = after + Math.random() * range;
      slots.set(el, slot);
      return slot;
    };

    // The targets, from the inside out: texts, media and links start anywhere in the window,
    // a box just before the first thing it holds. Deep nesting never squeezes the copy into
    // the last moment. Big panels come first, or all they hold would wait
    const held = new Set(targets);
    const holder = (el) => {
      for (let p = el.parentElement; p && p !== next; p = p.parentElement) {
        if (held.has(p)) return p;
      }
      return null;
    };
    const firstInside = new Map(); // box -> earliest slot of what it holds
    for (let i = targets.length - 1; i >= 0; i--) { // reversed document order: contents first
      const el = targets[i];
      let slot = firstInside.has(el) ? Math.max(0, firstInside.get(el) - C.nestGap) :
        Math.random() * C.spread;
      if (isBig(el)) slot = Math.min(slot, Math.random() * C.boxSpread);
      slots.set(el, slot);
      const box = holder(el);
      if (box) firstInside.set(box, Math.min(firstInside.get(box) ?? Infinity, slot));
    }

    // The home hero's canvases draw the statement's highlight boxes and portrait chip
    // (initHomeDither): they arrive with its words, never as empty bars before them
    targets.forEach((el) => {
      if (el.tagName !== "CANVAS" || !el.parentElement?.matches("[data-home-hero]")) return;
      const line = el.parentElement.querySelector("[data-home-line]");
      if (line) slots.set(el, slotFor(line));
    });

    intro = { page: next, slotFor, elapsed };

    // Hidden while the sheet still covers them
    const items = targets.map((el) => {
      const s = getComputedStyle(el);
      const item = {
        el,
        to: parseFloat(s.opacity),
        opacity: el.style.opacity,
        transition: el.style.transition,
        slot: slotFor(el),
      };
      if (transitionsOpacity(s)) el.style.transition = "none";
      return item;
    });
    gsap.set(targets, { opacity: 0 });
    hideIntroSheet();

    // Handover: entry reveals wait for their own slot (atIntroSlot)
    pageRevealPending = null;
    revealPage?.();

    items.forEach((item) => fadeIntroItem(item, elapsed));

    // Reveals registered later (headings split after the fonts) no longer wait
    const end = items.reduce((max, item) => Math.max(max, item.slot), C.spread) + C.fade;
    gsap.delayedCall(end, () => {
      if (intro?.page === next) intro = null;
      if (lenis) gsap.ticker.lagSmoothing(0);
    });
  };

  // Two frames after the fonts and the held work: the page's own setup (afterEnter, first
  // WebGL frames) runs while the sheet still covers it, not during the fades
  const holds = introHolds || [];
  introHolds = null;
  Promise.all([new Promise((resolve) => whenTextFontsReady(resolve)), ...holds])
    .then(() => requestAnimationFrame(() => requestAnimationFrame(start)));
  gsap.delayedCall(C.readyWait, start);
}

// Every template carries its own .preloader inside the container: the copy that
// comes with a Barba page must never show (the head CSS makes it display:flex)
function initContainerPreloaderHide() {
  if (!onceFunctionsInitialized) return; // first load: runPageOnceAnimation decides

  nextPage.querySelectorAll(".preloader").forEach(el => {
    el.style.display = "none";
  });
}

// -----------------------------------------
// GLOBAL: CLICK SOUND ([data-sound])
// -----------------------------------------

// One Howl and one delegated listener for the whole session, so it keeps working
// on every container Barba swaps in. Needs Howler 2.2.4 loaded before this file
function initClickSound() {
  if (typeof Howl === "undefined") return;

  const clickSound = new Howl({
    src: ["https://cdn.jsdelivr.net/gh/nicolaromei98/portfolio@945abc7/click.mp3"],
    volume: 0.6,
    preload: true
  });

  // Every click starts a new instance of the sound, so fast consecutive clicks work too
  document.addEventListener("click", (event) => {
    const trigger = event.target.closest("[data-sound]");
    if (!trigger) return;

    clickSound.play();
  });
}

// -----------------------------------------
// 404: THE REQUESTED PATH ([data-nf])
// -----------------------------------------

// Writes the address that was asked for into [data-nf-path], as text. A 404 is always a
// hard load (Barba falls back to a full navigation when the request fails), so
// location.pathname is that address. Nothing keeps running, so there is nothing to clean up
function initNotFound() {
  const root = nextPage.querySelector("[data-nf]");
  const pathEl = root && root.querySelector("[data-nf-path]");
  if (!pathEl) return;
  let path = location.pathname || "/";
  try { path = decodeURIComponent(path); } catch (e) {} // not valid UTF-8: keep it raw
  if (path.length > 110) path = path.slice(0, 109) + "…"; // one line on every desktop
  pathEl.textContent = path;
}

// -----------------------------------------
// SITEWIDE: HEADING REVEAL ([data-split="heading"])
// -----------------------------------------

// Lines slide up out of a mask. Headings in the first screen reveal while the band
// uncovers them, the others when they scroll into view. The only owner of
// [data-split="heading"] (it used to be split by three scripts at once). The head CSS
// keeps the heading hidden until it is split here.
const HEADING_REVEAL = {
  default: { duration: 0.85, stagger: 0.05, start: "top 95%" },
};

// Masked lines: SplitText lines, each with an inner wrapper that slides inside the mask.
// Returns the wrappers (what gets animated). The instance is kept on the element: a new
// split of the same element reverts the old one, which puts back the text it was made on,
// so a text swap has to revert it first (swapHeadingText)
function splitHeadingLines(heading) {
  const split = new SplitText(heading, { type: "lines", linesClass: "mask-line" });
  heading._split = split;

  split.lines.forEach((line) => {
    const wrapper = document.createElement("div");
    wrapper.style.display = "block";
    while (line.firstChild) wrapper.appendChild(line.firstChild);
    line.appendChild(wrapper);
  });

  return heading.querySelectorAll(".mask-line > div");
}

// beforeEnter: split into masked lines, park them below the mask, arm the entry reveal
function initHeadingSplit() {
  const page = nextPage;
  const headings = [...page.querySelectorAll('[data-split="heading"]')];
  const config = HEADING_REVEAL.default;

  // Reveals that never played (headings never scrolled to) would stay in GSAP's global timeline
  onPageLeave(() => headings.forEach((heading) => heading._reveal?.kill()));

  // Line breaks depend on the web fonts: split once they are in
  page._headingsReady = new Promise((resolve) => {
    whenTextFontsReady(() => {
      headings.forEach((heading) => {
        gsap.set(heading, { autoAlpha: 1 });

        heading._reveal = gsap.fromTo(splitHeadingLines(heading), {
          yPercent: 100,
        }, {
          yPercent: 0,
          duration: config.duration,
          stagger: config.stagger,
          ease: "power4.out",
          paused: true,
        });

        if (isAboveFold(heading)) {
          heading._revealOnEntry = true;
          revealOnEntry(heading, () => heading._reveal.play(), page);
        }
      });
      resolve();
    });
  });
}

// afterEnter: headings further down the page reveal when they scroll into view
function initHeadingScrollReveal() {
  const page = nextPage;
  const config = HEADING_REVEAL.default;

  (page._headingsReady || Promise.resolve()).then(() => {
    if (!page.isConnected) return;

    page.querySelectorAll('[data-split="heading"]').forEach((heading) => {
      if (!heading._reveal || heading._revealOnEntry) return;

      ScrollTrigger.create({
        trigger: heading,
        start: config.start,
        once: true,
        onEnter: () => heading._reveal.play(),
      });
    });
  });
}

// -----------------------------------------
// AI EXPLORATION: BLINK TEXT (slide titles)
// -----------------------------------------

// Wrap every character in a .blink-char span with a random "broken" opacity.
// Runs once per element (data-wrapped guard), so it is safe to call again
function wrapBlinkChars(el) {
  if (el.dataset.wrapped) return;

  const raw = el.innerHTML.replace(/<br\s*\/?>/gi, "\n");
  el.innerHTML = raw.split("").map(ch => {
    if (ch === "\n") return "<br>";

    const isOff = Math.random() < 0.25;
    const opacity = isOff ? 0 : gsap.utils.random(0.2, 1);
    const safeChar = ch === " " ? "&nbsp;" : ch;

    return `<span class="blink-char" style="display:inline-block; will-change:opacity,filter; opacity:${opacity}; filter:brightness(.7)">${safeChar}</span>`;
  }).join("");
  el.dataset.wrapped = "1";
}

// Blink controls for one element: entrance burst, flicker loop while hovered.
// Hover listeners use `signal`; destroy() kills every timeline it started
function createBlinkControls(el, signal) {
  wrapBlinkChars(el);

  const chars = el.querySelectorAll(".blink-char");
  let hoverTL = null;
  let burstTL = null;

  // Final state: every character readable
  const settleAll = () => {
    gsap.to(chars, {
      opacity: 1,
      filter: "brightness(1)",
      duration: 0.18,
      stagger: 0.008,
      overwrite: "auto"
    });
  };

  // "Broken" state again, used before a slide re-enters
  const resetBlink = () => {
    chars.forEach(char => {
      const isOff = Math.random() < 0.25;
      const opacity = isOff ? 0 : gsap.utils.random(0.2, 1);
      gsap.set(char, { opacity: opacity, filter: "brightness(0.7)" });
    });
  };

  // One flash on a single character: dark → bright → dim → normal
  const createFlash = (target) => {
    return gsap.timeline()
      .to(target, {
        opacity: gsap.utils.random(0.0, 0.18),
        filter: "brightness(.35)",
        duration: gsap.utils.random(0.012, 0.03),
        ease: "none",
        overwrite: "auto"
      })
      .to(target, {
        opacity: 1,
        filter: `brightness(${gsap.utils.random(1.1, 2.2)})`,
        duration: gsap.utils.random(0.012, 0.04),
        ease: "none",
        overwrite: "auto"
      })
      .to(target, {
        opacity: gsap.utils.random(0.05, 0.35),
        filter: "brightness(.55)",
        duration: gsap.utils.random(0.012, 0.03),
        ease: "none",
        overwrite: "auto"
      })
      .to(target, {
        opacity: 1,
        filter: "brightness(1)",
        duration: gsap.utils.random(0.02, 0.06),
        ease: "none",
        overwrite: "auto"
      });
  };

  const getRandomChar = () => chars[gsap.utils.random(0, chars.length - 1, 1)];

  // Entrance burst, settles into the readable state
  const doBurst = () => {
    if (hoverTL) hoverTL.kill();
    const tl = gsap.timeline({ onComplete: settleAll });
    const flashes = Math.min(140, Math.max(70, chars.length * 6));

    for (let i = 0; i < flashes; i++) {
      tl.add(createFlash(getRandomChar()), gsap.utils.random(0, 0.9));
    }
    burstTL = tl;
  };

  // Endless flicker while the pointer is over the element
  const startHover = () => {
    if (hoverTL) hoverTL.kill();
    hoverTL = gsap.timeline({ repeat: -1 });
    const flashes = Math.min(220, Math.max(120, chars.length * 8));
    for (let i = 0; i < flashes; i++) {
      hoverTL.add(createFlash(getRandomChar()), gsap.utils.random(0, 1.0));
    }
  };

  const stopHover = () => {
    if (hoverTL) hoverTL.kill();
    settleAll();
  };

  el.addEventListener("mouseenter", startHover, { passive: true, signal });
  el.addEventListener("mouseleave", stopHover, { passive: true, signal });

  // No mouseleave fires when the element is removed while hovered:
  // the repeat:-1 hover loop has to be killed by hand on page leave
  const destroy = () => {
    if (hoverTL) hoverTL.kill();
    if (burstTL) burstTL.kill();
    hoverTL = burstTL = null;
    gsap.killTweensOf(chars);
  };

  return { doBurst, resetBlink, settleAll, destroy };
}

// -----------------------------------------
// SITEWIDE: CURRENT TIME ([data-current-time])
// -----------------------------------------

// Live clock in the time zone given by data-current-time (default Europe/Amsterdam)
function initDynamicCurrentTime() {
  const clocks = nextPage.querySelectorAll("[data-current-time]");

  const createFormatter = (timezone) => new Intl.DateTimeFormat([], {
    timeZone: timezone,
    timeZoneName: "short",
    hour: "2-digit",
    minute: "2-digit",
    second: "2-digit",
    hour12: false,
  });

  const parseFormattedTime = (formattedDateTime) => {
    const match = formattedDateTime.match(/(\d+):(\d+):(\d+)\s*([\w+]+)/);
    return match ? { hours: match[1], minutes: match[2], seconds: match[3], timezone: match[4] } :
      null;
  };

  const updateTime = () => {
    clocks.forEach((clock) => {
      const timezone = clock.getAttribute("data-current-time") || "Europe/Amsterdam";
      const parsed = parseFormattedTime(createFormatter(timezone).format(new Date()));
      if (!parsed) return;

      const hours = clock.querySelector("[data-current-time-hours]");
      const minutes = clock.querySelector("[data-current-time-minutes]");
      const seconds = clock.querySelector("[data-current-time-seconds]");
      const zone = clock.querySelector("[data-current-time-timezone]");
      if (hours) hours.textContent = parsed.hours;
      if (minutes) minutes.textContent = parsed.minutes;
      if (seconds) seconds.textContent = parsed.seconds;
      if (zone) zone.textContent = parsed.timezone;
    });
  };

  updateTime();
  const interval = setInterval(updateTime, 1000);
  onPageLeave(() => clearInterval(interval));
}

// -----------------------------------------
// DITHER HOVER ([data-dither] wrapping a CMS <img>)
// -----------------------------------------

// Dither Hover defaults, overridable per wrapper with
// data-dither-radius (px), -life (s), -ghost (0-1), -pixel (display px), -bg, -dot, -accent ("none" to disable it)
const DITHER_HOVER_DEFAULTS = {
  radius: 0,
  life: 0.9,
  ghost: 0.1,
  pixel: 1,
  bg: '#0E0E0E',
  dot: '#F3F3F3',
  accent: '#FF3B00'
};
const DITHER_HOVER_TRAIL_SCALE =
  6; // the trail is drawn at 1/6 of the resolution, then interpolated
const DITHER_HOVER_INTRO = 0.8; // seconds: on page entry the white dots fade in from black

const DITHER_HOVER_VS = 'attribute vec2 p;void main(){gl_Position=vec4(p,0.,1.);}';
const DITHER_HOVER_FS = [
  'precision highp float;',
  'uniform sampler2D uTex,uTrail,uFresh;uniform vec2 uRes,uImg;',
  'uniform float uTime,uGhost,uPx,uAccOn;uniform vec3 uBg,uDot,uAcc;',
  'float b2(vec2 a){a=floor(a);return fract(a.x*.5+a.y*a.y*.75);}',
  'float b4(vec2 a){return b2(.5*a)*.25+b2(a);}float b8(vec2 a){return b4(.5*a)*.25+b2(a);}',
  'float h(vec2 p){return fract(sin(dot(p,vec2(127.1,311.7)))*43758.5453);}',
  'float vn(vec2 p){vec2 i=floor(p),f=fract(p);f=f*f*(3.-2.*f);return mix(mix(h(i),h(i+vec2(1.,0.)),f.x),mix(h(i+vec2(0.,1.)),h(i+vec2(1.,1.)),f.x),f.y);}',
  'vec2 cover(vec2 uv){float rs=uRes.x/uRes.y,ri=uImg.x/uImg.y;vec2 s=rs<ri?vec2(rs/ri,1.):vec2(1.,ri/rs);return (uv-.5)*s+.5;}',
  'void main(){',
  '  vec2 f=gl_FragCoord.xy,uv=f/uRes;',
  // Organic trail edge that "boils"
  '  float n=vn(uv*vec2(uRes.x/uRes.y,1.)*5.+uTime*.7)-.5;',
  '  float t=texture2D(uTrail,uv+n*.02).a;',
  '  t=clamp(t*(1.+n*.6),0.,1.);',
  // 1-bit dither of the image (grid in display pixels)
  '  vec2 c=floor(f/uPx);',
  '  float l=dot(texture2D(uTex,cover((c+.5)*uPx/uRes)).rgb,vec3(.299,.587,.114));',
  '  l=clamp((l-.5)*1.35+.5,0.,1.);',
  '  vec3 dith=l>b8(c)?uDot:uBg;',
  // Layers: background -> dither -> colour (each layer uses a different Bayer, so they never line up)
  '  float g1=smoothstep(.05,.4,t),g2=smoothstep(.45,.9,t);',
  // Explicit comparisons: with step() some GPUs (ANGLE on Mac) light up pixels that should stay off
  '  vec3 col=max(g1,uGhost)>b8(c.yx+vec2(5.,2.))+1./128.?dith:uBg;',
  '  float fr=texture2D(uFresh,uv+n*.02).a;',
  '  float edge=smoothstep(.05,.12,fr)*(1.-smoothstep(.16,.3,fr));',
  '  if(uAccOn>.5&&edge*.35>b8(c+vec2(3.,7.))+1./128.)col=uAcc;',
  '  if(g2>b8(c.yx+vec2(1.,6.))+1./128.)col=texture2D(uTex,cover(uv)).rgb;',
  '  gl_FragColor=vec4(col,1.);',
  '}'
].join('\n');

// Dither Hover only runs with a mouse/trackpad and without "reduce motion"
// (the same conditions as the media query around the sitewide dither CSS)
function canUseDitherHover() {
  return matchMedia('(hover: hover) and (pointer: fine)').matches && !reducedMotion;
}

// One offscreen WebGL context renders every [data-dither] item, on every page.
// It is created on first use and kept for the whole session (Barba never reloads the page),
// and rebuilt if the browser has lost it in the meantime. Returns null without WebGL.
let ditherHoverRenderer; // undefined = not created yet, null = WebGL not available

function getDitherHoverRenderer() {
  if (ditherHoverRenderer === null) return null;
  if (ditherHoverRenderer && !ditherHoverRenderer.gl.isContextLost()) return ditherHoverRenderer;

  const glc = document.createElement('canvas');
  const gl = glc.getContext('webgl', {
    antialias: false,
    premultipliedAlpha: false,
    preserveDrawingBuffer: true
  });
  if (!gl) {
    ditherHoverRenderer = null;
    return null;
  }

  function compile(type, source) {
    const shader = gl.createShader(type);
    gl.shaderSource(shader, source);
    gl.compileShader(shader);
    if (!gl.getShaderParameter(shader, gl.COMPILE_STATUS)) console.warn('[dither]', gl
      .getShaderInfoLog(shader));
    return shader;
  }

  const program = gl.createProgram();
  gl.attachShader(program, compile(gl.VERTEX_SHADER, DITHER_HOVER_VS));
  gl.attachShader(program, compile(gl.FRAGMENT_SHADER, DITHER_HOVER_FS));
  gl.linkProgram(program);
  gl.useProgram(program);

  // One triangle that covers the whole viewport
  gl.bindBuffer(gl.ARRAY_BUFFER, gl.createBuffer());
  gl.bufferData(gl.ARRAY_BUFFER, new Float32Array([-1, -1, 3, -1, -1, 3]), gl.STATIC_DRAW);
  const position = gl.getAttribLocation(program, 'p');
  gl.enableVertexAttribArray(position);
  gl.vertexAttribPointer(position, 2, gl.FLOAT, false, 0, 0);

  const L = {};
  'uTex uTrail uFresh uRes uImg uTime uGhost uPx uAccOn uBg uDot uAcc'.split(' ').forEach((
    name) => {
    L[name] = gl.getUniformLocation(program, name);
  });
  gl.uniform1i(L.uTex, 0);
  gl.uniform1i(L.uTrail, 1);
  gl.uniform1i(L.uFresh, 2);
  gl.pixelStorei(gl.UNPACK_FLIP_Y_WEBGL, true);

  ditherHoverRenderer = { glc, gl, L };
  return ditherHoverRenderer;
}

// beforeEnter: the sitewide head CSS hides every [data-dither] <img> and shows it again after 3s
// as a fallback. .dither-ready cancels that fallback (no colour flash), so it must be on <html>
// before the page is visible, not after a long once/transition animation.
function initDitherHoverState() {
  if (!canUseDitherHover()) return;

  const root = document.documentElement;
  root.classList.add('dither-ready');

  if (!document.getElementById('dither-hover-style')) {
    const style = document.createElement('style');
    style.id = 'dither-hover-style';
    style.textContent =
      '[data-dither]{position:relative;overflow:hidden} [data-dither] img{display:block;width:100%;height:100%;object-fit:cover} .dither-cv{position:absolute;inset:0;width:100%;height:100%;pointer-events:none}';
    document.head.appendChild(style);
  }

  // No WebGL: the head CSS shows the normal image again
  if (!getDitherHoverRenderer()) root.classList.add('dither-off');
}

// At rest the image is hidden on a black background: only white dots are left (its light areas).
// On hover the trail reveals it in layers: background -> 1-bit dither -> colour,
// with a fringe of accent pixels on the edge. Then the trail closes again.

// afterEnter: trails, observers and the render loop for the [data-dither] items of this page
function initDitherHover() {
  if (!canUseDitherHover()) return;
  const renderer = getDitherHoverRenderer();
  if (!renderer) return; // no WebGL: .dither-off keeps the normal image

  const { glc, gl, L } = renderer;
  const page = nextPage;
  const controller = new AbortController();
  const { signal } = controller;
  const TRAIL_SCALE = DITHER_HOVER_TRAIL_SCALE;

  const items = [];
  let running = false;
  let last = -1;
  let rafId = 0;
  let destroyed = false;

  function rgb(hex) {
    let h = String(hex).replace('#', '');
    if (h.length === 3) h = h.replace(/./g, '$&$&');
    const n = parseInt(h, 16) || 0;
    return [(n >> 16 & 255) / 255, (n >> 8 & 255) / 255, (n & 255) / 255];
  }

  function opts(el) {
    const o = {};
    for (const k in DITHER_HOVER_DEFAULTS) {
      const v = el.getAttribute('data-dither-' + k);
      o[k] = v == null ? DITHER_HOVER_DEFAULTS[k] : (typeof DITHER_HOVER_DEFAULTS[k] === 'number' ?
        parseFloat(v) : v);
    }
    o.accOn = o.accent !== 'none';
    o.bg = rgb(o.bg);
    o.dot = rgb(o.dot);
    o.accent = o.accOn ? rgb(o.accent) : [0, 0, 0];
    return o;
  }

  // Pick the srcset candidate that fits the rendered size (Webflow CMS images ship a srcset)
  function pickSrc(img, w) {
    const ss = img.getAttribute('srcset');
    let best = img.currentSrc || img.src;
    let bw = 0;
    if (!ss) return best;
    ss.split(',').forEach((s) => {
      const p = s.trim().split(/\s+/);
      const cw = parseInt(p[1], 10) || 0;
      if (!bw || (bw < w && cw > bw) || (cw >= w && cw < bw)) {
        best = p[0];
        bw = cw;
      }
    });
    return best;
  }

  function newTexture() {
    const t = gl.createTexture();
    gl.bindTexture(gl.TEXTURE_2D, t);
    gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_WRAP_S, gl.CLAMP_TO_EDGE);
    gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_WRAP_T, gl.CLAMP_TO_EDGE);
    gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_MIN_FILTER, gl.LINEAR);
    gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_MAG_FILTER, gl.LINEAR);
    return t;
  }

  function setup(el) {
    if (el.__dither) return;
    const img = el.querySelector('img');
    if (!img) return;
    const cv = document.createElement('canvas');
    cv.className = 'dither-cv';
    cv.setAttribute('aria-hidden', 'true');
    const trail = document.createElement('canvas');
    const fresh = document.createElement(
      'canvas'); // head of the trail: fades out right away (for the accent)
    const it = el.__dither = {
      el,
      img,
      cv,
      ctx: cv.getContext('2d'),
      trail,
      tctx: trail.getContext('2d'),
      fresh,
      fctx: fresh.getContext('2d'),
      o: opts(el),
      tex: null,
      ttex: newTexture(),
      ftex: newTexture(),
      iw: 1,
      ih: 1,
      intro: 0,
      started: false,
      visible: false,
      hover: false,
      mouse: null,
      prev: null,
      energy: 0,
      dirty: true
    };
    items.push(it);
    el.addEventListener('pointerenter', (e) => {
      it.hover = true;
      it.mouse = it.prev = pos(it, e);
      kick();
    }, { signal });
    el.addEventListener('pointermove', (e) => {
      it.mouse = pos(it, e);
      kick();
    }, { signal });
    el.addEventListener('pointerleave', () => {
      it.hover = false;
      it.prev = null;
      kick();
    }, { signal });
    io.observe(el);
    ro.observe(el);
    sizeTrail(it);
  }

  function pos(it, e) {
    const r = it.el.getBoundingClientRect();
    return [(e.clientX - r.left) / TRAIL_SCALE, (e.clientY - r.top) / TRAIL_SCALE];
  }

  function sizeTrail(it) {
    it.trail.width = it.fresh.width = Math.ceil(it.el.clientWidth / TRAIL_SCALE) + 1;
    it.trail.height = it.fresh.height = Math.ceil(it.el.clientHeight / TRAIL_SCALE) + 1;
    it.energy = 0;
    it.dirty = true;
  }

  function load(it) {
    if (it.loading) return;
    it.loading = true;
    const dpr = Math.min(devicePixelRatio || 1, 2);
    const im = new Image();
    im.crossOrigin = 'anonymous';
    im.decoding = 'async';
    im.onload = () => {
      // The page may have been left while the image was loading
      if (destroyed) return;
      const t = newTexture();
      try {
        gl.texImage2D(gl.TEXTURE_2D, 0, gl.RGBA, gl.RGBA, gl.UNSIGNED_BYTE, im);
      } catch (err) {
        gl.deleteTexture(t);
        console.warn('[dither] CORS blocked', im.src);
        it.el.classList.add('is-plain');
        return;
      }
      it.tex = t;
      it.iw = im.naturalWidth;
      it.ih = im.naturalHeight;
      it.dirty = true;
      kick();
    };
    im.onerror = () => {
      it.el.classList.add(
        'is-plain');
    }; // image cannot load: back to the normal one
    // No query string: the Webflow CDN answers 403 to it (and already sends CORS *)
    im.src = pickSrc(it.img, it.el.clientWidth * dpr);
  }

  const io = new IntersectionObserver((entries) => {
    entries.forEach((e) => {
      const it = e.target.__dither;
      if (!it) return;
      it.visible = e.isIntersecting;
      if (e.isIntersecting) {
        load(it);
        it.dirty = true;
        kick();
      }
    });
  }, { rootMargin: '200px 0px' });

  const ro = new ResizeObserver((entries) => {
    entries.forEach((e) => {
      const it = e.target.__dither;
      if (it) sizeTrail(it);
    });
    kick();
  });

  // One trail stroke: soft stamps along the movement, bigger when the pointer is fast
  function stroke(it, a, b, dt) {
    const o = it.o;
    const base = (o.radius || Math.min(90, Math.max(14, Math.min(it.el.clientWidth, it.el
      .clientHeight) * 0.18))) / TRAIL_SCALE;
    const dx = b[0] - a[0],
      dy = b[1] - a[1],
      d = Math.sqrt(dx * dx + dy * dy);
    const speed = d * TRAIL_SCALE / Math.max(dt, 1 / 120); // CSS px per second
    const r = base * (1 + Math.min(0.6, speed / 1500));
    const steps = Math.max(1, Math.ceil(d / (r * 0.3)));
    it.tctx.globalCompositeOperation = it.fctx.globalCompositeOperation = 'source-over';
    for (let i = 1; i <= steps; i++) {
      const x = a[0] + dx * i / steps,
        y = a[1] + dy * i / steps;
      const g = it.tctx.createRadialGradient(x, y, 0, x, y, r);
      g.addColorStop(0, 'rgba(255,255,255,0.9)');
      g.addColorStop(0.5, 'rgba(255,255,255,0.55)');
      g.addColorStop(1, 'rgba(255,255,255,0)');
      it.tctx.fillStyle = it.fctx.fillStyle = g;
      it.tctx.fillRect(x - r, y - r, r * 2, r * 2);
      it.fctx.fillRect(x - r, y - r, r * 2, r * 2);
    }
  }

  function kick() {
    if (destroyed || running) return;
    running = true;
    last = -1;
    rafId = requestAnimationFrame(frame);
  }

  function frame(now) {
    if (destroyed) return;
    // rAF timestamps can be older than performance.now() at kick: never let dt go negative
    const dt = last < 0 ? 1 / 60 : Math.min(0.05, Math.max(0, (now - last) / 1000));
    last = now;
    let any = false;
    items.forEach((it) => {
      if (!it.tex || !it.visible) return;
      if (!it.started) {
        it.started = true;
        it.el.appendChild(it.cv);
        it.intro = 0;
      }
      const o = it.o,
        tc = it.tctx;
      let busy = false;

      // Intro: the white dots fade in from black
      if (it.intro < 1) {
        it.intro = Math.min(1, it.intro + dt / DITHER_HOVER_INTRO);
        busy = true;
      }

      // The trail closes again
      if (it.energy > 0) {
        tc.globalCompositeOperation = 'destination-out';
        tc.fillStyle = 'rgba(0,0,0,' + Math.min(1, dt * 2.6 / o.life) + ')';
        tc.fillRect(0, 0, it.trail.width, it.trail.height);
        it.fctx.globalCompositeOperation = 'destination-out';
        it.fctx.fillStyle = 'rgba(0,0,0,' + Math.min(1, dt * 14) + ')';
        it.fctx.fillRect(0, 0, it.fresh.width, it.fresh.height);
        it.energy = Math.max(0, it.energy - dt / (o.life * 1.6));
        if (it.energy === 0) { // clear the 8-bit leftovers
          tc.clearRect(0, 0, it.trail.width, it.trail.height);
          it.fctx.clearRect(0, 0, it.fresh.width, it.fresh.height);
        }
        busy = true;
      }

      // New strokes while the pointer is over the item
      if (it.hover && it.mouse) {
        stroke(it, it.prev || it.mouse, it.mouse, dt);
        it.prev = it.mouse;
        it.energy = 1;
        busy = true;
      }

      if (!busy && !it.dirty) return;
      draw(it, now);
      it.dirty = false;
      any = any || busy;
    });
    if (any) rafId = requestAnimationFrame(frame);
    else running = false;
  }

  function draw(it, now) {
    const o = it.o,
      dpr = Math.min(devicePixelRatio || 1, 2);
    const W = Math.max(1, Math.round(it.el.clientWidth * dpr)),
      H = Math.max(1, Math.round(it.el.clientHeight * dpr));
    if (it.cv.width !== W || it.cv.height !== H) {
      it.cv.width = W;
      it.cv.height = H;
    }
    if (glc.width !== W || glc.height !== H) {
      glc.width = W;
      glc.height = H;
    }
    gl.viewport(0, 0, W, H);
    gl.activeTexture(gl.TEXTURE0);
    gl.bindTexture(gl.TEXTURE_2D, it.tex);
    gl.activeTexture(gl.TEXTURE1);
    gl.bindTexture(gl.TEXTURE_2D, it.ttex);
    gl.texImage2D(gl.TEXTURE_2D, 0, gl.RGBA, gl.RGBA, gl.UNSIGNED_BYTE, it.trail);
    gl.activeTexture(gl.TEXTURE2);
    gl.bindTexture(gl.TEXTURE_2D, it.ftex);
    gl.texImage2D(gl.TEXTURE_2D, 0, gl.RGBA, gl.RGBA, gl.UNSIGNED_BYTE, it.fresh);
    gl.uniform2f(L.uRes, W, H);
    gl.uniform2f(L.uImg, it.iw, it.ih);
    gl.uniform1f(L.uTime, now / 1000);
    gl.uniform1f(L.uGhost, o.ghost * it.intro * it.intro * (3 - 2 * it.intro));
    gl.uniform1f(L.uPx, Math.max(1, Math.round(o.pixel)));
    gl.uniform1f(L.uAccOn, o.accOn ? 1 : 0);
    gl.uniform3fv(L.uBg, o.bg);
    gl.uniform3fv(L.uDot, o.dot);
    gl.uniform3fv(L.uAcc, o.accent);
    gl.drawArrays(gl.TRIANGLES, 0, 3);
    it.ctx.clearRect(0, 0, W, H);
    it.ctx.drawImage(glc, 0, 0);
  }

  function scan(root) {
    root.querySelectorAll('[data-dither]').forEach(setup);
  }
  scan(page);

  // CMS pagination / "load more" (e.g. Finsweet) adds items later. Watch this container only:
  // on document.body it would also catch the next Barba container and bind it to this page
  const mo = new MutationObserver((mutations) => {
    mutations.forEach((m) => {
      m.addedNodes.forEach((n) => {
        if (n.nodeType !== 1) return;
        if (n.matches('[data-dither]')) setup(n);
        scan(n);
      });
    });
  });
  mo.observe(page, { childList: true, subtree: true });

  onPageLeave(() => {
    destroyed = true;
    running = false;
    cancelAnimationFrame(rafId);
    controller.abort();
    io.disconnect();
    ro.disconnect();
    mo.disconnect();
    // The WebGL context is shared and outlives the page: free this page's textures
    items.forEach((it) => {
      if (it.tex) gl.deleteTexture(it.tex);
      gl.deleteTexture(it.ttex);
      gl.deleteTexture(it.ftex);
      it.el.__dither = null;
    });
    items.length = 0;
  });
}

// -----------------------------------------
// PROFILE: PORTRAIT ([data-portrait])
// -----------------------------------------
// Nicola's photo on The Profile, played back off a worn VHS tape and seen through a depth
// window, the Lab's effect: the picture sits in a shallow box shaped by its depth map, and the
// view leans with the pointer over it, so the background slides behind the head and shoulders
// while the face holds. With no pointer on it, the view drifts a little by itself.
// Markup: [data-portrait] (the box under its window bar) holds the Webflow <img>, shown until the
// first WebGL frame and whenever WebGL can't run; data-portrait-depth on the box = the depth
// map URL (grayscale, near = white, same framing as the photo).
// Raw WebGL 1, two passes on one canvas: the depth window into a texture, then the tape over it
// (chroma split, line jitter, scanlines, grain, gamma). It draws PORTRAIT.fps times a second,
// only while the box is on screen and the tab visible; with reduced motion, only when the
// pointer moves, and the tape holds still.

const PORTRAIT = {
  // "Nineties VHS", the values from the design panel, as 0..1: chromatic 16%, grain 10,
  // jitter 15, scan 50, gamma 14, colour mode blue/red, mix 100, speed 50
  vhs: { chroma: 0.16, grain: 0.1, jitter: 0.15, scan: 0.5, gamma: 0.14, mix: 1, speed: 0.5 },
  depth: {
    amount: 0.075, // depth of the box, in picture widths, at a full lean
    focus: 0.6, // the depth that holds still (0 far .. 1 near): about the face
    margin: 0.045, // the photo is zoomed in this much per side, so a lean never shows its edge
    ease: 0.06, // pointer follow, share of the way per 60 Hz frame
    sway: 0.22, // idle drift, as a share of a full lean
  },
  tape: 0.42, // depth-window texels per CSS pixel: the tape's softness
  fps: 30,
  maxDpr: 2,
};

const PORTRAIT_VERT =
  `attribute vec2 aPos;varying vec2 vUv;void main(){vUv=aPos*.5+.5;gl_Position=vec4(aPos,0.,1.);}`;
const PORTRAIT_PRECISION =
  "#ifdef GL_FRAGMENT_PRECISION_HIGH\nprecision highp float;\n#else\nprecision mediump float;\n#endif\n";

// Pass 1, the depth window: each pixel marches its view ray down into the box until it meets
// the surface (depth map: near = at the glass), then a few halvings land on it. The depth that
// holds still (uFocus) sits at the glass's rest position, so near parts lean against the view
// and far parts with it
const PORTRAIT_DEPTH = PORTRAIT_PRECISION + `varying vec2 vUv;
uniform sampler2D uMap,uDepth;
uniform vec4 uCrop;
uniform vec2 uLean;
uniform float uAmt,uFocus;
vec2 photo(vec2 uv){return clamp(uCrop.xy+uv*uCrop.zw,0.,1.);}
float floorAt(vec2 uv){return(1.-texture2D(uDepth,photo(uv)).r)*uAmt;}
void main(){
  float hf=(1.-uFocus)*uAmt;
  float dt=uAmt/24.;
  float t=0.,tp=0.;
  for(int i=0;i<24;i++){
    if(t>=floorAt(vUv+uLean*(t-hf)))break;
    tp=t;
    t+=dt;
  }
  for(int j=0;j<5;j++){
    float tm=(tp+t)*.5;
    if(tm>=floorAt(vUv+uLean*(tm-hf)))t=tm;else tp=tm;
  }
  gl_FragColor=vec4(texture2D(uMap,photo(vUv+uLean*(t-hf))).rgb,1.);
}`;

// Pass 2, the tape. The depth window comes in at tape resolution (PORTRAIT.tape CSS px per
// texel, upscaled soft). Lines slide a little every frame and a slow band rolls up the picture
// and tears more; luma goes soft and colour smears sideways the way VHS carries it; red and
// blue part ways; then the tape's tone (darker mids and blacks, whites to paper white, so richer
// colour),
// faint scanlines and grain that is mostly colour. Sizes are in CSS pixels (uCss = the box in
// CSS px, uPx = device pixels per CSS pixel), so the tape reads the same on any screen.
// vhs() is the taped colour at vUv; the TV adds its dither change after it
const PORTRAIT_TAPE_GLSL = `uniform sampler2D uFrame;
uniform vec2 uCss;
uniform float uTime,uPx,uChroma,uGrain,uJitter,uScan,uGamma,uMix;
float hash(vec2 p){return fract(sin(mod(dot(p,vec2(12.9898,78.233)),6.2831853))*43758.5453);}
vec3 yiq(vec3 c){return vec3(dot(c,vec3(.299,.587,.114)),dot(c,vec3(.596,-.274,-.322)),dot(c,vec3(.211,-.523,.312)));}
vec3 rgb(vec3 c){return vec3(c.x+.956*c.y+.621*c.z,c.x-.272*c.y-.647*c.z,c.x-1.106*c.y+1.703*c.z);}
vec3 tape(vec2 uv){
  vec2 d=vec2(2./uCss.x,0.);
  vec3 c0=yiq(texture2D(uFrame,uv).rgb);
  vec3 c1=yiq(texture2D(uFrame,uv-d).rgb)+yiq(texture2D(uFrame,uv+d).rgb);
  vec3 c2=yiq(texture2D(uFrame,uv-2.*d).rgb)+yiq(texture2D(uFrame,uv+2.*d).rgb);
  return vec3(c0.x*.6+c1.x*.2,(c0.yz+c1.yz+c2.yz)*.2);
}
vec3 vhs(){
  vec2 uv=vUv;
  float frame=floor(uTime*24.);
  vec2 css=gl_FragCoord.xy/uPx;
  float row=floor(css.y*.5);
  float roll=fract(uTime*.05);
  float band=exp(-pow((uv.y-roll)*26.,2.));
  uv.x+=((hash(vec2(row,frame))-.5)*.004+band*(hash(vec2(row*.37,frame+3.))-.25)*.03)*uJitter;
  vec2 ca=vec2(uChroma*14./uCss.x,0.);
  vec3 clean=texture2D(uFrame,vUv).rgb;
  vec3 mid=tape(uv);
  vec3 col=vec3(rgb(tape(uv+ca)).r,rgb(mid).g,rgb(tape(uv-ca)).b);
  col=clamp((pow(clamp(col,0.,1.),vec3(1.+uGamma*1.4))-.02)/.92,0.,1.);
  vec3 q=yiq(col);
  vec2 cell=floor(css/1.5);
  q.x+=(hash(cell+frame*1.7)-.5)*uGrain;
  q.yz+=(vec2(hash(cell+vec2(31.1,7.3)+frame*2.3),hash(cell+vec2(77.7,19.9)+frame*1.1))-.5)*uGrain*2.;
  col=rgb(q);
  col*=1.-uScan*.05*(.5+.5*cos(css.y*3.14159265));
  return clamp(mix(clean,col,uMix),0.,1.);
}`;
const PORTRAIT_TAPE = PORTRAIT_PRECISION + `varying vec2 vUv;
${PORTRAIT_TAPE_GLSL}
void main(){gl_FragColor=vec4(vhs(),1.);}`;

// WebGL 1 on a canvas, with what both Profile screens need (the portrait and the TV): a program
// builder (uniform locations by name), a uniform setter, linear textures, a frame texture to
// draw into, and the tape pass from that frame onto the canvas. Null when WebGL is not there
function profileGl(canvas, label) {
  const gl = canvas.getContext("webgl", { alpha: false, antialias: false, depth: false,
    stencil: false, preserveDrawingBuffer: false, powerPreference: "low-power" });
  if (!gl) return null;

  function program(fs) {
    const p = gl.createProgram();
    [
      [gl.VERTEX_SHADER, PORTRAIT_VERT],
      [gl.FRAGMENT_SHADER, fs]
    ].forEach(([type, code]) => {
      const s = gl.createShader(type);
      gl.shaderSource(s, code);
      gl.compileShader(s);
      gl.attachShader(p, s);
    });
    gl.bindAttribLocation(p, 0, "aPos");
    gl.linkProgram(p);
    if (!gl.getProgramParameter(p, gl.LINK_STATUS)) throw new Error(`${label} shader: ` + gl
      .getProgramInfoLog(p));
    const u = {};
    for (let i = 0, n = gl.getProgramParameter(p, gl.ACTIVE_UNIFORMS); i < n; i++) {
      const info = gl.getActiveUniform(p, i);
      u[info.name] = gl.getUniformLocation(p, info.name);
    }
    return { p, u };
  }

  function set(prog, values) {
    for (const name in values) {
      const loc = prog.u[name],
        v = values[name];
      if (loc == null) continue;
      if (typeof v === "number") gl.uniform1f(loc, v);
      else if (v.length === 2) gl.uniform2fv(loc, v);
      else gl.uniform4fv(loc, v);
    }
  }

  function texture(source) {
    const t = gl.createTexture();
    gl.bindTexture(gl.TEXTURE_2D, t);
    gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_MIN_FILTER, gl.LINEAR);
    gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_MAG_FILTER, gl.LINEAR);
    gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_WRAP_S, gl.CLAMP_TO_EDGE);
    gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_WRAP_T, gl.CLAMP_TO_EDGE);
    if (source) gl.texImage2D(gl.TEXTURE_2D, 0, gl.RGBA, gl.RGBA, gl.UNSIGNED_BYTE, source);
    return t;
  }
  gl.bindBuffer(gl.ARRAY_BUFFER, gl.createBuffer());
  gl.bufferData(gl.ARRAY_BUFFER, new Float32Array([-1, -1, 3, -1, -1, 3]), gl.STATIC_DRAW);
  gl.enableVertexAttribArray(0);
  gl.vertexAttribPointer(0, 2, gl.FLOAT, false, 0, 0);
  gl.pixelStorei(gl.UNPACK_FLIP_Y_WEBGL, true);

  // The frame texture, sized on demand: bind(w, h) makes it the target of the next draw
  const frameTex = texture(null),
    fbo = gl.createFramebuffer();
  let fw = 0,
    fh = 0;

  function bindFrame(w, h) {
    if (fw !== w || fh !== h) {
      fw = w;
      fh = h;
      gl.bindTexture(gl.TEXTURE_2D, frameTex);
      gl.texImage2D(gl.TEXTURE_2D, 0, gl.RGBA, fw, fh, 0, gl.RGBA, gl.UNSIGNED_BYTE, null);
      gl.bindFramebuffer(gl.FRAMEBUFFER, fbo);
      gl.framebufferTexture2D(gl.FRAMEBUFFER, gl.COLOR_ATTACHMENT0, gl.TEXTURE_2D, frameTex, 0);
    }
    gl.bindFramebuffer(gl.FRAMEBUFFER, fbo);
    gl.viewport(0, 0, fw, fh);
  }
  // The frame (unit 0) through the tape onto the canvas. css: the box in CSS px; prog: a program
  // built on PORTRAIT_TAPE_GLSL instead of the plain tape, values: its own uniforms
  let tapePass = null;

  function tape(time, css, prog, values) {
    const V = PORTRAIT.vhs;
    if (!prog) prog = tapePass || (tapePass = program(PORTRAIT_TAPE));
    gl.bindFramebuffer(gl.FRAMEBUFFER, null);
    gl.viewport(0, 0, canvas.width, canvas.height);
    gl.useProgram(prog.p);
    gl.activeTexture(gl.TEXTURE0);
    gl.bindTexture(gl.TEXTURE_2D, frameTex);
    set(prog, { uCss: css, uTime: time * V.speed * 2, uPx: canvas.width / css[0], uChroma: V.chroma,
        uGrain: V.grain, uJitter: V.jitter, uScan: V.scan, uGamma: V.gamma, uMix: V.mix, ...
        values });
    gl.drawArrays(gl.TRIANGLES, 0, 3);
  }

  function lose() { const ext = gl.getExtension("WEBGL_lose_context"); if (ext) ext.loseContext(); }
  return { gl, program, set, texture, bindFrame, tape, lose };
}

// The portrait's two passes on one canvas; null when WebGL is not there
function portraitRenderer(canvas) {
  const k = profileGl(canvas, "portrait");
  if (!k) return null;
  const gl = k.gl,
    depthPass = k.program(PORTRAIT_DEPTH);
  let mapTex = null,
    depthTex = null;

  return {
    // The photo and its depth map, decoded images
    load(photo, depth) {
      mapTex = k.texture(photo);
      depthTex = k.texture(depth);
    },
    // crop: canvas uv → photo uv; lean: the view, -1..1 each way; css: the box in CSS px
    render(crop, lean, time, css) {
      if (!mapTex || !canvas.width || !canvas.height) return;
      const D = PORTRAIT.depth;
      k.bindFrame(Math.max(2, Math.round(css[0] * PORTRAIT.tape)), Math.max(2, Math.round(css[1] *
        PORTRAIT.tape)));
      gl.useProgram(depthPass.p);
      gl.activeTexture(gl.TEXTURE1);
      gl.bindTexture(gl.TEXTURE_2D, depthTex);
      gl.activeTexture(gl.TEXTURE0);
      gl.bindTexture(gl.TEXTURE_2D, mapTex);
      gl.uniform1i(depthPass.u.uMap, 0);
      gl.uniform1i(depthPass.u.uDepth, 1);
      k.set(depthPass, { uCrop: crop, uLean: lean, uAmt: D.amount, uFocus: D.focus });
      gl.drawArrays(gl.TRIANGLES, 0, 3);
      k.tape(time, css);
    },
    lose: k.lose,
  };
}

// An image for WebGL: CORS, decoded
function profileImage(url) {
  return new Promise((resolve, reject) => {
    const img = new Image();
    img.crossOrigin = "anonymous";
    img.decoding = "async";
    img.onload = () => (img.decode ? img.decode().catch(() => {}) : Promise.resolve()).then(
    () => resolve(img));
    img.onerror = () => reject(new Error(`${url} didn't load`));
    img.src = url;
  });
}

function initProfilePortrait() {
  nextPage.querySelectorAll("[data-portrait]").forEach((box) => {
    const img = box.querySelector("img");
    const depthUrl = box.getAttribute("data-portrait-depth");
    const photoUrl = img && (img.getAttribute("src") || img.currentSrc);
    if (!photoUrl || !depthUrl) return;

    const canvas = document.createElement("canvas");
    canvas.className = "pf__gl";
    canvas.setAttribute("aria-hidden", "true");
    box.append(canvas);

    const controller = new AbortController();
    const { signal } = controller;
    const still = reducedMotion;
    const D = PORTRAIT.depth;
    let renderer = null,
      left = false,
      onScreen = false,
      raf = 0,
      last = 0,
      drawn = false;
    let aspect = 0.8; // the photo's width / height
    let pointer = null; // [-1..1, -1..1] over the box, null when away
    const lean = [0, 0];
    let restore = null; // rebuilds the renderer after a lost context

    // The photo covers the box, zoomed in by the margin: uv on the canvas → uv on the photo
    function crop() {
      const ba = canvas.width / canvas.height || 1;
      let sx = 1,
        sy = 1;
      if (aspect > ba) sx = ba / aspect;
      else sy = aspect / ba;
      sx *= 1 - 2 * D.margin;
      sy *= 1 - 2 * D.margin;
      return [(1 - sx) / 2, (1 - sy) / 2, sx, sy];
    }

    function resize() {
      const rect = box.getBoundingClientRect(),
        dpr = Math.min(window.devicePixelRatio || 1, PORTRAIT.maxDpr);
      const w = Math.max(1, Math.round(rect.width * dpr)),
        h = Math.max(1, Math.round(rect.height * dpr));
      if (canvas.width !== w || canvas.height !== h) { canvas.width = w;
        canvas.height = h;
        draw(performance.now()); }
    }

    function draw(t) {
      if (!renderer) return;
      const rect = box.getBoundingClientRect();
      renderer.render(crop(), lean, still ? 0 : t / 1000, [rect.width || 1, rect.height || 1]);
      if (!drawn) { drawn = true;
        box.classList.add("is-gl"); }
    }
    // Lean towards the pointer; away from it, a slow drift (none with reduced motion)
    function step(t, dt) {
      let tx = 0,
        ty = 0;
      if (pointer) {
        [tx, ty] = pointer; }
      else if (!still) { tx = Math.sin(t / 2300) * D.sway;
        ty = Math.sin(t / 3100 + 1.3) * D.sway * 0.6; }
      const k = 1 - Math.pow(1 - D.ease, dt / 16.67);
      lean[0] += (tx - lean[0]) * k;
      lean[1] += (ty - lean[1]) * k;
      return Math.abs(tx - lean[0]) + Math.abs(ty - lean[1]) > 0.002;
    }

    function wake() {
      if (raf || !renderer || !onScreen || document.hidden || left) return;
      raf = requestAnimationFrame(loop);
    }

    function stopLoop() { if (raf) cancelAnimationFrame(raf);
      raf = 0; }

    function loop(t) {
      raf = 0;
      if (!renderer || !onScreen || document.hidden || left) return;
      const dt = last ? Math.min(100, t - last) : 16.67;
      if (t - last < 1000 / PORTRAIT.fps - 3) { raf = requestAnimationFrame(loop); return; }
      last = t;
      const moving = step(t, dt);
      draw(t);
      // Reduced motion: frames only while the view is still easing
      if (!still || moving) raf = requestAnimationFrame(loop);
    }

    box.addEventListener("pointermove", (e) => {
      const r = box.getBoundingClientRect();
      pointer = [((e.clientX - r.left) / r.width) * 2 - 1, 1 - ((e.clientY - r.top) / r
        .height) * 2];
      wake();
    }, { signal });
    box.addEventListener("pointerleave", () => { pointer = null;
      wake(); }, { signal });

    const ro = new ResizeObserver(resize);
    const io = new IntersectionObserver((entries) => {
      onScreen = entries[entries.length - 1].isIntersecting;
      if (onScreen) wake();
      else stopLoop();
    });
    document.addEventListener("visibilitychange", () => { if (document.hidden) stopLoop();
      else wake(); }, { signal });
    canvas.addEventListener("webglcontextlost", (e) => {
      e.preventDefault();
      stopLoop();
      renderer = null;
      drawn = false;
      box.classList.remove("is-gl");
    }, { signal });

    const ready = Promise.all([profileImage(photoUrl), profileImage(depthUrl)]).then(([photo,
      depth
    ]) => {
      if (left) return;
      aspect = photo.naturalWidth / photo.naturalHeight || aspect;
      try { renderer = portraitRenderer(canvas); } catch (e) { renderer = null; }
      if (!renderer) return;
      renderer.load(photo, depth);
      restore = () => {
        try { renderer = portraitRenderer(canvas); } catch (e) { renderer = null; }
        if (renderer) { renderer.load(photo, depth);
          resize();
          draw(performance.now());
          wake(); }
      };
      ro.observe(box);
      io.observe(box);
      resize();
      draw(performance.now());
    }).catch((err) => console.warn("[portrait]", err.message || err));
    canvas.addEventListener("webglcontextrestored", () => { if (restore && !left)
    restore(); }, { signal });
    holdIntro(ready);

    onPageLeave(() => {
      left = true;
      controller.abort();
      stopLoop();
      ro.disconnect();
      io.disconnect();
      // The last frame stays on screen while the page leaves, then the context goes
      const r = renderer;
      renderer = null;
      if (r) setTimeout(() => r.lose(), 1500);
    });
  });
}

// -----------------------------------------
// PROFILE: PROJECTS TV ([data-tv])
// -----------------------------------------
// The little screen next to the portrait on The Profile: an old TV tuned to the projects. Each
// channel is a project from the Works page (its cover, name and award), played off the same worn
// tape as the portrait. Channels change with the site's dither cloud, the one of the project
// slider and the Works preview. The pill holds three keys: previous project, the orb (pause /
// play the channel surfing), next project; the arrow keys change channel too while the TV has
// focus. A click on the screen opens the project on screen ([data-tv-link], Barba takes it).
// The channels come from the Works page itself (data-tv-source, default /work), read once per
// visit: each folder (a[data-works-folder]) gives the link, .wk__label the name, .wk__award the
// award and its <img> the cover. The first cover dithers in over the dark screen; if the Works
// page can't be read, the screen stays dark ("No signal") and the link goes to the Works page.
// The card is native Webflow elements and classes; the page's embed (pf__css) holds the state
// rules (data-state: tuning | on | nosignal, data-playing). Raw WebGL 1, two passes on one
// canvas: the covers at tape resolution, then the tape with the dither cloud over it. It draws
// TV.fps times a second, only while on screen and the tab visible. With reduced motion it waits
// for the orb before surfing, channels cut without the cloud and the tape holds still; without
// WebGL the covers show as a plain <img> (.pf__tv-still).

const TV = {
  hold: 4200, // ms on a channel while surfing
  change: 900, // ms, one dither change: the Works preview's (WORKS_PREVIEW.duration)
  dot: 1, // device px per dither dot, as on the Works preview
  fieldCell: 6, // CSS px per texel of the cloud's shape, as in the project slider
  tape: 0.85, // source texels per CSS pixel: sharper than the portrait, covers have detail
  coverWidth: 500, // px, the srcset candidate to load (covers without one load whole)
  coverHeight: 256, // px, covers are scaled down to this before they become textures
  fps: 24,
  maxDpr: 2,
};

// The TV's shaders, built when first needed: the dither GLSL is declared further down
// Pass 1, at tape resolution: the cover before the cloud (A) and after it (B), each cropped to
// fill the screen
const tvSourceShader = () => PORTRAIT_PRECISION + `varying vec2 vUv;
uniform sampler2D uA,uB,uField;
uniform vec4 uCropA,uCropB;
uniform float uProgress;
${DITHER_CLOUD_GLSL}
void main(){
  float useB=ditherCloud(texture2D(uField,vUv),uProgress).y;
  vec3 a=texture2D(uA,clamp(uCropA.xy+vUv*uCropA.zw,0.,1.)).rgb;
  vec3 b=texture2D(uB,clamp(uCropB.xy+vUv*uCropB.zw,0.,1.)).rgb;
  gl_FragColor=vec4(mix(a,b,useB),1.);
}`;
// Pass 2, at screen resolution: the tape over pass 1, then the cloud. Inside it the picture
// turns into the project slider's 1-bit black and white dither; its edge fades with a
// transposed Bayer, the +.06 leaves no stray dots behind
const tvPresentShader = () => PORTRAIT_PRECISION + `varying vec2 vUv;
${PORTRAIT_TAPE_GLSL}
uniform sampler2D uField;
uniform float uProgress,uDot;
${DITHER_BAYER_GLSL}
${DITHER_CLOUD_GLSL}
void main(){
  vec3 col=vhs();
  float density=ditherCloud(texture2D(uField,vUv),uProgress).x;
  vec2 cell=floor(gl_FragCoord.xy/uDot);
  if(bayer8(cell.yx+vec2(3.,5.))+.06>density){gl_FragColor=vec4(col,1.);return;}
  float lum=smoothstep(.12,.88,dot(col,vec3(.299,.587,.114)));
  gl_FragColor=vec4(vec3(step(bayer8(cell)+1./128.,lum)),1.);
}`;

// The TV's two passes on one canvas; null when WebGL is not there
function tvRenderer(canvas) {
  const k = profileGl(canvas, "tv");
  if (!k) return null;
  const gl = k.gl,
    source = k.program(tvSourceShader()),
    present = k.program(tvPresentShader());
  // Texture units: 0 cover A (then the frame), 1 cover B, 2 the cloud's field
  gl.useProgram(source.p);
  gl.uniform1i(source.u.uA, 0);
  gl.uniform1i(source.u.uB, 1);
  gl.uniform1i(source.u.uField, 2);
  gl.useProgram(present.p);
  gl.uniform1i(present.u.uFrame, 0);
  gl.uniform1i(present.u.uField, 2);
  const black = new Uint8Array([0, 0, 0, 255]);
  // The dark screen before the first cover; pass 1 must never sample the frame it draws into
  const blank = k.texture(null);
  gl.texImage2D(gl.TEXTURE_2D, 0, gl.RGBA, 1, 1, 0, gl.RGBA, gl.UNSIGNED_BYTE, black);
  const fieldTex = k.texture(null);
  gl.texImage2D(gl.TEXTURE_2D, 0, gl.RGBA, 1, 1, 0, gl.RGBA, gl.UNSIGNED_BYTE, black);
  const textures = new Map(); // cover canvas → its texture, made on first use
  const tex = (pic) => {
    if (!pic) return blank;
    if (!textures.has(pic)) textures.set(pic, k.texture(pic));
    return textures.get(pic);
  };

  return {
    // A new cloud for the next change, for a w × h screen (CSS px)
    field(w, h) {
      const f = ditherField(w, h, TV.fieldCell);
      gl.bindTexture(gl.TEXTURE_2D, fieldTex);
      gl.texImage2D(gl.TEXTURE_2D, 0, gl.RGBA, f.cols, f.rows, 0, gl.RGBA, gl.UNSIGNED_BYTE, f
      .data);
    },
    // a, b: { pic (a small canvas, or null for the dark screen), crop (screen uv → cover uv) };
    // progress: the change from a to b, 0..1; css: the screen in CSS px
    render(a, b, progress, time, css) {
      if (!canvas.width || !canvas.height) return;
      const texA = tex(a.pic),
        texB = tex(b.pic);
      k.bindFrame(Math.max(2, Math.round(css[0] * TV.tape)), Math.max(2, Math.round(css[1] * TV
        .tape)));
      gl.useProgram(source.p);
      gl.activeTexture(gl.TEXTURE2);
      gl.bindTexture(gl.TEXTURE_2D, fieldTex);
      gl.activeTexture(gl.TEXTURE1);
      gl.bindTexture(gl.TEXTURE_2D, texB);
      gl.activeTexture(gl.TEXTURE0);
      gl.bindTexture(gl.TEXTURE_2D, texA);
      k.set(source, { uCropA: a.crop, uCropB: b.crop, uProgress: progress });
      gl.drawArrays(gl.TRIANGLES, 0, 3);
      k.tape(time, css, present, { uProgress: progress, uDot: TV.dot });
    },
    lose: k.lose,
  };
}

// The Works page's projects, read once per visit (a failed read tries again next time)
let tvChannels = null;

function tvLoadChannels(url) {
  if (tvChannels) return tvChannels;
  const clean = (text) => (text || "").replace(/[​-‍﻿]/g, "").replace(/\s+/g, " ").trim();
  tvChannels = fetch(url, { credentials: "same-origin" })
    .then((res) => {
      if (!res.ok) throw new Error(`${url}: ${res.status}`);
      return res.text();
    })
    .then((html) => {
      const doc = new DOMParser().parseFromString(html, "text/html");
      const list = [...doc.querySelectorAll("a[data-works-folder]")]
        .map((folder) => ({
          href: folder.getAttribute("href") || "",
          name: clean(folder.querySelector(".wk__label")?.textContent),
          award: clean(folder.querySelector(".wk__award")?.textContent),
          src: worksCoverSrc(folder.querySelector("img"), TV.coverWidth),
          cover: worksCoverSrc(folder.querySelector("img"), PP
          .coverWidth), // the project page's next project
        }))
        .filter((channel) => channel.href && channel.name && channel.src);
      if (!list.length) throw new Error(`${url}: no projects`);
      return list;
    });
  tvChannels.catch(() => { tvChannels = null; });
  return tvChannels;
}

// A cover for the TV: the image, and a copy scaled down to TV.coverHeight for WebGL
function tvCover(url) {
  return profileImage(url).then((img) => {
    const aspect = img.naturalWidth / img.naturalHeight || 1.5;
    const h = Math.max(1, Math.min(TV.coverHeight, img.naturalHeight)),
      w = Math.max(1, Math.round(h * aspect));
    const pic = document.createElement("canvas");
    pic.width = w;
    pic.height = h;
    const g = pic.getContext("2d");
    g.imageSmoothingQuality = "high";
    g.drawImage(img, 0, 0, w, h);
    return { pic, aspect, url };
  });
}

function initProfileTv() {
  nextPage.querySelectorAll("[data-tv]").forEach((root) => {
    const screen = root.querySelector("[data-tv-screen]");
    if (!screen) return;
    const link = root.querySelector("[data-tv-link]");
    const keys = {};
    root.querySelectorAll("[data-tv-key]").forEach((key) => { keys[key.dataset.tvKey] = key; });
    const osd = { ch: root.querySelector("[data-tv-ch]"), name: root.querySelector(
        "[data-tv-name]"), award: root.querySelector("[data-tv-award]") };
    const status = root.querySelector("[data-tv-status]");
    const sourceUrl = root.getAttribute("data-tv-source") || "/work";
    const controller = new AbortController();
    const { signal } = controller;
    const still = reducedMotion;

    const canvas = document.createElement("canvas");
    canvas.className = "pf__tv-view";
    canvas.setAttribute("aria-hidden", "true");
    screen.prepend(canvas);
    let renderer = null,
      plain = null; // plain: the <img> that shows covers without WebGL
    try { renderer = tvRenderer(canvas); } catch (e) { renderer = null; }

    // shown: the channel on screen (-1: none yet); target: the one wanted, the last key pressed.
    // A change already running finishes first, then the TV catches up, like the Works preview
    let channels = [],
      shown = -1,
      target = -1,
      dir = 1,
      change = null,
      announce = false,
      dead = false;
    let playing = !still,
      hovered = false,
      focused = false,
      timer = 0;
    let onScreen = false,
      left = false,
      raf = 0,
      last = 0;
    const covers = new Map(); // index → promise of the cover
    const ready = new Map(); // index → the cover, once in; null when it failed

    // ---- Text ----
    function say(text) {
      if (!status) return;
      status.textContent = "";
      requestAnimationFrame(() => { status.textContent = text; });
    }

    function setPlaying(on) {
      playing = on;
      root.dataset.playing = String(on);
      if (keys.play) keys.play.setAttribute("aria-label", on ? "Pause" : "Play");
      schedule();
    }

    function setKeys() {
      const many = channels.length > 1;
      ["prev", "next", "play"].forEach((name) => { if (keys[name]) keys[name].setAttribute(
          "aria-disabled", String(!many)); });
    }
    // The OSD and the link follow the channel as soon as its change starts
    function caption(i) {
      const channel = channels[i];
      if (osd.ch) osd.ch.textContent = `CH ${String(i + 1).padStart(2, "0")}`;
      if (osd.name) osd.name.textContent = channel.name;
      if (osd.award) osd.award.textContent = channel.award;
      if (link) {
        link.setAttribute("href", channel.href);
        link.setAttribute("aria-label", `Open project: ${channel.name}`);
      }
      root.dataset.state = "on";
      if (announce) say(`Channel ${i + 1} of ${channels.length}: ${channel.name}`);
      announce = false;
    }

    function noSignal() {
      dead = true;
      root.dataset.state = "nosignal";
      if (osd.ch) osd.ch.textContent = "CH --";
      if (osd.name) osd.name.textContent = "No signal";
      if (osd.award) osd.award.textContent = "";
    }

    // ---- Channels ----
    const wrap = (i) => (i + channels.length) % channels.length;

    function cover(i) {
      if (!covers.has(i)) {
        covers.set(i, tvCover(channels[i].src).then(
          (c) => { ready.set(i, c); return c; },
          () => { ready.set(i, null); return null; },
        ).then((c) => {
          if (i === target && !left) kick(); // the TV was waiting for it
          return c;
        }));
      }
      return covers.get(i);
    }
    // The next channel that has a cover (or may still get one), step by step
    function next(from, step) {
      let i = from;
      for (let n = 0; n < channels.length; n++) {
        i = wrap(i + step);
        if (ready.get(i) !== null) return i;
      }
      return -1;
    }

    function tune(step, manual) {
      if (channels.length < 2 || left || dead) return;
      const i = next(target, step);
      if (i < 0 || i === target) return;
      clearTimeout(timer);
      timer = 0;
      target = i;
      dir = step;
      announce = manual;
      cover(target);
      kick();
    }

    function setShown(i) {
      shown = i;
      if (plain) plain.src = ready.get(i).url;
      cover(wrap(i + 1)); // the next one is ready by the time it's needed
    }
    // Starts the change to the target once its cover is in; a failed cover is skipped, the
    // same way the TV was going
    function catchUp(t) {
      while (!change && !dead && target >= 0 && target !== shown) {
        const c = ready.get(target);
        if (c === undefined) return; // still loading: cover() kicks the loop when it's in
        if (c === null) {
          const i = next(target, dir);
          if (i < 0 || i === shown) { target = shown; if (shown < 0) noSignal(); return; }
          target = i;
          cover(target);
          continue;
        }
        caption(target);
        if (still || !renderer) { setShown(target);
          schedule(); return; }
        const rect = screen.getBoundingClientRect();
        renderer.field(rect.width || 1, rect.height || 1);
        change = { from: shown, to: target, start: t };
      }
    }
    // Surfing: the next channel after TV.hold, while playing and nobody is on the TV
    function schedule() {
      clearTimeout(timer);
      timer = 0;
      if (!playing || hovered || focused || !onScreen || document.hidden || left || change ||
        target !== shown || channels.length < 2) return;
      timer = setTimeout(() => { timer = 0;
        tune(1, false); }, TV.hold);
    }

    // ---- Drawing ----
    // A cover fills the screen (cover crop): uv on the screen → uv on the cover
    function crop(aspect) {
      const ba = canvas.width / canvas.height || 1;
      let sx = 1,
        sy = 1;
      if (aspect > ba) sx = ba / aspect;
      else sy = aspect / ba;
      return [(1 - sx) / 2, (1 - sy) / 2, sx, sy];
    }
    const view = (i) => {
      const c = i >= 0 ? ready.get(i) : null;
      return c ? { pic: c.pic, crop: crop(c.aspect) } : { pic: null, crop: [0, 0, 1, 1] };
    };
    // One frame: the running change advances (and ends), then the next one may start
    function frame(t) {
      if (change && t - change.start >= TV.change) {
        setShown(change.to);
        change = null;
        schedule();
      }
      catchUp(t);
      draw(t);
    }

    function draw(t) {
      if (!renderer) return;
      const rect = screen.getBoundingClientRect();
      const a = view(change ? change.from : shown),
        b = change ? view(change.to) : a;
      const progress = change ? Math.min(1, Math.max(0, (t - change.start) / TV.change)) : 0;
      renderer.render(a, b, progress, still ? 0 : t / 1000, [rect.width || 1, rect.height ||
      1]);
    }
    // Runs while on screen; with reduced motion, without WebGL or with no signal, only until
    // the change on the way is done
    function kick() {
      if (raf || left || !onScreen || document.hidden) return;
      raf = requestAnimationFrame(loop);
    }

    function stopLoop() { if (raf) cancelAnimationFrame(raf);
      raf = 0; }

    function loop(t) {
      raf = 0;
      if (left || !onScreen || document.hidden) return;
      if (t - last < 1000 / TV.fps - 3) { raf = requestAnimationFrame(loop); return; }
      last = t;
      frame(t);
      if ((!still && renderer && !dead) || change) raf = requestAnimationFrame(loop);
    }

    function resize() {
      const rect = screen.getBoundingClientRect(),
        dpr = Math.min(window.devicePixelRatio || 1, TV.maxDpr);
      const w = Math.max(1, Math.round(rect.width * dpr)),
        h = Math.max(1, Math.round(rect.height * dpr));
      if (canvas.width !== w || canvas.height !== h) { canvas.width = w;
        canvas.height = h;
        draw(performance.now()); }
    }
    // Without WebGL (or while its context is lost): the covers as a plain <img>
    function usePlain(on) {
      root.classList.toggle("pf__tv--plain", on);
      if (on && !plain) {
        plain = document.createElement("img");
        plain.className = "pf__tv-still";
        plain.alt = "";
        plain.setAttribute("aria-hidden", "true");
        canvas.after(plain);
      }
      if (on && shown >= 0) plain.src = ready.get(shown).url;
    }
    if (!renderer) usePlain(true);

    // ---- Keys ----
    const actions = {
      play: () => setPlaying(!playing),
      prev: () => tune(-1, true),
      next: () => tune(1, true),
    };
    root.addEventListener("click", (event) => {
      const key = event.target.closest("[data-tv-key]");
      if (!key || !root.contains(key) || key.getAttribute("aria-disabled") === "true")
        return;
      const run = actions[key.dataset.tvKey];
      if (run) run();
    }, { signal });
    root.addEventListener("keydown", (event) => {
      if (event.key !== "ArrowLeft" && event.key !== "ArrowRight") return;
      if (event.altKey || event.metaKey || event.ctrlKey || event.shiftKey)
    return; // the browser's back / forward
      event.preventDefault();
      tune(event.key === "ArrowLeft" ? -1 : 1, true);
    }, { signal });
    // No surfing away from a channel being looked at: the pointer on the screen (not on the
    // pill, where the keys are) or the keyboard on its link
    screen.addEventListener("pointerenter", (event) => { if (event.pointerType ===
        "mouse") { hovered = true;
        schedule(); } }, { signal });
    screen.addEventListener("pointerleave", () => { hovered = false;
      schedule(); }, { signal });
    if (link) {
      link.addEventListener("focus", () => { focused = true;
        schedule(); }, { signal });
      link.addEventListener("blur", () => { focused = false;
        schedule(); }, { signal });
    }

    // ---- Lifecycle ----
    canvas.addEventListener("webglcontextlost", (event) => {
      event.preventDefault();
      stopLoop();
      renderer = null;
      usePlain(true);
      kick(); // a change on the way finishes on the plain <img>
    }, { signal });
    canvas.addEventListener("webglcontextrestored", () => {
      if (left) return;
      try { renderer = tvRenderer(canvas); } catch (e) { renderer = null; }
      if (renderer) { usePlain(false);
        resize();
        kick(); }
    }, { signal });
    const ro = new ResizeObserver(resize);
    ro.observe(screen);
    const io = new IntersectionObserver((entries) => {
      onScreen = entries[entries.length - 1].isIntersecting;
      if (onScreen) kick();
      else stopLoop();
      schedule();
    });
    io.observe(root);
    document.addEventListener("visibilitychange", () => {
      if (document.hidden) stopLoop();
      else kick();
      schedule();
    }, { signal });

    root.dataset.state = "tuning";
    setPlaying(playing);
    setKeys();
    resize();
    tvLoadChannels(sourceUrl).then((list) => {
      if (left) return;
      channels = list;
      target = 0;
      cover(0);
      setKeys();
      kick();
    }).catch((err) => {
      if (left) return;
      console.warn("[tv]", err.message || err);
      noSignal();
    });

    onPageLeave(() => {
      left = true;
      controller.abort();
      stopLoop();
      clearTimeout(timer);
      ro.disconnect();
      io.disconnect();
      // The last frame stays on screen while the page leaves, then the context goes
      const r = renderer;
      renderer = null;
      if (r) setTimeout(() => r.lose(), 1500);
    });
  });
}

// -----------------------------------------
// PROJECT TEMPLATE: DITHER SLIDER (#slider[data-images], #next, #prev)
// -----------------------------------------

// Ordered dither thresholds (Bayer matrices), shared by every dither shader: the project
// slider and the home statement. bayerN(cell) returns a threshold in [0, 1)
const DITHER_BAYER_GLSL = `
  // Bayer matrices (ordered dither)
  float bayer2(vec2 a) { a = floor(a); return fract(a.x * 0.5 + a.y * a.y * 0.75); }
  float bayer4(vec2 a) { return bayer2(0.5 * a) * 0.25 + bayer2(a); }
  float bayer8(vec2 a) { return bayer4(0.5 * a) * 0.25 + bayer2(a); }
`;

// The dither cloud of every image change (the project slider, the Works preview, the Profile
// TV). Its field (ditherField) holds when the cloud passes each point (r, 0 → 1) and its
// turbulence (g, b); at progress 0..1, ditherCloud gives the cloud's density at that point (x)
// and 1 where it has passed and the new image is already there (y)
const DITHER_CLOUD_GLSL = `
  const float CORE = 0.16;    // solid part of the cloud
  const float EDGE = 0.07;    // soft edge (short: no halo of dots left behind)
  const float BOIL = 0.12;    // turbulence
  const float MARGIN = 0.31;  // CORE + EDGE + turbulence: the cloud starts and ends fully off-screen

  vec2 ditherCloud(vec4 f, float progress) {
    float front = mix(-MARGIN, 1.0 + MARGIN, progress);
    float boil = mix(f.g, f.b, progress) - 0.5;
    float dist = abs(f.r - front + boil * BOIL);
    return vec2(1.0 - smoothstep(CORE, CORE + EDGE, dist), step(f.r, front));
  }
`;

const DITHER_SLIDER_VERTEX = `
  varying vec2 vUv;
  void main() {
    vUv = uv;
    gl_Position = projectionMatrix * modelViewMatrix * vec4(position, 1.0);
  }
`;

const DITHER_SLIDER_FRAGMENT = `
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
${DITHER_CLOUD_GLSL}
  vec2 coverUV(vec2 uv, vec2 imgRes) {
    float rs = (resolution.x / resolution.y) / (imgRes.x / imgRes.y);
    vec2 s = rs > 1.0 ? vec2(1.0, 1.0 / rs) : vec2(rs, 1.0);
    return (uv - 0.5) * s + 0.5;
  }

  float luma(vec3 c) { return dot(c, vec3(0.299, 0.587, 0.114)); }
${DITHER_BAYER_GLSL}
  vec3 image(vec2 uv, float useB) {
    return useB > 0.5
      ? texture2D(texture2, coverUV(uv, res2)).rgb
      : texture2D(texture1, coverUV(uv, res1)).rgb;
  }

  void main() {
    // Cloud field (interpolated, soft edges)
    vec2 cloud = ditherCloud(texture2D(fieldMap, vUv), progress);
    float density = cloud.x;

    // Behind the cloud the new image is already there
    float useB = cloud.y;
    vec3 clean = image(vUv, useB);

    // Dither grid in display pixels
    vec2 cell = floor(gl_FragCoord.xy / ditherSize);

    // Cloud edge faded with a transposed Bayer (it does not line up with the image dither).
    // The +0.06 cuts the tail: below that density no isolated dot is left
    if (bayer8(cell.yx + vec2(3.0, 5.0)) + 0.06 > density) {
      gl_FragColor = vec4(clean, 1.0);
      return;
    }

    // Inside the cloud: 1-bit black and white dither
    vec2 cellUv = (cell + 0.5) * ditherSize / (resolution * pixelRatio);
    float lum = smoothstep(0.12, 0.88, luma(image(cellUv, useB)));
    gl_FragColor = vec4(vec3(step(bayer8(cell) + 1.0 / 128.0, lum)), 1.0);
  }
`;

// Noise for the cloud field (computed once per transition, not per pixel)
function createNoise(seed) {
  const hash = (x, y) => {
    const s = Math.sin(x * 127.1 + y * 311.7 + seed * 74.7) * 43758.5453;
    return s - Math.floor(s);
  };
  const smooth = (t) => t * t * (3 - 2 * t);
  const noise = (x, y) => {
    const xi = Math.floor(x),
      yi = Math.floor(y);
    const xf = smooth(x - xi),
      yf = smooth(y - yi);
    const a = hash(xi, yi),
      b = hash(xi + 1, yi);
    const c = hash(xi, yi + 1),
      d = hash(xi + 1, yi + 1);
    return (a + (b - a) * xf) + ((c + (d - c) * xf) - (a + (b - a) * xf)) * yf;
  };
  const fbm = (x, y) => {
    let v = 0,
      amp = 0.5;
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

// The cloud's shape on a coarse grid (cell CSS px per texel) for a w × h box, RGBA bytes:
// r = when the cloud passes (equalized: every area gets its own moment, no patches vanishing
// all at once), g/b = turbulence. A new shape for every change
function ditherField(w, h, cell) {
  const cols = Math.max(1, Math.ceil(w / cell));
  const rows = Math.max(1, Math.ceil(h / cell));
  const scale = (cell / Math.max(1, h)) * 2.5;
  const { noise, fbm } = createNoise(Math.random() * 100);
  const count = cols * rows;
  const raw = new Float32Array(count);
  const data = new Uint8Array(count * 4);

  for (let y = 0; y < rows; y++) {
    for (let x = 0; x < cols; x++) {
      const i = y * cols + x;
      raw[i] = fbm((x + 0.5) * scale, (y + 0.5) * scale);
      data[i * 4 + 1] = noise(x / cols * 6, y / rows * 6) * 255;
      data[i * 4 + 2] = noise(x / cols * 6 + 40, y / rows * 6 + 40) * 255;
      data[i * 4 + 3] = 255;
    }
  }
  const order = Array.from(raw.keys()).sort((a, b) => raw[a] - raw[b]);
  order.forEach((cellIndex, rank) => {
    data[cellIndex * 4] = Math.round((rank / Math.max(1, count - 1)) * 255);
  });
  return { data, cols, rows };
}

// Animated GIFs in the slider. WebGL (like a 2D canvas) only ever takes the first frame of
// a GIF: ImageDecoder decodes every frame, each one is drawn into a canvas the texture reads.
// Without ImageDecoder (Safari before 26) the GIF stays on its first frame
const isGifUrl = (url) => /\.gif(?:$|[?#])/i.test(url);

class GifTexture {
  // null when the browser can't decode it this way or it has one frame only:
  // the regular texture loader takes over
  static async load(url) {
    if (typeof ImageDecoder === 'undefined') return null;
    const response = await fetch(url);
    if (!response.ok) return null;
    const type = response.headers.get('content-type') || 'image/gif';
    if (!(await ImageDecoder.isTypeSupported(type))) return null;

    const decoder = new ImageDecoder({ data: await response.arrayBuffer(), type });
    try {
      await Promise.all([decoder.completed, decoder.tracks.ready]);
      const frameCount = decoder.tracks.selectedTrack?.frameCount || 0;
      if (frameCount < 2) {
        decoder.close();
        return null;
      }
      const { image } = await decoder.decode({ frameIndex: 0 });
      return new GifTexture(decoder, frameCount, image);
    } catch (e) {
      decoder.close();
      throw e;
    }
  }

  constructor(decoder, frameCount, first) {
    this.decoder = decoder;
    this.frameCount = frameCount;
    this.decoded = 0; // index of the last decoded frame
    this.next = null; // decoded frame waiting for its turn
    this.decoding = false;
    this.stopped = false;
    this.closed = false;

    this.canvas = document.createElement('canvas');
    this.canvas.width = first.displayWidth;
    this.canvas.height = first.displayHeight;
    this.ctx = this.canvas.getContext('2d');
    this.texture = new THREE.CanvasTexture(this.canvas);
    this.texture.minFilter = THREE.LinearFilter;
    this.texture.generateMipmaps = false;
    this.draw(first, performance.now());
  }

  draw(frame, start) {
    const { width, height } = this.canvas;
    this.ctx.clearRect(0, 0, width, height);
    this.ctx.drawImage(frame, 0, 0, width, height);
    // Duration in µs. Like every browser, delays of 10ms or less play at 100ms
    this.dueAt = start + (frame.duration > 10000 ? frame.duration / 1000 : 100);
    frame.close();
    this.texture.needsUpdate = true;
  }

  // Called every tick while the slider shows this image: true when a new frame was drawn.
  // Nothing is decoded while it's hidden, the GIF resumes where it stopped
  update(now) {
    if (this.stopped) return false;
    if (!this.next) {
      if (!this.decoding) this.decodeNext();
      return false;
    }
    if (now < this.dueAt) return false;

    const frame = this.next;
    this.next = null;
    // Back after a pause: restart the timing instead of rushing through the frames
    this.draw(frame, now - this.dueAt > 250 ? now : this.dueAt);
    this.decodeNext();
    return true;
  }

  // One frame ahead, so it's ready when its turn comes
  decodeNext() {
    this.decoding = true;
    const frameIndex = (this.decoded + 1) % this.frameCount;
    this.decoder.decode({ frameIndex }).then(({ image }) => {
      this.decoding = false;
      if (this.closed) return image.close();
      this.decoded = frameIndex;
      this.next = image;
    }).catch(() => {
      // Corrupt frame or closed decoder: stay on the current frame
      this.decoding = false;
      this.stopped = true;
    });
  }

  destroy() {
    if (this.closed) return;
    this.closed = this.stopped = true;
    this.next?.close();
    this.next = null;
    this.decoder.close();
  }
}

// Video slides: a muted, looping, inline <video> is the texture. Like an image it needs CORS
// headers from its host (jsDelivr sends them). It plays only while it's on screen, as GIFs do
const isVideoUrl = (url) => typeof url === 'string' && /\.(?:mp4|webm|mov|m4v)(?:$|[?#])/i.test(
url);

class VideoSlide {
  // null when it can't play (broken URL, no CORS, unsupported format, autoplay blocked):
  // the slide falls back to its image
  static load(url, parent) {
    return new Promise((resolve) => {
      const video = document.createElement('video');
      video.crossOrigin = 'anonymous';
      video.muted = video.defaultMuted = true;
      video.loop = true;
      video.playsInline = true;
      video.preload = 'auto';
      // iOS reads the attributes, not only the properties
      video.setAttribute('muted', '');
      video.setAttribute('playsinline', '');
      video.setAttribute('aria-hidden', 'true');
      // In the page but invisible: iOS pauses muted videos that aren't (opacity doesn't count)
      Object.assign(video.style, {
        position: 'absolute',
        top: '0',
        left: '0',
        width: '2px',
        height: '2px',
        opacity: '0',
        pointerEvents: 'none'
      });
      parent.appendChild(video);

      let settled = false;
      const settle = (ok) => {
        if (settled) return;
        settled = true;
        clearTimeout(timer);
        if (ok) {
          video.pause(); // the slider decides when it plays
          resolve(new VideoSlide(video));
          return;
        }
        video.removeAttribute('src');
        video.load();
        video.remove();
        resolve(null);
      };
      const timer = setTimeout(() => settle(false), 10000);
      video.addEventListener('loadeddata', () => settle(true), { once: true });
      video.addEventListener('error', () => settle(false), { once: true });
      video.src = url;
      // iOS loads nothing until play(). Blocked (Low Power Mode, autoplay off): use the image
      video.play()?.catch((e) => {
        if (e.name === 'NotAllowedError') settle(false);
      });
    });
  }

  constructor(video) {
    this.video = video;
    this.playing = false;
    this.closed = false;
    this.fresh = false; // a new video frame since the last update
    this.texture = new THREE.Texture(video);
    this.texture.minFilter = THREE.LinearFilter;
    this.texture.magFilter = THREE.LinearFilter;
    this.texture.generateMipmaps = false;
    this.texture.needsUpdate = true;
    this.frameCallback = 'requestVideoFrameCallback' in video;
    if (this.frameCallback) this.watchFrames();
  }

  watchFrames() {
    this.video.requestVideoFrameCallback(() => {
      if (this.closed) return;
      this.fresh = true;
      this.watchFrames();
    });
  }

  // Only on a change: play() on every tick would fight the browser
  setPlaying(on) {
    if (on === this.playing || this.closed) return;
    this.playing = on;
    if (on) this.video.play()?.catch(() => {}); // blocked: stays on its current frame
    else this.video.pause();
  }

  // Called every tick while the slider shows this video: true when there's a new frame.
  // Without requestVideoFrameCallback every tick of a playing video counts as one
  update() {
    const fresh = this.frameCallback ? this.fresh :
      !this.video.paused && this.video.readyState >= 2;
    this.fresh = false;
    if (fresh) this.texture.needsUpdate = true;
    return fresh;
  }

  destroy() {
    if (this.closed) return;
    this.closed = true;
    this.video.pause();
    this.video.removeAttribute('src');
    this.video.load(); // drops the buffered data
    this.video.remove();
  }
}

class DitherSlider {
  // root = the Barba container the slider lives in (#next / #prev are looked up inside it)
  constructor(container, root, opts = {}) {
    this.container = container;
    this.root = root;
    this.images = JSON.parse(container.getAttribute('data-images') || '[]');
    if (this.images.length < 2) return;

    this.duration = opts.duration || 1.2;
    this.ditherSize = opts.ditherSize || 1; // display px per dot
    this.keys = opts.keys !== false; // arrow keys work like PREV / NEXT
    this.maxWidth = opts.maxWidth || 0; // px, wider still images are scaled down (0: as is)
    this.fieldCell = 6; // resolution of the cloud shape (CSS px)
    this.start = opts.start ||
    0; // data-images entry shown first (the first loaded one if it failed)
    this.current = 0;
    this.target = 0; // the image a running change ends on (current when none runs)
    this.isRunning = false;
    this.destroyed = false;
    this.textures = [];
    this.gifs = []; // GifTexture of every animated GIF
    this.videos = []; // VideoSlide of every video
    this.inView = true;
    this.controller = new AbortController();

    this.scene = new THREE.Scene();
    this.camera = new THREE.OrthographicCamera(-0.5, 0.5, 0.5, -0.5, -1, 1);
    this.renderer = new THREE.WebGLRenderer();
    this.renderer.setPixelRatio(Math.min(window.devicePixelRatio, 2));
    this.renderer.setClearColor(0xeeeeee, 1);

    const canvas = this.renderer.domElement;
    Object.assign(canvas.style, {
      position: 'absolute',
      top: '0',
      left: '0',
      width: '100%',
      height: '100%',
      display: 'block',
      pointerEvents: 'none'
    });
    if (getComputedStyle(container).position === 'static') {
      container.style.position = 'relative';
    }

    this.loadTextures().then(() => {
      // The page may have been left while the images were loading
      if (this.destroyed || !this.textures.length) return;
      this.addObjects();
      this.resize();

      // On screen only once the first image is drawn: an empty WebGL canvas is black
      container.querySelectorAll('canvas').forEach((c) => c.remove());
      container.appendChild(canvas);

      // Fades in instead of cutting in: at its own slot during the hard-load intro, while the
      // band uncovers it on a Barba navigation, at once otherwise. One frame later: the setup
      // above was a long task, and with lag smoothing off a tween made now would skip ahead
      if (!reducedMotion) {
        gsap.set(canvas, { opacity: 0 });
        revealOnEntry(container, () => requestAnimationFrame(() => gsap.to(canvas, {
          opacity: 1,
          duration: PAGE_INTRO.fade,
          ease: PAGE_INTRO.ease,
        })), this.root);
      }

      const { signal } = this.controller;
      // The box, not the window: a side card can resize it while the window stays put
      let size = `${container.offsetWidth}x${container.offsetHeight}`;
      this.ro = new ResizeObserver(() => {
        const now = `${container.offsetWidth}x${container.offsetHeight}`;
        if (now === size) return;
        size = now;
        this.resize();
      });
      this.ro.observe(container);
      this.root.querySelector('#next')?.addEventListener('click', () => this.goTo(this
        .current + 1), { signal });
      this.root.querySelector('#prev')?.addEventListener('click', () => this.goTo(this
        .current - 1), { signal });

      // Arrow keys work like PREV / NEXT (not while typing in a field)
      if (this.keys) window.addEventListener('keydown', (e) => {
        if (e.defaultPrevented || e.altKey || e.ctrlKey || e.metaKey) return;
        if (e.target.closest?.('input, textarea, select, [contenteditable]')) return;
        if (e.key === 'ArrowRight') this.goTo(this.current + 1);
        else if (e.key === 'ArrowLeft') this.goTo(this.current - 1);
      }, { signal });

      // Animated GIFs and videos play only while the slider is on screen
      if (this.gifs.length || this.videos.length) {
        this.io = new IntersectionObserver(([entry]) => {
          this.inView = entry.isIntersecting;
        });
        this.io.observe(container);
        gsap.ticker.add(this.tick);
        // The ticker stops in a hidden tab: pause the videos right away
        document.addEventListener('visibilitychange', this.tick, { signal });
      }

      this.emit('ready', this.current);
    });
  }

  // GIFs and videos on screen (the current image, and the incoming one during a slide
  // change) move to their next frame; a new frame redraws the slider
  tick = () => {
    const visible = this.inView && !document.hidden;
    const { texture1, texture2 } = this.uniforms;
    const shown = (texture) => texture === texture1.value ||
      (this.isRunning && texture === texture2.value);

    this.videos.forEach((video) => video.setPlaying(visible && shown(video.texture)));
    if (!visible) return;

    const now = performance.now();
    let drawn = false;
    this.gifs.forEach((gif) => {
      if (shown(gif.texture) && gif.update(now)) drawn = true;
    });
    this.videos.forEach((video) => {
      if (shown(video.texture) && video.update()) drawn = true;
    });

    // During a slide change the transition already renders every frame
    if (drawn && !this.isRunning) this.render();
  };

  // ditherslider:ready / ditherslider:change (a change starts) / ditherslider:settle (it
  // ended) on the container. index: position among the loaded images, source: position in
  // data-images, total: images the slider shows
  emit(name, index) {
    this.container.dispatchEvent(new CustomEvent(`ditherslider:${name}`, {
      detail: { index, source: this.sources[index], total: this.textures.length },
    }));
  }

  loadTextures() {
    const loader = new THREE.TextureLoader();
    return Promise.all(this.images.map((entry) => this.loadTexture(entry, loader)))
      .then((textures) => {
        // Where each loaded texture sits in data-images (broken images are skipped)
        this.sources = textures.map((texture, i) => (texture ? i : -1)).filter((i) => i >= 0);
        this.textures = textures.filter(Boolean);
        // Left the page before the images arrived: free them right away
        if (this.destroyed) {
          this.textures.forEach((texture) => texture.dispose());
          this.gifs.forEach((gif) => gif.destroy());
          this.videos.forEach((video) => video.destroy());
        }
      });
  }

  // A data-images entry is an image URL, a video URL, or { video, image }: the image shows
  // when the video can't play
  loadTexture(entry, loader) {
    const { video, image } = typeof entry === 'string' ?
      (isVideoUrl(entry) ? { video: entry } : { image: entry }) : entry || {};
    const fallback = () => (image ? this.loadImage(image, loader) : null);
    if (!video) return Promise.resolve(fallback());

    return VideoSlide.load(video, this.container).then((slide) => {
      if (!slide) {
        console.warn('[dither slider] video could not be played', video);
        return fallback();
      }
      this.videos.push(slide);
      return slide.texture;
    });
  }

  // Animated GIFs are decoded frame by frame (GifTexture). Any other image, or a GIF the
  // browser can't decode that way, is a regular texture (a GIF then shows its first frame)
  loadImage(url, loader) {
    const still = () => new Promise((resolve) => {
      loader.load(url, (texture) => {
        texture.minFilter = THREE.LinearFilter;
        texture.generateMipmaps = false;
        this.fitWidth(texture);
        resolve(texture);
      }, undefined, () => {
        // A broken image must not block the slider: skip it and keep the others
        console.warn('[dither slider] image failed to load', url);
        resolve(null);
      });
    });

    if (!isGifUrl(url)) return still();

    return GifTexture.load(url)
      .then((gif) => {
        if (!gif) return still();
        this.gifs.push(gif);
        return gif.texture;
      })
      .catch((err) => {
        console.warn('[dither slider] GIF could not be decoded, showing its first frame', url,
          err);
        return still();
      });
  }

  // An image wider than opts.maxWidth goes to the GPU as a scaled-down canvas: an original
  // upload can be ~4000px wide, about 40 MB of texture for a box a few hundred px wide
  fitWidth(texture) {
    const { image } = texture;
    if (!this.maxWidth || !image || image.width <= this.maxWidth) return;
    const canvas = document.createElement('canvas');
    canvas.width = this.maxWidth;
    canvas.height = Math.max(1, Math.round(image.height * this.maxWidth / image.width));
    canvas.getContext('2d').drawImage(image, 0, 0, canvas.width, canvas.height);
    texture.image = canvas;
    texture.needsUpdate = true;
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
    this.current = this.target = Math.max(0, this.sources.indexOf(this.start));
    this.setTexture(1, this.current);
    this.setTexture(2, (this.current + 1) % this.textures.length);

    const material = new THREE.ShaderMaterial({
      uniforms: this.uniforms,
      vertexShader: DITHER_SLIDER_VERTEX,
      fragmentShader: DITHER_SLIDER_FRAGMENT
    });
    this.scene.add(new THREE.Mesh(new THREE.PlaneGeometry(1, 1), material));
  }

  setTexture(slot, index) {
    const texture = this.textures[index];
    this.uniforms[`texture${slot}`].value = texture;
    const { image } = texture; // a video's size is videoWidth / videoHeight
    this.uniforms[`res${slot}`].value.set(image.videoWidth || image.width,
      image.videoHeight || image.height);
  }

  // Cloud shape on a coarse grid: a new shape for every transition
  buildField() {
    const { data, cols, rows } = ditherField(this.container.offsetWidth, this.container
      .offsetHeight, this.fieldCell);

    // Linear filtering: the cloud stays soft even though the grid is coarse
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
    this.target = nextIndex;
    this.setTexture(2, nextIndex);
    this.buildField();
    this.emit('change', nextIndex); // at the start, so captions move with the dither

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
        this.emit('settle', nextIndex);
      }
    });
  }

  // The change running now ends `scale` times faster (the next one is already wanted)
  hurry(scale) {
    if (!this.isRunning || !this.uniforms) return;
    gsap.getTweensOf(this.uniforms.progress).forEach((tween) => tween.timeScale(scale));
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

  // Barba teardown: listeners, running transition, GPU memory and the WebGL context
  destroy() {
    this.destroyed = true;
    this.controller.abort();
    gsap.ticker.remove(this.tick);
    this.io?.disconnect();
    this.ro?.disconnect();
    this.gifs.forEach((gif) => gif.destroy());
    this.videos.forEach((video) => video.destroy());

    if (this.uniforms) {
      gsap.killTweensOf(this.uniforms.progress);
      this.uniforms.fieldMap.value?.dispose();
    }
    this.textures.forEach((texture) => texture.dispose());
    this.scene.traverse((obj) => {
      if (obj.isMesh) {
        obj.geometry.dispose();
        obj.material.dispose();
      }
    });

    this.renderer.dispose();
    this.renderer.forceContextLoss?.();
    this.renderer.domElement.remove();
  }
}

function initDitherSlider() {
  if (typeof THREE === 'undefined') return;

  // Keep the decoded slider images: coming back to a project doesn't download them again
  if (THREE.Cache) THREE.Cache.enabled = true;

  const page = nextPage;
  const container = page.querySelector('#slider[data-images]');
  if (!container) return;

  const slider = new DitherSlider(container, page, { duration: 1.2, ditherSize: 1 });
  if (!slider.renderer) return; // fewer than 2 images: nothing was built

  onPageLeave(() => slider.destroy());
}

// -----------------------------------------
// HEADER BAND ([data-works-head])
// -----------------------------------------
// The header component (header--nav): the home strip ([data-works-head]) in a band
// (.wk__head). The strip is one or two lines taller when its links wrap, so the band's height
// goes to --wk-head on the frame around it (the CSS has fallbacks). Works (.wk): the side card
// sticks right under the sticky band (desktop). Profile (.section__profile): the portrait's
// width is worked out from the viewport height minus the band (--wk-head on the section)

function initWorksHead() {
  const strip = nextPage.querySelector("[data-works-head]");
  const band = strip.closest(".wk__head") || strip;
  const frame = band.closest(".wk") || band.parentElement;
  const sync = () => frame.style.setProperty("--wk-head", `${band.offsetHeight}px`);

  sync();
  const observer = new ResizeObserver(sync);
  observer.observe(band);
  onPageLeave(() => observer.disconnect());
}

// -----------------------------------------
// WORKS: FOLDER PREVIEW ([data-works-preview], [data-works-folder])
// -----------------------------------------
// Every project is a folder ([data-works-folder], a CMS link to its page) holding its cover
// (a hidden CMS img) and its fields (.wk__data). Pointing at a folder, or focusing it, makes
// it the active one at once: data-active, the side card ([data-works-info]: services,
// keywords, tools) and the preview window's title and link ([data-works-open]). The preview
// box dithers over to its cover with the project slider's cloud (DitherSlider); a change
// still running toward another cover is sped up, then the box catches up with the last
// folder pointed at.
// Once the covers are in, every folder's sheet gets a small 1-bit print of its cover: the
// sheet slides out of the folder on hover and focus (on touch screens it always peeks out).
// Touch screens have no hover: the covers take turns on their own while the box is at least
// half on screen (not with reduced motion), holding still while a folder is focused.
// Coming back from a project, the preview starts on it, and keyboard focus returns to its
// folder when the project was opened from the keyboard.
// The folders' look and states live in the page's embed in Webflow (wk__css), which uses the
// same hover media query as canHover below.

const WORKS_PREVIEW = {
  duration: 0.9, // s, one dither change (the project slider takes 1.2)
  hurry: 4, // a running change toward a cover nobody points at any more ends this much faster
  ditherSize: 1, // display px per dot
  cycle: 3.2, // s per cover where nothing can hover
  minWidth: 600, // px, smallest image worth loading for the box
  maxWidth: 1600, // px, largest one (covers without a srcset are scaled down to fit)
  crop: 1.5, // the box is filled: a cover up to 3:2 needs this × the box height in width
  services: 4, // services named in the side card, the rest counted ("+3")
  printDot: 1, // CSS px per dot of the folder prints
};
// sessionStorage: { href, keyboard } of the project the visitor left Works for
const WORKS_LAST = "nr:works-last";

// The smallest srcset candidate at least `need` px wide, else the largest, else src
function worksCoverSrc(img, need) {
  if (!img) return "";
  const candidates = (img.getAttribute("srcset") || "")
    .split(",")
    .map((part) => part.trim().split(/\s+/))
    .map(([url, width]) => ({ url, width: parseInt(width, 10) }))
    .filter((candidate) => candidate.url && candidate.width > 0)
    .sort((a, b) => a.width - b.width);
  const fit = candidates.find((candidate) => candidate.width >= need) || candidates.at(-1);
  return fit?.url || img.getAttribute("src") || "";
}

// CMS text without zero-width characters, runs of spaces (nbsp too) as one
const cleanCmsText = (text) => text.replace(/[​-‍﻿]/g, "").replace(/\s+/g, " ").trim();

// Lines of a CMS rich text: every <br> and every paragraph or list item ends one
function richTextLines(el) {
  const lines = [];
  el?.querySelectorAll("p, li").forEach((block) => {
    let line = "";
    block.childNodes.forEach((node) => {
      if (node.nodeName === "BR") {
        lines.push(cleanCmsText(line));
        line = "";
      } else {
        line += node.textContent;
      }
    });
    lines.push(cleanCmsText(line));
  });
  return lines.filter(Boolean);
}

// "SALESFORCE" → "Salesforce": names are set in capitals by CSS, screen readers get them
// in title case
const titleCase = (text) => text.toLowerCase().replace(/(^|[\s-])(\p{L})/gu, (m, a, b) => a + b
  .toUpperCase());

// The awards line under a folder ("W. FWA CSSDA SOTD") spelled out for screen readers
const WORKS_AWARDS = { "W.": "Awwwards", FWA: "FWA", CSSDA: "CSS Design Awards" };

function worksAwardText(raw) {
  const tokens = raw.toUpperCase().split(/\s+/).filter(Boolean);
  const names = tokens.map((token) => WORKS_AWARDS[token]).filter(Boolean);
  if (!names.length) return raw;
  const list = names.length > 1 ? `${names.slice(0, -1).join(", ")} and ${names.at(-1)}` : names[0];
  return tokens.includes("SOTD") ? `Site of the Day on ${list}` : list;
}

// A folder's info, from its label and hidden CMS fields (.wk__data): the name, the awards,
// the services (rich text, one per line), the keywords (K1-K3, else the Tags) and the tools
// (rich text). Only what the project page doesn't already lead with
function worksFolderInfo(folder) {
  const keywords = [...folder.querySelectorAll("[data-works-k]")]
    .map((el) => cleanCmsText(el.textContent))
    .filter(Boolean);
  const tags = cleanCmsText(folder.querySelector("[data-works-tags]")?.textContent || "")
    .split(",")
    .map(cleanCmsText)
    .filter(Boolean);
  const services = richTextLines(folder.querySelector("[data-works-services]"));
  const more = services.length - WORKS_PREVIEW.services;

  return {
    name: titleCase(cleanCmsText(folder.querySelector(".wk__label")?.textContent || "")),
    award: cleanCmsText(folder.querySelector(".wk__award")?.textContent || ""),
    services: services.slice(0, WORKS_PREVIEW.services).join(" · ") + (more > 0 ? ` +${more}` : ""),
    keywords: (keywords.length ? keywords : tags).join(" · "),
    tools: richTextLines(folder.querySelector("[data-works-tools]")).join(" · "),
  };
}

// Ordered dither thresholds (8×8 Bayer), in (0, 1)
const BAYER8 = (() => {
  let m = [
    [0]
  ];
  while (m.length < 8) {
    const n = m.length;
    const next = Array.from({ length: n * 2 }, () => new Array(n * 2));
    for (let y = 0; y < n; y++) {
      for (let x = 0; x < n; x++) {
        const v = m[y][x] * 4;
        next[y][x] = v;
        next[y][x + n] = v + 2;
        next[y + n][x] = v + 3;
        next[y + n][x + n] = v + 1;
      }
    }
    m = next;
  }
  return m.flat().map((v) => (v + 0.5) / 64);
})();

// A folder sheet's print: the cover cropped to the sheet (a little above the middle: the
// sheet shows its top first), as 1-bit ink dots, one canvas pixel per dot. Paper stays
// transparent. False when the image can't be read (no CORS) or has no size yet
function drawWorksPrint(canvas, source, cols, rows) {
  const sw = source?.videoWidth || source?.naturalWidth || source?.width || 0;
  const sh = source?.videoHeight || source?.naturalHeight || source?.height || 0;
  if (!sw || !sh || cols < 2 || rows < 2) return false;
  canvas.width = cols;
  canvas.height = rows;
  const ctx = canvas.getContext("2d", { willReadFrequently: true });
  if (!ctx) return false;
  const scale = Math.max(cols / sw, rows / sh);
  const w = sw * scale;
  const h = sh * scale;
  ctx.clearRect(0, 0, cols, rows);
  ctx.drawImage(source, (cols - w) / 2, (rows - h) * 0.35, w, h);

  let image;
  try {
    image = ctx.getImageData(0, 0, cols, rows);
  } catch (e) {
    return false; // a tainted canvas
  }
  const px = image.data;
  for (let y = 0; y < rows; y++) {
    for (let x = 0; x < cols; x++) {
      const i = (y * cols + x) * 4;
      const lum = (px[i] * 0.299 + px[i + 1] * 0.587 + px[i + 2] * 0.114) / 255;
      const t = Math.min(1, Math.max(0, (lum - 0.12) / 0.76));
      const tone = t * t * (3 - 2 * t); // the same contrast curve as the slider's dither
      px[i] = 28;
      px[i + 1] = 28;
      px[i + 2] = 26;
      px[i + 3] = tone <= BAYER8[(y & 7) * 8 + (x & 7)] ? 255 : 0;
    }
  }
  ctx.putImageData(image, 0, 0);
  return true;
}

// The folder grid itself, with or without WebGL: the "new project" folder
// ([data-works-cta], parked after the CMS list in Webflow) joins the grid as its last cell,
// and every project folder gets a spoken name with its awards spelled out
function initWorksGrid() {
  const page = nextPage;
  const grid = page.querySelector(".wk__grid");
  const cta = page.querySelector("[data-works-cta]");
  if (grid && cta) grid.appendChild(cta.closest(".wk__item") || cta);

  page.querySelectorAll("[data-works-folder]").forEach((folder) => {
    const { name, award } = worksFolderInfo(folder);
    if (!name) return;
    folder.setAttribute("aria-label", award ? `${name}, ${worksAwardText(award)}` : name);
  });
}

function initWorksPreview() {
  if (typeof THREE === "undefined") return;

  // Keep the decoded covers: coming back to Works doesn't download them again
  if (THREE.Cache) THREE.Cache.enabled = true;

  const page = nextPage;
  const box = page.querySelector("[data-works-preview]");
  if (!box) return;
  const C = WORKS_PREVIEW;

  // One entry per folder with a cover, in grid order
  const dpr = Math.min(window.devicePixelRatio || 1, 2);
  const boxWidth = Math.max(box.offsetWidth, box.offsetHeight * C.crop) * dpr;
  const need = Math.round(Math.min(Math.max(boxWidth, C.minWidth), C.maxWidth));
  const entries = [...page.querySelectorAll("[data-works-folder]")]
    .map((folder) => ({ folder, src: worksCoverSrc(folder.querySelector("img"), need) }))
    .filter((entry) => entry.src);
  if (entries.length < 2) return;
  entries.forEach((entry) => (entry.info = worksFolderInfo(entry.folder)));

  // The project this visit came back from (or last opened): the preview starts on it
  let last = null;
  try {
    last = JSON.parse(sessionStorage.getItem(WORKS_LAST) || "null");
  } catch (e) {}
  const back = last ? entries.findIndex((entry) => entry.folder.getAttribute("href") === last
    .href) : -1;
  const remember = (href, keyboard) => {
    try {
      sessionStorage.setItem(WORKS_LAST, JSON.stringify({ href, keyboard }));
    } catch (e) {}
  };

  box.setAttribute("data-images", JSON.stringify(entries.map((entry) => entry.src)));
  const reduce = reducedMotion;
  const slider = new DitherSlider(box, page, {
    duration: reduce ? 0.01 : C.duration,
    ditherSize: C.ditherSize,
    keys: false, // arrows belong to the page here
    maxWidth: need, // originals without a srcset can be ~4000px wide
    start: Math.max(0, back),
  });
  if (!slider.renderer) return;

  const canHover = window.matchMedia("(hover: hover) and (pointer: fine)").matches;
  const controller = new AbortController();
  const { signal } = controller;
  let wanted = Math.max(0, back); // entry the preview should end on
  let active = null;
  let cycle = null;
  let io = null;
  let inView = true;

  // Side card ([data-works-info]): services, keywords and tools of the active folder,
  // scrambled in. Its rows keep the height of their longest value, so the preview window
  // under them never changes size
  const fields = [...page.querySelectorAll("[data-works-info-field]")]
    .map((el) => ({ el, key: el.getAttribute("data-works-info-field") }));
  if (fields.length) {
    const reserve = () => fields.forEach(({ el, key }) =>
      reserveCaptionHeight(el, entries.map((entry) => entry.info[key] || "—")));
    whenFontsReady(reserve);
    window.addEventListener("resize", debounceOnWidthChange(reserve, 150), { signal });
  }

  // The preview window: its title names the active project, and the window opens it
  const win = page.querySelector("[data-works-open]");
  const winTitle = page.querySelector("[data-works-win-title]");

  // The active folder: data-active, the side card, the window. At once, not when the
  // dither gets there
  const markActive = (entryIndex, animate) => {
    const entry = entries[entryIndex];
    const folder = entry?.folder || null;
    if (folder === active) return;
    active?.removeAttribute("data-active");
    folder?.setAttribute("data-active", "");
    active = folder;
    const put = (el, value) => {
      if (!el) return;
      if (animate) {
        scrambleWords(el, value);
      } else {
        el._scramble?.kill();
        el.textContent = value;
      }
    };
    fields.forEach(({ el, key }) => put(el, entry?.info[key] || "—"));
    if (!entry) return;
    put(winTitle, `Preview — ${entry.info.name}`);
    win?.setAttribute("href", entry.folder.getAttribute("href"));
    win?.setAttribute("aria-label", `Open ${entry.info.name}`);
  };
  markActive(wanted, false);

  // Starts the change to the wanted cover. One already running toward another cover is
  // sped up, and calls back on settle
  const catchUp = () => {
    if (slider.destroyed || !slider.uniforms) return;
    const index = slider.sources.indexOf(wanted); // -1: that cover failed to load
    if (slider.isRunning) {
      if (index !== slider.target) slider.hurry(C.hurry);
      return;
    }
    if (index >= 0 && index !== slider.current) slider.goTo(index);
  };

  const show = (entryIndex, animate = true) => {
    wanted = entryIndex;
    markActive(entryIndex, animate);
    catchUp();
  };

  // No hover: the next cover every C.cycle seconds, only while the box can be seen and no
  // folder holds it (a trackpad on a tablet, keyboard focus)
  let held = 0;
  const schedule = () => {
    cycle?.kill();
    cycle = gsap.delayedCall(C.cycle, () => {
      if (inView && !document.hidden && !held && !slider.isRunning) {
        show(slider.sources[(slider.current + 1) % slider.textures.length]);
      }
      schedule();
    });
  };
  const hold = (entryIndex) => {
    held++;
    show(entryIndex);
  };
  // A fresh full turn for the cover the preview is on, once nothing holds it
  const release = () => {
    held = Math.max(0, held - 1);
    if (cycle && !held) schedule();
  };

  // Every folder's sheet gets the print of its cover, from the texture the slider already
  // loaded (no second download). The print's box on the sheet is set by the embed's CSS
  // (.wk__print); redrawn when the folders change size
  const prints = [];
  const drawPrints = () => {
    prints.forEach((print) => {
      const { canvas, source } = print;
      const cols = Math.round(canvas.clientWidth / C.printDot);
      const rows = Math.round(canvas.clientHeight / C.printDot);
      if (`${cols}x${rows}` === print.size) return;
      print.size = `${cols}x${rows}`;
      if (drawWorksPrint(canvas, source, cols, rows)) canvas.classList.add("is-in");
    });
  };
  const makePrints = () => {
    entries.forEach((entry, i) => {
      const sheet = entry.folder.querySelector(".wk__folder-sheet");
      const source = slider.textures[slider.sources.indexOf(i)]?.image;
      if (!sheet || !source) return;
      const canvas = document.createElement("canvas");
      canvas.className = "wk__print";
      canvas.setAttribute("aria-hidden", "true");
      sheet.appendChild(canvas);
      prints.push({ canvas, sheet, source });
    });
    drawPrints();
    let raf = 0;
    const observer = new ResizeObserver(() => {
      cancelAnimationFrame(raf);
      raf = requestAnimationFrame(drawPrints);
    });
    if (prints[0]) observer.observe(prints[0].sheet);
    signal.addEventListener("abort", () => {
      observer.disconnect();
      cancelAnimationFrame(raf);
    });
  };

  box.addEventListener("ditherslider:ready", () => {
    makePrints();
    catchUp(); // a folder pointed at while the covers were loading
    if (canHover || reduce) return;
    // Half of the box on screen: a cover that only shows a sliver doesn't count
    io = new IntersectionObserver(([entry]) => {
      inView = entry.intersectionRatio >= 0.5;
    }, { threshold: [0, 0.5, 1] });
    io.observe(box);
    schedule();
  }, { signal });
  box.addEventListener("ditherslider:settle", catchUp, { signal });

  entries.forEach(({ folder }, i) => {
    folder.addEventListener("pointerenter", (e) => {
      if (e.pointerType !== "touch") hold(i);
    }, { signal });
    folder.addEventListener("pointerleave", (e) => {
      if (e.pointerType !== "touch") release();
    }, { signal });
    folder.addEventListener("focus", () => hold(i), { signal });
    folder.addEventListener("blur", release, { signal });
    // A click from the keyboard has no pointer detail: focus comes back here on return
    folder.addEventListener("click", (e) => remember(folder.getAttribute("href"), e.detail ===
      0), {
      signal
    });
  });
  win?.addEventListener("click", () => remember(win.getAttribute("href"), false), { signal });

  // Back from a project opened from the keyboard: its folder takes the focus again
  if (back >= 0 && last?.keyboard) {
    remember(last.href, false);
    requestAnimationFrame(() => {
      const folder = entries[back].folder;
      if (folder.isConnected && !signal.aborted) folder.focus({ preventScroll: true });
    });
  }

  onPageLeave(() => {
    controller.abort();
    cycle?.kill();
    io?.disconnect();
    fields.forEach(({ el }) => el._scramble?.kill());
    winTitle?._scramble?.kill();
    active?.removeAttribute("data-active");
    slider.destroy();
  });
}

// -----------------------------------------
// HOME: DITHER STATEMENT ([data-home-hero])
// -----------------------------------------
// The statement's black highlights are screens: on hover / keyboard focus the black melts
// into a dithered video or image of the work ([data-home-hl] with data-video or data-src).
// The portrait chip ([data-home-chip]) is always dithered. Elsewhere on the hero the cursor
// leaves a trail of ink that uncovers the collage behind the page ([data-home-behind] img),
// dithered; the ink left behind creeps a little and fades out unevenly, in blotches. Two WebGL
// canvases inside the hero, both below the text: canvasBack (the ink, lowest) and canvasUnder
// (highlights and chip, above the ink). Until WebGL draws, or without it, the page stays as
// styled in Webflow: black boxes with white text, no ink.

const HOME_DITHER = {
  dot: 2, // CSS px per dither dot
  ink: 0x1c1c1a,
  dotLight: 0x7c7c76, // highlight dots
  dotChip: 0xecece8, // portrait dots
  paper: 0xffffff, // behind the page
  imageZoom: 1.15, // images in the highlights: zoomed in and slowly panning
  revealIn: { duration: 0.6, ease: "power2.out" },
  revealOut: { duration: 0.45, ease: "power2.in" },
  lens: {
    brush: 0.055, // radius of the head of the trail, of the hero width
    minBrush: 48, // CSS px
    maxBrush: 104,
    life: 4.5, // s for ink left behind to fade out completely
    grain: 0.5, // how unevenly it fades: 0 = evenly, higher = bigger blotches and holes
    flow: 16, // CSS px per second the fading ink creeps
    spread: 0.12, // how much it bleeds into the paper around it, per frame at 60 fps
    rim: 0.1, // fringe of ink dots along the edge (0: none)
    wash: 0.14, // ink tone the trail lays even over white paper (0: none)
    tone: 0x8f8f89, // colour of the collage's dots and of the fringe (a soft grey: ink was too loud)
    contrast: 1.35, // of the collage
    lift: 0, // 0..1: lightens the collage (fewer dots); 0 = as it is
    trailScale: 4, // CSS px per texel of the trail buffer
    move: { duration: 0.35, ease: "power3.out" },
    scale: { duration: 0.4, ease: "power2.out" },
    autoScale: 0.75,
    tagGap: 6, // CSS px between the tag and the head of the trail
    wordPad: 0.05, // em, paper around each letter of the statement
    wordFeather: 4, // CSS px of grainy edge around that paper
  },
};

const HOME_DITHER_VERTEX = `
  varying vec2 vUv;
  void main() {
    vUv = uv;
    gl_Position = projectionMatrix * modelViewMatrix * vec4(position, 1.0);
  }
`;

// One quad per highlight / chip, laid on its span. Every dot samples the media at its own
// centre (crisp 2px dots); uReveal 0 is solid ink, exactly the CSS box
const HOME_DITHER_SCREEN_FRAGMENT = `
  precision highp float;
  uniform sampler2D uTex;
  uniform vec2 uTexSize; // 0 until the media is ready
  uniform vec2 uSize; // quad, CSS px
  uniform float uReveal;
  uniform float uPixel; // device px per dot
  uniform float uDpr;
  uniform float uZoom;
  uniform float uPan; // -1..1 of the horizontal slack
  uniform vec3 uInk;
  uniform vec3 uDot;
  varying vec2 vUv;
  ${DITHER_BAYER_GLSL}
  float luma(vec3 c) { return dot(c, vec3(0.2126, 0.7152, 0.0722)); }

  void main() {
    vec2 cell = floor(gl_FragCoord.xy / uPixel);
    float l = 0.0;
    if (uTexSize.x > 0.0 && uReveal > 0.0) {
      vec2 uv = vUv + ((cell + 0.5) * uPixel - gl_FragCoord.xy) / (uSize * uDpr);
      // "cover" on the quad
      float rq = uSize.x / uSize.y;
      float rt = uTexSize.x / uTexSize.y;
      vec2 s = (rq > rt ? vec2(1.0, rt / rq) : vec2(rq / rt, 1.0)) / uZoom;
      uv = (uv - 0.5) * s + 0.5;
      uv.x += uPan * (1.0 - s.x) * 0.5;
      l = clamp((luma(texture2D(uTex, uv).rgb) - 0.5) * 1.3 + 0.5, 0.0, 1.0) * uReveal;
    }
    gl_FragColor = vec4(l > bayer4(cell) ? uDot : uInk, 1.0);
  }
`;

// Value noise for the ink (0..1)
const HOME_INK_NOISE_GLSL = `
  float inkHash(vec2 p) { return fract(sin(dot(p, vec2(127.1, 311.7))) * 43758.5453); }
  float inkNoise(vec2 p) {
    vec2 i = floor(p);
    vec2 f = fract(p);
    f = f * f * (3.0 - 2.0 * f);
    return mix(mix(inkHash(i), inkHash(i + vec2(1.0, 0.0)), f.x),
      mix(inkHash(i + vec2(0.0, 1.0)), inkHash(i + vec2(1.0, 1.0)), f.x), f.y);
  }
`;

// Full-target quad for the trail buffer (no camera)
const HOME_DITHER_PASS_VERTEX = `
  varying vec2 vUv;
  void main() {
    vUv = uv;
    gl_Position = vec4(position.xy, 0.0, 1.0);
  }
`;

// The trail buffer, one step per frame (ping-pong): how much ink is left at each spot, 0..1.
// The old ink creeps along a slow swirl, bleeds a little into its neighbours and loses
// uFade; the head of the trail lays fresh ink along its path since the previous frame
const HOME_DITHER_TRAIL_FRAGMENT = `
  precision highp float;
  uniform sampler2D uPrev;
  uniform vec2 uTexel; // 1 / buffer size
  uniform vec2 uHero; // CSS px
  uniform vec2 uFrom; // head on the previous frame, CSS px from the hero's top left
  uniform vec2 uTo; // head now
  uniform float uRadius; // CSS px, 0 = no fresh ink
  uniform float uFade;
  uniform float uFlow; // texels the ink creeps this frame
  uniform float uSpread; // 0..1
  uniform float uTime;
  varying vec2 vUv;
  ${HOME_INK_NOISE_GLSL}

  void main() {
    vec2 p = vec2(vUv.x * uHero.x, (1.0 - vUv.y) * uHero.y);
    // Curl of a slowly drifting noise field: the ink swirls instead of sliding one way
    vec2 q = p / 180.0 + uTime * 0.05;
    float n = inkNoise(q);
    vec2 curl = vec2(inkNoise(q + vec2(0.0, 0.05)) - n, n - inkNoise(q + vec2(0.05, 0.0))) / 0.05;
    vec2 uv = vUv - curl * uFlow * uTexel;
    float v = texture2D(uPrev, uv).r;
    float around = 0.25 * (texture2D(uPrev, uv + vec2(uTexel.x, 0.0)).r +
      texture2D(uPrev, uv - vec2(uTexel.x, 0.0)).r + texture2D(uPrev, uv + vec2(0.0, uTexel.y)).r +
      texture2D(uPrev, uv - vec2(0.0, uTexel.y)).r);
    v = max(0.0, mix(v, around, uSpread) - uFade);
    if (uRadius > 0.0) {
      // Distance to the segment the head covered, with a ragged radius
      vec2 ab = uTo - uFrom;
      float h = clamp(dot(p - uFrom, ab) / max(dot(ab, ab), 0.0001), 0.0, 1.0);
      float d = length(p - uFrom - ab * h);
      float r = uRadius * (0.8 + 0.4 * inkNoise(p / 26.0 + uTime * 0.6));
      v = max(v, 1.0 - smoothstep(r * 0.6, r, d));
    }
    gl_FragColor = vec4(v, v, v, 1.0);
  }
`;

// The ink on canvasBack: where the trail buffer holds enough ink (shifted by blotchy noise,
// so a spot never fades evenly: it breaks into blotches that shrink) the collage shows,
// "cover" on the hero and fixed to it, dithered; the edge dissolves dot by dot and pools
// into a fringe of solid ink dots, like ink drying on paper. The ink sits under the
// statement and never touches its letters: uWordMask holds their shapes, slightly fattened,
// so the paper follows each letter (no box around the words) and ink dots never erase one
const HOME_DITHER_INK_FRAGMENT = `
  precision highp float;
  uniform sampler2D uTex;
  uniform vec2 uTexSize;
  uniform sampler2D uTrail;
  uniform vec2 uHero; // CSS px
  uniform float uPixel;
  uniform float uDpr;
  uniform float uTime;
  uniform float uGrain;
  uniform float uRim;
  uniform float uWash;
  uniform float uContrast;
  uniform float uLift;
  uniform vec3 uInk;
  uniform vec3 uPaper;
  uniform sampler2D uWordMask; // letters of the statement (alpha), same orientation as uTrail
  ${DITHER_BAYER_GLSL}
  ${HOME_INK_NOISE_GLSL}
  float luma(vec3 c) { return dot(c, vec3(0.2126, 0.7152, 0.0722)); }

  void main() {
    vec2 cell = floor(gl_FragCoord.xy / uPixel);
    // gl_FragCoord starts bottom left, like the trail buffer
    vec2 c = (cell + 0.5) * uPixel / uDpr;
    vec2 tuv = c / uHero;
    // No ink anywhere near (most of the hero): nothing else to work out
    if (texture2D(uTrail, tuv).r < 0.01) discard;
    // Back to CSS px from the top left
    vec2 p = vec2(c.x, uHero.y - c.y);
    float blot = inkNoise(p / 70.0 + vec2(uTime * 0.03, 0.0)) * 0.6 +
      inkNoise(p / 28.0 - uTime * 0.05) * 0.4;
    float fibre = inkNoise(p * vec2(0.11, 0.035) + uTime * 0.02);
    float t = texture2D(uTrail, tuv + (vec2(blot, fibre) - 0.5) * 8.0 / uHero).r;
    float m = t + (blot * 0.75 + fibre * 0.25 - 0.5) * uGrain;
    float b = bayer4(cell);
    if (b >= smoothstep(0.42, 0.58, m)) discard;

    // Paper on and around the letters, dissolving dot by dot at the edge of the halo
    if (b < texture2D(uWordMask, tuv).a) discard;

    vec2 uv = vec2(p.x / uHero.x, 1.0 - p.y / uHero.y);
    float rq = uHero.x / uHero.y;
    float rt = uTexSize.x / uTexSize.y;
    uv = (uv - 0.5) * (rq > rt ? vec2(1.0, rt / rq) : vec2(rq / rt, 1.0)) + 0.5;
    float l = clamp((luma(texture2D(uTex, uv).rgb) - 0.5) * uContrast + 0.5, 0.0, 1.0);
    l = mix(l, 1.0, uLift);
    // A light wash of ink dots where the collage is white, so the trail always reads
    l = min(l, 1.0 - uWash * smoothstep(0.45, 0.9, m));
    vec3 col = l > b ? uPaper : uInk;
    // Fringe: ink pools at the edge, unevenly along the fibres (another Bayer offset, so it
    // doesn't line up with the image dots)
    float rim = (1.0 - smoothstep(0.5, 0.5 + max(uRim, 0.001), m)) * (0.3 + 0.7 * fibre);
    if (uRim > 0.0 && rim > bayer4(cell.yx + vec2(1.0, 3.0)) + 0.0625) col = uInk;
    gl_FragColor = vec4(col, 1.0);
  }
`;

// Image texture for a dither quad, or null (one clear warning) when it can't be used
function loadHomeDitherImage(url, fallback = "its box stays black") {
  return new Promise((resolve) => {
    const loader = new THREE.TextureLoader();
    loader.setCrossOrigin("anonymous");
    loader.load(url, (texture) => {
      // Sampled at dot resolution: no mipmaps, so WebGL1 doesn't resize it to a power of two
      texture.minFilter = THREE.LinearFilter;
      texture.magFilter = THREE.LinearFilter;
      texture.generateMipmaps = false;
      resolve(texture);
    }, undefined, () => {
      console.warn(
        `[home dither] ${url} can't be used as a WebGL texture (CORS or loading ` +
        `error): ${fallback}.`);
      resolve(null);
    });
  });
}

function initHomeDither() {
  if (typeof THREE === "undefined") return;
  const hero = nextPage.querySelector("[data-home-hero]");
  if (!hero) return;

  const C = HOME_DITHER;
  const hlEls = [...hero.querySelectorAll("[data-home-hl]")];
  const chipEl = hero.querySelector("[data-home-chip]");
  const lineEl = hero.querySelector("[data-home-line]");
  const behindImg = hero.querySelector("[data-home-behind] img");
  const tag = hero.querySelector("[data-home-lens-tag]");
  const coarse = window.matchMedia("(pointer: coarse)").matches;
  const useLens = !coarse && !!behindImg;

  const makeRenderer = () => {
    const renderer = new THREE.WebGLRenderer({ alpha: true, antialias: false });
    renderer.setPixelRatio(Math.min(window.devicePixelRatio, 2));
    renderer.setClearColor(0x000000, 0);
    const canvas = renderer.domElement;
    canvas.setAttribute("aria-hidden", "true");
    Object.assign(canvas.style, {
      position: "absolute",
      top: "0",
      left: "0",
      width: "100%",
      height: "100%",
      display: "block",
      pointerEvents: "none",
    });
    return renderer;
  };

  let under, back;
  try {
    under = makeRenderer();
    if (useLens) back = makeRenderer();
  } catch (e) {
    console.warn("[home dither] WebGL not available: the statement stays static.", e);
    under?.dispose();
    return;
  }
  // Stacking inside the hero (isolation: isolate): canvasBack (z 0, first) < lens tag (z 0,
  // later in the DOM) < canvasUnder (z 1) < statement (z 1, later in the DOM) < foot (z 4).
  // The ink never covers a word, highlights included
  under.domElement.style.zIndex = "1";
  hero.prepend(under.domElement);
  if (back) {
    back.domElement.style.zIndex = "0";
    hero.prepend(back.domElement);
  }

  const controller = new AbortController();
  const { signal } = controller;
  const pr = under.getPixelRatio();
  const geometry = new THREE.PlaneBufferGeometry(1, 1);
  const textures = [];
  const materials = [];
  let destroyed = false;
  let W = 1,
    H = 1,
    tagW = 0,
    tagH = 0;
  const wordRects = []; // statement runs outside the boxes, hero px { x0, y0, x1, y1 }
  const boxRects = []; // highlights and chip, hero px
  let laidOut = false;
  let underDirty = true; // canvasUnder needs a frame even with nothing revealed

  // -- Screens: highlights and the chip, one quad each on canvasUnder
  const underScene = new THREE.Scene();
  const underCamera = new THREE.OrthographicCamera(0, 1, 0, -1, -10, 10);

  const makeScreen = (el, chip) => {
    const uniforms = {
      uTex: { value: null },
      uTexSize: { value: new THREE.Vector2(0, 0) },
      uSize: { value: new THREE.Vector2(1, 1) },
      uReveal: { value: chip ? 1 : 0 },
      uPixel: { value: C.dot * pr },
      uDpr: { value: pr },
      uZoom: { value: 1 },
      uPan: { value: 0 },
      uInk: { value: new THREE.Color(C.ink) },
      uDot: { value: new THREE.Color(chip ? C.dotChip : C.dotLight) },
    };
    const material = new THREE.ShaderMaterial({
      uniforms,
      vertexShader: HOME_DITHER_VERTEX,
      fragmentShader: HOME_DITHER_SCREEN_FRAGMENT,
      depthTest: false,
      depthWrite: false,
    });
    materials.push(material);
    const mesh = new THREE.Mesh(geometry, material);
    underScene.add(mesh);
    return {
      el,
      chip,
      mesh,
      uniforms,
      on: { hover: false, focus: false, tap: false },
      shown: false,
      video: null,
      pan: false
    };
  };

  const screens = hlEls.map((el) => makeScreen(el, false));
  if (chipEl) screens.push(makeScreen(chipEl, true));

  const setMedia = (screen, texture, size, pan) => {
    if (destroyed) return;
    textures.push(texture);
    screen.uniforms.uTex.value = texture;
    screen.uniforms.uTexSize.value.set(size[0], size[1]);
    screen.uniforms.uZoom.value = pan ? C.imageZoom : 1;
    screen.pan = pan;
    underDirty = true;
  };

  const loadImageInto = (screen, url, pan) => loadHomeDitherImage(url).then((texture) => {
    if (!texture) return;
    if (destroyed) return texture.dispose();
    setMedia(screen, texture, [texture.image.width, texture.image.height], pan);
  });

  screens.forEach((screen) => {
    const { el, chip } = screen;
    const video = !chip && el.getAttribute("data-video");
    const image = el.getAttribute("data-src");
    if (video) {
      VideoSlide.load(video, hero).then((slide) => {
        if (destroyed) return slide?.destroy();
        if (!slide) {
          console.warn(`[home dither] ${video} can't play here (CORS, format or autoplay ` +
            `blocked)${image ? ": using data-src" : ": its box stays black"}.`);
          if (image) loadImageInto(screen, image, true);
          return;
        }
        screen.video = slide;
        setMedia(screen, slide.texture, [slide.video.videoWidth, slide.video.videoHeight],
          false);
      });
    } else if (image) {
      // The portrait is always on show: the sheet waits for it, so it never pops in black
      const loaded = loadImageInto(screen, image, !chip);
      if (chip) holdIntro(loaded);
    }
  });

  // -- Reveal: hover, keyboard focus, or a tap on touch screens
  const sync = (screen) => {
    const on = screen.on.hover || screen.on.focus || screen.on.tap;
    if (on === screen.shown) return;
    screen.shown = on;
    gsap.to(screen.uniforms.uReveal, {
      value: on ? 1 : 0,
      ...(on ? C.revealIn : C.revealOut),
      overwrite: true,
      // The loop stops drawing once nothing is revealed: draw the final, solid frame too
      onComplete: () => { underDirty = true; },
    });
    underDirty = true;
  };

  screens.filter((s) => !s.chip).forEach((screen) => {
    const { el } = screen;
    if (!el.hasAttribute("tabindex")) el.tabIndex = 0;
    el.addEventListener("pointerenter", (e) => {
      if (e.pointerType === "mouse" || e.pointerType === "pen") {
        screen.on.hover = true;
        sync(screen);
      }
    }, { signal });
    el.addEventListener("pointerleave", (e) => {
      if (e.pointerType === "mouse" || e.pointerType === "pen") {
        screen.on.hover = false;
        sync(screen);
      }
    }, { signal });
    // Touch: a tap toggles this screen and closes the others. A plate with a project
    // (data-plate-href) stays open on the second tap: that one opens the project
    // (initHomePlates)
    el.addEventListener("pointerup", (e) => {
      if (e.pointerType !== "touch") return;
      if (screen.on.tap && el.hasAttribute("data-plate-href")) return;
      const open = !screen.on.tap;
      screens.forEach((other) => {
        if (other.chip) return;
        other.on.tap = other === screen ? open : false;
        sync(other);
      });
    }, { signal });
    // Keyboard only (a tap or a click also focuses the span)
    el.addEventListener("focus", () => {
      let keyboard = true;
      try { keyboard = el.matches(":focus-visible"); } catch (e) { /* old Safari */ }
      if (!keyboard) return;
      screen.on.focus = true;
      sync(screen);
    }, { signal });
    el.addEventListener("blur", () => {
      screen.on.focus = false;
      sync(screen);
    }, { signal });
  });

  // Touch: a tap anywhere else on the sheet closes the open screen
  hero.addEventListener("pointerup", (e) => {
    if (e.pointerType !== "touch" || e.target.closest?.("[data-home-hl]")) return;
    screens.forEach((screen) => {
      if (!screen.on.tap) return;
      screen.on.tap = false;
      sync(screen);
    });
  }, { signal });

  // -- Ink: the collage behind the page, on canvasBack (under the words). `lens` is the head of
  // the trail; the trail itself lives in two render targets that take turns (ping-pong)
  const lens = { x: 0, y: 0, s: 0, auto: useLens && !reducedMotion, drawn: false };
  let backScene, backCamera, lensMesh, lensUniforms, xTo, yTo, sTo;
  let trailScene, trailCamera, trailUniforms, passGeometry;
  let trailTargets = [];
  let trailRead = 0; // the target holding the current trail
  let inkLeft = 0; // s until the last ink laid has faded out
  let fadeOwed = 0; // fade not applied yet (the buffer only takes whole 8-bit steps)
  let flowOwed = 0; // s of creep and bleed not applied yet (see stepTrail)
  let wordMask = null; // canvas with the statement's letters (measureWords)
  let wordMaskTexture = null;
  const from = { x: 0, y: 0 }; // head on the previous frame
  let target = 0; // head scale the pointer asks for

  if (useLens) {
    backScene = new THREE.Scene();
    backCamera = new THREE.OrthographicCamera(0, 1, 0, -1, -10, 10);
    const heroSize = new THREE.Vector2(1, 1);
    lensUniforms = {
      uTex: { value: null },
      uTexSize: { value: new THREE.Vector2(1, 1) },
      uTrail: { value: null },
      uHero: { value: heroSize },
      uPixel: { value: C.dot * back.getPixelRatio() },
      uDpr: { value: back.getPixelRatio() },
      uTime: { value: 0 },
      uGrain: { value: C.lens.grain },
      uRim: { value: C.lens.rim },
      uWash: { value: C.lens.wash },
      uContrast: { value: C.lens.contrast },
      uLift: { value: C.lens.lift },
      uInk: { value: new THREE.Color(C.lens.tone) },
      uPaper: { value: new THREE.Color(C.paper) },
      uWordMask: { value: null },
    };
    const material = new THREE.ShaderMaterial({
      uniforms: lensUniforms,
      vertexShader: HOME_DITHER_VERTEX,
      fragmentShader: HOME_DITHER_INK_FRAGMENT,
      depthTest: false,
      depthWrite: false,
    });
    materials.push(material);
    lensMesh = new THREE.Mesh(geometry, material); // covers the hero (layout)
    lensMesh.visible = false; // until the collage is loaded
    backScene.add(lensMesh);

    // 1 texel per CSS px: the halo is a few px, the ink dots 2px
    wordMask = document.createElement("canvas");
    wordMaskTexture = new THREE.CanvasTexture(wordMask);
    wordMaskTexture.minFilter = THREE.LinearFilter;
    wordMaskTexture.magFilter = THREE.LinearFilter;
    wordMaskTexture.generateMipmaps = false;
    textures.push(wordMaskTexture);
    lensUniforms.uWordMask.value = wordMaskTexture;

    trailUniforms = {
      uPrev: { value: null },
      uTexel: { value: new THREE.Vector2(1, 1) },
      uHero: { value: heroSize },
      uFrom: { value: new THREE.Vector2(0, 0) },
      uTo: { value: new THREE.Vector2(0, 0) },
      uRadius: { value: 0 },
      uFade: { value: 0 },
      uFlow: { value: 0 },
      uSpread: { value: 0 },
      uTime: { value: 0 },
    };
    const trailMaterial = new THREE.ShaderMaterial({
      uniforms: trailUniforms,
      vertexShader: HOME_DITHER_PASS_VERTEX,
      fragmentShader: HOME_DITHER_TRAIL_FRAGMENT,
      depthTest: false,
      depthWrite: false,
    });
    materials.push(trailMaterial);
    passGeometry = new THREE.PlaneBufferGeometry(2, 2);
    const pass = new THREE.Mesh(passGeometry, trailMaterial);
    pass.frustumCulled = false;
    trailScene = new THREE.Scene();
    trailScene.add(pass);
    trailCamera = new THREE.OrthographicCamera(-1, 1, 1, -1, 0, 1);
    trailTargets = [0, 1].map(() => {
      const t = new THREE.WebGLRenderTarget(1, 1, {
        minFilter: THREE.LinearFilter,
        magFilter: THREE.LinearFilter,
        format: THREE.RGBAFormat,
        depthBuffer: false,
        stencilBuffer: false,
      });
      t.texture.generateMipmaps = false;
      return t;
    });

    // Webflow's src is the original upload (the srcset variants are smaller)
    const url = behindImg.getAttribute("src") || behindImg.currentSrc;
    loadHomeDitherImage(url, "the cursor leaves no ink").then((texture) => {
      if (!texture) return;
      if (destroyed) return texture.dispose();
      textures.push(texture);
      lensUniforms.uTex.value = texture;
      lensUniforms.uTexSize.value.set(texture.image.width, texture.image.height);
      lensMesh.visible = true;
    });

    // Reduced motion: no easing, the head sits on the pointer (a 0s quickTo never renders)
    const follow = (prop, vars) =>
      reducedMotion ? (value) => { lens[prop] = value; } : gsap.quickTo(lens, prop, vars);
    xTo = follow("x", C.lens.move);
    yTo = follow("y", C.lens.move);
    sTo = follow("s", C.lens.scale);

    hero.addEventListener("pointermove", (e) => {
      if (e.pointerType === "touch") return;
      const r = hero.getBoundingClientRect();
      const x = e.clientX - r.left;
      const y = e.clientY - r.top;
      // The first move hands the head over to the pointer, for good
      lens.auto = false;
      if (lens.s < 0.01) {
        // An invisible head (back in the hero, off a highlight) starts under the pointer:
        // gliding there from where it was would lay ink along a path the pointer never took.
        // quickTo's 2nd argument restarts its tween from there (the reduced-motion setter
        // ignores it)
        xTo(x, x);
        yTo(y, y);
        lens.x = from.x = x;
        lens.y = from.y = y;
      } else {
        xTo(x);
        yTo(y);
      }
      // No ink over a highlight or the portrait: the work shows there instead
      target = e.target.closest?.("[data-home-hl], [data-home-chip]") ? 0 : 1;
      sTo(target);
    }, { signal });
    hero.addEventListener("pointerleave", (e) => {
      if (e.pointerType === "touch") return;
      target = 0;
      sTo(0);
    }, { signal });
  }

  // The statement's words, skipping the highlights and the chip (their boxes sit on
  // canvasUnder, above the ink anyway): one rect per word for the tag, and their letters
  // drawn into the mask the ink keeps off. Each word is drawn with its computed font on its
  // own rect (baseline from the font's ascent, stretched to the rect's width so letter
  // spacing and kerning can't drift), then fattened by strokes: a solid core and two fainter
  // rings for the grainy edge
  const measureWords = (hr) => {
    wordRects.length = 0;
    if (!wordMask) return;
    const ctx = wordMask.getContext("2d");
    if (wordMask.width !== Math.ceil(W) || wordMask.height !== Math.ceil(H)) {
      wordMask.width = Math.ceil(W);
      wordMask.height = Math.ceil(H);
    } else {
      ctx.setTransform(1, 0, 0, 1, 0, 0);
      ctx.clearRect(0, 0, wordMask.width, wordMask.height);
    }
    wordMaskTexture.needsUpdate = true;
    if (!lineEl) return;
    ctx.lineJoin = "round";
    ctx.textBaseline = "alphabetic";
    const range = document.createRange();
    const walker = document.createTreeWalker(lineEl, NodeFilter.SHOW_TEXT);
    for (let node = walker.nextNode(); node; node = walker.nextNode()) {
      if (!node.data.trim() || node.parentElement.closest("[data-home-hl], [data-home-chip]")) {
        continue;
      }
      const cs = getComputedStyle(node.parentElement);
      const size = parseFloat(cs.fontSize);
      const pad = size * C.lens.wordPad;
      ctx.font = `${cs.fontStyle} ${cs.fontWeight} ${cs.fontSize} ${cs.fontFamily}`;
      if ("letterSpacing" in ctx) ctx.letterSpacing = cs.letterSpacing === "normal" ? "0px" : cs
        .letterSpacing;
      const upper = cs.textTransform === "uppercase";
      for (const match of node.data.matchAll(/\S+/g)) {
        range.setStart(node, match.index);
        range.setEnd(node, match.index + match[0].length);
        const word = upper ? match[0].toUpperCase() : match[0];
        const m = ctx.measureText(word);
        const ascent = m.fontBoundingBoxAscent ?? m.actualBoundingBoxAscent;
        const descent = m.fontBoundingBoxDescent ?? m.actualBoundingBoxDescent;
        // A word only breaks across lines when hyphenated: one rect per piece
        for (const r of range.getClientRects()) {
          if (r.width < 1) continue;
          const x = r.left - hr.left;
          const y = r.top - hr.top;
          wordRects.push({ x0: x - pad, y0: y, x1: x + r.width + pad, y1: y + r.height });
          ctx.setTransform(r.width / Math.max(1, m.width), 0, 0, 1, x,
            y + r.height * ascent / Math.max(1, ascent + descent));
          [
            [pad + C.lens.wordFeather, 0.35],
            [pad + C.lens.wordFeather / 2, 0.7],
            [pad, 1]
          ]
          .forEach(([grow, alpha]) => {
            ctx.strokeStyle = `rgba(0, 0, 0, ${alpha})`;
            ctx.lineWidth = grow * 2;
            ctx.strokeText(word, 0, 0);
          });
          ctx.fillStyle = "#000";
          ctx.fillText(word, 0, 0);
        }
      }
    }
  };

  // -- Layout: quads on the span rects, canvases on the hero
  const layout = () => {
    if (destroyed) return;
    const hr = hero.getBoundingClientRect();
    const oldW = W;
    const oldH = H;
    W = Math.max(1, hr.width);
    H = Math.max(1, hr.height);
    // The auto head is a fraction of the hero: its previous position scales with it, so a
    // resize doesn't stamp a bar from the old spot to the new one
    if (laidOut && lens.auto) {
      from.x *= W / oldW;
      from.y *= H / oldH;
    }
    under.setSize(W, H, false);
    underCamera.right = W;
    underCamera.bottom = -H;
    underCamera.updateProjectionMatrix();
    boxRects.length = 0;
    screens.forEach(({ el, mesh, uniforms }) => {
      const r = el.getBoundingClientRect();
      const w = Math.max(1, r.width);
      const h = Math.max(1, r.height);
      mesh.scale.set(w, h, 1);
      mesh.position.set(r.left - hr.left + w / 2, -(r.top - hr.top + h / 2), 0);
      uniforms.uSize.value.set(w, h);
      boxRects.push({
        x0: r.left - hr.left,
        y0: r.top - hr.top,
        x1: r.right - hr.left,
        y1: r.bottom - hr.top
      });
    });
    if (back) {
      back.setSize(W, H, false);
      backCamera.right = W;
      backCamera.bottom = -H;
      backCamera.updateProjectionMatrix();
      lensUniforms.uHero.value.set(W, H);
      lensMesh.scale.set(W, H, 1);
      lensMesh.position.set(W / 2, -H / 2, 0);
      // A new buffer size starts a clean trail
      const tw = Math.max(1, Math.ceil(W / C.lens.trailScale));
      const th = Math.max(1, Math.ceil(H / C.lens.trailScale));
      if (trailTargets[0].width !== tw || trailTargets[0].height !== th) {
        trailTargets.forEach((t) => t.setSize(tw, th));
        trailUniforms.uTexel.value.set(1 / tw, 1 / th);
        clearTrail();
      }
      measureWords(hr);
      tagW = tag ? tag.offsetWidth : 0;
      tagH = tag ? tag.offsetHeight : 0;
      if (!laidOut) {
        lens.x = from.x = W * 0.55;
        lens.y = from.y = H * 0.42;
      }
    }
    laidOut = true;
    underDirty = true;
    render(true);
  };

  let layoutFrame = 0;
  const queueLayout = () => {
    cancelAnimationFrame(layoutFrame);
    layoutFrame = requestAnimationFrame(layout);
  };
  const ro = new ResizeObserver(queueLayout);
  ro.observe(hero);
  if (lineEl) ro.observe(lineEl);
  window.addEventListener("resize", debounceOnWidthChange(queueLayout, 100), { signal });
  whenFontsReady(queueLayout);

  // -- Loop (gsap.ticker): canvasUnder only while a screen is revealed (or after a change),
  // canvasBack only while there is ink left. Nothing while the hero is off screen or the tab
  // is hidden
  let inView = true;
  let time = 0;
  let firstDraw = false;
  let tagClear = true;
  let tagFade = 1;

  const io = new IntersectionObserver(([entry]) => {
    inView = entry.isIntersecting;
    if (inView) underDirty = true;
  });
  io.observe(hero);

  const active = () => inView && !document.hidden && laidOut;

  const render = (force, dt = 0) => {
    if (!active() && !force) return;
    const revealed = screens.some((s) => !s.chip && s.uniforms.uReveal.value > 0);

    screens.forEach((screen) => {
      if (!screen.video) return;
      const live = screen.shown || screen.uniforms.uReveal.value > 0;
      screen.video.setPlaying(active() && live && !reducedMotion);
      if (live) screen.video.update();
    });

    if (revealed || underDirty) {
      screens.forEach((s) => {
        if (s.pan) s.uniforms.uPan.value = reducedMotion ? 0 : Math.sin(time * 0.25) * 0.9;
      });
      under.render(underScene, underCamera);
      underDirty = false;
      // The canvas draws the boxes from now on: the CSS ones step aside
      if (!firstDraw) {
        firstDraw = true;
        screens.forEach(({ el }) => { el.style.backgroundColor = "transparent"; });
      }
    }

    if (!back) return;
    if (lens.auto) {
      lens.x = W * (0.55 + 0.3 * Math.sin(time * 0.35));
      lens.y = H * (0.42 + 0.22 * Math.sin(time * 0.53));
    }
    const radius = lensMesh.visible ?
      Math.min(Math.max(W * C.lens.brush, C.lens.minBrush), C.lens.maxBrush) * lens.s : 0;
    const inking = radius > 0.5;
    // Reduced motion: nothing lingers, the ink is only where the head is
    if (inking) inkLeft = reducedMotion ? 0 : C.lens.life + 0.25;
    if (inking || inkLeft > 0) {
      stepTrail(radius, dt);
      back.render(backScene, backCamera);
      lens.drawn = true;
    } else if (lens.drawn) {
      back.clear();
      clearTrail();
      lens.drawn = false;
    }
    from.x = lens.x;
    from.y = lens.y;
    if (tag && inking) {
      // Above the head, kept inside the hero (overflow: hidden) near its top/left edge.
      // 0.8: where the ink of the head ends (the trail buffer fades over its outer 40%)
      const gap = C.lens.tagGap;
      const reach = radius * 0.8;
      const tx = Math.max(gap, lens.x - reach);
      const ty = Math.max(gap, lens.y - reach - tagH - gap);
      tag.style.transform = `translate3d(${tx}px, ${ty}px, 0)`;
      // Under the words but ink on ink: it fades out rather than sit on one
      const hit = (r) => tx < r.x1 && tx + tagW > r.x0 && ty < r.y1 && ty + tagH > r.y0;
      tagClear = !wordRects.some(hit) && !boxRects.some(hit);
    }
    if (tag) {
      tagFade += ((tagClear ? 1 : 0) - tagFade) * (reducedMotion ? 1 : 0.25);
      // No tag without ink (the collage may have failed to load)
      const s = lensMesh.visible ? lens.s : 0;
      tag.style.opacity = String(Math.min(1, Math.max(0, (s - 0.3) / 0.7)) * tagFade);
    }
  };

  // One step of the trail buffer: read one target, write the other
  const stepTrail = (radius, dt) => {
    const u = trailUniforms;
    if (reducedMotion) {
      u.uFade.value = 1;
      u.uFlow.value = 0;
      u.uSpread.value = 0;
    } else {
      // Linear fade in whole 8-bit steps: a small multiply would leave ink stuck forever
      fadeOwed += dt / C.lens.life;
      const fade = Math.floor(fadeOwed * 255) / 255;
      fadeOwed -= fade;
      u.uFade.value = fade;
      // Creep and bleed in steps of ~1/60 s whatever the refresh rate: at 120 Hz the
      // per-frame change would be under half an 8-bit step and round away
      flowOwed += dt;
      const step = flowOwed >= 1 / 70 ? flowOwed : 0;
      if (step) flowOwed = 0;
      u.uFlow.value = C.lens.flow * step / C.lens.trailScale;
      u.uSpread.value = Math.min(1, C.lens.spread * step * 60);
    }
    u.uRadius.value = radius;
    u.uFrom.value.set(from.x, from.y);
    u.uTo.value.set(lens.x, lens.y);
    u.uTime.value = time;
    u.uPrev.value = trailTargets[trailRead].texture;
    trailRead = 1 - trailRead;
    back.setRenderTarget(trailTargets[trailRead]);
    back.render(trailScene, trailCamera);
    back.setRenderTarget(null);
    lensUniforms.uTrail.value = trailTargets[trailRead].texture;
    lensUniforms.uTime.value = time;
    inkLeft = Math.max(0, inkLeft - dt);
  };

  const clearTrail = () => {
    trailTargets.forEach((t) => {
      back.setRenderTarget(t);
      back.clear();
    });
    back.setRenderTarget(null);
    fadeOwed = 0;
    flowOwed = 0;
  };

  let autoStarted = false;
  const tick = (t, deltaTime) => {
    if (!active()) {
      // Videos stop with the hero off screen or the tab hidden
      screens.forEach((s) => s.video?.setPlaying(false));
      return;
    }
    const dt = Math.min(deltaTime, 50) / 1000;
    if (!reducedMotion) time += dt;
    if (lens.auto && reducedMotion) lens.auto = false;
    if (lens.auto && !autoStarted && lensMesh?.visible) {
      autoStarted = true;
      sTo(C.lens.autoScale);
    }
    render(false, dt);
  };
  gsap.ticker.add(tick);
  // The ticker stops in a hidden tab: pause the videos right away
  document.addEventListener("visibilitychange", () => tick(0, 0), { signal });

  onPageLeave(() => {
    destroyed = true;
    gsap.ticker.remove(tick);
    cancelAnimationFrame(layoutFrame);
    controller.abort();
    ro.disconnect();
    io.disconnect();
    screens.forEach(({ uniforms }) => gsap.killTweensOf(uniforms.uReveal));
    gsap.killTweensOf(lens);
    screens.forEach((s) => {
      s.video?.destroy();
      s.el.style.removeProperty("background-color");
    });
    if (tag) {
      tag.style.removeProperty("transform");
      tag.style.removeProperty("opacity");
    }
    textures.forEach((texture) => texture.dispose());
    materials.forEach((material) => material.dispose());
    trailTargets.forEach((t) => t.dispose());
    geometry.dispose();
    passGeometry?.dispose();
    [under, back].forEach((renderer) => {
      if (!renderer) return;
      renderer.dispose();
      renderer.forceContextLoss?.();
      renderer.domElement.remove();
    });
  });
}

// -----------------------------------------
// HOME: PLATES ([data-plate] in the statement)
// -----------------------------------------
// The highlight boxes and the portrait are the sheet's plates. Hover, keyboard focus or a
// first tap captions one in the margin ("Tav. 02 — Salesforce, 2026 / AI Trust Map · Open ↗"),
// tags the box corner with its number and draws a leader only where it runs clear of the
// words. The ticket shows what is on air and its timecode. A click, Enter or a second tap
// opens the project. All from the Designer: data-plate (its number), data-plate-title,
// data-plate-meta, data-plate-href

const HOME_PLATES = {
  open: "Open", // the call after the meta, followed by an arrow
  gap: 40, // px between the caption and the statement
  minGap: 12, // px, the least of that gap on short sheets
  edge: 16, // px the caption keeps from the sheet's sides
  top: 40, // px the caption keeps from the sheet's top (the crop marks)
  hold: 1.2, // s the ticket keeps ON AIR and TC after the last plate closes
  fps: 30, // timecode frames per second (the clips are 30 fps)
};

function initHomePlates() {
  const hero = nextPage.querySelector("[data-home-hero]");
  const line = hero?.querySelector("[data-home-line]");
  if (!hero || !line) return;
  const plates = [...line.querySelectorAll("[data-plate]")];
  if (!plates.length) return;

  const C = HOME_PLATES;
  const ticket = hero.querySelector("[data-pm-ticket]");
  const onAirEl = ticket?.querySelector("[data-pm-onair]");
  const tcEl = ticket?.querySelector("[data-pm-tc]");
  const controller = new AbortController();
  const { signal } = controller;

  // The caption layer, over the statement and the ink. Screen readers get the plate's own
  // text as the link name instead
  const layer = document.createElement("div");
  layer.className = "hd__plates";
  layer.setAttribute("aria-hidden", "true");
  layer.setAttribute("data-intro-skip", "");
  layer.innerHTML = '<svg class="hd__leads"></svg>' +
    '<div class="hd__note"><span class="hd__note-a"><b class="hd__note-no"></b> ' +
    '<span class="hd__note-who"></span></span><span class="hd__note-b"></span></div>' +
    '<span class="hd__tag"></span>';
  hero.appendChild(layer);
  const leads = layer.querySelector(".hd__leads");
  const note = layer.querySelector(".hd__note");
  const noEl = layer.querySelector(".hd__note-no");
  const whoEl = layer.querySelector(".hd__note-who");
  const metaEl = layer.querySelector(".hd__note-b");
  const tag = layer.querySelector(".hd__tag");

  const read = (el) => {
    const attr = (name) => (el.getAttribute(name) || "").trim();
    const no = attr("data-plate");
    return {
      no,
      num: (no.match(/\d+/) || [""])[0],
      title: attr("data-plate-title"),
      meta: attr("data-plate-meta"),
      href: attr("data-plate-href")
    };
  };

  plates.forEach((el) => {
    if (!el.hasAttribute("tabindex")) el.tabIndex = 0;
    if (read(el).href) el.setAttribute("role", "link");
  });

  // Hero px
  const rel = (r, h) => ({
    x0: r.left - h.left,
    y0: r.top - h.top,
    x1: r.right - h.left,
    y1: r.bottom - h.top
  });

  // What a leader must not cross: the statement's runs of text and the other plates
  const obstacles = (h, except) => {
    const out = [];
    const range = document.createRange();
    const walker = document.createTreeWalker(line, NodeFilter.SHOW_TEXT);
    for (let node = walker.nextNode(); node; node = walker.nextNode()) {
      if (!node.data.trim() || node.parentElement.closest("[data-plate]")) continue;
      range.selectNodeContents(node);
      for (const r of range.getClientRects())
        if (r.width > 0) out.push({ ...rel(r, h), text: true });
    }
    plates.forEach((p) => { if (p !== except) out.push(rel(p.getBoundingClientRect(), h)); });
    return out;
  };

  // The caption sits on a column edge of the header (the one nearest the plate first), in
  // the band above the statement and clear of the ticket. No room: number tag only
  const place = (el, fresh) => {
    const h = hero.getBoundingClientRect();
    const W = h.width;
    const H = h.height;
    const r = rel(el.getBoundingClientRect(), h);
    const st = rel(line.getBoundingClientRect(), h);
    const tk = ticket && getComputedStyle(ticket).visibility !== "hidden" ?
      rel(ticket.getBoundingClientRect(), h) : null;
    const nw = note.offsetWidth;
    const nh = note.offsetHeight;

    const css = getComputedStyle(hero);
    const xs = ["--pm-c1", "--pm-c2", "--pm-c3"]
      .map((k) => parseFloat(css.getPropertyValue(k)))
      .filter((x) => Number.isFinite(x))
      .concat(C.edge)
      .map((x) => Math.round(Math.min(Math.max(x, C.edge), W - nw - C.edge)))
      .sort((a, b) => Math.abs(a - r.x0) - Math.abs(b - r.x0));
    let spot = null;
    for (const x of xs) {
      const underTicket = tk && x < tk.x1 + 12 && x + nw > tk.x0 - 12;
      const top = underTicket ? tk.y1 + C.minGap : C.top;
      const y = Math.round(Math.max(top, st.y0 - C.gap - nh));
      if (y + nh <= st.y0 - C.minGap) {
        spot = { x, y };
        break;
      }
    }
    if (spot) note.style.transform = `translate(${spot.x}px, ${spot.y}px)`;
    layer.toggleAttribute("data-note", !!spot);

    // Number tag: on a word box it sits outside like a footnote mark (right of the box, else
    // under its right end) so it never covers a letter; on the portrait, or with no room
    // outside, it goes inside the top right corner
    const obs = obstacles(h, el);
    tag.removeAttribute("data-out"); // measure with the boxed style, the wider of the two
    const tw = tag.offsetWidth;
    const th = tag.offsetHeight;
    // A run of text is tested on its capitals only: its box also holds the ascent and descent
    // room, empty in an all-caps statement
    const clear = (x, y) => x >= 8 && x + tw <= W - 8 && y >= 0 && y + th <= H - 8 &&
      !obs.some((o) => {
        const pad = o.text ? (o.y1 - o.y0) * 0.2 : 0;
        return x < o.x1 + 3 && x + tw > o.x0 - 3 && y < o.y1 - pad && y + th > o.y0 + pad;
      });
    let tagAt = null;
    if (!el.hasAttribute("data-home-chip")) {
      tagAt = [
        [r.x1 + 4, r.y0],
        [r.x1 - tw, r.y1 + 3]
      ].find(([x, y]) => clear(x, y)) || null;
    }
    tag.toggleAttribute("data-out", !!tagAt);
    if (!tagAt) tagAt = [r.x1 - tw - 3, r.y0 + 3];
    tag.style.transform = `translate(${Math.round(tagAt[0])}px, ${Math.round(tagAt[1])}px)`;

    // Leader: up from the plate to the caption's first line, through a gap in the words
    leads.setAttribute("viewBox", `0 0 ${Math.round(W)} ${Math.round(H)}`);
    let d = "";
    if (spot) {
      const ya = spot.y + 7;
      const yb = r.y0 - 5;
      const free = (x) => !obs.some((o) => x > o.x0 - 5 && x < o.x1 + 5 && o.y0 < yb && o.y1 >
      ya);
      const aim = spot.x + nw / 2;
      const candidates = [];
      for (let x = r.x0 + 10; x <= r.x1 - 10; x += 3) candidates.push(x);
      candidates.sort((a, b) => Math.abs(a - aim) - Math.abs(b - aim));
      // The route for a start x: up, then across to the caption's side (or straight up under
      // it). It must keep off the ticket too, else the plate goes without a leader
      const hitsTicket = (x0, x1, y0, y1) => !!tk &&
        x0 < tk.x1 + 6 && x1 > tk.x0 - 6 && y0 < tk.y1 + 6 && y1 > tk.y0 - 6;
      const route = (lx) => {
        if (!free(lx)) return null;
        const x = Math.round(lx) + 0.5;
        const y0 = Math.round(yb) + 0.5;
        const end = spot.x - 8 > x ? spot.x - 8 : spot.x + nw + 8 < x ? spot.x + nw + 8 : null;
        const ym = Math.round(end == null ? spot.y + nh + 6 : ya) + 0.5;
        if (hitsTicket(x, x, ym, y0)) return null;
        if (end != null && hitsTicket(Math.min(x, end), Math.max(x, end), ym, ym)) return null;
        return { x, y0, d: end == null ? `M${x} ${y0} V${ym}` : `M${x} ${y0} V${ym} H${end}` };
      };
      let path = null;
      for (const c of candidates)
        if ((path = route(c))) break;
      if (path) {
        const { x, y0 } = path;
        d = path.d;
        leads.innerHTML = `<circle class="hd__anchor" cx="${x}" cy="${y0}" r="2"></circle>` +
          `<path class="hd__lead${fresh ? "" : " is--in"}" pathLength="1" d="${d}"></path>`;
        if (fresh) {
          requestAnimationFrame(() => requestAnimationFrame(() => {
            leads.querySelector(".hd__lead")?.classList.add("is--in");
          }));
        }
      }
    }
    if (!d) leads.innerHTML = "";
    layer.setAttribute("data-on", "");
  };

  // -- Ticket: ON AIR names the plate, TC runs with its clip (elapsed time for stills)
  let live = null; // { el, video, t0 }
  let holdCall = null;
  const videoFor = (el) => {
    const url = el.getAttribute("data-video");
    if (!url) return null;
    return [...hero.querySelectorAll("video")].find((v) => v.src === url || v.currentSrc ===
      url) || null;
  };
  const startLive = (el) => {
    if (!ticket) return;
    holdCall?.kill();
    holdCall = null;
    const { no, title } = read(el);
    ticket.setAttribute("data-live", "");
    if (onAirEl) scrambleWords(onAirEl, [no, title].filter(Boolean).join(" — "), 0.4);
    live = { el, video: videoFor(el), t0: gsap.ticker.time };
  };
  const stopLive = () => {
    if (!live) return;
    live = null;
    holdCall?.kill();
    holdCall = gsap.delayedCall(C.hold, () => {
      if (!live) ticket?.removeAttribute("data-live");
    });
  };
  const two = (n) => String(Math.floor(n)).padStart(2, "0");
  const tick = () => {
    if (!live || !tcEl) return;
    if (!live.video?.isConnected) live.video = videoFor(live.el);
    const v = live.video;
    let t = 0;
    if (v && v.readyState > 0) t = v.currentTime;
    else if (!reducedMotion) t = gsap.ticker.time - live.t0;
    const f = Math.floor(t * C.fps);
    const text = [f / (C.fps * 3600), (f / (C.fps * 60)) % 60, (f / C.fps) % 60, f % C.fps]
      .map(two).join(":");
    if (tcEl.textContent !== text) tcEl.textContent = text;
  };
  gsap.ticker.add(tick);

  // -- Show / hide
  let active = null; // the captioned plate
  let focused = null; // keyboard focus
  let tapped = null; // touch: the plate a first tap opened
  let touchAt = -Infinity;

  const show = (el) => {
    if (active === el) return;
    active = el;
    const { no, num, title, meta, href } = read(el);
    noEl.textContent = no;
    scrambleWords(whoEl, title ? `— ${title}` : "", 0.38);
    scrambleWords(metaEl, [meta, href ? `${C.open} ↗` : ""].filter(Boolean).join(" · "), 0.52);
    tag.textContent = num;
    place(el, true);
    startLive(el);
  };
  const hide = (el) => {
    if (!active || (el && active !== el)) return;
    active = null;
    layer.removeAttribute("data-on");
    layer.removeAttribute("data-note");
    leads.innerHTML = "";
    stopLive();
  };
  // Like a link: Cmd/Ctrl/Shift or the middle button open a new tab. One navigation at a
  // time: a barba.go() while a transition runs makes Barba hard-load the page
  const go = (el, e) => {
    const { href } = read(el);
    if (!href) return;
    const url = new URL(href, location.href);
    if (e && (e.metaKey || e.ctrlKey || e.shiftKey || e.button === 1)) {
      window.open(url.href, "_blank", "noopener");
      return;
    }
    if (window.barba?.transitions?.isRunning) return;
    if (url.origin === location.origin && window.barba?.go) barba.go(url.href);
    else location.assign(url.href);
  };

  plates.forEach((el) => {
    el.addEventListener("pointerenter", (e) => {
      if (e.pointerType !== "touch") show(el);
    }, { signal });
    el.addEventListener("pointerleave", (e) => {
      if (e.pointerType === "touch" || focused === el) return;
      if (focused) show(focused); // the keyboard's plate keeps its caption
      else hide(el);
    }, { signal });
    // Keyboard only (a click also focuses the plate)
    el.addEventListener("focus", () => {
      let keyboard = true;
      try { keyboard = el.matches(":focus-visible"); } catch (e) { /* old Safari */ }
      if (!keyboard) return;
      focused = el;
      show(el);
    }, { signal });
    el.addEventListener("blur", () => {
      if (focused !== el) return;
      focused = null;
      hide(el);
    }, { signal });
    el.addEventListener("keydown", (e) => {
      if (e.key !== "Enter" || e.repeat) return;
      e.preventDefault();
      go(el, e);
    }, { signal });
    // Touch: the first tap captions, the second opens
    el.addEventListener("pointerup", (e) => {
      if (e.pointerType !== "touch") return;
      touchAt = performance.now();
      if (tapped === el) {
        go(el);
        return;
      }
      tapped = el;
      show(el);
    }, { signal });
    el.addEventListener("click", (e) => {
      if (performance.now() - touchAt < 800) return; // the tap was handled on pointerup
      go(el, e);
    }, { signal });
    el.addEventListener("auxclick", (e) => {
      if (e.button !== 1) return;
      e.preventDefault();
      go(el, e);
    }, { signal });
  });

  // Touch: a tap anywhere else on the sheet closes the caption
  hero.addEventListener("pointerup", (e) => {
    if (e.pointerType !== "touch" || e.target.closest?.("[data-plate]")) return;
    tapped = null;
    hide();
  }, { signal });

  // The statement resizes with the sheet (and the ticket's fit): the caption follows
  let frame = 0;
  const ro = new ResizeObserver(() => {
    cancelAnimationFrame(frame);
    frame = requestAnimationFrame(() => { if (active) place(active, false); });
  });
  ro.observe(hero);
  ro.observe(line);

  onPageLeave(() => {
    controller.abort();
    ro.disconnect();
    cancelAnimationFrame(frame);
    gsap.ticker.remove(tick);
    holdCall?.kill();
    [whoEl, metaEl, onAirEl].forEach((el) => el?._scramble?.kill());
  });
}

// -----------------------------------------
// HOME: HEADER ([data-home-header])
// -----------------------------------------
// The email copies itself: [data-copy] holds the address, its [data-copy-label] reads
// "Copied" for a moment. Without the clipboard API it opens the mail app instead.

const HOME_HEADER = {
  copied: "Copied",
  copiedFor: 1.6, // s the label says so
};

function initHomeHeader() {
  const header = nextPage.querySelector("[data-home-header]");
  const C = HOME_HEADER;
  const controller = new AbortController();
  const { signal } = controller;
  const restores = new Set();

  header.querySelectorAll("[data-copy]").forEach((button) => {
    const value = button.dataset.copy.trim();
    const label = button.querySelector("[data-copy-label]");
    const text = label?.textContent;
    let restore = null;
    if (label) label.setAttribute("aria-live", "polite");

    const copy = () => {
      if (!navigator.clipboard) {
        window.location.href = `mailto:${value}`;
        return;
      }
      navigator.clipboard.writeText(value).then(() => {
        if (!label || signal.aborted) return;
        label.textContent = C.copied;
        if (restore) {
          restore.kill();
          restores.delete(restore);
        }
        restore = gsap.delayedCall(C.copiedFor, () => {
          label.textContent = text;
          restores.delete(restore);
        });
        restores.add(restore);
      }).catch((err) => console.warn("[home header] copy failed:", err));
    };

    button.addEventListener("click", copy, { signal });
    button.addEventListener("keydown", (e) => {
      if (e.key !== "Enter" && e.key !== " ") return;
      e.preventDefault();
      copy();
    }, { signal });
  });

  onPageLeave(() => {
    controller.abort();
    restores.forEach((call) => call.kill());
    restores.clear();
  });
}

// -----------------------------------------
// PRINT MARKS (.pm[data-decor])
// -----------------------------------------
// The home hero, the works panel and the profile card are three proof sheets: crop marks,
// registration, punch holes and small slugs in their margins. The marks live in an HTML embed
// on each page (with their CSS); this fills in what only the page knows.
// Home: the proof date, the trim size, the header column edges the marks hang on, and the
// pointer as sheet fractions (fine pointers only, never with reduced motion).
// Profile: the gap between the statement column and the portrait window (--pm-gx), and the
// pointer as on the home.
// Works: the proof date, the folder count, an index beside each folder, a "+" where the grid
// gutters cross, the colophon of an odd last row, and the active folder's cell (it follows
// data-active, set by the works preview on hover, focus or the touch cycle).
// Project (Works template): the project's number among the works and its name in the slug,
// the gallery's plate, the pointer as on the home.
// Layout is read on resize and once the fonts are in; the only per-frame work is one rect
// read in a frame requested by a pointer move. No loop runs on its own.

function initPrintMarks() {
  const offs = [];
  const pad = (n) => String(n).padStart(2, "0");
  const px = (n) => `${Math.round(n)}px`;
  const put = (el, text) => {
    if (el && el.textContent !== text) el.textContent = text;
  };

  // Pointer on a sheet, 0-1 with four decimals, into the marks' [data-pm-x] / [data-pm-y].
  // Dashes until the first reading, then the last value holds. One frame per burst of moves,
  // one rect read in it (fine pointers only, never with reduced motion)
  const trackPointer = (sheet, marks) => {
    const xEl = marks.querySelector("[data-pm-x]");
    const yEl = marks.querySelector("[data-pm-y]");
    if (!xEl || !yEl || reducedMotion) return;
    const controller = new AbortController();
    const clamp = (v) => Math.min(1, Math.max(0, v));
    let cx = 0,
      cy = 0,
      raf = 0;
    const write = () => {
      raf = 0;
      const r = sheet.getBoundingClientRect();
      if (!r.width || !r.height) return;
      put(xEl, clamp((cx - r.left) / r.width).toFixed(4));
      put(yEl, clamp((cy - r.top) / r.height).toFixed(4));
    };
    sheet.addEventListener("pointermove", (e) => {
      if (e.pointerType === "touch") return;
      cx = e.clientX;
      cy = e.clientY;
      if (!raf) raf = requestAnimationFrame(write);
    }, { passive: true, signal: controller.signal });
    offs.push(() => {
      controller.abort();
      cancelAnimationFrame(raf);
    });
  };

  // Proof date, day month year: "29 10 26"
  const d = new Date();
  const date = `${pad(d.getDate())} ${pad(d.getMonth() + 1)} ${pad(d.getFullYear() % 100)}`;
  nextPage.querySelectorAll(".pm [data-pm-date]").forEach((el) => put(el, date));

  // -- Home: the header strip's column edges, measured against the hero
  const home = nextPage.querySelector(".pm--home");
  const hero = home?.closest(".hd__hero");
  const strip = hero?.closest(".hd")?.querySelector(".hd__strip") || nextPage.querySelector(
    ".hd__strip");
  if (home && hero) {
    const cols = {
      "--pm-c1": [".hd__row.is--nav .hd__index", "left"], // first column
      "--pm-c2": [".hd__row.is--nav nav.hd__links", "left"], // second column
      "--pm-c3": [".hd__row.is--nav div.hd__links",
      "left"], // services (the right column on tablets and phones)
      "--pm-c4": [".hd__mail", "right"], // end of the mail column
      "--pm-c5": [".hd__folders", "left"], // divider before the folders
    };
    // The ticket: native in the hero ([data-pm-ticket], editable in the Designer) or the old
    // one inside the marks
    const ticket = hero.querySelector("[data-pm-ticket]") || home.querySelector(".pm__ticket");
    const native = !!ticket?.matches("[data-pm-ticket]");
    const trim = (native ? ticket : home).querySelector("[data-pm-trim]");
    const line = hero.querySelector(".hd__line");
    // The statement on the grid ([data-home-grid]): its rows step on the columns
    const grid = !!line?.matches("[data-home-grid]");
    const gap = 24; // px the ticket keeps from the statement
    const minVw = 3.8; // the statement never goes below its old size (vw)

    // Wide screens: the ticket hangs in the top band. The statement takes the room below it,
    // up to its CSS size; when even the old size doesn't fit, the ticket steps out (only
    // hidden, so its box can still be measured). Tablets and phones stack them instead
    const placeTicket = () => {
      if (!ticket || !line) return;
      if (grid) line.style.removeProperty("font-size");
      const hanging = !native || getComputedStyle(ticket).position === "absolute";
      const a = ticket.getBoundingClientRect();
      let b = line.getBoundingClientRect();
      if (grid && hanging) {
        const room = b.bottom - a.bottom - gap;
        if (b.height > room) {
          const size = parseFloat(getComputedStyle(line).fontSize);
          const min = window.innerWidth * minVw / 100;
          let fs = Math.max(min, Math.floor(size * Math.max(0, room) / b.height));
          line.style.fontSize = `${fs}px`;
          b = line.getBoundingClientRect();
          // The line's height is not quite linear in its size: step down until it clears
          while (b.top < a.bottom + gap && fs - 1 >= min) {
            fs -= 1;
            line.style.fontSize = `${fs}px`;
            b = line.getBoundingClientRect();
          }
        }
      }
      const clear = !hanging || a.bottom + gap <= b.top || a.top >= b.bottom + gap ||
        a.right <= b.left || a.left >= b.right;
      if (native) ticket.toggleAttribute("data-tight", !clear);
      else home.toggleAttribute("data-pm-tight-ticket", !clear);
    };

    const place = () => {
      const h = hero.getBoundingClientRect();
      if (strip) {
        // On the hero: the marks, the ticket and the statement's rows all read them
        for (const [prop, [selector, side]] of Object.entries(cols)) {
          const r = strip.querySelector(selector)?.getBoundingClientRect();
          if (r && r.width) hero.style.setProperty(prop, px(r[side] - h.left));
        }
      }
      put(trim, `${Math.round(h.width)} × ${Math.round(h.height)}`);
      placeTicket();
    };
    const observer = new ResizeObserver(place);
    observer.observe(hero);
    document.fonts?.ready.then(() => home.isConnected && place());
    offs.push(() => observer.disconnect());

    trackPointer(hero, home);
  }

  // -- Profile: the card is the sheet. The coordinates, the gutter crosses and the tone scale
  // hang on the gap between the statement column and the portrait window
  const profile = nextPage.querySelector(".pm--profile");
  const card = profile?.closest(".pf__card");
  if (profile && card) {
    const photo = card.querySelector(".pf__win.is--photo") || card.querySelector("[data-portrait]");
    const place = () => {
      const c = card.getBoundingClientRect();
      const r = photo?.getBoundingClientRect();
      if (!r || !r.width || !c.width) return;
      const gap = parseFloat(getComputedStyle(card).columnGap) || 0;
      profile.style.setProperty("--pm-gx", px(r.left - c.left - gap / 2));
    };
    const observer = new ResizeObserver(place);
    observer.observe(card);
    document.fonts?.ready.then(() => profile.isConnected && place());
    offs.push(() => observer.disconnect());
    trackPointer(card, profile);
  }

  // -- Works: marks from the folder grid
  const work = nextPage.querySelector(".pm--work");
  const panel = work?.closest(".wk__panel");
  const cells = work?.querySelector("[data-pm-cells]");
  if (work && panel && cells) {
    // Project folders (numbered and counted); the grid's cells also hold the "new project"
    // folder, which takes a cell without being a work
    const folders = [...panel.querySelectorAll(".wk__folder:not([data-works-cta])")];
    const cellOf = (el) => el.closest(".wk__item") || el;
    const gridItems = () => [...new Set([...panel.querySelectorAll(".wk__folder")].map(cellOf))];
    const total = pad(folders.length);
    work.querySelectorAll("[data-pm-count], [data-pm-total]").forEach((el) => put(el, total));
    const make = (tag, className, text) => {
      const el = document.createElement(tag);
      el.className = className;
      if (text) el.textContent = text;
      cells.appendChild(el);
      return el;
    };
    const indices = folders.map((f, i) => make("span", "pm__idx", pad(i + 1)));
    const crosses = [];
    const colophon = work.querySelector("[data-pm-colo]");
    const cellEls = [...work.querySelectorAll("[data-pm-cell]")];
    const indexEls = [...work.querySelectorAll("[data-pm-index]")];
    const corner = (f) => (f.querySelector(".hd__folder-corner") || f.querySelector(".wk__frame") ||
      f).getBoundingClientRect();
    let address = [];

    // The active folder: its index darkens on a chip, the readouts name its cell
    const sync = () => {
      const i = folders.findIndex((f) => f.hasAttribute("data-active"));
      indices.forEach((el, j) => el.classList.toggle("pm__idx--on", j === i));
      cellEls.forEach((el) => put(el, address[i] || "—"));
      indexEls.forEach((el) => put(el, i < 0 ? "—" : pad(i + 1)));
    };

    const place = () => {
      if (!folders.length) return;
      const p = panel.getBoundingClientRect();
      if (!p.width || !p.height) return;
      const items = gridItems().map((el) => el.getBoundingClientRect());
      const frames = folders.map((f) => (f.querySelector(".wk__frame") || f)
        .getBoundingClientRect());

      // Columns and rows of the grid, from every cell's edges: cells A1, B1...
      const key = (n) => Math.round(n);
      const lefts = [...new Set(items.map((r) => key(r.left)))].sort((a, b) => a - b);
      const tops = [...new Set(items.map((r) => key(r.top)))].sort((a, b) => a - b);
      const col = (r) => lefts.indexOf(key(r.left));
      const row = (r) => tops.indexOf(key(r.top));
      address = folders.map((f) => {
        const r = cellOf(f).getBoundingClientRect();
        return String.fromCharCode(65 + col(r)) + (row(r) + 1);
      });

      // One "+" where two gutter centre lines cross
      const gx = lefts.slice(1).map((l, c) => (Math.max(...items.filter((r) => col(r) === c).map((
        r) => r.right)) + l) / 2 - p.left);
      const gy = tops.slice(1).map((t, k) => (Math.max(...items.filter((r) => row(r) === k).map((
        r) => r.bottom)) + t) / 2 - p.top);
      const points = gx.flatMap((x) => gy.map((y) => [x, y]));
      while (crosses.length < points.length) crosses.push(make("i", "pm__cross"));
      crosses.forEach((cross, i) => {
        cross.style.display = points[i] ? "" : "none";
        if (points[i]) Object.assign(cross.style, { left: px(points[i][0]), top: px(points[i][
            1
          ]) });
      });

      // Index: its text ends 4px left of the frame, level with the top-left corner mark
      frames.forEach((r, i) => Object.assign(indices[i].style, { left: px(r.left - p.left - 2),
        top: px(r.top - p.top + 6) }));

      // The first empty cell of an odd last row: the colophon, on the corner mark of the
      // folder above it (x) and of the last row (y)
      // (Cells, not folders: a "new project" folder in the last row fills its cell)
      const all = [...panel.querySelectorAll(".wk__folder")];
      const n = all.length,
        k = lefts.length;
      const blank = !!colophon && n > k && n % k > 0;
      if (blank) {
        work.style.setProperty("--pm-cx", px(corner(all[n - k]).left - p.left));
        work.style.setProperty("--pm-cy", px(corner(all[n - 1]).top - p.top));
      }
      work.toggleAttribute("data-pm-blank", blank);

      // The readout starts on the first column's corner marks. The bands above and below the
      // folders must leave room for the registration mark and the readout
      const top = Math.min(...frames.map((r) => r.top)) - p.top;
      const lastBottom = Math.max(...all.map((f) => f.getBoundingClientRect().bottom)) - p.top;
      work.style.setProperty("--pm-fl", px(Math.min(...folders.map((f) => corner(f).left)) - p
        .left));
      work.toggleAttribute("data-pm-tight-top", top < 56);
      work.toggleAttribute("data-pm-tight-bottom", p.height - lastBottom < 48);
      sync();
    };
    const observer = new ResizeObserver(place);
    observer.observe(panel);
    document.fonts?.ready.then(() => work.isConnected && place());
    const activeObserver = new MutationObserver(sync);
    folders.forEach((f) => activeObserver.observe(f, { attributes: true, attributeFilter: [
        "data-active"
      ] }));
    offs.push(() => {
      observer.disconnect();
      activeObserver.disconnect();
    });
  }

  // -- Project: the light text card is the sheet. Its number among the works comes from the
  // Works page (read once per visit, shared with the profile TV), matched by the project's
  // name, else by its path; the plate follows the gallery slider
  const project = nextPage.querySelector(".pm--project");
  const projectSheet = project?.closest(".pd__grid");
  if (project && projectSheet) {
    const name = (nextPage.querySelector("h1")?.textContent || "").replace(/\s+/g, " ").trim();
    if (name) project.querySelectorAll("[data-pm-name]").forEach((el) => put(el, name));
    const titleIndex = nextPage.querySelector("[data-pd-index]");
    const key = (s) => (s || "").toLowerCase().replace(/\s+/g, " ").trim();
    const path = (href) => {
      try {
        return new URL(href, location.origin).pathname.replace(/\/$/, "");
      } catch (e) {
        return "";
      }
    };
    tvLoadChannels("/work").then((list) => {
      if (!project.isConnected) return;
      let i = name ? list.findIndex((c) => key(c.name) === key(name)) : -1;
      if (i < 0) i = list.findIndex((c) => path(c.href) === path(location.href));
      if (i < 0) return;
      const n = pad(i + 1),
        total = pad(list.length);
      project.querySelectorAll("[data-pm-index]").forEach((el) => put(el, n));
      project.querySelectorAll("[data-pm-total]").forEach((el) => put(el, total));
      put(titleIndex, `(${n}/${total})`);
    }).catch(() => {});

    // Plate n/total of the gallery: data-images until the slider reports what it shows
    const slider = nextPage.querySelector("#slider[data-images]");
    const plate = project.querySelector("[data-pm-plate]");
    const plates = project.querySelector("[data-pm-plates]");
    if (slider) {
      try {
        const images = JSON.parse(slider.getAttribute("data-images") || "[]");
        if (images.length) put(plates, pad(images.length));
      } catch (e) {}
      const controller = new AbortController();
      const show = ({ detail }) => {
        put(plate, pad(detail.index + 1));
        put(plates, pad(detail.total));
      };
      slider.addEventListener("ditherslider:ready", show, { signal: controller.signal });
      slider.addEventListener("ditherslider:change", show, { signal: controller.signal });
      offs.push(() => controller.abort());
    }

    trackPointer(projectSheet, project);
  }

  onPageLeave(() => offs.forEach((off) => off()));
}

// -----------------------------------------
// PROJECT: CASE STUDY CHAPTERS
// -----------------------------------------
// Projects with "Has case study" on (CMS) carry a hidden [data-case-slides] block:
// one [data-case-slide] per chapter with its image, label and caption, and optionally a
// [data-case-video] with a video URL (plays instead of the image, which stays as fallback).
// Chapters without an image or a video are skipped. They replace the slider's data-images,
// and the label, caption and counter follow the slider through its ditherslider:* events

const CASE_TEXT_OUT = { duration: 0.35, stagger: 0.02, ease: "power2.in" };
const WEBFLOW_PLACEHOLDER = /\/placeholder\.[0-9a-f]+\.svg$/;

// Video URL of a chapter: a link's href, the data-case-video value or the element's text
// (a CMS text field bound to it). Empty CMS fields give ""
function readCaseVideo(slide) {
  const el = slide.querySelector("[data-case-video]");
  if (!el) return "";
  const value = (el.getAttribute("href") || el.getAttribute("data-case-video") ||
    el.textContent).trim();
  return /^https?:\/\/\S+$/.test(value) ? value : "";
}

function readCaseSlides(page) {
  const block = page.querySelector("[data-case-slides]");
  if (!block) return [];

  return [...block.querySelectorAll("[data-case-slide]")]
    .map((slide) => {
      const img = slide.querySelector("img");
      const src = img?.getAttribute("src") || "";
      // An image bound to an empty CMS field: w-dyn-bind-empty, or Webflow's placeholder
      const empty = !src || img.classList.contains("w-dyn-bind-empty") ||
        WEBFLOW_PLACEHOLDER.test(src);
      return {
        url: empty ? "" : src,
        video: readCaseVideo(slide),
        chapter: slide.querySelector("[data-case-chapter]")?.textContent.trim() || "",
        caption: slide.querySelector("[data-case-caption]")?.textContent.trim() || "",
      };
    })
    .filter((slide) => slide.url || slide.video);
}

// [data-split="heading"] text swap: current lines slide out, new lines slide in
function swapHeadingText(el, value) {
  if (!el || !value || el.textContent.trim() === value) return;
  const config = HEADING_REVEAL.default;

  el._swap?.kill();
  el._reveal?.kill();

  // Revert the old split before writing: otherwise the next split reverts it and
  // puts the old text back
  const replaceText = () => {
    el._split?.revert();
    el._split = null;
    el.textContent = value;
  };

  if (reducedMotion) {
    replaceText();
    return;
  }

  const lines = el.querySelectorAll(".mask-line > div");
  const tl = gsap.timeline();
  if (lines.length) tl.to(lines, { yPercent: -100, ...CASE_TEXT_OUT });
  tl.call(() => {
    replaceText();
    el._reveal = gsap.fromTo(splitHeadingLines(el), { yPercent: 100 }, {
      yPercent: 0,
      duration: config.duration,
      stagger: config.stagger,
      ease: "power4.out",
    });
  });
  el._swap = tl;
}

// Chapter label: scrambles into the new name (plain swap without the plugin)
function swapLabelText(el, value) {
  if (!el || el.textContent === value) return;
  gsap.killTweensOf(el);

  if (reducedMotion || !window.ScrambleTextPlugin) {
    el.textContent = value;
    return;
  }
  gsap.registerPlugin(ScrambleTextPlugin);
  gsap.to(el, {
    duration: 0.6,
    ease: "none",
    scrambleText: { text: value, chars: "upperCase", speed: 0.6 },
  });
}

// Multi-word values (Works side card): scrambles into the new value left to right, but
// unlike ScrambleTextPlugin (one run of random letters, no spaces) it keeps spaces and
// separators where they belong and only shuffles each word's own unrevealed letters. The
// scrambled text has the final words and widths, so it wraps like the final one and never
// runs out of its box. The tween is kept on el._scramble
function scrambleWords(el, value, duration = 0.6) {
  if (!el || el.textContent === value) return;
  el._scramble?.kill();
  el._scramble = null;
  if (reducedMotion) {
    el.textContent = value;
    return;
  }

  // Kerning still differs a hair between shuffles: the box keeps the final value's height
  // while it scrambles (a shuffle that would wrap one more line is clipped, never a jump)
  el.textContent = value;
  el.style.height = `${el.getBoundingClientRect().height}px`;
  el.style.overflow = "hidden";
  const release = () => {
    el.style.removeProperty("height");
    el.style.removeProperty("overflow");
  };

  const chars = [...value];
  // Runs of letters/digits: [start, end) of each word
  const words = [];
  chars.forEach((ch, i) => {
    if (!/[\p{L}\p{N}]/u.test(ch)) return;
    const last = words[words.length - 1];
    if (last && last[1] === i) last[1] = i + 1;
    else words.push([i, i + 1]);
  });

  const frame = (shown) => {
    const out = chars.slice();
    words.forEach(([start, end]) => {
      const from = Math.max(start, shown);
      if (from >= end) return;
      const rest = chars.slice(from, end);
      for (let i = rest.length - 1; i > 0; i--) {
        const j = Math.floor(Math.random() * (i + 1));
        [rest[i], rest[j]] = [rest[j], rest[i]];
      }
      rest.forEach((ch, k) => { out[from + k] = ch; });
    });
    return out.join("");
  };

  const state = { p: 0 };
  let drawn = "";
  el._scramble = gsap.to(state, {
    p: 1,
    duration,
    ease: "none",
    onUpdate: () => {
      // New shuffle every 45ms (or when one more letter settles), not every frame
      const shown = Math.floor(state.p * chars.length);
      const key = `${shown}:${Math.floor(state.p * duration / 0.045)}`;
      if (key === drawn) return;
      drawn = key;
      el.textContent = frame(shown);
    },
    onComplete: () => {
      el.textContent = value;
      el._scramble = null;
      release();
    },
    onInterrupt: release,
  });
}

// The caption box gets the height of the longest caption at the current width, so a
// caption with one line less never moves the label or the rows above it.
// Same character count is not enough: line breaks depend on the words and the width
function reserveCaptionHeight(el, captions) {
  // Exact width: offsetWidth rounds down, and a fraction of a pixel less can push a
  // word to the next line
  const width = el?.isConnected ? el.getBoundingClientRect().width : 0;
  if (!width) return;

  // Unsplit copy with the same classes and width, measured off screen
  const probe = el.cloneNode(false);
  probe.removeAttribute("data-split");
  probe.removeAttribute("data-case-text");
  Object.assign(probe.style, {
    position: "absolute",
    left: "-9999px",
    top: "0",
    width: `${width}px`,
    height: "auto",
    minHeight: "0",
    visibility: "hidden",
    pointerEvents: "none",
  });
  el.parentNode.appendChild(probe);

  let tallest = 0;
  captions.forEach((caption) => {
    probe.textContent = caption;
    tallest = Math.max(tallest, probe.getBoundingClientRect().height);
  });
  probe.remove();

  el.style.minHeight = `${Math.ceil(tallest)}px`;
}

// beforeEnter, before the heading split and the slider: the first chapter's text is in
// place before anything is split, and the slider is built from the chapter images
function initCaseStudy() {
  const page = nextPage;
  const slider = page.querySelector("#slider[data-images]");
  const slides = readCaseSlides(page);
  if (!slider || slides.length < 2) return; // fewer than 2 chapters: default gallery

  slider.setAttribute("data-images", JSON.stringify(slides.map(({ url, video }) =>
    (video ? { video, image: url } : url))));

  const label = page.querySelector("[data-case-label]");
  const text = page.querySelector("[data-case-text]");
  const count = page.querySelector("[data-case-count]");
  const description = text?.textContent.trim() || "";
  const pad = (n) => String(n).padStart(2, "0");
  let total = slides.length;

  const setCount = (position) => {
    if (count) count.textContent = `${pad(position + 1)} / ${pad(total)}`;
  };

  // slide: chapter in `slides`, position: where it sits in the slider
  const show = (slide, position, animate) => {
    const chapter = slides[slide];
    if (!chapter) return;
    setCount(position);

    const caption = chapter.caption || description;
    if (!animate) {
      if (label) label.textContent = chapter.chapter;
      if (text && caption) text.textContent = caption;
      return;
    }
    swapLabelText(label, chapter.chapter);
    swapHeadingText(text, caption);
  };

  // Not split yet: plain text swap
  show(0, 0, false);

  const controller = new AbortController();
  const { signal } = controller;

  // Slides that fail to load are dropped by the slider: count only what it shows
  slider.addEventListener("ditherslider:ready", ({ detail }) => {
    total = detail.total;
    // The first chapter's image failed: move the text to the one actually on screen.
    // Otherwise only the count changes (the heading may already be split)
    if (detail.source === 0) setCount(detail.index);
    else show(detail.source, detail.index, true);
  }, { signal });

  slider.addEventListener("ditherslider:change", ({ detail }) => {
    show(detail.source, detail.index, true);
  }, { signal });

  // Fixed caption height: measured once the web fonts are in, again when the width changes
  if (text) {
    const captions = slides.map((slide) => slide.caption || description);
    const reserve = () => reserveCaptionHeight(text, captions);
    whenFontsReady(reserve);
    window.addEventListener("resize", debounceOnWidthChange(reserve, 150), { signal });
  }

  onPageLeave(() => {
    controller.abort();
    if (label) gsap.killTweensOf(label);
    text?._swap?.kill();
  });
}

// -----------------------------------------
// PROJECT PAGE ([data-pp], Works template)
// -----------------------------------------
// One screen under the header band, three columns on the white sheet: the project (left,
// fixed), its images (center, the only column that scrolls), its details (right, fixed).
// The CMS fields sit in a hidden [data-pp-data] block (bindings kept from the old template);
// the figures, thumbnails, detail rows and the next project are built from it here. Every
// image sits in a site window at its own proportions, never cropped, and is printed by the
// slider's dither cloud when it comes into view. Scrolling on past the end fills the next
// project's meter; full, it opens it. Phones and tablets: one column, the page scrolls

const PP = {
  desktop: "(min-width: 992px)",
  fieldCell: 6, // CSS px per texel of the cloud's shape, as in the project slider
  print: 1300, // ms, one print (the slider's sweep is 1.2 s)
  stagger: 140, // ms between figures that come into view together
  threshold: 0.2, // share of a figure in view before it prints
  maxTexture: 2048, // px, larger images go to the GPU scaled down (originals can be ~4000px)
  thumbCell: 2, // CSS px per dither cell of a thumbnail
  thumbTurn: 900, // ms, a thumbnail's dither turning into the image
  wheel: 900, // px of wheel past the end to fill the meter
  touch: 0.35, // share of the screen height of swipe past the end to fill it
  drain: 1.1, // meter per second once the input stops
  idle: 160, // ms without input before the meter drains
  pitch: 7, // px, one block of the meter (5) and its gap (2)
  sizeWait: 2500, // ms, longest wait for the images' proportions before the column prints
  coverWidth: 1600, // px, the srcset candidate of the next project's cover
};

const PP_FRAGMENT = `
  precision highp float;
  uniform sampler2D map;
  uniform sampler2D fieldMap;
  uniform vec4 rect;        // the figure in framebuffer px: x, y (from the bottom), w, h
  uniform float progress;
  uniform float ditherSize;
  uniform vec3 paper;
  varying vec2 vUv;
  ${DITHER_CLOUD_GLSL}
  ${DITHER_BAYER_GLSL}
  float luma(vec3 c) { return dot(c, vec3(0.299, 0.587, 0.114)); }
  void main() {
    vec2 cloud = ditherCloud(texture2D(fieldMap, vUv), progress);
    float density = cloud.x;
    float passed = cloud.y;
    vec2 cell = floor(gl_FragCoord.xy / ditherSize);
    // Outside the cloud: the image where it has passed, the bare paper (nothing) ahead
    if (bayer8(cell.yx + vec2(3.0, 5.0)) + 0.06 > density) {
      if (passed < 0.5) discard;
      gl_FragColor = vec4(texture2D(map, vUv).rgb, 1.0);
      return;
    }
    // Inside the cloud: 1-bit black and white dither of what is there
    vec2 cellUv = ((cell + 0.5) * ditherSize - rect.xy) / rect.zw;
    vec3 src = passed > 0.5 ? texture2D(map, cellUv).rgb : paper;
    float lum = smoothstep(0.12, 0.88, luma(src));
    gl_FragColor = vec4(vec3(step(bayer8(cell) + 1.0 / 128.0, lum)), 1.0);
  }
`;

const ppPad = (n) => String(n).padStart(2, "0");

function ppEl(tag, cls, text) {
  const el = document.createElement(tag);
  if (cls) el.className = cls;
  if (text != null) el.textContent = text;
  return el;
}

// The project, from the hidden CMS block. Empty fields carry w-dyn-bind-empty
function ppReadProject(page) {
  const data = page.querySelector("[data-pp-data]");
  const field = (name) => {
    const el = data?.querySelector(`[data-pp-field="${name}"]`);
    return el && !el.classList.contains("w-dyn-bind-empty") ? el : null;
  };
  const text = (name) => cleanCmsText(field(name)?.textContent || "");
  const lines = (name) => richTextLines(field(name));

  const name = cleanCmsText(page.querySelector("[data-pp-name]")?.textContent || "");
  const description = cleanCmsText(page.querySelector("[data-pp-desc]")?.textContent || "");

  // Visual identity: "COLOR 1: #263CFF" lines, then the typefaces
  const colors = [];
  const fonts = [];
  lines("visual").forEach((line) => {
    const hex = line.match(/#([0-9a-f]{6}|[0-9a-f]{3})\b/i);
    if (hex) colors.push(`#${hex[1]}`.toUpperCase());
    else if (!/^colou?r\b/i.test(line)) fonts.push(line);
  });

  // Media: the case study's chapters (two or more, as the slider had it), else img1-4.
  // Chapter 1's caption is the description, already in the left column
  const block = data?.querySelector("[data-case-slides]");
  const caseStudy = !!block && !block.classList.contains("w-condition-invisible");
  const slides = caseStudy ? readCaseSlides(data) : [];
  let media;
  if (slides.length >= 2) {
    media = slides.map((slide) => ({
      src: slide.url,
      video: slide.video,
      label: slide.chapter,
      caption: cleanCmsText(slide.caption) === description ? "" : cleanCmsText(slide.caption),
    }));
  } else {
    let entries = [];
    try {
      entries = JSON.parse(data?.querySelector("[data-images]")?.getAttribute("data-images") ||
        "[]");
    } catch (e) {}
    media = entries.map((entry) => (typeof entry === "string" ?
      (isVideoUrl(entry) ? { video: entry } : { src: entry }) :
      { src: entry?.image || "", video: entry?.video || "" }));
  }
  media = media
    .map((m) => ({ ...m, src: m.src && !WEBFLOW_PLACEHOLDER.test(m.src) ? m.src : "" }))
    .filter((m) => m.src || m.video);

  // The next project in the page itself (the old template's list): used when the Works
  // page can't be read
  const nextLink = field("next");
  const fallbackNext = nextLink?.getAttribute("href") ? {
    href: nextLink.getAttribute("href"),
    name: cleanCmsText(field("next-name")?.textContent || ""),
    cover: worksCoverSrc(nextLink.querySelector("img"), PP.coverWidth),
  } : null;

  return {
    name,
    description,
    caseStudy,
    chapters: slides.length >= 2,
    role: text("role"),
    timeline: text("timeline"),
    outcome: text("outcome"),
    services: lines("services"),
    tools: lines("tools"),
    partners: lines("partners"),
    colors,
    fonts,
    media,
    fallbackNext,
  };
}

// A site window (black bar, title, three keys) around a box at the media's proportions; the
// media stays hidden (.is-pending) until it's printed
function ppMediaWin(title, src, video) {
  const win = ppEl("div", "pf__win pp__win");
  const bar = ppEl("div", "pf__win-bar");
  const keys = ppEl("span", "pf__win-keys");
  keys.append(ppEl("i", "pf__win-key"), ppEl("i", "pf__win-key"), ppEl("i", "pf__win-key"));
  bar.append(ppEl("span", "pf__win-title", title), keys);
  const box = ppEl("div", "pp__media");
  let node;
  if (video) {
    node = document.createElement("video");
    node.muted = true;
    node.loop = true;
    node.playsInline = true;
    node.preload = "auto";
    node.crossOrigin = "anonymous";
    node.setAttribute("muted", "");
    node.setAttribute("playsinline", "");
    if (src) node.poster = src; // the chapter's image, if the video can't play
    node.src = video.trim();
  } else {
    node = new Image();
    node.crossOrigin = "anonymous"; // the dither reads its pixels
    node.decoding = "async";
    node.alt = "";
    node.src = src;
  }
  node.classList.add("is-pending");
  box.append(node);
  win.append(bar, box);
  return { win, box, node };
}

// The media's own size, [w, h], as soon as it is known (an image's header is in long before
// the image), null if it fails
function ppNaturalSize(node) {
  return new Promise((resolve) => {
    if (node.tagName === "VIDEO") {
      const done = () => resolve(node.videoWidth ? [node.videoWidth, node.videoHeight] : null);
      if (node.readyState >= 1) return done();
      node.addEventListener("loadedmetadata", done, { once: true });
      node.addEventListener("error", () => resolve(null), { once: true });
      return;
    }
    let frame = 0;
    const finish = (size) => {
      cancelAnimationFrame(frame);
      resolve(size);
    };
    const check = () => {
      if (node.naturalWidth) return finish([node.naturalWidth, node.naturalHeight]);
      if (!node.isConnected) return finish(null); // the page has gone
      frame = requestAnimationFrame(check);
    };
    node.addEventListener("error", () => finish(null), { once: true });
    check();
  });
}

// The media can be drawn: an image decoded, a video with its first frame
function ppMediaReady(node) {
  if (node.tagName !== "VIDEO") {
    return node.complete && node.naturalWidth ? Promise.resolve() : node.decode();
  }
  return new Promise((resolve, reject) => {
    if (node.readyState >= 2) return resolve();
    node.addEventListener("loadeddata", resolve, { once: true });
    node.addEventListener("error", reject, { once: true });
    node.play().catch(() => {});
  });
}

// Dither print: one WebGL canvas over the window draws only the figures being printed, at
// their place on screen and clipped to the scrolling column. The cloud and the 1-bit dither
// are the project slider's: the paper is ahead of the cloud, the image behind it. When it has
// passed, the real <img>/<video> takes over (GIFs animate, videos play). Every print
// dispatches pp:printed on its box ({ delay } ms until it starts)
function ppReveal(canvas, signal) {
  const printed = (box, delay) => {
    box.dataset.printed = "1";
    box.dispatchEvent(new CustomEvent("pp:printed", { detail: { delay } }));
  };
  const items = [];
  let root = null;
  let started = false;
  let io = null;

  // Videos play only while they're on screen
  let videoIo = null;
  const watchVideos = () => {
    videoIo?.disconnect();
    videoIo = new IntersectionObserver((entries) => entries.forEach((e) => {
      if (e.isIntersecting) e.target.play().catch(() => {});
      else e.target.pause();
    }), { root, threshold: 0.05 });
    items.forEach((it) => it.node.tagName === "VIDEO" && videoIo.observe(it.node));
  };

  const observe = (onIn) => {
    io?.disconnect();
    io = new IntersectionObserver((entries) => entries.forEach((e) => {
      if (!e.isIntersecting) return;
      const it = items.find((x) => x.box === e.target);
      if (!it || it.state !== "idle") return;
      io.unobserve(e.target);
      onIn(it);
    }), { root, threshold: PP.threshold });
    items.forEach((it) => it.state === "idle" && io.observe(it.box));
  };

  // No WebGL or reduced motion: the media fades in when it comes into view
  const plain = () => (it) => {
    it.state = "loading";
    ppMediaReady(it.node).catch(() => {}).finally(() => {
      it.node.classList.remove("is-pending");
      it.state = "done";
      printed(it.box, 0);
    });
  };

  let renderer = null;
  if (!reducedMotion && window.THREE) {
    try {
      renderer = new THREE.WebGLRenderer({ canvas, alpha: true, antialias: false });
    } catch (e) {
      renderer = null;
    }
  }

  const api = {
    add(box) {
      const node = box.firstElementChild;
      const it = { box, node, state: "idle" };
      items.push(it);
      if (started) {
        io?.observe(box);
        if (node.tagName === "VIDEO") videoIo?.observe(node);
      }
    },
    setRoot(el) {
      root = el;
      if (!started) return;
      watchVideos();
      observe(onIn);
    },
    start() {
      if (started) return;
      started = true;
      watchVideos();
      observe(onIn);
    },
    destroy() {
      io?.disconnect();
      videoIo?.disconnect();
      items.forEach((it) => it.node.tagName === "VIDEO" && it.node.pause());
      teardown();
    },
  };

  let onIn = plain();
  let teardown = () => {};
  if (!renderer) {
    canvas.closest("[data-pp]")?.classList.add("pp--plain");
    return api;
  }

  renderer.setPixelRatio(Math.min(window.devicePixelRatio || 1, 2));
  renderer.setClearColor(0x000000, 0);
  const scene = new THREE.Scene();
  const camera = new THREE.OrthographicCamera(0, 1, 0, -1, -10, 10);
  const geometry = new THREE.PlaneGeometry(1, 1);
  let W = 0,
    H = 0;
  const size = () => {
    W = window.innerWidth;
    H = window.innerHeight;
    renderer.setSize(W, H, false);
    camera.right = W;
    camera.bottom = -H;
    camera.updateProjectionMatrix();
  };
  size();
  window.addEventListener("resize", size, { signal });

  const active = new Set();
  let frame = 0;
  let lastStart = 0;

  // Large images go to the GPU scaled down
  const source = (img) => {
    if (img.naturalWidth <= PP.maxTexture) return img;
    const c = document.createElement("canvas");
    c.width = PP.maxTexture;
    c.height = Math.round(img.naturalHeight * PP.maxTexture / img.naturalWidth);
    c.getContext("2d").drawImage(img, 0, 0, c.width, c.height);
    return c;
  };

  const start = (it) => {
    const isVideo = it.node.tagName === "VIDEO";
    const map = isVideo ? new THREE.VideoTexture(it.node) : new THREE.Texture(source(it.node));
    map.minFilter = THREE.LinearFilter;
    map.magFilter = THREE.LinearFilter;
    map.generateMipmaps = false;
    map.needsUpdate = true;
    const r = it.box.getBoundingClientRect();
    const f = ditherField(r.width, r.height, PP.fieldCell);
    const field = new THREE.DataTexture(f.data, f.cols, f.rows, THREE.RGBAFormat);
    field.minFilter = THREE.LinearFilter;
    field.magFilter = THREE.LinearFilter;
    field.generateMipmaps = false;
    field.needsUpdate = true;
    const material = new THREE.ShaderMaterial({
      uniforms: {
        map: { value: map },
        fieldMap: { value: field },
        rect: { value: new THREE.Vector4() },
        progress: { value: 0 },
        ditherSize: { value: 1 },
        paper: { value: new THREE.Color(1, 1, 1) },
      },
      vertexShader: DITHER_SLIDER_VERTEX,
      fragmentShader: PP_FRAGMENT,
      depthTest: false,
    });
    const mesh = new THREE.Mesh(geometry, material);
    scene.add(mesh);
    // Figures that come in together print one after the other
    const now = performance.now();
    lastStart = Math.max(now, lastStart + PP.stagger);
    Object.assign(it, { state: "running", mesh, material, map, field, t0: lastStart, shown: 0 });
    active.add(it);
    printed(it.box, lastStart - now);
    if (!frame) frame = requestAnimationFrame(draw);
  };

  const cleanup = (it) => {
    scene.remove(it.mesh);
    it.material.dispose();
    it.map.dispose();
    it.field.dispose();
    active.delete(it);
    it.state = "done";
  };

  const draw = (now) => {
    frame = 0;
    const clip = root ? root.getBoundingClientRect() : { left: 0, top: 0, width: W, height: H };
    const pr = renderer.getPixelRatio();
    renderer.setScissorTest(true);
    renderer.setScissor(clip.left, H - (clip.top + clip.height), clip.width, clip.height);
    for (const it of active) {
      const r = it.box.getBoundingClientRect();
      const t = Math.min(1, Math.max(0, (now - it.t0) / PP.print));
      it.material.uniforms.progress.value = t;
      it.mesh.position.set(r.left + r.width / 2, -(r.top + r.height / 2), 0);
      it.mesh.scale.set(r.width, r.height, 1);
      it.material.uniforms.rect.value.set(r.left * pr, (H - r.bottom) * pr, r.width * pr, r
        .height * pr);
      // Done: the real element shows under the last frame, the mesh goes the next one
      if (t >= 1) {
        it.node.classList.remove("is-pending");
        it.shown++;
      }
    }
    renderer.render(scene, camera);
    [...active].forEach((it) => it.shown > 1 && cleanup(it));
    if (active.size) frame = requestAnimationFrame(draw);
    else {
      renderer.setScissorTest(false);
      renderer.clear();
    }
  };

  onIn = (it) => {
    it.state = "loading";
    ppMediaReady(it.node).then(() => {
      if (!signal.aborted) start(it);
    }).catch(() => {
      it.node.classList.remove("is-pending");
      it.state = "done";
      printed(it.box, 0);
    });
  };

  teardown = () => {
    cancelAnimationFrame(frame);
    [...active].forEach(cleanup);
    geometry.dispose();
    renderer.dispose();
    renderer.forceContextLoss?.();
  };
  return api;
}

// Thumbnails, at the bottom of the left column: one per image, at its own proportions. Until
// its image has been printed in the column a thumbnail is a coarse 1-bit dither you can't
// quite read; then it turns into the image, in the dither's Bayer order. The one in view is
// marked, and a click scrolls the column to it
function ppThumbs(nav, figures, goTo, signal) {
  const BAYER = [0, 32, 8, 40, 2, 34, 10, 42, 48, 16, 56, 24, 50, 18, 58, 26, 12, 44, 4, 36, 14,
    46, 6, 38, 60, 28, 52, 20, 62, 30, 54, 22, 3, 35, 11, 43, 1, 33, 9, 41, 51, 19, 59, 27, 49,
    17,
    57, 25, 15, 47, 7, 39, 13, 45, 5, 37, 63, 31, 55, 23, 61, 29, 53, 21
  ];
  const bayer = (x, y) => (BAYER[(y & 7) * 8 + (x & 7)] + 0.5) / 64;
  const total = figures.length;
  const head = ppEl("div", "pp__index-head");
  head.append(ppEl("span", null, "(Index)"), ppEl("span", null, ppPad(total)));
  const row = ppEl("div", "pp__thumbs");
  nav.append(head, row);

  const frameReady = (node) => new Promise((resolve, reject) => {
    if (node.tagName === "VIDEO") {
      if (node.readyState >= 2) return resolve();
      node.addEventListener("loadeddata", resolve, { once: true });
      node.addEventListener("error", reject, { once: true });
    } else if (node.complete && node.naturalWidth) resolve();
    else {
      node.addEventListener("load", resolve, { once: true });
      node.addEventListener("error", reject, { once: true });
    }
  });

  const paint = (it) => {
    const { canvas, node } = it;
    const r = canvas.getBoundingClientRect();
    if (!r.width) return false; // hidden (phones)
    const dpr = Math.min(window.devicePixelRatio || 1, 2);
    const W = Math.max(1, Math.round(r.width * dpr));
    const H = Math.max(1, Math.round(r.height * dpr));
    canvas.width = W;
    canvas.height = H;
    const ctx = canvas.getContext("2d", { willReadFrequently: true });
    ctx.imageSmoothingQuality = "high";
    ctx.drawImage(node, 0, 0, W, H);
    it.color = ctx.getImageData(0, 0, W, H);
    // The image at one pixel per cell, then 1-bit through the Bayer matrix
    const cell = Math.max(1, Math.round(PP.thumbCell * dpr));
    const cols = Math.ceil(W / cell);
    const rows = Math.ceil(H / cell);
    const small = document.createElement("canvas");
    small.width = cols;
    small.height = rows;
    const sctx = small.getContext("2d", { willReadFrequently: true });
    sctx.drawImage(node, 0, 0, cols, rows);
    const px = sctx.getImageData(0, 0, cols, rows).data;
    const dither = ctx.createImageData(W, H);
    const d = dither.data;
    for (let y = 0; y < H; y++) {
      const cy = Math.floor(y / cell);
      for (let x = 0; x < W; x++) {
        const cx = Math.floor(x / cell);
        const k = (cy * cols + cx) * 4;
        let l = (0.299 * px[k] + 0.587 * px[k + 1] + 0.114 * px[k + 2]) / 255;
        l = Math.min(1, Math.max(0, (l - 0.12) / 0.76));
        l = l * l * (3 - 2 * l);
        const v = l > bayer(cx, cy) ? 255 : 0;
        const o = (y * W + x) * 4;
        d[o] = d[o + 1] = d[o + 2] = v;
        d[o + 3] = 255;
      }
    }
    it.dither = dither;
    it.cell = cell;
    ctx.putImageData(it.turn === 1 ? it.color : dither, 0, 0);
    return true;
  };

  const turn = (it, delay) => {
    if (!it.dither) {
      it.wantTurn = delay; // painted later: turns then
      return;
    }
    if (it.turn != null) return;
    const ctx = it.canvas.getContext("2d");
    if (reducedMotion) {
      it.turn = 1;
      ctx.putImageData(it.color, 0, 0);
      return;
    }
    it.turn = 0;
    const t0 = performance.now() + Math.max(0, delay || 0);
    const { width: W, height: H } = it.canvas;
    const out = ctx.createImageData(W, H);
    const step = (now) => {
      if (signal.aborted) return;
      const t = Math.min(1, Math.max(0, (now - t0) / PP.thumbTurn));
      // Cells switch from dither to image in Bayer order
      const a = it.color.data,
        b = it.dither.data,
        o = out.data;
      for (let y = 0; y < H; y++) {
        const cy = Math.floor(y / it.cell);
        for (let x = 0; x < W; x++) {
          const src = bayer(Math.floor(x / it.cell), cy) < t ? a : b;
          const k = (y * W + x) * 4;
          o[k] = src[k];
          o[k + 1] = src[k + 1];
          o[k + 2] = src[k + 2];
          o[k + 3] = 255;
        }
      }
      ctx.putImageData(out, 0, 0);
      it.turn = t;
      if (t < 1) requestAnimationFrame(step);
    };
    requestAnimationFrame(step);
  };

  const items = figures.map((fig, i) => {
    const b = ppEl("button", "pp__thumb");
    b.type = "button";
    b.setAttribute("aria-label", `Image ${ppPad(i + 1)} of ${ppPad(total)}`);
    const canvas = document.createElement("canvas");
    b.append(canvas);
    b.addEventListener("click", () => goTo(i), { signal });
    row.append(b);
    const it = { b, canvas, node: fig.node, dither: null, color: null, cell: 1, turn: null,
      wantTurn: null };
    fig.box.addEventListener("pp:printed", (e) => turn(it, e.detail.delay), { signal });
    return it;
  });

  const draw = (it) => {
    frameReady(it.node).then(() => {
      if (signal.aborted || !paint(it)) return;
      if (it.wantTurn != null) turn(it, it.wantTurn);
    }).catch(() => {});
  };
  items.forEach(draw);

  // Sizes change with the window: paint again at the new size
  window.addEventListener("resize", debounceOnWidthChange(() => items.forEach((it) => {
    if (it.turn == null || it.turn >= 1) draw(it);
  }), 200), { signal });

  return {
    setRatio(i, ratio) {
      items[i]?.b.style.setProperty("--ratio", ratio);
    },
    setCurrent(i) {
      items.forEach((it, k) => it.b.setAttribute("aria-current", String(k === i)));
    },
  };
}

// Osmo Supply's Button 077: the arrow is redrawn (DrawSVG) and the label nudged on hover.
// Their snippet started on page ready: here the page's init calls it instead, on every visit
// of the page (Barba never fires page ready again). DrawSVG isn't in the site's GSAP set: it
// is loaded once, from the same Webflow GSAP build
const DRAW_SVG_URL = "https://cdn.prod.website-files.com/gsap/3.15.0/DrawSVGPlugin.min.js";
let drawSvgLoading = null;

function loadDrawSvg() {
  if (window.DrawSVGPlugin) return Promise.resolve(window.DrawSVGPlugin);
  if (!drawSvgLoading) {
    drawSvgLoading = new Promise((resolve, reject) => {
      const script = document.createElement("script");
      script.src = DRAW_SVG_URL;
      script.async = true;
      script.onload = () => (window.DrawSVGPlugin ? resolve(window.DrawSVGPlugin) : reject(
        new Error("DrawSVG")));
      script.onerror = () => reject(new Error("DrawSVG"));
      document.head.append(script);
    });
    drawSvgLoading.catch(() => { drawSvgLoading = null; });
  }
  return drawSvgLoading;
}

function initButton077(root = nextPage) {
  const buttons = root.querySelectorAll("[data-button-077]");
  if (!buttons.length) return;
  let mm = null;
  let left = false;
  onPageLeave(() => {
    left = true;
    mm?.revert();
  });

  // Without DrawSVG the button keeps its look, without the hover animation
  loadDrawSvg().then((DrawSVG) => {
    if (left) return;
    gsap.registerPlugin(DrawSVG);
    mm = gsap.matchMedia();
    mm.add("(hover: hover) and (pointer: fine) and (prefers-reduced-motion: no-preference)",
    () => {
        const cleanups = [];

        buttons.forEach((button) => {
          const text = button.querySelector("[data-button-077-text]");
          const icon = button.querySelector("[data-button-077-icon]");
          if (!icon || !text) return;

          const paths = icon.querySelectorAll("path");
          if (paths.length < 2) return;

          const linePath = paths[0];
          const tipPath = paths[1];
          const hoverRoot = button.closest("[data-hover]") || button;

          gsap.set(linePath, { drawSVG: "0% 100%" });
          gsap.set(tipPath, { drawSVG: "0% 100%" });

          let tl;

          const playSequence = () => {
            if (tl && tl.isActive()) return;

            tl?.kill();
            tl = gsap.timeline({ overwrite: true });

            tl.addLabel("empty")
              .to(linePath, { drawSVG: "100% 100%", duration: 0.25, ease: "circ.out" },
                "empty")
              .to(tipPath, { drawSVG: "50% 50%", duration: 0.25, ease: "circ.out" },
                "empty+=0.125")
              .set(linePath, { drawSVG: "0% 0%" }, "empty+=0.25")
              .addLabel("fill")
              .to(linePath, { drawSVG: "0% 100%", duration: 0.3, ease: "circ.inOut" },
                "fill")
              .to(tipPath, { drawSVG: "0% 100%", duration: 0.3, ease: "circ.inOut" },
                "fill+=0.15");

            tl.to(text, { x: "0.375em", duration: 0.2, ease: "circ.out" }, "empty")
              .to(text, { x: "0em", duration: 0.25, ease: "circ.inOut" }, "empty+=0.2");
          };

          const onEnter = () => playSequence();
          const onFocusIn = () => {
            if (hoverRoot.matches(":focus-visible")) playSequence();
          };

          hoverRoot.addEventListener("pointerenter", onEnter);
          hoverRoot.addEventListener("focusin", onFocusIn);

          cleanups.push(() => {
            hoverRoot.removeEventListener("pointerenter", onEnter);
            hoverRoot.removeEventListener("focusin", onFocusIn);
            tl?.kill();
            gsap.set([linePath, tipPath], { clearProps: "drawSVG" });
          });
        });

        return () => cleanups.forEach((cleanup) => cleanup());
      });
  }).catch(() => {});
}

// beforeEnter: builds the page, so the band uncovers it laid out. The prints start when the
// page is in view (band or intro)
function initProjectPage() {
  const page = nextPage;
  const root = page.querySelector("[data-pp]");
  const card = root?.querySelector("[data-pp-card]");
  const scroller = root?.querySelector("[data-pp-scroller]");
  const track = root?.querySelector("[data-pp-track]");
  if (!card || !scroller || !track) return;

  const controller = new AbortController();
  const { signal } = controller;
  const desktop = window.matchMedia(PP.desktop);
  const project = ppReadProject(page);
  const total = project.media.length;
  const pad = ppPad;
  const $ = (s) => root.querySelector(s);
  const put = (el, text) => {
    if (el && el.textContent !== text) el.textContent = text;
  };

  // -- Left: awards as a highlight, the live site (hidden without a link)
  const awards = $("[data-pp-awards]");
  const award = cleanCmsText(awards?.textContent || "");
  if (awards) {
    awards.textContent = "";
    if (award) awards.append(ppEl("span", "pp__hl", award));
  }
  const live = $("[data-pp-live]");
  if (live) {
    const href = live.getAttribute("href") || "";
    if (/^https?:\/\//i.test(href)) {
      live.target = "_blank";
      live.rel = "noopener";
    } else live.hidden = true;
  }

  // -- Print marks, as on the site's other sheets
  const d = new Date();
  const marks = ppEl("div", "pm");
  marks.setAttribute("aria-hidden", "true");
  marks.setAttribute("data-intro-skip", "");
  marks.innerHTML = '<i class="pm__crop pm__crop--tl"></i><i class="pm__crop pm__crop--tr"></i>' +
    '<i class="pm__crop pm__crop--bl"></i><i class="pm__crop pm__crop--br"></i>' +
    '<i class="pm__reg"><i class="pm__reg-twin"></i></i><i class="pm__punch"></i>' +
    '<span class="pm__slug pm__slug--plate">NR &middot; sheet 02/03 &middot; work ' +
    '<span data-pm-index>&mdash;</span>/<span data-pm-total>&mdash;</span> &middot; ' +
    '<span data-pm-name></span> &middot; proof <span class="pm__date" data-pm-date></span></span>' +
    '<span class="pm__tone"><i></i><i></i><i></i><i></i><i></i></span>';
  put(marks.querySelector("[data-pm-name]"), project.name || "project");
  put(marks.querySelector("[data-pm-date]"),
    `${pad(d.getDate())} ${pad(d.getMonth() + 1)} ${pad(d.getFullYear() % 100)}`);
  card.prepend(marks);

  // -- Center: one figure per image / video (case study: one per chapter)
  const stripNumber = (label) => label.replace(/^\s*\d+\s*\/\s*/, "");
  put($("[data-pp-medialabel]"), project.chapters ? "(Case study)" : "(Images)");
  track.setAttribute("data-intro-skip", ""); // the windows are there at once, then print
  const figures = project.media.map((m, i) => {
    const fig = ppEl("figure", "pp__fig");
    const title = project.chapters && m.label ?
      `${pad(i + 1)} — ${stripNumber(m.label)}` :
      `${project.name} — ${pad(i + 1)}`;
    const { win, box, node } = ppMediaWin(title, m.src, m.video);
    fig.append(win);
    if (m.caption) {
      const cap = ppEl("figcaption", "pp__cap");
      cap.append(ppEl("p", "pp__cap-text", m.caption));
      fig.append(cap);
    }
    track.append(fig);
    return { fig, win, box, node };
  });

  // -- Right: label / value rows; empty fields are left out
  const details = $("[data-pp-details]");
  const dl = ppEl("dl");
  details?.append(dl);
  const row = (label, values) => {
    const items = values.filter((v) => v && (typeof v !== "string" || v.trim()));
    if (!items.length) return;
    const r = ppEl("div", "pp__row");
    const dd = ppEl("dd");
    items.forEach((v) => dd.append(typeof v === "string" ? ppEl("span", null, v) : v));
    r.append(ppEl("dt", null, label), dd);
    dl.append(r);
  };
  // "[10,000+ visits] The digital companion…": the bracket becomes a highlight
  const outcome = (text) => {
    const m = text.match(/^\[(.+?)\]\s*(.*)$/);
    if (!m) return text;
    const span = ppEl("span");
    span.append(ppEl("span", "pp__hl", m[1]), document.createTextNode(` ${m[2]}`));
    return span;
  };
  const swatches = (values) => {
    if (!values.length) return null;
    const line = ppEl("span", "pp__swatches");
    values.forEach((hex) => {
      const s = ppEl("span", "pp__swatch");
      const chip = ppEl("i");
      chip.style.setProperty("--c", hex);
      s.append(chip, document.createTextNode(hex));
      line.append(s);
    });
    return line;
  };
  if (project.caseStudy) {
    row("Role", [project.role]);
    row("Timeline", [project.timeline]);
    if (project.outcome) row("Outcome", [outcome(project.outcome)]);
  }
  row("Services", [project.services.join(" · ")]);
  row("Tools", [project.tools.join(" · ")]);
  row("Colours", [swatches(project.colors)]);
  row("Type", [project.fonts.join(" · ")]);
  row("Partners", [project.partners.join(" · ")]);

  // -- Scrolling: desktop = only the center column moves (its own Lenis, the wheel works
  // anywhere on the sheet: overscroll off keeps the page's Lenis out of it); phones = the page
  let inner = null;
  const tick = (time) => inner?.raf(time * 1000);
  gsap.ticker.add(tick);

  // The figure being looked at: the last one whose top passed 40% of the visible area
  let current = -1;
  const count = $("[data-pp-count]");
  let thumbs = null;
  const onScroll = () => {
    if (!total) return;
    const view = desktop.matches ? scroller.getBoundingClientRect() : { top: 0, height: window
        .innerHeight };
    const line = view.top + view.height * 0.4;
    let now = 0;
    figures.forEach((f, i) => {
      if (f.fig.getBoundingClientRect().top <= line) now = i;
    });
    if (now === current) return;
    current = now;
    put(count, `${pad(now + 1)}/${pad(total)}`);
    thumbs?.setCurrent(now);
  };
  window.addEventListener("scroll", onScroll, { passive: true, signal });
  scroller.addEventListener("scroll", onScroll, { passive: true, signal });

  const goTo = (i) => {
    const fig = figures[i]?.fig;
    if (!fig) return;
    if (inner) {
      const start = parseFloat(getComputedStyle(card).getPropertyValue("--start")) || 20;
      inner.scrollTo(fig, { offset: -start, duration: 1.2 });
    } else if (lenis) {
      lenis.scrollTo(fig, { offset: -24, duration: 1.2 });
    } else {
      fig.scrollIntoView({ behavior: reducedMotion ? "auto" : "smooth", block: "start" });
    }
  };

  // -- Thumbnails (the left column's bottom)
  const nav = $("[data-pp-index]");
  if (nav && total) thumbs = ppThumbs(nav, figures, goTo, signal);

  // -- The dither print
  const gl = ppEl("canvas", "pp__gl");
  gl.setAttribute("aria-hidden", "true");
  gl.setAttribute("data-intro-skip", "");
  root.append(gl);
  const reveal = ppReveal(gl, signal);
  figures.forEach((f) => reveal.add(f.box));

  // -- The proportions: every window gets its media's own as soon as it is known
  const sized = figures.map((f, i) => ppNaturalSize(f.node).then((size) => {
    if (!size || signal.aborted) return;
    const ratio = `${size[0]} / ${size[1]}`;
    f.win.style.setProperty("--ratio", ratio);
    thumbs?.setRatio(i, ratio);
  }));
  const laidOut = Promise.race([
    Promise.all(sized),
    new Promise((resolve) => setTimeout(resolve, PP.sizeWait)),
  ]);
  holdIntro(laidOut);

  // -- The next project: closes the column (desktop) or the page (phones). A black rule and
  // "(Next project)" set it apart, then its name and its cover in a window whose status strip
  // fills while the reader keeps scrolling past the end (a click opens it too)
  let next = null; // { link, meter, fill, pct, label }
  const buildNext = (info, number, of) => {
    if (next || !info?.href || signal.aborted) return;
    const link = ppEl("a", "pp__next");
    link.href = info.href;
    const head = ppEl("span", "pp__next-head");
    head.append(ppEl("span", null, "(Next project)"), ppEl("span", null, number ?
      `${pad(number)}/${pad(of)}` : ""));
    const win = ppMediaWin(`Next — ${info.name}`, info.cover, "");
    const status = ppEl("span", "pp__status");
    const label = ppEl("span", "pp__status-label", "Scroll to open");
    const meter = ppEl("span", "pp__meter");
    const fill = ppEl("i", "pp__meter-fill");
    const pct = ppEl("span", "pp__meter-pct", "000%");
    meter.append(fill);
    status.append(label, meter, pct);
    win.win.append(status);
    link.append(head, ppEl("span", "pp__next-name", info.name), win.win);
    next = { link, meter, fill, pct, label };
    ppNaturalSize(win.node).then((size) => {
      if (size && !signal.aborted) win.win.style.setProperty("--ratio",
        `${size[0]} / ${size[1]}`);
    });
    reveal.add(win.box);
    place();
  };

  // Work n/total and the next project come from the Works page (read once per visit, shared
  // with the profile TV); the template's own next link if it can't be read
  const key = (s) => (s || "").toLowerCase().replace(/\s+/g, " ").trim();
  const path = (href) => {
    try {
      return new URL(href, location.origin).pathname.replace(/\/$/, "");
    } catch (e) {
      return "";
    }
  };
  tvLoadChannels("/work").then((list) => {
    if (signal.aborted) return;
    let i = project.name ? list.findIndex((c) => key(c.name) === key(project.name)) : -1;
    if (i < 0) i = list.findIndex((c) => path(c.href) === path(location.href));
    if (i < 0) throw new Error("project not on the Works page");
    put($("[data-pp-work]"), `Work ${pad(i + 1)}/${pad(list.length)}`);
    put(marks.querySelector("[data-pm-index]"), pad(i + 1));
    put(marks.querySelector("[data-pm-total]"), pad(list.length));
    const n = (i + 1) % list.length;
    const c = list[n];
    buildNext({ href: c.href, name: c.name, cover: c.cover || c.src }, n + 1, list.length);
  }).catch(() => buildNext(project.fallbackNext));

  // -- Keep scrolling past the end: every push fills the meter, letting go drains it, full it
  // opens the next project. Wheel (trackpads too), touch and keys all push
  const advance = (() => {
    let p = 0; // the push so far, 0..1
    let shown = 0; // what the meter shows, easing toward p
    let last = 0;
    let prev = 0;
    let frame = 0;
    let done = false;

    const atEnd = () => (inner ?
      inner.scroll >= inner.limit - 1 :
      window.scrollY + window.innerHeight >= document.documentElement.scrollHeight - 2);

    const render = (v) => {
      if (!next) return;
      // Whole blocks only, like an old progress bar
      const inside = next.meter.clientWidth - 2;
      const blocks = Math.max(1, Math.floor((inside + 2) / PP.pitch));
      const filled = Math.round(v * blocks);
      next.fill.style.width = filled >= blocks ? "100%" : `${filled * PP.pitch}px`;
      next.pct.textContent = `${String(Math.round(v * 100)).padStart(3, "0")}%`;
    };

    const step = (now) => {
      frame = 0;
      if (signal.aborted) return;
      const dt = prev ? Math.min(0.05, (now - prev) / 1000) : 0;
      prev = now;
      if (!done) {
        // Draining: after a pause, and faster once the reader has scrolled back up
        if (now - last > PP.idle) p = Math.max(0, p - PP.drain * dt);
        if (!atEnd()) p = Math.max(0, p - PP.drain * 2 * dt);
      }
      shown += (p - shown) * Math.min(1, dt * 14);
      if (Math.abs(p - shown) < 0.002) shown = p;
      render(shown);
      if (p > 0 || shown > 0) frame = requestAnimationFrame(step);
      else prev = 0;
    };
    const loop = () => {
      if (!frame) frame = requestAnimationFrame(step);
    };

    const open = () => {
      const href = next.link.href;
      if (window.barba?.go && !window.barba.transitions?.isRunning) barba.go(href);
      else location.href = href;
    };

    const push = (amount) => {
      if (done || !next) return;
      p = Math.min(1, Math.max(0, p + amount));
      last = performance.now();
      if (p >= 1) {
        done = true;
        next.link.classList.add("is-going");
        next.label.textContent = "Opening";
        setTimeout(() => {
          if (!signal.aborted) open();
        }, 320);
      }
      loop();
    };

    window.addEventListener("wheel", (e) => {
      if (e.ctrlKey) return; // pinch zoom
      if (inner && !card.contains(e.target)) return; // desktop: the sheet moves the column
      const dy = e.deltaY * (e.deltaMode === 1 ? 16 : e.deltaMode === 2 ? window
        .innerHeight : 1);
      if ((dy > 0 && atEnd()) || (dy < 0 && p > 0)) push(dy / PP.wheel);
    }, { passive: true, signal });

    let touchY = null;
    window.addEventListener("touchstart", (e) => { touchY = e.touches[0]
      .clientY; }, { passive: true, signal });
    window.addEventListener("touchmove", (e) => {
      if (touchY == null) return;
      const y = e.touches[0].clientY;
      const dy = touchY - y;
      touchY = y;
      if ((dy > 0 && atEnd()) || (dy < 0 && p > 0)) push(dy / (window.innerHeight * PP
        .touch));
    }, { passive: true, signal });
    window.addEventListener("touchend", () => { touchY = null; }, { passive: true, signal });

    // Back from the next project (page cache): start empty again
    window.addEventListener("pageshow", (e) => {
      if (!e.persisted || !next) return;
      done = false;
      p = shown = 0;
      next.link.classList.remove("is-going");
      next.label.textContent = "Scroll to open";
      render(0);
    }, { signal });

    onPageLeave(() => cancelAnimationFrame(frame));
    return { atEnd, push };
  })();

  // Keys move the center column too (desktop)
  window.addEventListener("keydown", (e) => {
    if (!inner || e.defaultPrevented || e.altKey || e.ctrlKey || e.metaKey) return;
    if (e.target.closest?.("input, textarea, select, [contenteditable]")) return;
    const h = scroller.clientHeight;
    const by = { ArrowDown: 120, ArrowUp: -120, PageDown: h * 0.85, PageUp: -h * 0.85, " ": e
        .shiftKey ? -h * 0.85 : h * 0.85 } [e.key];
    if (e.key === "Home") inner.scrollTo(0);
    else if (e.key === "End") inner.scrollTo(scroller.scrollHeight);
    else if (by > 0 && advance.atEnd()) advance.push(by / PP.wheel);
    else if (by) inner.scrollTo(inner.targetScroll + by);
    else return;
    e.preventDefault();
  }, { signal });

  // -- Layout per breakpoint: the next project ends the image column (desktop) or the page
  // (phones); the column's own Lenis on desktop only
  function place() {
    if (!next) return;
    const parent = desktop.matches ? track : card;
    if (next.link.parentNode !== parent) parent.append(next.link);
  }

  function layout() {
    const desk = desktop.matches;
    place();
    if (desk) card.style.setProperty("--frame-h", `${scroller.clientHeight}px`);
    if (desk && !inner && hasLenis) {
      inner = new Lenis({ wrapper: scroller, content: track, eventsTarget: card, smoothWheel: true,
        lerp: 0.1, overscroll: false });
      inner.on("scroll", onScroll);
    }
    if (!desk && inner) {
      inner.destroy();
      inner = null;
    }
    reveal.setRoot(desk ? scroller : null);
    current = -1;
    onScroll();
  }
  const sizer = new ResizeObserver(() => {
    if (desktop.matches) card.style.setProperty("--frame-h", `${scroller.clientHeight}px`);
  });
  sizer.observe(scroller);
  desktop.addEventListener("change", layout, { signal });
  layout();

  // -- The live site's button
  initButton077(root);

  // The prints start when the page is in view, once the windows have their proportions
  revealOnEntry(card, () => laidOut.then(() => {
    if (!signal.aborted) reveal.start();
  }), page);

  onPageLeave(() => {
    controller.abort();
    sizer.disconnect();
    gsap.ticker.remove(tick);
    inner?.destroy();
    inner = null;
    reveal.destroy();
  });
}

// -----------------------------------------
// AI EXPLORATION: FULLSCREEN SLIDER
// -----------------------------------------

// beforeEnter: stack the slides with only the first one visible, write the
// slide counters, put the titles in their "broken" state and split the text
// into masked lines, so the page is already correct while the transition
// uncovers it. No listeners, timelines or ScrollTriggers here.
function initAiSliderInitialState() {
  const slider = nextPage.querySelector(".ai__slider");
  const slides = nextPage.querySelectorAll(".ai__slide");
  if (!slider || slides.length === 0) return;
  if (slider.hasAttribute("data-ai-slider-prepared")) return;

  if (typeof SplitText === "undefined") {
    console.error("GSAP SplitText not found: the AI slider needs it.");
    return;
  }

  const totalSlides = slides.length;

  slides.forEach((slide, index) => {
    // Slide stacking: the first slide on top and visible, the others hidden
    gsap.set(slide, {
      position: "absolute",
      top: 0,
      left: 0,
      width: "100%",
      height: "100%",
      zIndex: index === 0 ? 2 : 1,
      autoAlpha: index === 0 ? 1 : 0
    });

    // Slide counter (01 / 07)
    const indexDisplay = slide.querySelector(".slide-index-wrapper p:first-child");
    if (indexDisplay) indexDisplay.textContent = (index + 1).toString().padStart(2, "0");

    const totalDisplay = slide.querySelector(".slide-index-wrapper p:last-child");
    if (totalDisplay) totalDisplay.textContent = totalSlides.toString().padStart(2, "0");

    // Prompt button: hidden on every slide except the first
    const emailWrapper = slide.querySelector(".copy-email-wrapper");
    if (emailWrapper) {
      gsap.set(emailWrapper, { autoAlpha: index === 0 ? 1 : 0 });
    }

    // Title: characters in their "broken" state, the burst runs in afterEnter
    const slideHeader = slide.querySelector("h1");
    if (slideHeader) wrapBlinkChars(slideHeader);

    // Hard load: the first title waits, hidden, for its own slot in the intro (the intro
    // itself skips it: at opacity 0 it is not a target)
    if (slideHeader && index === 0 && pageRevealPending) gsap.set(slideHeader, { opacity: 0 });

    // Paragraphs: masked lines (the h1 is left to the blink effect)
    const slideContent = slide.querySelectorAll("p, a, .ai__slide-tags p");
    slideContent.forEach((element) => {
      new SplitText(element, {
        type: "lines",
        linesClass: "line",
        mask: "lines",
        reduceWhiteSpace: false
      });

      // First slide: lines already in place
      if (index === 0) {
        gsap.set(element.querySelectorAll(".line"), { y: "0%" });
      }
    });
  });

  slider.setAttribute("data-ai-slider-prepared", "");
}

// afterEnter: first title burst, wheel/touch navigation between slides (Lenis ignores
// them: data-lenis-prevent, see lockScrollFor). Everything is torn down in onPageLeave.
function initAiExplorationSlider() {
  const container = nextPage;
  const slider = container.querySelector(".ai__slider");
  if (!slider) return;

  // Safety net in case the beforeEnter half did not run (no-op if it did)
  initAiSliderInitialState();
  if (!slider.hasAttribute("data-ai-slider-prepared")) return;

  const slides = container.querySelectorAll(".ai__slide");
  const totalSlides = slides.length;
  let currentIndex = 0;
  let isAnimating = false;
  let scrollAllowed = true;
  let lastScrollTime = 0;

  const controller = new AbortController();
  const { signal } = controller;
  const timeouts = new Set();
  const headerControls = new Map();
  let textTL = null;

  // setTimeout that is cleared on page leave
  const later = (fn, ms) => {
    const id = setTimeout(() => {
      timeouts.delete(id);
      fn();
    }, ms);
    timeouts.add(id);
  };

  // Barba keeps the old container on screen under the transition band until
  // it is removed: ignore input while two containers are in the DOM
  const isTransitioning = () =>
    document.querySelectorAll('[data-barba="container"]').length > 1;

  // Title blink controls, one per slide
  slides.forEach((slide, index) => {
    const slideHeader = slide.querySelector("h1");
    if (!slideHeader) return;

    const controls = createBlinkControls(slideHeader, signal);
    headerControls.set(slideHeader, controls);

    // First slide: burst right away so the title becomes readable. On a hard load, at its
    // slot in the intro, once the sheet is gone
    if (index === 0) {
      if (slideHeader.style.opacity === "0") {
        onPageReveal(() => atIntroSlot(slideHeader, () => {
          gsap.set(slideHeader, { opacity: 1 });
          controls.doBurst();
        }), container);
      } else {
        later(() => controls.doBurst(), 100);
      }
    }
  });

  // Slide change: current slide flies out, next one is uncovered from below/above
  function animateSlide(direction) {
    if (isAnimating || !scrollAllowed) return;

    isAnimating = true;
    scrollAllowed = false;

    const currentSlideElement = slides[currentIndex];

    let nextIndex;
    if (direction === "down") {
      nextIndex = currentIndex === totalSlides - 1 ? 0 : currentIndex + 1;
    } else {
      nextIndex = currentIndex === 0 ? totalSlides - 1 : currentIndex - 1;
    }
    const nextSlideElement = slides[nextIndex];

    const exitY = direction === "down" ? "-200vh" : "200vh";
    const entryY = direction === "down" ? "100vh" : "-100vh";
    const entryClipPath = direction === "down" ?
      "polygon(20% 20%, 80% 20%, 80% 100%, 20% 100%)" :
      "polygon(20% 0%, 80% 0%, 80% 80%, 20% 80%)";

    // --- Phase A: current slide leaves ---

    // Prompt button fades out
    const currentEmailWrapper = currentSlideElement.querySelector(".copy-email-wrapper");
    if (currentEmailWrapper) {
      gsap.to(currentEmailWrapper, { autoAlpha: 0, duration: 0.5, ease: "power2.out" });
    }

    gsap.to(currentSlideElement, {
      scale: 0.25,
      autoAlpha: 0,
      rotation: 30,
      y: exitY,
      duration: 2,
      ease: "power4.inOut",
      force3D: true,
      zIndex: 1,
      onComplete: () => {
        gsap.set(currentSlideElement, {
          y: 0,
          rotation: 0,
          scale: 1,
          clipPath: "polygon(0% 0%, 100% 0%, 100% 100%, 0% 100%)"
        });
      },
    });

    // --- Phase B: next slide enters ---
    later(() => {
      // 1. Next slide in its start position
      gsap.set(nextSlideElement, {
        y: entryY,
        clipPath: entryClipPath,
        autoAlpha: 1,
        zIndex: 2,
        force3D: true,
      });

      // 2. Text back to its hidden state
      const lines = nextSlideElement.querySelectorAll(".line");
      gsap.set(lines, { y: "100%", force3D: true });

      const nextHeader = nextSlideElement.querySelector("h1");
      const nextControls = nextHeader ? headerControls.get(nextHeader) : null;
      if (nextControls) nextControls.resetBlink();

      // 3. Slide in
      gsap.to(nextSlideElement, {
        y: 0,
        clipPath: "polygon(0% 0%, 100% 0%, 100% 100%, 0% 100%)",
        duration: 1.5,
        ease: "power4.out",
        force3D: true,
        onStart: () => {
          const tl = gsap.timeline();
          textTL = tl;

          // Title burst
          if (nextControls) {
            tl.call(() => {
              nextControls.doBurst();
            }, null, 0.75);
          }

          // Paragraph lines slide up
          const otherLines = nextSlideElement.querySelectorAll("p .line, a .line");
          if (otherLines.length) {
            tl.to(otherLines, {
              y: "0%",
              duration: 1,
              ease: "power4.out",
              stagger: 0.05
            }, 0.75);
          }

          // Prompt button fades in
          const nextEmailWrapper = nextSlideElement.querySelector(".copy-email-wrapper");
          if (nextEmailWrapper) {
            tl.to(nextEmailWrapper, {
              autoAlpha: 1,
              duration: 1,
              ease: "power2.out"
            }, "<");
          }
        },
        onComplete: () => {
          isAnimating = false;
          currentIndex = nextIndex;
          later(() => {
            scrollAllowed = true;
            lastScrollTime = Date.now();
          }, 100);
        },
      });
    }, 750);
  }

  // Input gate: one slide change per gesture, at most one per second
  function handleScroll(direction) {
    const now = Date.now();
    if (isAnimating || !scrollAllowed) return;
    if (isTransitioning()) return;
    if (now - lastScrollTime < 1000) return;

    lastScrollTime = now;
    animateSlide(direction);
  }

  // Mouse wheel
  window.addEventListener("wheel", (e) => {
    if (slider.contains(e.target)) {
      e.preventDefault();
      const direction = e.deltaY > 0 ? "down" : "up";
      handleScroll(direction);
    }
  }, { passive: false, signal });

  // Touch swipe
  let touchStartY = 0;
  let isTouchActive = false;

  window.addEventListener("touchstart", (e) => {
    touchStartY = e.touches[0].clientY;
    isTouchActive = true;
  }, { passive: false, signal });

  window.addEventListener("touchmove", (e) => {
    if (!isTouchActive || isAnimating || !scrollAllowed) return;
    if (slider.contains(e.target)) {
      const touchCurrentY = e.touches[0].clientY;
      const difference = touchStartY - touchCurrentY;

      if (Math.abs(difference) > 50) {
        e.preventDefault();
        isTouchActive = false;
        const direction = difference > 0 ? "down" : "up";
        handleScroll(direction);
      }
    }
  }, { passive: false, signal });

  window.addEventListener("touchend", () => { isTouchActive = false; }, { signal });

  // .body.is--ai (overflow) and data-lenis-prevent come from the boilerplate
  // (syncBodyClass, lockScrollFor)

  onPageLeave(() => {
    controller.abort();

    timeouts.forEach(clearTimeout);
    timeouts.clear();

    if (textTL) textTL.kill();
    headerControls.forEach(controls => controls.destroy());
    headerControls.clear();
    gsap.killTweensOf(slides);
    gsap.killTweensOf(slider.querySelectorAll(".copy-email-wrapper, .line"));

  });
}

// Copies the slide prompt (data-prompt on [data-copy-email-element], falls back
// to the button's data-copy-email). Listeners live on in-container buttons and
// go away with the container, so no cleanup is needed.
function initCopyPromptClipboard() {
  const buttons = nextPage.querySelectorAll(".copy-email-button");
  if (!buttons.length) return;

  const copyText = (button) => {
    const targetElement = button.querySelector("[data-copy-email-element]");
    let textToCopy = null;

    if (targetElement) {
      textToCopy = targetElement.getAttribute("data-prompt");
    }
    if (!textToCopy) {
      textToCopy = button.getAttribute("data-copy-email");
    }

    if (textToCopy) {
      textToCopy = textToCopy.trim();
      navigator.clipboard.writeText(textToCopy).then(() => {
        button.setAttribute("data-copy-button", "copied");
        button.setAttribute("aria-label", "Text copied to clipboard!");
      }).catch(err => {
        console.error("Copy to clipboard failed:", err);
      });
    }
  };

  const handleInteraction = (e) => {
    if (e.type === "click" || (e.type === "keydown" && (e.key === "Enter" || e.key === " "))) {
      e.preventDefault();
      copyText(e.currentTarget);
    }
  };

  buttons.forEach((button) => {
    button.addEventListener("click", handleInteraction);
    button.addEventListener("keydown", handleInteraction);

    button.addEventListener("mouseleave", () => {
      button.removeAttribute("data-copy-button");
      button.blur();
      button.setAttribute("aria-label", "Copy to clipboard");
    });
    button.addEventListener("blur", () => {
      button.removeAttribute("data-copy-button");
      button.setAttribute("aria-label", "Copy to clipboard");
    });
  });
}

// ==== LAB start (built from lab-src/lab.js by lab-src/build-lab.mjs: edit the source, then rebuild)
// -----------------------------------------
// LAB ([data-lab])
// -----------------------------------------
// /lab: the experiments float in space. Each one is a cluster of photo "windows" along a helix
// that runs into the screen and never ends (slot k shows experiment k mod N). Every photo is a
// pane of glass with the picture in a shallow box behind it, shaped by its depth map: looking
// around (mouse lean, drag, idle sway) slides the far parts inside the frame while the near ones
// hold. Hovering a plate opens its tech window, a far cluster (or a row of the index window) is a
// flight to that experiment; the arrow keys, the wheel and the small ← → control fly too. On a
// phone a sideways swipe flies, and a wide Prev / Next bar sits under the stage.
// Content: the hidden CMS list [data-lab-data] (collection "Lab", one [data-lab-item] each, fields
// in [data-lab-f], images in img[data-lab-img="1".."7"], depth maps in img[data-lab-depth]).
// The copy of the current experiment goes into [data-lab-desc] / [data-lab-live] / [data-lab-name]
// / [data-lab-meta]; the canvas and its overlay UI go into [data-lab-stage].
// three r170 is an ES module (LAB_THREE_URL), imported on demand (the sitewide window.THREE
// is r109). Source: lab-src/lab.js, inlined here by lab-src/build-lab.mjs (edit the source).

const LAB = {
  // Phone layout: Webflow's mobile landscape breakpoint, and phones held sideways (a short touch
  // screen). The second half must match the same query in the page's lab__css embed
  phoneQuery: "(max-width: 767px), (min-width: 768px) and (max-height: 500px) and (pointer: coarse)",
  sharp: { desk: 1024, phone: 768 }, // px, cap on the long side of the visible crop: current ± 1
  shell: { desk: 384, phone: 288 }, // px, the same for every other cluster
  maxLong: 2048, // px, longest texture side whatever the crop (very wide or tall uploads)
  depthLong: 320, // px, baked depth maps are processed at this size (blur radii are tuned to it)
  bufferPx: 7e6, // device px, cap on the drawing buffer (very large retina stages draw a bit softer)
  fontWait: 1500, // ms, longest wait for the web fonts the canvas labels are drawn with
  underCopy: 0.16, // opacity of a far cluster passing behind the copy (desktop)
  floatRide: 0.7, // share of the view's turn (lean, sway, drag) the foreground windows follow
  floatClear: 0.12, // opacity of a foreground window over the copy, the hint or the nav (desktop)
  ink: "#111111",
  muted: "#8e8e8a",
  faint: "#a9a9a5",
  line: "#dddddb",
  accent: "#111111", // ink: the owner found the site red (--tech-red, #ff564a) too loud here
  frame: 0xcfcfcb,
  wire: 0xd2d2ce,
  route: 0xb4b4b0,
  cross: 0x9c9c98,
  fallbackBg: "#f8f8f7", // fog colour when nothing behind the stage paints a background
};

// Layout of one experiment's windows (cluster units, origin at the middle).
// w = width, a = the slot's design aspect (w / h), r = small turns so the cluster reads in depth.
// A plate takes its picture's own aspect: w and a only set its area and the box it may outgrow
// (LAB_PLATE below); a text window keeps w and a as they are.
// 0-5 are the spike's six plates; 6 is the seventh (desktop only), right of plate 5, a little
// behind it
const LAB_SLOTS = [
  { x: -1.35, y: 1.45, z: 0.25, w: 2.0, a: 0.95, rx: -0.03, ry: 0.10, rz: 0.01 },
  { x: 1.55, y: 1.25, z: -0.35, w: 2.2, a: 0.85, rx: 0.02, ry: -0.14, rz: -0.008 },
  { x: 0.05, y: 2.35, z: -1.0, w: 1.15, a: 1.25, rx: 0.03, ry: 0.05, rz: 0 },
  { x: 0.35, y: 0.2, z: 0.75, w: 1.45, a: 1.3, rx: 0, ry: -0.06, rz: 0.01 },
  { x: -1.15, y: -1.55, z: 0.35, w: 2.5, a: 1.0, rx: 0.04, ry: 0.12, rz: -0.01 },
  { x: 1.3, y: -1.75, z: -0.25, w: 1.75, a: 0.75, rx: -0.02, ry: -0.1, rz: 0.012 },
  { x: 2.72, y: -1.5, z: -0.55, w: 1.0, a: 0.82, rx: 0.02, ry: -0.16, rz: 0.01 },
];
// One or two images: bigger windows of their own, so the cluster isn't a lone stamp
const LAB_SLOTS_FEW = {
  solo: { x: 0.25, y: 0.3, z: 0.3, w: 3.1, a: 1.2, rx: -0.02, ry: -0.07, rz: 0.006 },
  duoA: { x: -1.15, y: 1.0, z: 0.25, w: 2.4, a: 0.95, rx: -0.03, ry: 0.1, rz: 0.01 },
  duoB: { x: 1.3, y: -1.0, z: -0.3, w: 2.2, a: 0.85, rx: 0.02, ry: -0.12, rz: -0.008 },
};
const LAB_SLOTS_FEW_PHONE = {
  solo: { x: -0.05, y: 0.35, z: 0.3, w: 3.4, a: 0.95, rx: -0.02, ry: 0.05, rz: 0.006 },
  duoA: LAB_SLOTS_FEW.duoA,
  duoB: LAB_SLOTS_FEW.duoB,
};
// Which slots an experiment with 1..7 images uses (image n goes to the n-th slot of its set)
const LAB_SETS = {
  1: ["solo"],
  2: ["duoA", "duoB"],
  3: [0, 3, 5],
  4: [0, 1, 3, 5],
  5: [0, 1, 3, 4, 5],
  6: [0, 1, 2, 3, 4, 5],
  7: [0, 1, 2, 3, 4, 5, 6],
};
// Phone: at most five plates, the spike's narrow set (6 or 7 images: the 3rd and 7th stay off)
const LAB_PHONE_SLOTS = [0, 1, 3, 4, 5];
// The notes window (brief + status), desktop only
const LAB_NOTES_SLOT = { x: -2.45, y: -1.45, z: 1.0, w: 1.75, a: 1.2, rx: 0, ry: 0.16, rz: 0 };
// Wires between window corners, like the sketch: [slot, corner, slot, corner]
const LAB_WIRES = [
  [0, "tr", 2, "tl"],
  [2, "tr", 1, "tl"],
  [2, "bl", 3, "tl"],
  [0, "br", 3, "tl"],
  [3, "tr", 1, "bl"],
  [3, "bl", 4, "tr"],
  [3, "br", 5, "tl"],
  [4, "tr", 5, "tl"],
  [0, "bl", 4, "tl"],
  [5, "tr", 6, "tl"],
  [5, "br", 6, "bl"]
];
const LAB_CORNER = { tl: [-0.5, 0.5], tr: [0.5, 0.5], bl: [-0.5, -0.5], br: [0.5, -0.5] };
// A plate takes its picture's own aspect: a slot gives it an area (w * w / a) and a box it may
// outgrow by `grow` on each side; it never spills more than spillX / spillY past the layout's
// bounds (LB: the framing, the copy clearance and far picking are all computed on them; the
// label above a plate counts). Beyond aMin..aMax the picture is cropped to the clamp
const LAB_PLATE = { aMin: 1 / 4, aMax: 4, grow: 1.25, spillX: 0.3, spillY: 0.2, label: 0.3,
  keep: 0.8, tagGap: 0.055, tagH: 0.17 };
const labPlateAspect = (ia) => labClamp(ia, LAB_PLATE.aMin, LAB_PLATE.aMax);

function labPlateSize(s, a, lb) {
  const P = LAB_PLATE;
  const w0 = Math.sqrt(((s.w * s.w) / s.a) * a),
    h0 = w0 / a;
  const hw = Math.min(s.x - (lb.x0 - P.spillX), lb.x1 + P.spillX - s.x);
  const hh = Math.min(s.y - (lb.y0 - P.spillY), lb.y1 + P.spillY - P.label - s.y);
  const k = Math.min(1, (P.grow * s.w) / w0, (P.grow * s.w) / s.a / h0, (2 * Math.max(0.2, hw)) /
    w0, (2 * Math.max(0.2, hh)) / h0);
  return { w: w0 * k, h: h0 * k };
}
// A picture far wider (or taller) than its slot can hold would become a thin strip there: it trades
// slot geometry (and wires, which follow the slot id) with the slot of the set that leaves the
// smaller of the two plates the longest short side. Each keeps its image index k, so its number,
// label and plate note stay its own. slots and aspects are parallel; slot objects are replaced,
// never mutated (they spread the LAB_SLOTS constants)
const LAB_EXTREME = 2.4;

function labPlaceExtremes(slots, aspects, lb) {
  const short = (s, a) => {
    const { w, h } = labPlateSize(s, a, lb);
    return Math.min(w, h);
  };
  for (let i = 0; i < slots.length; i++) {
    const a = aspects[i];
    if (a < LAB_EXTREME && a > 1 / LAB_EXTREME) continue;
    let best = i,
      gain = 1e-3;
    for (let j = 0; j < slots.length; j++) {
      if (j === i) continue;
      const b = aspects[j];
      const now = Math.min(short(slots[i], a), short(slots[j], b));
      const swapped = Math.min(short(slots[j], a), short(slots[i], b));
      if (swapped - now > gain) {
        gain = swapped - now;
        best = j;
      }
    }
    if (best === i) continue;
    const si = slots[i],
      sj = slots[best];
    slots[i] = { ...sj, k: si.k };
    slots[best] = { ...si, k: sj.k };
  }
  return slots;
}
// The plates of one cluster: each one at its picture's aspect, then no nearer window hides the
// label over a plate behind it: of the two plates, the one that loses less shrinks (not below
// LAB_PLATE.keep), else the label moves to the top right corner. blocks: fixed windows (x, y, z,
// w, h) that only ever cover. Returns [{ w, h, flip }] in slot order
function labPlateLayout(slots, aspects, tagW, lb, blocks = []) {
  const P = LAB_PLATE;
  const out = slots.map((s, n) => ({ x: s.x, y: s.y, z: s.z, ...labPlateSize(s, aspects[n], lb),
    tw: tagW[n], flip: false }));
  const box = (o, k = 1) => ({ x0: o.x - (o.w * k) / 2, x1: o.x + (o.w * k) / 2, y0: o.y - (o.h *
      k) / 2, y1: o.y + (o.h * k) / 2 });
  const tag = (o, k = 1, flip = o.flip) => {
    const b = box(o, k),
      x0 = flip ? b.x1 - o.tw : b.x0;
    return { x0, x1: x0 + o.tw, y0: b.y1 + P.tagGap, y1: b.y1 + P.tagGap + P.tagH };
  };
  const hit = (a, b) => a.x0 < b.x1 && a.x1 > b.x0 && a.y0 < b.y1 && a.y1 > b.y0;
  // The largest scale (1 down to keep) that passes, 0 when none does
  const clearAt = (ok) => {
    for (let k = 1; k >= P.keep - 1e-6; k -= 0.01)
      if (ok(k)) return k;
    return 0;
  };
  const covers = [...out.map((o) => ({ o, fixed: false })), ...blocks.map((o) => ({ o,
    fixed: true }))];
  for (let pass = 0; pass < 2; pass++) {
    for (const B of out) {
      for (const { o: F, fixed } of covers) {
        if (F === B || F.z <= B.z || !hit(box(F), tag(B))) continue;
        const kF = fixed ? 0 : clearAt((k) => !hit(box(F, k), tag(B)));
        const kB = clearAt((k) => !hit(box(F), tag(B, k)));
        if (kF > 0 && kF >= kB) {
          F.w *= kF;
          F.h *= kF;
        } else if (kB > 0) {
          B.w *= kB;
          B.h *= kB;
        } else if (!B.flip && !hit(box(F), tag(B, 1, true))) B.flip = true;
      }
      // A nearer plate's label over this one's: this label moves to its other corner, when that
      // corner is clear of the nearer plates and windows and of their labels
      for (const F of out) {
        if (F === B || F.z <= B.z || B.flip || !hit(tag(F), tag(B))) continue;
        const alt = tag(B, 1, true);
        const clear = covers.every(({ o }) => o === B || o.z <= B.z || (!hit(box(o), alt) && (!o
          .tw || !hit(tag(o), alt))));
        if (clear) B.flip = true;
      }
    }
  }
  return out.map(({ w, h, flip }) => ({ w, h, flip }));
}

// Foreground windows, placed in the frame of each resting view and cut by its edges.
// fx, fy = centre in screen units (-1..1), d = distance from the camera,
// h = height as a share of the view at that distance, a = aspect; portrait = fx, fy on tall
// desktop stages (portrait tablets), see floatPose. On desktop the palette is then fitted
// between the hint and the project name, whatever their length (fitBand)
const LAB_FLOAT_DESK = [
  { kind: "prompt", fx: 0.84, fy: 0.76, d: 9.5, h: 0.36, a: 0.92, ry: -0.18 },
  { kind: "palette", fx: 0.12, fy: -0.87, d: 8.3, h: 0.22, a: 2.3, ry: 0.08, fit: true,
    portrait: { fx: -0.08, fy: -0.66 } },
  { kind: "index", fx: -0.86, fy: 0.72, d: 11, h: 0.34, a: 1.3, ry: 0.16 },
];
const LAB_FLOAT_PHONE = [
  { kind: "prompt", fx: 0.66, fy: 1.04, d: 9, h: 0.3, a: 0.95, ry: -0.12 },
  { kind: "palette", fx: -0.52, fy: -1.0, d: 8.4, h: 0.2, a: 2.0, ry: 0.08 },
];
const LAB_INDEX_ROWS = 9; // the index window lists this many experiments around the current one

// The space: one experiment every SPACING units along a helix that turns once every LAB_TURNS
// slots (whatever the number of experiments, so the trail always opens the same way)
const LAB_SPACE = {
  dist: 16, // resting distance from the camera to a cluster
  spacing: 26,
  turns: 7,
  phase: -2.28, // from the first slot the trail opens to the right
  fogNear: 24,
  fogFar: 105,
};

// Depth window: the plate is a pane of glass and the picture sits in a shallow box behind it,
// shaped by its depth map (near = at the glass, far = deep). Each pixel marches its view ray into
// the box. Points are mapped back to the image through the resting camera, so from the resting
// view the plate shows the plain picture; any other view slides the far parts inside the frame
// while the near ones hold. The view offset is exaggerated (uGain) so a small camera move already
// reads as depth, and on hover the pane tilts towards the mouse (uLook).
// Textures are stored top-down (no flip on upload, ImageBitmaps ignore it anyway): labFlip
// turns the picture's v (up) into texture space
const LAB_WIN_VERT = `
  varying vec3 vPos;
  #include <fog_pars_vertex>
  void main() {
    vPos = position;
    vec4 mvPosition = modelViewMatrix * vec4(position, 1.0);
    gl_Position = projectionMatrix * mvPosition;
    #include <fog_vertex>
  }
`;
const labWinFrag = (steps) => `
  uniform sampler2D uMap, uDepth;
  uniform vec3 uCam, uEye;
  uniform vec2 uSize, uLook, uCover;
  uniform float uAmt, uGain, uZoom, uAlpha, uHover, uMaxOff;
  varying vec3 vPos;
  #include <fog_pars_fragment>
  vec2 labFlip(vec2 uv) { return vec2(uv.x, 1.0 - uv.y); }
  // Where a point behind the glass shows from the resting camera: its place in the picture
  vec2 toUv(vec3 X) {
    vec2 S = uCam.xy + (X.xy - uCam.xy) * (uCam.z / (uCam.z - X.z));
    return (S / uSize) * uZoom * uCover + 0.5;
  }
  float floorAt(vec3 X, float amt) { return (texture2D(uDepth, labFlip(toUv(X))).r - 1.0) * amt; }
  void main() {
    vec3 P = vPos;
    vec3 R = (P - uCam) / uCam.z;                       // resting ray, z = -1
    vec3 V = (P - uEye) / max(uEye.z, 0.05);            // current ray, z = -1
    // Turn of the view plus the hover tilt, capped as one: the far layer never slides past the margin
    vec2 off = (V.xy - R.xy) * uGain + uLook;
    off *= min(1.0, uMaxOff / max(length(off), 1e-4));
    vec3 D = vec3(R.xy + off, -1.0);
    float amt = uAmt * (1.0 + 0.3 * uHover);
    vec3 stp = D * (amt / float(${steps}));
    vec3 X = P, Xp = P;
    for (int i = 0; i < ${steps}; i++) {
      Xp = X;
      X += stp;
      if (X.z <= floorAt(X, amt)) break;
    }
    for (int j = 0; j < 5; j++) {
      vec3 M = (Xp + X) * 0.5;
      if (M.z <= floorAt(M, amt)) X = M; else Xp = M;
    }
    // Secant step: land between the last point above and the first below the surface
    float ha = Xp.z - floorAt(Xp, amt);
    float hb = X.z - floorAt(X, amt);
    X = mix(Xp, X, clamp(ha / max(ha - hb, 1e-5), 0.0, 1.0));
    vec2 uv = toUv(X), uv0 = toUv(P);
  #if __VERSION__ >= 300
    vec2 g = vec2(uv0.x, -uv0.y);
    vec3 col = textureGrad(uMap, labFlip(clamp(uv, 0.0, 1.0)), dFdx(g), dFdy(g)).rgb;
  #else
    vec3 col = texture2D(uMap, labFlip(clamp(uv, 0.0, 1.0))).rgb;
  #endif
    // Past the picture's edge: the picture's own border, in shadow (no flat wall colour)
    vec2 e = max(-uv, uv - 1.0);
    col *= 1.0 - 0.35 * smoothstep(0.0, 0.04, max(e.x, e.y));
    // A soft shade along the inside of the frame, stronger as the view turns
    vec2 q = abs(P.xy / uSize) * 2.0;
    float edge = 1.0 - max(q.x, q.y);
    col *= 1.0 - 0.1 * (1.0 - smoothstep(0.0, 0.06, edge)) * clamp(length(off) * 2.5, 0.0, 1.0);
    gl_FragColor = vec4(col, uAlpha);
    #include <colorspace_fragment>
    #include <fog_fragment>
  }
`;
// Small crosses scattered through the space, so the depth has something to measure against
const LAB_CROSS_VERT = `
  uniform float uProj, uSize;
  varying float vA;
  void main() {
    vec4 mv = modelViewMatrix * vec4(position, 1.0);
    gl_Position = projectionMatrix * mv;
    float d = -mv.z;
    gl_PointSize = clamp(uSize * uProj / d, 2.0, 22.0);
    vA = smoothstep(3.0, 10.0, d) * (1.0 - smoothstep(${LAB_SPACE.fogNear.toFixed(1)}, ${LAB_SPACE.fogFar.toFixed(1)}, d));
  }
`;
const LAB_CROSS_FRAG = `
  uniform vec3 uColor;
  varying float vA;
  void main() {
    vec2 q = abs(gl_PointCoord - 0.5);
    float arm = step(min(q.x, q.y), 0.055) * step(max(q.x, q.y), 0.5);
    if (arm * vA < 0.01) discard;
    gl_FragColor = vec4(uColor, arm * vA);
    #include <colorspace_fragment>
  }
`;

// Overlay UI (HTML, so the words stay sharp). Injected once, kept across pages
// --lab-bg / --lab-veil: the stage colour (set by the lab on [data-lab]). The hint, the nav and the
// live link sit on a veil of it (the link's is a box-shadow, so Webflow keeps its box) and the copy
// gets a dense halo of it, so far clusters, the route and the lattice never run through the words
// or flicker next to them. The tech window and the fly tag open with a fade and a whole-px slide:
// a scale would re-rasterize the words when it ends. The stage takes the panel's rounded corners (only the top two on
// phone, where the copy continues below it), so the canvas and the focus ring follow the panel
const LAB_CSS = `
[data-lab-stage]{border-top-left-radius:inherit;border-top-right-radius:inherit}
[data-lab-stage]:not(:has(> .lab-scene.is-phone)){border-bottom-left-radius:inherit;border-bottom-right-radius:inherit}
[data-lab-stage]:focus{outline:none}
[data-lab-stage]:focus-visible{outline:2px solid ${LAB.accent};outline-offset:-2px}
@media (min-width:768px){[data-lab] .lab__concept,[data-lab] .lab__live,[data-lab] .lab__name,[data-lab] .lab__meta{text-shadow:0 0 1px var(--lab-bg),0 0 1px var(--lab-bg),0 0 3px var(--lab-bg),0 0 6px var(--lab-bg),0 0 10px var(--lab-bg)}
[data-lab] .lab__live{background:var(--lab-veil,transparent);box-shadow:0 0 0 4px var(--lab-veil,transparent)}}
.lab-scene{position:absolute;inset:0;overflow:hidden;touch-action:none;cursor:grab;-webkit-user-select:none;user-select:none;-webkit-tap-highlight-color:transparent}
.lab-scene.is-phone{touch-action:pan-y}
.lab-scene.is-dragging{cursor:grabbing}
.lab-scene.is-over{cursor:pointer}
.lab-gl{position:absolute;inset:0;width:100%;height:100%;display:block}
.lab-lead{position:absolute;inset:0;width:100%;height:100%;pointer-events:none;overflow:visible}
.lab-tech{position:absolute;z-index:3;left:0;top:0;width:272px;background:#fff;border:1px solid ${LAB.ink};font:400 11px/1.45 "Geist Mono",ui-monospace,monospace;color:${LAB.ink};text-align:left;opacity:0;transform:translateY(4px);transition:opacity .18s ease,transform .22s cubic-bezier(.2,.8,.2,1);pointer-events:none}
.lab-tech.is-on{opacity:1;transform:none}
.lab-tech__bar{display:flex;justify-content:space-between;align-items:center;gap:8px;background:${LAB.accent};color:#fff;padding:6px 9px;font-size:10px;letter-spacing:.06em;text-transform:uppercase}
.lab-tech__bar span{overflow:hidden;text-overflow:ellipsis;white-space:nowrap}
.lab-tech__bar em{font-style:normal;display:flex;gap:4px;flex:none}
.lab-tech__bar em i{width:6px;height:6px;border:1px solid #fff}
.lab-tech__body{padding:10px 10px 11px}
.lab-tech__what{margin:0 0 10px;font-family:"Host Grotesk",system-ui,sans-serif;font-size:13px;line-height:1.25;letter-spacing:-.005em}
.lab-tech__what:empty{display:none}
.lab-tech dl{margin:0;display:grid;grid-template-columns:minmax(62px,max-content) 1fr;row-gap:3px;column-gap:10px;border-top:1px solid ${LAB.line};padding-top:8px}
.lab-tech__what:empty+dl{border-top:0;padding-top:0}
.lab-tech dt{max-width:104px;overflow-wrap:anywhere;color:${LAB.muted};text-transform:uppercase;font-size:9.5px;letter-spacing:.06em;padding-top:1px}
.lab-tech dd{margin:0;overflow-wrap:anywhere}
.lab-fly{position:absolute;z-index:4;left:0;top:0;display:flex;gap:10px;align-items:center;background:${LAB.accent};color:#fff;font:400 10px/1 "Geist Mono",ui-monospace,monospace;letter-spacing:.06em;text-transform:uppercase;padding:7px 10px;white-space:nowrap;pointer-events:none;opacity:0;transform:translate(16px,20px);transition:opacity .15s ease,transform .2s cubic-bezier(.2,.8,.2,1)}
.lab-fly.is-on{opacity:1;transform:translate(16px,16px)}
.lab-fly i{font-style:normal;opacity:.7}
.lab-hint{position:absolute;z-index:1;left:4%;bottom:5.5%;display:flex;gap:10px;align-items:center;font:400 9px/1 "Geist Mono",ui-monospace,monospace;letter-spacing:.08em;color:${LAB.faint};text-transform:uppercase;pointer-events:none;white-space:nowrap;background:var(--lab-veil,transparent);padding:4px 7px;margin:-4px -7px}
.lab-hint b{display:grid;grid-template-columns:4px 4px;gap:3px}
.lab-hint b i{width:4px;height:4px;border-radius:50%;border:1px solid #9c9c98}
.lab-hint b i:nth-child(2){background:#9c9c98}
.lab-hint.is-fly{color:${LAB.accent}}
.lab-hint.is-fly b i{border-color:${LAB.accent}}
.lab-hint.is-fly b i:nth-child(2){background:${LAB.accent}}
.lab-nav{position:absolute;z-index:2;right:14px;bottom:10px;display:flex;align-items:center;gap:2px;font:400 9px/1 "Geist Mono",ui-monospace,monospace;letter-spacing:.08em;color:${LAB.faint};text-transform:uppercase;background:var(--lab-veil,transparent)}
.lab-nav[hidden]{display:none}
.lab-nav__btn{appearance:none;-webkit-appearance:none;margin:0;padding:0;width:28px;height:28px;display:grid;place-items:center;border:0;background:none;color:${LAB.muted};font:inherit;font-size:11px;cursor:pointer;border-radius:0}
.lab-nav__btn:hover{color:${LAB.accent}}
.lab-nav__btn:focus{outline:none}
.lab-nav__btn:focus-visible{outline:2px solid ${LAB.accent};outline-offset:-4px}
.lab-nav__count{min-width:5.2em;text-align:center}
.lab-loading{position:absolute;z-index:1;left:50%;top:50%;translate:-50% -50%;font:400 10px/1 "Geist Mono",ui-monospace,monospace;letter-spacing:.08em;color:${LAB.muted};text-transform:uppercase;pointer-events:none;white-space:nowrap;opacity:0;transition:opacity .3s}
.lab-loading.is-on{opacity:1;transition-delay:.6s}
.lab-sr{position:absolute;width:1px;height:1px;margin:-1px;padding:0;overflow:hidden;clip:rect(0 0 0 0);clip-path:inset(50%);white-space:nowrap;border:0}
.lab-scene.is-phone .lab-tech{width:auto;left:10px!important;right:10px;top:auto!important;bottom:calc(40px + var(--lab-under,0px))}
.lab-scene.is-phone .lab-tech .lab-opt{display:none}
.lab-scene.is-phone .lab-hint{left:auto;right:16px;bottom:calc(46px + var(--lab-under,0px))}
[data-lab]:has(> .lab-nav.is-bar[hidden]) .lab-scene.is-phone .lab-hint{bottom:18px}
.lab-scene.is-phone .lab-nav{right:8px;bottom:8px}
[data-lab]:has(> .lab-nav.is-bar){overflow:clip}
.lab-nav.is-bar{position:sticky;z-index:5;right:auto;bottom:0;flex:none;background:var(--lab-bg,${LAB.fallbackBg});display:grid;grid-template-columns:auto minmax(0,1fr) auto;align-items:stretch;gap:0;height:52px;border-top:1px solid ${LAB.line};border-bottom:1px solid ${LAB.line};font-size:10px;color:${LAB.ink};-webkit-user-select:none;user-select:none;-webkit-tap-highlight-color:transparent}
.lab-nav.is-bar .lab-nav__btn{width:auto;height:auto;min-width:96px;padding:0 18px;display:flex;align-items:center;gap:8px;color:${LAB.ink};font-size:10px;letter-spacing:.08em;text-transform:uppercase;transition:background-color .15s,color .15s;touch-action:manipulation}
.lab-nav.is-bar .lab-nav__btn[data-go="1"]{justify-content:flex-end}
.lab-nav.is-bar .lab-nav__btn span{font-size:13px;letter-spacing:0}
.lab-nav.is-bar .lab-nav__btn:active{background:${LAB.ink};color:#fff}
.lab-nav.is-bar .lab-nav__btn:focus-visible{outline-offset:-3px}
.lab-nav__mid{display:flex;align-items:center;justify-content:center;gap:10px;min-width:0}
.lab-nav.is-bar .lab-nav__count{min-width:0;flex:none;color:${LAB.faint}}
.lab-nav__name{min-width:0;overflow:hidden;text-overflow:ellipsis;white-space:nowrap}
@media (max-height:500px){.lab-nav.is-bar{height:44px}}
.lab-nav.is-bar[hidden]{display:none}
.lab-copy-fade{transition:opacity .35s ease,translate .35s ease}
.lab-copy-fade.lab-is-out{opacity:0;translate:0 6px}
@media (prefers-reduced-motion:reduce){.lab-copy-fade,.lab-tech,.lab-fly{transition:none}}
`;

function labInjectCss() {
  if (document.querySelector("style[data-lab-css]")) return;
  const style = document.createElement("style");
  style.setAttribute("data-lab-css", "");
  style.textContent = LAB_CSS;
  document.head.appendChild(style);
}

const labPad = (n) => String(n).padStart(2, "0");
const LAB_PLACEHOLDER = /\/placeholder\.[0-9a-f]+\.svg(?:$|[?#])/i;

// -- Reading the CMS list ---------------------------------------------------------------------

// Text of a bound field. Webflow marks empty bindings with w-dyn-bind-empty. Line breaks come
// as <br> (innerText is useless here: the list is display:none, so it has no layout)
function labText(el, multiline = false) {
  if (!el || el.classList.contains("w-dyn-bind-empty")) return "";
  const html = el.innerHTML.replace(/<br\s*\/?>/gi, "\n").replace(/<\/(?:p|div|li|h\d)>/gi, "\n");
  const decoder = document.createElement("textarea"); // decodes entities, never builds elements
  decoder.innerHTML = html.replace(/<[^>]*>/g, "");
  const text = decoder.value.replace(/ /g, " ").replace(/[​-‍﻿]/g, "");
  if (!multiline) return text.replace(/\s+/g, " ").trim();
  return text.replace(/\r\n?/g, "\n").split("\n").map((line) => line.replace(/\s+$/, ""))
    .join("\n").replace(/^\n+|\n+$/g, "");
}

// A bound image: null when the field is empty (Webflow keeps a placeholder src there)
function labImage(img) {
  if (!img || img.classList.contains("w-dyn-bind-empty")) return null;
  const raw = (img.getAttribute("src") || "").trim();
  if (!raw || LAB_PLACEHOLDER.test(raw) || raw.startsWith("data:image/gif")) return null;
  const abs = (url) => {
    try { return new URL(url, document.baseURI).href; } catch (e) { return ""; }
  };
  // Width candidates only ("800w"); density ones ("2x") say nothing about the pixels
  const set = (img.getAttribute("srcset") || "").split(",")
    .map((part) => part.trim().split(/\s+/))
    .filter(([url, size]) => url && /^\d+w$/i.test(size || ""))
    .map(([url, size]) => ({ url: abs(url), w: parseInt(size, 10) }))
    .filter((c) => c.url && c.w > 0)
    .sort((a, b) => a.w - b.w);
  return { src: abs(raw), set, alt: (img.getAttribute("alt") || "").trim() };
}

// The URL to load for `need` px of width: the largest srcset candidate up to it, else the
// smallest one above it, else src
function labPick(img, need) {
  if (img.set.length) {
    const fit = img.set.filter((c) => c.w <= need);
    return (fit.length ? fit[fit.length - 1] : img.set[0]).url;
  }
  return img.src;
}

// The project's primary colours (field "colors"): entries split by new lines, commas or
// semicolons, each a hex code with an optional name before or after it ("Ink #0C0C0C",
// "#0c0c0c", "#FFF Paper", "Ink: #0C0C0C", "#0C0C0C (Ink)"). Case does not matter, #RGB becomes
// #RRGGBB. The # may be left out only where the code cannot be a word: a 6-digit code with a
// digit in it ("Ink 0C0C0C") or one that is the whole entry ("FAFAFA"); a 3-digit code, or a
// letters-only one next to a name, needs it ("Bad", "Deep facade" stay names) unless it is written
// in capitals at the end of the entry ("White FFFFFF"). In an entry with
// a # code, bare codes belong to the name. Several codes in one entry (a missing comma) are
// split, each name going with the code on the side the entry starts with. Entries without a
// code are skipped, a repeated colour keeps its first place, at most LAB_COLORS.max colours.
const LAB_COLORS = { max: 8, name: 48 }; // the name is cut again to the swatch width when drawn
function labColors(text) {
  const out = [];
  const edge = /^[\s:=|\/\\·•"'“”‘’«»*_–—-]+|[\s:=|\/\\·•"'“”‘’«»*_–—-]+$/g;
  const tidy = (s) => {
    // "Ink: 0C0C0C (dark)" leaves "Ink: (dark)"; "Paper #FFF." leaves "Paper ."
    let t = s.replace(/\(\s*\)|\[\s*\]/g, " ").replace(/\s+/g, " ").replace(/\s*[:=]\s+(?=\S)/g,
        " ")
      .replace(edge, "").replace(/[\s.!?]+$/, "").replace(edge, "");
    const wrapped = t.match(
    /^\(([^()]*)\)$|^\[([^[\]]*)\]$/); // "#0C0C0C (Ink)", not "(Signal) (red)"
    if (wrapped) t = (wrapped[1] ?? wrapped[2]).replace(edge, "");
    const chars = Array.from(t); // by character, so an emoji is never split
    return chars.length > LAB_COLORS.name ?
      `${chars.slice(0, LAB_COLORS.name - 1).join("").trimEnd()}…` : t;
  };
  for (const entry of String(text || "").split(/[\n\r,;]+/)) {
    const codes = [],
      re = /#?([0-9a-f]{6}|[0-9a-f]{3})(?![0-9a-z])/gi;
    for (let m;
      (m = re.exec(entry));) {
      codes.push({ at: m.index, end: re.lastIndex, hash: m[0][0] === "#", d: m[1], before: entry[m
          .index - 1] || "" });
    }
    const hashed = codes.some((c) => c.hash);
    const ok = codes.filter((c) => c.hash || (!hashed && c.d.length === 6 && !/[0-9a-z]/i.test(c
        .before) &&
      (/\d/.test(c.d) || entry.trim() === c.d || (/^[A-F]{6}$/.test(c.d) && !entry.slice(c.end)
        .trim()))));
    const lead = ok.length > 1 && !tidy(entry.slice(0, ok[0].at)); // "#111 Ink #222 Paper"
    ok.forEach((c, i) => {
      const name = ok.length === 1 ? tidy(`${entry.slice(0, c.at)} ${entry.slice(c.end)}`) :
        lead ? tidy(entry.slice(c.end, i + 1 < ok.length ? ok[i + 1].at : entry.length)) :
        tidy(entry.slice(i ? ok[i - 1].end : 0, c.at));
      const hex = `#${(c.d.length === 3 ? c.d.replace(/./g, "$&$&") : c.d).toUpperCase()}`;
      const prev = out.find((o) => o.hex === hex);
      if (prev) prev.name = prev.name || name;
      else if (out.length < LAB_COLORS.max) out.push({ hex, name });
    });
  }
  return out;
}

function labReadItem(item) {
  const f = (name) => item.querySelector(`[data-lab-f="${name}"]`);
  const name = labText(f("name")) || "Untitled";

  // "Name | score | note", one line per image (line n goes with Image n)
  const plates = labText(f("plates"), true).split("\n").map((line) => {
    const [title = "", score = "", ...rest] = line.split("|").map((s) => s.trim());
    const num = parseFloat(score.replace("%", "").replace(",", "."));
    return { name: title, score: Number.isFinite(num) ? Math.round(num) : null, note: rest.join(
        " | ") };
  });

  // "Label: value; Label: value" (new lines work too)
  const tools = labText(f("tools"), true).split(/[;\n]/).map((s) => s.trim()).filter(Boolean)
    .map((s) => {
      const i = s.indexOf(":");
      return i > 0 ? [s.slice(0, i).trim(), s.slice(i + 1).trim()] : ["Tool", s];
    });

  let link = null;
  const a = f("link");
  const href = (a?.getAttribute("href") || "").trim();
  if (a && href && href !== "#" && !/^javascript:/i.test(href)) {
    let label = labText(a),
      external = false;
    try {
      const u = new URL(href, document.baseURI);
      // mailto: / tel: have no host: the address or the number is the label
      if (!label) label = u.host || decodeURIComponent(u.pathname) || href;
      external = /^https?:$/.test(u.protocol) && u.origin !== location.origin;
    } catch (e) {
      if (!label) label = href;
    }
    link = { href, label, external };
  }

  const images = [];
  for (let n = 1; n <= 7; n++) {
    const img = labImage(item.querySelector(`img[data-lab-img="${n}"]`));
    if (!img) continue;
    const plate = plates[n - 1] || {};
    images.push({
      ...img,
      k: images.length,
      depth: labImage(item.querySelector(`img[data-lab-depth="${n}"]`)),
      name: plate.name || img.alt || "Untitled",
      score: plate.score ?? null,
      note: plate.note || "",
    });
  }

  return {
    name,
    slug: labText(f("slug")),
    kind: labText(f("kind")),
    year: labText(f("year")),
    desc: labText(f("desc"), true),
    link,
    brief: labText(f("brief"), true),
    status: labText(f("status"), true),
    tools,
    prompt: {
      head: labText(f("prompt-title")) || "Prompt",
      body: labText(f("prompt"), true),
      meta: labText(f("prompt-meta")),
      mono: labText(f("prompt-style")).toLowerCase() === "code",
    },
    colors: labColors(labText(f("colors"), true)), // empty: the palette samples the plates
    images,
  };
}

// Experiments in CMS order; one without any image can't be shown
function labReadItems(root) {
  const data = root.querySelector("[data-lab-data]") || root;
  return [...data.querySelectorAll("[data-lab-item]")].map(labReadItem).filter((e) => e.images
    .length);
}

// -- Copy around the scene (Webflow elements) -------------------------------------------------

function labCopyBoxes(root) {
  const boxes = new Set();
  root.querySelectorAll("[data-lab-desc], [data-lab-live], [data-lab-name], [data-lab-meta]")
    .forEach((el) => boxes.add(el.closest(".lab__copy") || el));
  return [...boxes];
}

function labWriteCopy(root, e, i, n) {
  const put = (sel, text) => root.querySelectorAll(sel).forEach((el) => {
    if (el.textContent !== text) el.textContent = text;
  });
  put("[data-lab-desc]", e.desc);
  put("[data-lab-name]", e.name);
  put("[data-lab-meta]", [e.kind, e.year, `${labPad(i + 1)} / ${labPad(n)}`].filter(Boolean).join(
    " · "));
  root.querySelectorAll("[data-lab-live]").forEach((a) => {
    if (e.link) {
      const text = `Live at: ${e.link.label}`;
      if (a.textContent !== text) a.textContent = text;
      a.setAttribute("href", e.link.href);
      // Other sites open in a new tab; a page of this site goes through Barba like any link
      if (e.link.external) {
        a.setAttribute("target", "_blank");
        a.setAttribute("rel", "noopener");
      } else {
        a.removeAttribute("target");
        a.removeAttribute("rel");
      }
      a.style.display = "";
      a.removeAttribute("aria-hidden");
    } else {
      if (a.textContent) a.textContent = "";
      a.removeAttribute("href");
      a.style.display = "none";
      a.setAttribute("aria-hidden", "true");
    }
  });
}

// -- Depth maps: CPU helpers ------------------------------------------------------------------

const labClamp = (v, a, b) => Math.min(b, Math.max(a, v));
const labSmooth = (a, b, x) => {
  const t = labClamp((x - a) / (b - a), 0, 1);
  return t * t * (3 - 2 * t);
};

// Max filter: near (white) areas grow by r texels, so a silhouette's edge sits on the background
function labDilate(A, w, h, r) {
  const T = new Float32Array(A.length);
  for (let y = 0; y < h; y++)
    for (let x = 0; x < w; x++) {
      let m = 0;
      for (let k = -r; k <= r; k++) m = Math.max(m, A[y * w + Math.min(w - 1, Math.max(0, x + k))]);
      T[y * w + x] = m;
    }
  for (let y = 0; y < h; y++)
    for (let x = 0; x < w; x++) {
      let m = 0;
      for (let k = -r; k <= r; k++) m = Math.max(m, T[Math.min(h - 1, Math.max(0, y + k)) * w + x]);
      A[y * w + x] = m;
    }
  return A;
}

function labBlur(A, w, h, r, passes) {
  const T = new Float32Array(A.length);
  for (let p = 0; p < passes; p++) {
    for (let y = 0; y < h; y++) {
      let acc = 0;
      for (let x = -r; x <= r; x++) acc += A[y * w + labClamp(x, 0, w - 1)];
      for (let x = 0; x < w; x++) {
        T[y * w + x] = acc / (2 * r + 1);
        acc += A[y * w + labClamp(x + r + 1, 0, w - 1)] - A[y * w + labClamp(x - r, 0, w - 1)];
      }
    }
    for (let x = 0; x < w; x++) {
      let acc = 0;
      for (let y = -r; y <= r; y++) acc += T[labClamp(y, 0, h - 1) * w + x];
      for (let y = 0; y < h; y++) {
        A[y * w + x] = acc / (2 * r + 1);
        acc += T[labClamp(y + r + 1, 0, h - 1) * w + x] - T[labClamp(y - r, 0, h - 1) * w + x];
      }
    }
  }
  return A;
}

function labNormalise(A) {
  const s = Float32Array.from(A).sort();
  const lo = s[Math.floor(s.length * 0.04)],
    hi = s[Math.floor(s.length * 0.96)] || lo + 1e-3;
  for (let k = 0; k < A.length; k++) A[k] = labClamp((A[k] - lo) / (hi - lo || 1), 0, 1);
  return A;
}

function labPixels(img, w, h) {
  const c = document.createElement("canvas");
  c.width = w;
  c.height = h;
  const g = c.getContext("2d", { willReadFrequently: true });
  g.drawImage(img, 0, 0, w, h);
  const data = g.getImageData(0, 0, w, h).data;
  c.width = c.height = 0;
  return data;
}

// Depth from focus, for photos without a baked map: AI macro plates are sharp on the subject
// and soft behind it, so local sharpness, blurred into regions, is a fair stand-in for depth.
// A centre bias and a little luminance relief fill the flat areas; the depth eases to the
// window plane at the edges
function labDepthField(img, cols, rows, relief = 0.9) {
  const W = cols * 2,
    H = rows * 2;
  const px = labPixels(img, W, H);
  const Y = new Float32Array(W * H);
  for (let k = 0; k < W * H; k++) Y[k] = (0.2126 * px[k * 4] + 0.7152 * px[k * 4 + 1] + 0.0722 * px[
    k * 4 + 2]) / 255;
  const Sh = new Float32Array(cols * rows),
    L = new Float32Array(cols * rows);
  for (let y = 0; y < H; y++)
    for (let x = 0; x < W; x++) {
      const k = y * W + x;
      const lap = Math.abs(4 * Y[k] - Y[y * W + Math.max(0, x - 1)] - Y[y * W + Math.min(W - 1, x +
          1)] -
        Y[Math.max(0, y - 1) * W + x] - Y[Math.min(H - 1, y + 1) * W + x]);
      const j = (y >> 1) * cols + (x >> 1);
      Sh[j] += lap * 0.25;
      L[j] += Y[k] * 0.25;
    }
  labNormalise(labBlur(Sh, cols, rows, Math.max(2, Math.round(cols * 0.07)), 3));
  const Lb = labBlur(Float32Array.from(L), cols, rows, Math.max(2, Math.round(cols * 0.04)), 2);
  const D = new Float32Array(cols * rows);
  const edge = cols * 0.12;
  for (let y = 0; y < rows; y++)
    for (let x = 0; x < cols; x++) {
      const j = y * cols + x;
      const nx = (x + 0.5) / cols * 2 - 1,
        ny = (y + 0.5) / rows * 2 - 1;
      const centre = 1 - labSmooth(0.1, 1.1, Math.hypot(nx * 0.9, ny));
      let d = 0.64 * Sh[j] + 0.36 * centre + (L[j] - Lb[j]) * relief;
      d = labClamp(d, 0, 1);
      const e = labSmooth(0, 1, Math.min(x + 0.5, cols - x - 0.5, y + 0.5, rows - y - 0.5) / edge);
      D[j] = 0.5 + (d - 0.5) * e;
    }
  return D;
}

// A depth map image sampled on a grid (0 far .. 1 near)
function labReadDepth(img, cols, rows) {
  const px = labPixels(img, cols, rows);
  const D = new Float32Array(cols * rows);
  for (let j = 0; j < D.length; j++) D[j] = px[j * 4] / 255;
  return D;
}

// The colour that best stands for an image: saturated pixels weigh more than grey ones
function labDominant(img) {
  const d = labPixels(img, 24, 24);
  let r = 0,
    gr = 0,
    b = 0,
    ws = 0;
  for (let k = 0; k < d.length; k += 4) {
    const mx = Math.max(d[k], d[k + 1], d[k + 2]),
      mn = Math.min(d[k], d[k + 1], d[k + 2]);
    const sat = (mx - mn) / 255,
      w = 0.04 + sat * sat * 4;
    r += d[k] * w;
    gr += d[k + 1] * w;
    b += d[k + 2] * w;
    ws += w;
  }
  const hx = (v) => Math.round(v / ws).toString(16).padStart(2, "0");
  return `#${hx(r)}${hx(gr)}${hx(b)}`;
}

// Relative luminance (WCAG, 0..1) of a #RRGGBB colour
function labLuma(hex) {
  const n = parseInt(String(hex).slice(1, 7), 16) || 0;
  const lin = (v) => ((v /= 255) <= 0.04045 ? v / 12.92 : ((v + 0.055) / 1.055) ** 2.4);
  return 0.2126 * lin(n >> 16) + 0.7152 * lin((n >> 8) & 255) + 0.0722 * lin(n & 255);
}

// Breathing room between long CPU steps, so frames keep coming
const labYield = () => new Promise((resolve) => setTimeout(resolve, 0));

// -- The lab ----------------------------------------------------------------------------------

// createLab(THREE, opts) -> { ready, destroy(), debug }
// opts: root ([data-lab]), stage ([data-lab-stage]), items (labReadItems), reduced() (reduced
// motion, read live), reveal (promise: the page is in view, the fly-in may start), fontsReady
// (promise), log(message, isError). ready resolves once the first cluster is drawn (or the lab
// gave up). Phone and desktop have their own layout, sizes and space: crossing the breakpoint
// rebuilds the scene in place, on the experiment that was showing
function createLab(THREE, opts) {
  const mq = window.matchMedia(LAB.phoneQuery);
  const outer = new AbortController();
  let core = null;
  let dead = false;
  let index = 0;
  let resolveReady;
  const ready = new Promise((resolve) => { resolveReady = resolve; });

  const start = (intro) => {
    const c = labCore(THREE, {
      ...opts,
      phone: mq.matches,
      index,
      intro,
      onIndex: (i) => { index = i; },
      onReady: () => resolveReady(),
      // The WebGL context came back (or never will): the CPU copies of the textures were freed
      // on upload, so the scene is rebuilt on a fresh context, out of the context's own event
      onRestore: () => setTimeout(() => {
        if (dead || core !== c) return;
        rebuild();
      }, 0),
    });
    core = c;
  };
  // Rebuild in place on the experiment that was showing; keyboard focus stays in the stage (or on
  // the nav button it was on: on a phone the nav is a bar under the stage)
  const rebuild = () => {
    const f = document.activeElement;
    const was = f && f.closest?.(".lab-nav") && opts.root.contains(f) ? f.getAttribute(
      "data-go") : null;
    const inStage = f === opts.stage || opts.stage.contains(f) || was !== null;
    core?.destroy();
    start(false);
    if (!inStage) return;
    const el = (was && opts.root.querySelector(`.lab-nav__btn[data-go="${was}"]`)) || opts.stage;
    try { el.focus({ preventScroll: true }); } catch (e) { /* not focusable */ }
  };
  mq.addEventListener("change", () => {
    if (dead) return;
    rebuild();
  }, { signal: outer.signal });
  start(true);

  return {
    ready,
    destroy() {
      if (dead) return;
      dead = true;
      outer.abort();
      core?.destroy();
      core = null;
      resolveReady();
    },
    get debug() {
      return core?.debug || null;
    },
  };
}

function labCore(THREE, o) {
  const { root, stage, items } = o;
  const N = items.length;
  const PHONE = o.phone;
  const reduced = () => !!(o.reduced && o.reduced());
  const COARSE = window.matchMedia("(pointer: coarse)").matches;
  const log = (msg, isError = false) => {
    if (isError) console.warn(`[lab] ${msg}`);
    o.log?.(`${isError ? "✗" : "·"} lab: ${msg}`, isError);
  };
  const clamp = labClamp,
    smooth = labSmooth,
    pad2 = labPad;
  const mod = (n, m) => ((n % m) + m) % m;
  const easeInOut = (t) => (t < 0.5 ? 4 * t * t * t : 1 - Math.pow(-2 * t + 2, 3) / 2);

  const ac = new AbortController();
  const { signal } = ac;
  let alive = true;
  const ABORT = { aborted: true };
  const timers = new Set();
  const later = (fn, ms) => {
    const id = setTimeout(() => {
      timers.delete(id);
      if (alive) fn();
    }, ms);
    timers.add(id);
    return id;
  };
  const cancel = (id) => {
    clearTimeout(id);
    timers.delete(id);
  };

  // Mode constants (the spike's tuning)
  const GAIN = PHONE ? 2.3 : 2.6; // in-image parallax, exaggerated for the experiment in front
  const MAX_OFF = PHONE ? 0.28 : 0.36; // cap on the in-frame slide, in ray units
  const STEPS = PHONE ? 26 : 40; // ray-march steps behind the glass
  const SHELL = PHONE ? LAB.shell.phone : LAB.shell.desk;
  const SHARP = PHONE ? LAB.sharp.phone : LAB.sharp.desk;
  const PX = PHONE ? 300 : 420; // text window texels per unit
  const { dist: DIST, spacing: SPACING, turns: TURNS, phase: PHASE, fogNear: FOG_NEAR,
    fogFar: FOG_FAR } = LAB_SPACE;
  const TURN = (Math.PI * 2) / TURNS;
  const HELIX = PHONE ? { rx: 5.6, ry: 12 } : { rx: 17, ry: 10.5 };
  const YAW = PHONE ? 0.6 : 0.75,
    PITCH = PHONE ? 0 : 0.38;
  const FLOATS = PHONE ? LAB_FLOAT_PHONE : LAB_FLOAT_DESK;
  const WIN_FRAG = labWinFrag(STEPS);

  // Bounds of the full layout: every cluster is centred and scaled on them, whatever it holds
  const LB = (() => {
    // Desktop counts the seventh slot too, so the framing is the same with 6 or 7 images
    const plates = PHONE ? LAB_PHONE_SLOTS.map((k) => LAB_SLOTS[k]) : LAB_SLOTS;
    const texts = PHONE ? [] : [LAB_NOTES_SLOT];
    let x0 = Infinity,
      x1 = -Infinity,
      y0 = Infinity,
      y1 = -Infinity;
    for (const s of [...plates, ...texts]) {
      const w = s.w,
        h = s.w / s.a,
        top = plates.includes(s) ? 0.3 : 0;
      x0 = Math.min(x0, s.x - w / 2);
      x1 = Math.max(x1, s.x + w / 2);
      y0 = Math.min(y0, s.y - h / 2);
      y1 = Math.max(y1, s.y + h / 2 + top);
    }
    return { x0, x1, y0, y1, cx: (x0 + x1) / 2, cy: (y0 + y1) / 2, w: x1 - x0, h: y1 - y0 };
  })();

  // The windows of an experiment with `count` images: slot geometry + image index k
  const layoutFor = (count) => {
    const set = LAB_SETS[labClamp(count, 1, 7)];
    const few = PHONE ? LAB_SLOTS_FEW_PHONE : LAB_SLOTS_FEW;
    const slots = set.map((id, k) => ({ ...(typeof id === "number" ? LAB_SLOTS[id] : few[id]), id,
      k }));
    return PHONE ? slots.filter((s) => typeof s.id !== "number" || LAB_PHONE_SLOTS.includes(s
      .id)) : slots;
  };

  // -- DOM: the scene and its overlay, inside the stage
  const stageWas = {
    position: stage.style.position,
    attrs: ["tabindex", "role", "aria-label", "aria-roledescription", "data-lenis-prevent"]
      .map((name) => [name, stage.getAttribute(name)]),
  };
  if (getComputedStyle(stage).position === "static") stage.style.position = "relative";
  stage.setAttribute("tabindex", "0");
  stage.setAttribute("role", "region");
  stage.setAttribute("aria-roledescription", "3D gallery");
  stage.setAttribute("aria-label",
    `The lab in 3D: ${N} experiment${N === 1 ? "" : "s"} floating in space. ` +
    (N > 1 ?
      "Drag to look around, pick a far one to fly to it. Left and right arrow keys fly between experiments." :
      "Drag to look around."));
  // Desktop: the wheel over the stage flies, Lenis leaves it alone. Phone: the page scrolls
  if (!PHONE) stage.setAttribute("data-lenis-prevent", "");
  else stage.removeAttribute("data-lenis-prevent");

  const sceneEl = document.createElement("div");
  sceneEl.className = `lab-scene${PHONE ? " is-phone" : ""}`;
  sceneEl.innerHTML =
    '<canvas class="lab-gl" aria-hidden="true"></canvas>' +
    '<svg class="lab-lead" aria-hidden="true"><line stroke="' + LAB.accent +
    '" stroke-width="1" opacity="0"></line>' +
    '<rect width="5" height="5" fill="' + LAB.accent + '" opacity="0"></rect></svg>' +
    '<div class="lab-tech" aria-hidden="true"><div class="lab-tech__bar"><span></span><em><i></i><i></i><i></i></em></div>' +
    '<div class="lab-tech__body"><p class="lab-tech__what"></p><dl></dl></div></div>' +
    '<div class="lab-fly" aria-hidden="true"><span></span><i>Fly</i></div>' +
    '<div class="lab-hint" aria-hidden="true"><b><i></i><i></i><i></i><i></i></b><span></span></div>' +
    '<div class="lab-nav"><button type="button" class="lab-nav__btn" data-go="-1" aria-label="Previous experiment">←</button>' +
    '<span class="lab-nav__count" aria-hidden="true"></span>' +
    '<button type="button" class="lab-nav__btn" data-go="1" aria-label="Next experiment">→</button></div>' +
    '<div class="lab-loading" aria-hidden="true"></div>' +
    '<p class="lab-sr" aria-live="polite"></p>';
  stage.appendChild(sceneEl);
  const q = (sel) => sceneEl.querySelector(sel);
  const canvas = q(".lab-gl"),
    tech = q(".lab-tech"),
    leadLine = q(".lab-lead line"),
    leadDot = q(".lab-lead rect");
  const techTitle = q(".lab-tech__bar span"),
    techWhat = q(".lab-tech__what"),
    techList = q(".lab-tech dl");
  const flyEl = q(".lab-fly"),
    flyTxt = q(".lab-fly span"),
    hintEl = q(".lab-hint"),
    hintTxt = q(".lab-hint span");
  const navEl = q(".lab-nav"),
    loadingEl = q(".lab-loading"),
    srEl = q(".lab-sr");
  // Phone: the nav leaves the stage for a wide bar under it (thumb-sized Prev / Next, the
  // number and the name of the experiment in front)
  if (PHONE) {
    navEl.classList.add("is-bar");
    navEl.innerHTML =
      '<button type="button" class="lab-nav__btn" data-go="-1" aria-label="Previous experiment"><span aria-hidden="true">←</span>Prev</button>' +
      '<span class="lab-nav__mid" aria-hidden="true"><span class="lab-nav__count"></span><span class="lab-nav__name"></span></span>' +
      '<button type="button" class="lab-nav__btn" data-go="1" aria-label="Next experiment">Next<span aria-hidden="true">→</span></button>';
    stage.after(navEl);
    // iOS only shows :active on elements with a touch listener
    navEl.addEventListener("touchstart", () => {}, { passive: true, signal });
  }
  // The bar sticks to the foot of the screen while the stage runs past it (sticky; the lab
  // section clips instead of hiding its overflow): the hint and the tech window move up by the
  // stage height it covers
  let underRaf = 0;
  const measureUnder = () => {
    underRaf = 0;
    if (!alive || !PHONE) return;
    const off = navEl.hidden ? 0 :
      Math.max(0, Math.round(stage.getBoundingClientRect().bottom - navEl.getBoundingClientRect()
        .top));
    sceneEl.style.setProperty("--lab-under", `${off}px`);
  };
  const queueUnder = () => {
    if (PHONE && !underRaf) underRaf = requestAnimationFrame(measureUnder);
  };
  if (PHONE) {
    window.addEventListener("scroll", queueUnder, { passive: true, signal });
    window.addEventListener("resize", queueUnder, { passive: true, signal }); // iOS toolbars
    // The page above the stage settles after boot (fonts, the intro): measure again then
    [600, 1600, 3500].forEach((ms) => later(queueUnder, ms));
  }
  const navCount = navEl.querySelector(".lab-nav__count"),
    navName = navEl.querySelector(".lab-nav__name");
  navEl.hidden = N < 2;

  const copyBoxes = labCopyBoxes(root);
  copyBoxes.forEach((el) => el.classList.add("lab-copy-fade"));

  const showLoading = (text) => {
    loadingEl.textContent = text;
    loadingEl.classList.toggle("is-on", !!text);
  };

  // Torn down at the end whatever happens next
  function teardownDom() {
    sceneEl.remove();
    navEl.remove(); // on a phone it sits under the stage, outside the scene
    stage.style.position = stageWas.position;
    stageWas.attrs.forEach(([name, value]) => {
      if (value === null) stage.removeAttribute(name);
      else stage.setAttribute(name, value);
    });
    copyBoxes.forEach((el) => el.classList.remove("lab-copy-fade", "lab-is-out"));
    root.style.removeProperty("--lab-bg");
    root.style.removeProperty("--lab-veil");
    clampConcept(0);
  }

  // A description too long for the stage (desktop: the copy sits over it, the page doesn't
  // scroll) is cut to the lines that fit, with an ellipsis; the Live link stays in view
  const descEl = root.querySelector("[data-lab-desc]");
  const CLAMP_PROPS = ["display", "-webkit-box-orient", "-webkit-line-clamp", "overflow"];

  function clampConcept(lines) {
    if (!descEl) return;
    if (!lines) return CLAMP_PROPS.forEach((p) => descEl.style.removeProperty(p));
    descEl.style.setProperty("display", "-webkit-box");
    descEl.style.setProperty("-webkit-box-orient", "vertical");
    descEl.style.setProperty("-webkit-line-clamp", String(lines));
    descEl.style.setProperty("overflow", "hidden");
  }

  function fitConcept(roomPx) {
    if (!descEl) return;
    clampConcept(0);
    if (PHONE) return;
    const box = descEl.closest(".lab__copy") || descEl;
    const bh = box.getBoundingClientRect().height;
    if (bh <= roomPx) return;
    const dh = descEl.getBoundingClientRect().height;
    const lh = parseFloat(getComputedStyle(descEl).lineHeight) || 20;
    clampConcept(Math.max(2, Math.floor((roomPx - (bh - dh)) / lh)));
  }

  // -- Renderer
  let renderer;
  try {
    renderer = new THREE.WebGLRenderer({ canvas, antialias: true, alpha: true,
      powerPreference: "high-performance" });
  } catch (err) {
    log("WebGL is not available: the lab stays a still page.", true);
    navEl.hidden = true; // nothing to fly to
    showLoading("This browser can't draw the lab in 3D");
    o.onReady();
    return {
      destroy() {
        if (!alive) return;
        alive = false;
        ac.abort();
        if (underRaf) cancelAnimationFrame(underRaf);
        timers.forEach((id) => clearTimeout(id));
        timers.clear();
        teardownDom();
      },
      debug: null,
    };
  }
  renderer.setClearColor(0x000000, 0);
  renderer.outputColorSpace = THREE.SRGBColorSpace;
  // Context lost (iOS under memory pressure or in the background, a GPU reset, a GPU switch):
  // ask for it back and rebuild once it returns; if it never does, try a fresh one. Nothing is
  // drawn or uploaded from then on (the pictures' CPU copies are gone): this core is replaced
  let ctxLost = false,
    glDown = false;
  const retryLost = () => {
    if (!ctxLost) return;
    if (document.hidden) return later(retryLost, 1000);
    ctxLost = false;
    o.onRestore?.();
  };
  canvas.addEventListener("webglcontextlost", (e) => {
    e.preventDefault();
    glDown = true;
    if (ctxLost) return;
    ctxLost = true;
    log("WebGL context lost: the lab is rebuilt when it comes back");
    later(retryLost, 3000);
  }, { signal });
  canvas.addEventListener("webglcontextrestored", () => {
    if (!ctxLost) return;
    ctxLost = false;
    o.onRestore?.();
  }, { signal });
  // GPU objects of a lost context are gone with it: deleting them on the restored one only warns
  const gpuFree = (x) => {
    if (!glDown) x.dispose();
  };
  const scene = new THREE.Scene();
  // Fog fades far clusters into whatever paints behind the canvas
  const bgRgb = (() => {
    for (let el = stage; el; el = el.parentElement) {
      const bg = getComputedStyle(el).backgroundColor;
      const m = /rgba?\(([^)]+)\)/.exec(bg);
      if (!m) continue;
      const [r, g, b, a = 1] = m[1].split(",").map((v) => parseFloat(v));
      if (a > 0.5) return [r, g, b].map(Math.round);
    }
    return null;
  })();
  const fogColor = new THREE.Color(bgRgb ? `rgb(${bgRgb.join(", ")})` : LAB.fallbackBg);
  root.style.setProperty("--lab-bg", bgRgb ? `rgb(${bgRgb.join(", ")})` : LAB.fallbackBg);
  root.style.setProperty("--lab-veil", bgRgb ? `rgba(${bgRgb.join(", ")}, 0.9)` :
    "rgba(248, 248, 247, 0.9)");
  scene.fog = new THREE.Fog(fogColor, FOG_NEAR, FOG_FAR);
  const camera = new THREE.PerspectiveCamera(28, 1, 0.1, 400);
  const TAN = Math.tan(THREE.MathUtils.degToRad(camera.fov / 2));
  const U = { proj: { value: 1000 } };
  const UNIT_PLANE = new THREE.PlaneGeometry(1, 1);
  const MAX_ANISO = renderer.capabilities.getMaxAnisotropy();
  let S = 1; // cluster scale, from the view

  function anchor(k, out = new THREE.Vector3()) {
    const a = k * TURN + PHASE;
    return out.set(HELIX.rx * (Math.cos(a) - Math.cos(PHASE)), HELIX.ry * (Math.sin(a) - Math.sin(
      PHASE)), -SPACING * k);
  }
  const SHIFT = new THREE.Vector3(); // where the resting cluster sits, off the middle of the view
  function restPose(k, pos, tgt) {
    anchor(k, tgt).sub(SHIFT);
    pos.copy(tgt);
    pos.z += DIST;
  }
  const slotAt = (z) => (DIST - z) / SPACING; // camera z to (fractional) slot

  // -- Textures
  // Every canvas and decoded image lives on the GPU once uploaded: free the CPU copy then
  const freeImage = (img) => {
    if (!img) return;
    if (typeof img.close === "function") img.close();
    else if ("width" in img && img.getContext) img.width = img.height = 0;
  };

  function canvasTexture(wpx, hpx, draw) {
    const c = document.createElement("canvas");
    c.width = Math.max(1, Math.round(wpx));
    c.height = Math.max(1, Math.round(hpx));
    draw(c.getContext("2d"), c.width, c.height);
    const t = new THREE.CanvasTexture(c);
    t.colorSpace = THREE.SRGBColorSpace;
    t.anisotropy = MAX_ANISO;
    t.onUpdate = () => {
      t.onUpdate = null;
      freeImage(c);
    };
    return t;
  }

  function colorTexture(img) {
    const t = new THREE.Texture(img);
    t.colorSpace = THREE.SRGBColorSpace;
    t.flipY = false;
    t.anisotropy = 4;
    t.needsUpdate = true;
    t.onUpdate = () => {
      t.onUpdate = null;
      freeImage(img);
    };
    return t;
  }
  // Depth is data, not colour: no sRGB decode, no mipmaps (it is read in a loop)
  function depthTexture(D, w, h) {
    const px = new Uint8Array(w * h);
    for (let i = 0; i < px.length; i++) px[i] = Math.round(labClamp(D[i], 0, 1) * 255);
    const t = new THREE.DataTexture(px, w, h, THREE.RedFormat, THREE.UnsignedByteType);
    t.unpackAlignment = 1;
    t.minFilter = t.magFilter = THREE.LinearFilter;
    t.generateMipmaps = false;
    t.wrapS = t.wrapT = THREE.ClampToEdgeWrapping;
    t.needsUpdate = true;
    return t;
  }
  // Any image aspect fills the plate like object-fit: cover (CMS uploads are not pre-cropped)
  const coverFit = (ia, pa) => (ia > pa ? new THREE.Vector2(pa / ia, 1) : new THREE.Vector2(1, ia /
    pa));
  // Scale (<= 1) that gives the visible crop of a w x h image `cap` px on its long side
  const cropScale = (w, h, pa, cap, maxLong = LAB.maxLong) => {
    const ia = w / h;
    const cw = ia > pa ? h * pa : w,
      ch = ia > pa ? h : w / pa;
    return Math.min(1, cap / Math.max(cw, ch), maxLong / Math.max(w, h));
  };

  // Decodes run one or two at a time (downloads don't wait): a camera-size upload is tens of MB
  // once decoded, and a cluster asks for up to seven at once
  let decoding = 0;
  const decodeQueue = [];
  const DECODES = PHONE ? 1 : 2;
  const acquireDecode = () => new Promise((resolve) => {
    if (decoding < DECODES) {
      decoding++;
      resolve();
    } else decodeQueue.push(resolve);
  });
  const releaseDecode = () => {
    const next = decodeQueue.shift();
    if (next) next();
    else decoding--;
  };
  // An image's size without decoding it (an <img> decodes only to paint). EXIF orientation is
  // applied, as createImageBitmap does by default
  function imageSize(blob) {
    const url = URL.createObjectURL(blob);
    const im = new Image();
    return new Promise((resolve, reject) => {
      im.onload = () => resolve([im.naturalWidth, im.naturalHeight]);
      im.onerror = () => reject(new Error("not an image"));
      im.src = url;
    }).finally(() => URL.revokeObjectURL(url));
  }

  // Downloads and decodes an image off the main thread (fetch + createImageBitmap), scaled by
  // fit(w, h). Pixels stay top-down. Aborted with the lab
  async function decode(url, fit) {
    const res = await fetch(url, { mode: "cors", credentials: "omit", signal });
    if (!res.ok) throw new Error(`HTTP ${res.status}`);
    const blob = await res.blob();
    if (!alive) throw ABORT;
    await acquireDecode();
    try {
      return await decodeBlob(blob, fit);
    } finally {
      releaseDecode();
    }
  }
  async function decodeBlob(blob, fit) {
    if (!alive) throw ABORT;
    // Straight to the size needed when the browser can: no full-size bitmap in between
    if (typeof createImageBitmap === "function") {
      let size = null;
      try { size = await imageSize(blob); } catch (e) { size = null; }
      if (!alive) throw ABORT;
      if (size && size[0] > 0 && size[1] > 0) {
        const s = Math.min(1, fit(size[0], size[1]));
        const w = Math.max(1, Math.round(size[0] * s)),
          h = Math.max(1, Math.round(size[1] * s));
        let bm = null;
        try {
          bm = await (s < 1 ? createImageBitmap(blob, { resizeWidth: w, resizeHeight: h,
            resizeQuality: "high" }) : createImageBitmap(blob));
        } catch (e) { bm = null; }
        // A browser that resizes before applying the orientation gives the sides swapped
        if (bm && (bm.width !== w || bm.height !== h)) {
          bm.close();
          bm = null;
        }
        if (bm) {
          if (!alive) {
            bm.close();
            throw ABORT;
          }
          return bm;
        }
      }
    }
    let src = null;
    if (typeof createImageBitmap === "function") {
      try { src = await createImageBitmap(blob); } catch (e) { src = null; }
    }
    if (!src) {
      // SVG or an old browser: through an <img> (a blob URL never taints the canvas)
      const url2 = URL.createObjectURL(blob);
      try {
        const im = new Image();
        im.src = url2;
        await im.decode();
        src = im;
      } finally {
        URL.revokeObjectURL(url2);
      }
    }
    if (!alive) {
      freeImage(src);
      throw ABORT;
    }
    const w0 = src.naturalWidth || src.width,
      h0 = src.naturalHeight || src.height;
    if (!w0 || !h0) throw new Error("empty image");
    const s = Math.min(1, fit(w0, h0));
    const w = Math.max(1, Math.round(w0 * s)),
      h = Math.max(1, Math.round(h0 * s));
    const isBitmap = typeof ImageBitmap !== "undefined" && src instanceof ImageBitmap;
    if (isBitmap && w === w0 && h === h0) return src;
    let out = null;
    if (isBitmap) {
      try { out = await createImageBitmap(src, { resizeWidth: w, resizeHeight: h,
          resizeQuality: "high" }); } catch (e) { out = null; }
      if (out && (out.width !== w || out.height !== h)) {
        out.close();
        out = null;
      }
    }
    if (!out) {
      out = document.createElement("canvas");
      out.width = w;
      out.height = h;
      const g = out.getContext("2d");
      g.imageSmoothingQuality = "high";
      g.drawImage(src, 0, 0, w, h);
    }
    if (isBitmap) src.close();
    if (!alive) {
      freeImage(out);
      throw ABORT;
    }
    return out;
  }
  const greyPlate = () => {
    const c = document.createElement("canvas");
    c.width = c.height = 64;
    const g = c.getContext("2d");
    g.fillStyle = "#cfcfcb";
    g.fillRect(0, 0, 64, 64);
    return c;
  };
  const warned = new Set();
  const warnOnce = (url, err) => {
    if (warned.has(url)) return;
    warned.add(url);
    log(`${url} can't be used (${err && err.message ? err.message : "CORS or loading error"}): grey plate.`,
      true);
  };

  // One plate's pictures: colour at shell size, its depth (baked map, else estimated from focus),
  // and its palette colour
  async function loadPlate(img, slotA) {
    const shellUrl = labPick(img, SHELL);
    let color = null,
      ia = slotA,
      pa = slotA,
      scaled = false,
      failed = false;
    try {
      color = await decode(shellUrl, (w, h) => {
        ia = w / h;
        pa = labPlateAspect(ia);
        const s = cropScale(w, h, pa, SHELL, SHELL * 2);
        scaled = s < 0.999;
        return s;
      });
    } catch (err) {
      if (err === ABORT || !alive || err?.name === "AbortError") throw ABORT;
      warnOnce(shellUrl, err);
      color = greyPlate();
      ia = pa = slotA;
      failed = true;
    }
    let D = null,
      dw = 0,
      dh = 0,
      baked = 0;
    if (img.depth && !failed) {
      const depthUrl = labPick(img.depth, LAB.depthLong);
      try {
        const map = await decode(depthUrl, (w, h) => LAB.depthLong / Math.max(w, h));
        const ma = (map.width || 1) / (map.height || 1);
        dw = ma >= 1 ? LAB.depthLong : Math.max(8, Math.round(LAB.depthLong * ma));
        dh = ma >= 1 ? Math.max(8, Math.round(LAB.depthLong / ma)) : LAB.depthLong;
        await labYield();
        if (!alive) throw ABORT;
        // Baked map, softened: hard depth cliffs turn into stripes once the view turns, gentle
        // slopes only stretch the picture a little
        D = labBlur(labDilate(labReadDepth(map, dw, dh), dw, dh, 4), dw, dh, 4, 2);
        baked = Math.max(map.width, map.height);
        freeImage(map);
      } catch (err) {
        if (err === ABORT || !alive || err?.name === "AbortError") {
          freeImage(color);
          throw ABORT;
        }
        warnOnce(depthUrl, err);
        D = null;
      }
    }
    await labYield();
    if (!alive) {
      freeImage(color);
      throw ABORT;
    }
    if (!D) {
      // The estimate from focus, on a small grid at the picture's own aspect
      dw = 96;
      dh = Math.max(8, Math.round(96 / ia));
      D = labBlur(labDepthField(color, dw, dh, 0.3), dw, dh, 3, 2);
    }
    return { color, ia, pa, D, dw, dh, baked, dom: failed ? "#cfcfcb" : labDominant(color),
      failed, shellUrl, scaled };
  }

  // -- Meshes
  const flatMat = (map) => new THREE.MeshBasicMaterial({ map, transparent: true,
    toneMapped: false });
  const measure = document.createElement("canvas").getContext("2d");

  function labelMesh(text, hUnits, trash) {
    const H = 64,
      F = 28;
    measure.font = `400 ${F}px "Geist Mono", ui-monospace, monospace`;
    const W = Math.ceil(measure.measureText(text).width + F * 1.4);
    const tex = canvasTexture(W, H, (g, w, h) => {
      g.fillStyle = LAB.accent;
      g.fillRect(0, 0, w, h);
      g.fillStyle = "#ffffff";
      g.font = `400 ${F}px "Geist Mono", ui-monospace, monospace`;
      g.textBaseline = "middle";
      g.fillText(text, F * 0.7, h * 0.54);
    });
    const geo = new THREE.PlaneGeometry(hUnits * W / H, hUnits),
      mat = flatMat(tex);
    trash.push(tex, geo, mat);
    const m = new THREE.Mesh(geo, mat);
    m.userData.w = hUnits * W / H;
    return m;
  }
  // Big caption over each cluster, read from far away
  function titleMesh(text, hUnits, trash) {
    const H = 80,
      F = 34;
    measure.font = `400 ${F}px "Geist Mono", ui-monospace, monospace`;
    const W = Math.ceil(measure.measureText(text).width + F * 2.2);
    const tex = canvasTexture(W, H, (g, w, h) => {
      g.fillStyle = LAB.accent;
      g.fillRect(0, h * 0.5 - F * 0.36, F * 0.72, F * 0.72);
      g.fillStyle = LAB.ink;
      g.font = `400 ${F}px "Geist Mono", ui-monospace, monospace`;
      g.textBaseline = "middle";
      g.fillText(text, F * 1.3, h * 0.53);
    });
    const geo = new THREE.PlaneGeometry(hUnits * W / H, hUnits),
      mat = flatMat(tex);
    trash.push(tex, geo, mat);
    const m = new THREE.Mesh(geo, mat);
    m.userData.w = hUnits * W / H;
    return m;
  }

  function frameLines(w, h, trash) {
    const geo = new THREE.BufferGeometry().setFromPoints([
      new THREE.Vector3(-w / 2, -h / 2, 0), new THREE.Vector3(w / 2, -h / 2, 0),
      new THREE.Vector3(w / 2, h / 2, 0), new THREE.Vector3(-w / 2, h / 2, 0),
    ]);
    const mat = new THREE.LineBasicMaterial({ color: LAB.frame, transparent: true });
    trash.push(geo, mat);
    return new THREE.LineLoop(geo, mat);
  }
  // Word wrap; a line that still doesn't fit is cut with an ellipsis
  function wrap(g, text, maxW) {
    const lines = [];
    for (const para of String(text).split("\n")) {
      let line = "";
      for (const w of para.split(" ")) {
        const t = line ? `${line} ${w}` : w;
        if (g.measureText(t).width > maxW && line) {
          lines.push(line);
          line = w;
        } else line = t;
      }
      lines.push(line);
    }
    return lines.map((l) => fitText(g, l, maxW));
  }

  function fitText(g, text, maxW) {
    if (g.measureText(text).width <= maxW) return text;
    let t = text;
    while (t.length > 1 && g.measureText(`${t}…`).width > maxW) t = t.slice(0, -1);
    return `${t.trimEnd()}…`;
  }

  function notesTex(e, w, h) {
    return canvasTexture(w * PX, h * PX, (g, W, H) => {
      const s = W / 560;
      g.fillStyle = "rgba(255,255,255,0.94)";
      g.fillRect(0, 0, W, H);
      g.strokeStyle = LAB.ink;
      g.lineWidth = 2 * s;
      g.strokeRect(1 * s, 1 * s, W - 2 * s, H - 2 * s);
      g.fillStyle = LAB.ink;
      g.fillRect(0, 0, W, 40 * s);
      g.fillStyle = "#ffffff";
      g.font = `400 ${17 * s}px "Geist Mono", ui-monospace, monospace`;
      g.textBaseline = "middle";
      g.fillText(fitText(g, `NOTES — ${e.name.toUpperCase()}`, W - 90 * s), 16 * s, 21 * s);
      g.strokeStyle = "#ffffff";
      g.lineWidth = 2 * s;
      for (let k = 0; k < 3; k++) g.strokeRect(W - (22 + k * 18) * s, 14 * s, 11 * s, 11 * s);
      let y = 78 * s;
      // A narrow column, like a notebook (new lines in the CMS text are kept)
      const maxY = H - 16 * s,
        maxW = Math.min(W - 36 * s, 330 * s);
      const sections = [
        ["Brief", e.brief],
        ["Status", e.status]
      ].filter(([, t]) => t);
      sections.forEach(([head, body], n) => {
        if (n) y += 22 * s;
        if (y > maxY) return;
        g.fillStyle = LAB.muted;
        g.font = `400 ${15 * s}px "Geist Mono", ui-monospace, monospace`;
        g.fillText(head.toUpperCase(), 18 * s, y);
        y += 34 * s;
        g.fillStyle = LAB.ink;
        g.font = `500 ${25 * s}px "Host Grotesk", system-ui, sans-serif`;
        const lines = wrap(g, body, maxW);
        for (let i = 0; i < lines.length; i++) {
          if (y > maxY) break;
          const last = y + 32 * s > maxY && i < lines.length - 1;
          g.fillText(last ? fitText(g, `${lines[i]}…`, maxW) : lines[i], 18 * s, y);
          y += 32 * s;
        }
      });
    });
  }

  // Foreground windows: prompt or code, palette, lab index
  function chrome(g, W, H, u, title, right) {
    g.fillStyle = "rgba(255,255,255,0.96)";
    g.fillRect(0, 0, W, H);
    g.fillStyle = LAB.ink;
    g.fillRect(0, 0, W, 8 * u);
    g.fillStyle = "#ffffff";
    g.font = `400 ${3.3 * u}px "Geist Mono", ui-monospace, monospace`;
    g.textBaseline = "middle";
    let rw = 0;
    if (right) {
      g.textAlign = "right";
      g.fillText(right, W - 13 * u, 4.3 * u);
      rw = g.measureText(right).width + 4 * u;
      g.textAlign = "left";
    }
    g.fillText(fitText(g, title, W - 16.2 * u - rw), 3.2 * u, 4.3 * u);
    g.strokeStyle = "#ffffff";
    g.lineWidth = Math.max(1, 0.25 * u);
    for (let k = 0; k < 2; k++) g.strokeRect(W - (5.6 + k * 4) * u, 2.9 * u, 2.4 * u, 2.4 * u);
    const lw = Math.max(1.5, 0.35 * u);
    g.strokeStyle = LAB.ink;
    g.lineWidth = lw;
    g.strokeRect(lw / 2, lw / 2, W - lw, H - lw);
  }

  function promptTex(inst, W, H) {
    return canvasTexture(W, H, (g) => {
      const u = H / 100,
        P = inst.e.prompt;
      chrome(g, W, H, u, P.head.toUpperCase(), `${pad2(inst.idx + 1)} / ${pad2(N)}`);
      const x = 5 * u,
        maxW = W - 10 * u;
      // At rest the window runs about a tenth of its width past the stage's right edge:
      // the body keeps clear of it (the meta line may still bleed, like the other windows)
      const bodyW = maxW - 0.1 * W;
      // ...and about a sixth of its height above the stage's top edge (the title bar is meant
      // to be cut, as in the approved spike), so the body starts below that and ends above the rule
      const top = 22 * u,
        room = 61 * u;
      let y = top,
        end = 0,
        fs;
      g.textBaseline = "top";
      if (P.mono) {
        const src = P.body.replace(/\t/g, "  ").split("\n"); // canvas draws a tab as one space
        const codeW = bodyW - 7 * u;
        // Long code lines wrap at spaces (continuation rows carry no number) instead of
        // shrinking the whole listing to a size nobody can read
        const layout = () => {
          const rows = [];
          src.forEach((l, n) => {
            const lead = l.match(/^ */)[0];
            const indent = (lead.length < 12 ? lead : "") + "    ";
            let rest = l,
              pre = "";
            do {
              // Every row keeps at least one character past its prefix, so the loop always ends
              const line = pre + rest,
                floor = pre ? pre.length : lead.length;
              let cut = line.length;
              while (cut > pre.length + 1 && g.measureText(line.slice(0, cut)).width >
                codeW) {
                const sp = line.lastIndexOf(" ", cut - 1);
                cut = sp > floor ? sp : cut - 1;
              }
              rows.push({ num: pre ? 0 : n + 1, text: line.slice(0, cut) });
              rest = line.slice(cut).replace(/^ +/, "");
              pre = indent;
            } while (rest.length);
          });
          return rows;
        };
        fs = 4.4 * u;
        g.font = `400 ${fs}px "Geist Mono", ui-monospace, monospace`;
        let rows = layout();
        // Too many rows: smaller type, then cut, so the caret row still sits above the rule
        while ((rows.length + 1) * fs * 1.7 > room && fs > 2.4 * u) {
          fs *= 0.94;
          g.font = `400 ${fs}px "Geist Mono", ui-monospace, monospace`;
          rows = layout();
        }
        if ((rows.length + 1) * fs * 1.7 > room) rows = rows.slice(0, Math.max(1, Math.floor(
          room / (fs * 1.7)) - 1));
        // Short listings sit in the middle of the visible body
        y += Math.max(0, (room - (rows.length + 1) * fs * 1.7) / 2);
        rows.forEach((r) => {
          if (r.num) {
            g.fillStyle = LAB.faint;
            g.fillText(pad2(r.num), x, y);
          }
          g.fillStyle = LAB.ink;
          g.fillText(fitText(g, r.text, codeW), x + 7 * u, y);
          y += fs * 1.7;
        });
        g.fillStyle = LAB.faint;
        g.fillText(pad2(src.length + 1), x, y);
        end = x + 7 * u;
      } else {
        fs = 6.6 * u;
        g.font = `500 ${fs}px "Host Grotesk", system-ui, sans-serif`;
        let lines = wrap(g, P.body, bodyW);
        while (lines.length * fs * 1.1 > room - 4 * u && fs > 3 * u) {
          fs *= 0.94;
          g.font = `500 ${fs}px "Host Grotesk", system-ui, sans-serif`;
          lines = wrap(g, P.body, bodyW);
        }
        const rows = Math.max(1, Math.floor((room - 4 * u) / (fs * 1.1)));
        if (lines.length > rows) {
          lines = lines.slice(0, rows);
          lines[rows - 1] = fitText(g, `${lines[rows - 1]}…`, bodyW);
        }
        g.fillStyle = LAB.ink;
        lines.forEach((l, n) => {
          g.fillText(l, x, y);
          if (n < lines.length - 1) y += fs * 1.1;
        });
        end = x + g.measureText(lines[lines.length - 1]).width + fs * 0.18;
      }
      // Caret, as if the prompt was still being typed
      g.fillStyle = LAB.accent;
      g.fillRect(Math.min(end, W - 6 * u), y + fs * 0.06, fs * 0.5, fs * 0.92);
      g.fillStyle = LAB.line;
      g.fillRect(x, 86 * u, W - 10 * u, Math.max(1, 0.25 * u));
      g.fillStyle = LAB.muted;
      g.font = `400 ${3.1 * u}px "Geist Mono", ui-monospace, monospace`;
      g.textBaseline = "middle";
      if (P.meta) g.fillText(fitText(g, P.meta.toUpperCase(), maxW), x, 92.5 * u);
    });
  }
  // The palette window shows the project's own colours (CMS "colors") when it has any, else the
  // dominant colour sampled from each plate
  const paletteOf = (inst) => (inst.e.colors.length ? inst.e.colors : inst.palette);

  function paletteTex(inst, W, H) {
    return canvasTexture(W, H, (g) => {
      const u = H / 100,
        own = inst.e.colors.length > 0,
        pal = paletteOf(inst);
      const s = pal.length === 1 ? "" : "S";
      chrome(g, W, H, u, own ? `PALETTE — ${pad2(pal.length)} PRIMARY COLOUR${s}` :
        `PALETTE — SAMPLED FROM ${pad2(pal.length)} PLATE${s}`, inst.e.name.toUpperCase());
      const n = Math.max(1, pal.length),
        x0 = 4 * u,
        gap = 1.6 * u;
      const cw = (W - 8 * u - gap * (n - 1)) / n;
      const mono = (px) => `400 ${px}px "Geist Mono", ui-monospace, monospace`;
      // Labels keep a gap to the next swatch's: they shrink with a swatch too narrow for its hex
      // code and go below a readable size; a long name is cut
      const tw = cw - gap;
      g.font = mono(4.6 * u);
      const fit = Math.min(1, tw / g.measureText("#000000").width);
      const lw = Math.max(2, 0.45 *
      u); // at least 2 texels, or it vanishes on phone (240 px texture)
      g.textBaseline = "top";
      pal.forEach((c, i) => {
        const x = x0 + i * (cw + gap);
        g.fillStyle = c.hex;
        g.fillRect(x, 13 * u, cw, 44 * u);
        // A near-white swatch would melt into the window: a hairline keeps its edge, fading in
        // with lightness so two near-identical neighbours look alike
        const edgeA = labClamp((labLuma(c.hex) - 0.7) / 0.15, 0, 1);
        if (edgeA > 0) {
          g.globalAlpha = edgeA;
          g.strokeStyle = LAB.faint;
          g.lineWidth = lw;
          g.strokeRect(x + lw / 2, 13 * u + lw / 2, cw - lw, 44 * u - lw);
          g.globalAlpha = 1;
        }
        if (fit < 0.55) return;
        g.fillStyle = LAB.ink;
        g.font = mono(4.6 * u * fit);
        g.fillText(c.hex.toUpperCase(), x, 61 * u);
        const label = !own ? `PLATE ${c.k}` : c.name ? c.name.toUpperCase() :
          `COLOUR ${pad2(i + 1)}`;
        g.fillStyle = LAB.muted;
        g.font = mono(3.6 * u * fit);
        if (g.measureText("W…").width <= tw) g.fillText(fitText(g, label, tw), x, (61 + 9 *
          fit) * u);
      });
    });
  }
  // The index lists up to LAB_INDEX_ROWS experiments around the current one
  const indexRows = (idx) => {
    const n = Math.min(N, LAB_INDEX_ROWS);
    const first = N <= n ? 0 : labClamp(idx - Math.floor(n / 2), 0, N - n);
    return { first, n };
  };

  function indexTex(inst, W, H) {
    return canvasTexture(W, H, (g) => {
      const u = H / 100;
      chrome(g, W, H, u, "LAB INDEX", `${pad2(N)} EXPERIMENT${N === 1 ? "" : "S"}`);
      const { first, n } = indexRows(inst.idx);
      const top = 11 * u,
        rowH = (H - top - 3 * u) / n;
      g.textBaseline = "middle";
      for (let r = 0; r < n; r++) {
        const i = first + r,
          e = items[i];
        const y = top + r * rowH,
          cy = y + rowH / 2,
          on = i === inst.idx;
        if (on) {
          g.fillStyle = LAB.accent;
          g.fillRect(2.2 * u, y, W - 4.4 * u, rowH);
        } else if (r) {
          g.fillStyle = "#e4e4e2";
          g.fillRect(4 * u, y, W - 8 * u, Math.max(1, 0.22 * u));
        }
        g.fillStyle = on ? "#ffffff" : LAB.faint;
        g.font = `400 ${3.4 * u}px "Geist Mono", ui-monospace, monospace`;
        g.fillText(pad2(i + 1), 5 * u, cy);
        g.fillStyle = on ? "#ffffff" : LAB.ink;
        g.font = `500 ${5.6 * u}px "Host Grotesk", system-ui, sans-serif`;
        g.fillText(fitText(g, e.name, 49 * u), 15 * u, cy + 0.3 * u);
        g.fillStyle = on ? "#ffffff" : LAB.muted;
        g.font = `400 ${3.1 * u}px "Geist Mono", ui-monospace, monospace`;
        g.textAlign = "right";
        g.fillText(e.year, W - 5 * u, cy);
        const yw = g.measureText(e.year).width;
        g.textAlign = "left";
        g.fillText(fitText(g, e.kind.toUpperCase(), W - 5 * u - yw - 3 * u - 66 * u), 66 * u,
          cy);
      }
    });
  }
  // Index row under a hit (uv on the window), -1 outside the rows
  function indexRowAt(inst, uv) {
    const { first, n } = indexRows(inst.idx);
    const y = (1 - uv.y) * 100,
      top = 11,
      rowH = (100 - top - 3) / n;
    const r = Math.floor((y - top) / rowH);
    return r >= 0 && r < n ? first + r : -1;
  }

  // -- Clusters: one instance per slot in the window around the camera ------------------------
  // insts: slot -> instance. An instance leaving the window is reused for a slot that enters it
  // with the same experiment (with 7 experiments every cluster just hops, as in the spike);
  // otherwise it is freed and a new one is built
  const insts = new Map();
  let windowAt = null;
  let K = 0,
    index = mod(o.index || 0, N),
    flight = null,
    started = false;
  K = index; // the first slot shows the experiment that was showing (0 on a fresh page)
  let prevInst = null;

  function newInst(k) {
    const idx = mod(k, N);
    return {
      slot: k,
      idx,
      e: items[idx],
      ready: false,
      building: false,
      failed: false,
      dead: false,
      root: null,
      inner: null,
      panels: [],
      hits: [],
      trash: [],
      alpha: 0,
      hot: 0,
      gain: { value: 1 },
      maxOff: { value: 0.1 },
      floaters: null,
      floatOn: 0,
      palette: [],
      depth: 999,
      sharp: "none",
      sharpGen: 0,
    };
  }

  function disposeInst(inst) {
    inst.dead = true;
    if (inst.floaters) dropFloaters(inst);
    if (inst.root) scene.remove(inst.root);
    gpuDirty = true;
    inst.panels.forEach((p) => {
      if (p.sharpTex) gpuFree(p.sharpTex);
      p.sharpTex = null;
    });
    inst.trash.forEach(gpuFree);
    inst.trash = [];
    inst.panels = [];
    inst.hits = [];
    inst.ready = false;
    if (prevInst === inst) prevInst = null;
    if (hotInst === inst) hotInst = null;
  }
  // Build order: the current slot, then ahead before behind, nearest first
  const prio = (inst) => {
    const d = inst.slot - K;
    return d >= 0 ? d * 2 : -d * 2 + 1;
  };

  function reconcile(kr) {
    windowAt = kr;
    const lo = kr - 2,
      hi = kr + 4;
    const spare = [];
    for (const [k, inst] of insts) {
      if (k < lo || k > hi) {
        insts.delete(k);
        spare.push(inst);
      }
    }
    for (let k = lo; k <= hi; k++) {
      if (insts.has(k)) continue;
      const j = spare.findIndex((s) => s.idx === mod(k, N));
      if (j >= 0) {
        const inst = spare.splice(j, 1)[0];
        inst.slot = k;
        insts.set(k, inst);
        if (inst.ready) placeInst(inst);
      } else insts.set(k, newInst(k));
    }
    spare.forEach(disposeInst);
    pump();
    updateSharp();
  }

  let pumping = false;
  async function pump() {
    if (pumping) return;
    pumping = true;
    try {
      for (;;) {
        if (!alive) return;
        const next = [...insts.values()].filter((i) => !i.ready && !i.building && !i.failed && !i
            .dead)
          .sort((a, b) => prio(a) - prio(b))[0];
        if (!next) return;
        next.building = true;
        try {
          await buildInst(next);
        } catch (err) {
          if (!alive) return;
          if (err !== ABORT) {
            next.failed = true;
            log(`experiment ${next.idx + 1} could not be built: ${err && err.message}`, true);
            // Nothing to show in front: don't hold the page
            if (next.slot === K && !readyFired) {
              readyFired = true;
              showLoading("");
              o.onReady();
            }
          }
        }
        next.building = false;
        if (next.dead || !alive) {
          disposeInst(next);
          continue;
        }
        if (!next.ready) continue;
        scene.add(next.root);
        placeInst(next);
        gpuDirty = true;
        if (next.slot === K) {
          prepare(next);
          showLoading("");
        }
        updateSharp();
      }
    } finally {
      pumping = false;
    }
  }

  // Canvas text uses only the weights the site loads (Geist Mono 400/600/800, Host Grotesk
  // 300-700): WebKit's canvas does no nearest-weight match, "500 Geist Mono" drew in Times
  const fontsP = Promise.race([
    Promise.all([
      o.fontsReady,
      ...['400 28px "Geist Mono"', '500 25px "Host Grotesk"']
      .map((f) => (document.fonts ? document.fonts.load(f) : null)),
    ]).catch(() => {}),
    new Promise((resolve) => setTimeout(resolve, LAB.fontWait)),
  ]);
  fontsP.then(() => measureCopy()); // the copy reflows once Host Grotesk is in

  async function buildInst(inst) {
    const e = inst.e;
    const slots = layoutFor(e.images.length);
    const settled = await Promise.allSettled(slots.map((s) => loadPlate(e.images[s.k], s.a)));
    const plates = settled.map((r) => (r.status === "fulfilled" ? r.value : null));
    const bail = () => {
      plates.forEach((p) => p && freeImage(p.color));
      throw ABORT;
    };
    if (!alive || inst.dead) bail();
    const fail = settled.find((r) => r.status === "rejected");
    if (fail) {
      plates.forEach((p) => p && freeImage(p.color));
      throw fail.reason;
    }
    await fontsP;
    if (!alive || inst.dead) bail();
    labPlaceExtremes(slots, plates.map((pl) => pl.pa), LB);

    const trash = inst.trash;
    const root = new THREE.Group(); // slot position and scale
    const inner = new THREE.Group(); // centred on the layout's bounds
    inner.position.set(-LB.cx, -LB.cy, 0);
    root.add(inner);
    inst.root = root;
    inst.inner = inner;

    // The notes window: desktop only, when there is something to say
    const texts = !PHONE && (e.brief || e.status) ? [LAB_NOTES_SLOT] : [];
    const labels = slots.map((s) => {
      const im = e.images[s.k];
      return labelMesh(`${s.k} ${im.name}${im.score !== null ? `, Score: ${im.score}%` : ""}`,
        0.17, trash);
    });
    const sizes = labPlateLayout(slots, plates.map((pl) => pl.pa), labels.map((l) => l.userData
      .w), LB,
      texts.map((t) => ({ x: t.x, y: t.y, z: t.z, w: t.w, h: t.w / t.a })));

    slots.forEach((s, n) => {
      const pl = plates[n],
        im = e.images[s.k],
        label = labels[n];
      const { w, h, flip } = sizes[n];
      const cam = { value: new THREE.Vector3() },
        eye = { value: new THREE.Vector3(0, 0, 16) };
      const look = { value: new THREE.Vector2() },
        hover = { value: 0 };
      const shellTex = colorTexture(pl.color);
      const dTex = depthTexture(pl.D, pl.dw, pl.dh);
      const geo = new THREE.PlaneGeometry(w, h);
      const mat = new THREE.ShaderMaterial({
        uniforms: Object.assign(THREE.UniformsUtils.clone(THREE.UniformsLib.fog), {
          uMap: { value: shellTex },
          uDepth: { value: dTex },
          uCam: cam,
          uEye: eye,
          uLook: look,
          uHover: hover,
          uGain: inst.gain,
          uMaxOff: inst.maxOff,
          uSize: { value: new THREE.Vector2(w, h) },
          uCover: { value: coverFit(pl.ia, pl.pa) },
          // Box depth: the slide inside the frame stays within today's range on wide plates too
          uAmt: { value: 0.28 * Math.min(w, 1.3 * h) },
          uZoom: { value: 0.84 },
          uAlpha: { value: 0 },
        }),
        vertexShader: LAB_WIN_VERT,
        fragmentShader: WIN_FRAG,
        transparent: true,
        fog: true,
      });
      trash.push(shellTex, dTex, geo, mat);
      const quad = new THREE.Mesh(geo, mat);
      const g = new THREE.Group();
      g.position.set(s.x, s.y, s.z);
      g.rotation.set(s.rx, s.ry, s.rz);
      const frame = frameLines(w, h, trash);
      frame.position.z = 0.004;
      label.position.set((flip ? 1 : -1) * (w / 2 - label.userData.w / 2), h / 2 + 0.14,
        0.006);
      quad.userData.hit = { type: "plate", panel: inst.panels.length };
      g.add(quad, frame, label);
      inner.add(g);
      inst.panels.push({
        kind: "plate",
        inst,
        g,
        quad,
        frame,
        label,
        hover,
        cam,
        eye,
        look,
        lookT: new THREE.Vector2(),
        w,
        h,
        z: s.z,
        id: s.id,
        k: s.k,
        im,
        pa: pl.pa,
        ia: pl.ia,
        flip,
        shellTex,
        sharpTex: null,
        shellUrl: pl.shellUrl,
        scaled: pl.scaled,
        failed: pl.failed,
        baked: pl.baked,
        objs: [quad, frame, label],
      });
      inst.hits.push(quad);
      if (!pl.failed) inst.palette.push({ hex: pl.dom, k: s
        .k }); // a broken upload has no colour to show
    });

    texts.forEach((s) => {
      const w = s.w,
        h = s.w / s.a;
      const tex = notesTex(e, w, h);
      const geo = new THREE.PlaneGeometry(w, h),
        mat = flatMat(tex);
      trash.push(tex, geo, mat);
      const m = new THREE.Mesh(geo, mat);
      m.userData.hit = { type: "block" };
      const g = new THREE.Group();
      g.position.set(s.x, s.y, s.z);
      g.rotation.set(s.rx, s.ry, s.rz);
      g.add(m);
      inner.add(g);
      inst.panels.push({ kind: "text", inst, g, objs: [m] });
      inst.hits.push(m);
    });

    // Wires between corners; a plate left out of every wire links to its nearest neighbour
    const plateP = inst.panels.filter((p) => p.kind === "plate");
    const byId = new Map(plateP.map((p) => [p.id, p]));
    const pairs = LAB_WIRES.filter(([a, , b]) => byId.has(a) && byId.has(b));
    const linked = new Set(pairs.flatMap(([a, , b]) => [a, b]));
    plateP.forEach((p) => {
      if (linked.has(p.id) || plateP.length < 2) return;
      let best = null,
        bd = Infinity;
      plateP.forEach((qq) => {
        if (qq === p) return;
        const d = p.g.position.distanceTo(qq.g.position);
        if (d < bd) { bd = d;
          best = qq; }
      });
      const side = (a, b) =>
        `${b.g.position.y > a.g.position.y ? "t" : "b"}${b.g.position.x > a.g.position.x ? "r" : "l"}`;
      pairs.push([p.id, side(p, best), best.id, side(best, p)]);
      linked.add(p.id).add(best.id);
    });
    const wp = [];
    for (const [a, ca, b, cb] of pairs) {
      const A = byId.get(a),
        B = byId.get(b);
      A.g.updateMatrix();
      B.g.updateMatrix();
      wp.push(new THREE.Vector3(LAB_CORNER[ca][0] * A.w, LAB_CORNER[ca][1] * A.h, 0).applyMatrix4(
        A.g.matrix));
      wp.push(new THREE.Vector3(LAB_CORNER[cb][0] * B.w, LAB_CORNER[cb][1] * B.h, 0).applyMatrix4(
        B.g.matrix));
    }
    const wgeo = new THREE.BufferGeometry().setFromPoints(wp);
    const wmat = new THREE.LineBasicMaterial({ color: LAB.wire, transparent: true });
    trash.push(wgeo, wmat);
    inst.wires = new THREE.LineSegments(wgeo, wmat);
    inst.wires.renderOrder = -1;
    inner.add(inst.wires);

    // Caption, for reading the cluster from afar
    const title = titleMesh(
      `${pad2(inst.idx + 1)}  ${e.name.toUpperCase()}${e.year ? ` · ${e.year}` : ""}`, 0.42,
      trash);
    title.position.set(-LB.w / 2 + title.userData.w / 2, LB.h / 2 + 0.5, 0);
    root.add(title);
    inst.panels.push({ kind: "title", inst, g: title, objs: [title] });

    // Whole-cluster target, for picking it from a distance
    const bgeo = new THREE.PlaneGeometry(LB.w + 0.6, LB.h + 1.6),
      bmat = new THREE.MeshBasicMaterial({ visible: false });
    trash.push(bgeo, bmat);
    inst.bound = new THREE.Mesh(bgeo, bmat);
    inst.bound.position.y = 0.35;
    inst.bound.userData.hit = { type: "far", inst };
    root.add(inst.bound);
    inst.ready = true;
  }

  function placeInst(inst) {
    anchor(inst.slot, inst.root.position);
    inst.root.scale.setScalar(S);
    inst.root.updateMatrixWorld(true);
    placeFloaters(inst, true);
    updateCams(inst);
  }

  // The resting camera, in each plate's own space
  const tmpP = new THREE.Vector3(),
    tmpT = new THREE.Vector3(),
    tmpV = new THREE.Vector3(),
    tmpO = new THREE.Vector3();

  function updateCams(inst) {
    restPose(inst.slot, tmpP, tmpT);
    for (const p of inst.panels) {
      if (p.kind !== "plate") continue;
      const z = p.g.position.z;
      p.g.position.z = p.z;
      p.g.updateMatrixWorld(true);
      p.g.worldToLocal(p.cam.value.copy(tmpP));
      p.g.position.z = z;
      p.g.updateMatrixWorld(true);
    }
  }

  // -- Sharp textures: only the current experiment and its neighbours keep them, sized to the
  // plate as the resting view draws it (device px, with room for the in-frame zoom and hover),
  // never more than SHARP
  function sharpCap(p) {
    const px = ((Math.max(p.w, p.h) * S) / (2 * DIST * TAN)) * view.h * renderer.getPixelRatio();
    return Math.round(clamp(px * 1.4, SHELL, SHARP));
  }
  // After a resize: a cluster whose sharp pictures are now clearly too small loads them again
  function resharp() {
    for (const inst of insts.values()) {
      if (!inst.ready || inst.sharp !== "ready") continue;
      if (inst.panels.some((p) => p.kind === "plate" && !p.failed && sharpCap(p) > (p.sharpCap ||
          SHELL) * 1.25)) dropSharp(inst);
    }
    updateSharp();
  }

  function updateSharp() {
    if (!alive) return;
    for (const inst of insts.values()) {
      if (!inst.ready) continue;
      const want = Math.abs(inst.slot - K) <= 1;
      if (want && inst.sharp === "none") inst.sharp = "queued";
      else if (!want && inst.sharp !== "none") dropSharp(inst);
    }
    pumpSharp();
  }

  function dropSharp(inst) {
    inst.sharp = "none";
    inst.sharpGen++;
    inst.panels.forEach((p) => {
      if (!p.sharpTex) return;
      p.quad.material.uniforms.uMap.value = p.shellTex;
      gpuFree(p.sharpTex);
      p.sharpTex = null;
    });
    gpuDirty = true;
  }
  let sharpBusy = false;
  async function pumpSharp() {
    if (sharpBusy) return;
    sharpBusy = true;
    try {
      for (;;) {
        if (!alive) return;
        const inst = [...insts.values()].filter((i) => i.ready && i.sharp === "queued").sort((a,
          b) => prio(a) - prio(b))[0];
        if (!inst) return;
        inst.sharp = "loading";
        const gen = inst.sharpGen;
        const plates = inst.panels.filter((p) => p.kind === "plate" && !p.failed);
        for (const p of plates) {
          if (!alive || inst.dead || inst.sharpGen !== gen) break;
          // Enough pixels for the visible crop of this picture as big as it is drawn (its aspect
          // is known by now); the shell is enough for a plate drawn small
          const cap = sharpCap(p);
          p.sharpCap = cap;
          if (cap <= SHELL * 1.1) continue;
          const need = Math.min(LAB.maxLong, Math.round(cap * Math.max(1, p.ia / p.pa)));
          const url = labPick(p.im, need);
          if (url === p.shellUrl && !p.scaled) continue; // the shell is the full picture already
          let img;
          try {
            img = await decode(url, (w, h) => cropScale(w, h, p.pa, cap));
          } catch (err) {
            if (err === ABORT || !alive || err?.name === "AbortError") return;
            warnOnce(url, err);
            continue;
          }
          if (!alive || inst.dead || inst.sharpGen !== gen) {
            freeImage(img);
            break;
          }
          const t = colorTexture(img);
          if (!glDown) renderer.initTexture(
          t); // uploaded now, one picture per task, not all in one frame
          if (p.sharpTex) gpuFree(p.sharpTex);
          p.sharpTex = t;
          p.quad.material.uniforms.uMap.value = t;
          gpuDirty = true;
          await labYield();
        }
        if (alive && !inst.dead && inst.sharpGen === gen) inst.sharp = "ready";
      }
    } finally {
      sharpBusy = false;
    }
  }

  // -- Foreground windows of the experiment in front
  function buildFloaters(inst) {
    if (inst.floaters || !inst.ready) return;
    const dpr = Math.min(window.devicePixelRatio || 1, 2);
    inst.floaters = FLOATS.filter((f) => (f.kind !== "prompt" || inst.e.prompt.body) &&
      (f.kind !== "palette" || paletteOf(inst).length) && (f.kind !== "index" || N > 1)).map((
      f) => {
        const Hpx = Math.round(clamp(floatPose(f).h * view.h * dpr, 240, 1100)),
          Wpx = Math.round(Hpx * f.a);
        const tex = f.kind === "prompt" ? promptTex(inst, Wpx, Hpx) : f.kind === "palette" ?
          paletteTex(inst, Wpx, Hpx) : indexTex(inst, Wpx, Hpx);
        const mat = flatMat(tex);
        const mesh = new THREE.Mesh(UNIT_PLANE, mat);
        mesh.userData.hit = f.kind === "index" ? { type: "index", inst } : { type: "block" };
        const g = new THREE.Group();
        g.add(mesh);
        scene.add(g);
        return {
          kind: "float",
          inst,
          f,
          g,
          mesh,
          tex,
          mat,
          objs: [mesh],
          clear: 1,
          placed: false,
          rest: new THREE.Vector3(),
          restT: new THREE.Vector3(),
          scale: new THREE.Vector2(),
          scaleT: new THREE.Vector2(),
          qBase: new THREE.Quaternion(),
        };
      });
    inst.floatOn = 0;
    inst.ride = 0;
    inst.hold = { yaw: 0, pitch: 0, orbitYaw: 0 };
    placeFloaters(inst, true);
    gpuDirty = true;
  }
  // A foreground window's pose for the current stage: a little smaller on narrower desktop
  // stages (mid), smaller still on tall ones (PT), where a window with a portrait pose (the
  // palette, above the project name) moves there. The palette is then fitted into its row
  function floatPose(f) {
    const mid = !PHONE && view.w < 1180;
    let pose = f;
    if (PT || mid) {
      const p = f.portrait || f;
      pose = {
        ...f,
        fx: f.fx + (p.fx - f.fx) * PT,
        fy: f.fy + (p.fy - f.fy) * PT,
        h: f.h * (1 - 0.45 * PT) * (mid ? 0.92 : 1),
      };
    }
    return f.fit && !PHONE ? fitBand(pose) : pose;
  }
  // Keeps a window clear of the copy, the hint and the nav at rest (desktop): it slides along its
  // row between whatever shares the row, with a margin for the idle sway and half a mouse lean
  // (what is left of them once it rides with the view), and shrinks to 70% when the gap is narrow
  const SWAY_ROOM = 0.15 + 0.5 * 0.11; // rad of view turn the margin absorbs
  function fitBand(pose) {
    if (!hudRects.length) return pose;
    const hPx = pose.h * view.h;
    let wPx = hPx * pose.a;
    const cy = ((1 - pose.fy) / 2) * view.h,
      top = cy - hPx / 2,
      bot = cy + hPx / 2;
    const cx0 = ((pose.fx + 1) / 2) * view.w;
    let L = 0,
      R = view.w;
    for (const r of hudRects) {
      if (r.y1 < top - 8 || r.y0 > bot + 8) continue;
      if ((r.x0 + r.x1) / 2 < cx0) L = Math.max(L, r.x1 + 16);
      else R = Math.min(R, r.x0 - 16);
    }
    if (L === 0 && R === view.w) return pose;
    const m = ((1 - LAB.floatRide) * SWAY_ROOM * ((DIST - pose.d) / pose.d) / TAN) * (view.h / 2);
    const s = R - L - 2 * m < wPx ? Math.max(0.7, (R - L - 2 * m) / wPx) : 1;
    wPx *= s;
    const lo = L + m + wPx / 2,
      hi = R - m - wPx / 2;
    const cx = lo <= hi ? clamp(cx0, lo, hi) : (L + R) / 2;
    return { ...pose, fx: (cx / view.w) * 2 - 1, h: pose.h * s };
  }
  // snap: straight to the new place (resize); otherwise the windows glide there (a new copy)
  const eulF = new THREE.Euler();

  function placeFloaters(inst, snap = false) {
    if (!inst.floaters) return;
    restPose(inst.slot, tmpP, tmpT);
    inst.restT = (inst.restT || new THREE.Vector3()).copy(tmpT);
    for (const fl of inst.floaters) {
      const { fx, fy, d, h, a, ry } = floatPose(fl.f);
      const hh = d * TAN,
        H = h * 2 * hh;
      fl.restT.set(tmpP.x + fx * hh * camera.aspect, tmpP.y + fy * hh, tmpP.z - d);
      fl.scaleT.set(H * a, H);
      fl.qBase.setFromEuler(eulF.set(0, ry, 0));
      if (snap || !fl.placed) {
        fl.rest.copy(fl.restT);
        fl.scale.copy(fl.scaleT);
        fl.placed = true;
      }
    }
    rideFloaters(inst, 0);
    gpuDirty = true;
  }
  // The windows follow most of the view's turn around the cluster (lean, sway, drag: they keep a
  // little parallax but barely slide across the copy), and glide by kk towards a new place
  const qRide = new THREE.Quaternion(),
    eulR = new THREE.Euler(0, 0, 0, "YXZ");

  // The turn the windows follow: the live view's while their experiment rests in front, else the
  // one they had when a flight took the view (inst.hold, set in flyTo), so they stay where they
  // are instead of snapping back to the straight view. inst.ride blends between the two
  const turnR = { yaw: 0, pitch: 0, orbitYaw: 0 };

  function rideTurn(inst, out = turnR) {
    const r = inst.ride || 0,
      h = inst.hold;
    out.yaw = h.yaw + (orbit.yaw + lean.yaw - h.yaw) * r;
    out.pitch = h.pitch + (orbit.pitch + lean.pitch - h.pitch) * r;
    out.orbitYaw = h.orbitYaw + (orbit.yaw - h.orbitYaw) * r;
    return out;
  }

  function rideFloaters(inst, kk) {
    if (!inst.floaters || !inst.restT) return;
    const t = rideTurn(inst);
    eulR.set(-t.pitch * LAB.floatRide, t.yaw * LAB.floatRide, 0);
    qRide.setFromEuler(eulR);
    for (const fl of inst.floaters) {
      if (kk > 0) {
        fl.rest.lerp(fl.restT, kk);
        fl.scale.lerp(fl.scaleT, kk);
      }
      fl.g.position.copy(fl.rest).sub(inst.restT).applyQuaternion(qRide).add(inst.restT);
      fl.g.quaternion.multiplyQuaternions(qRide, fl.qBase);
      fl.mesh.scale.set(fl.scale.x, fl.scale.y, 1);
      fl.g.updateMatrixWorld(true);
    }
  }
  // Whether a window's screen rect touches the copy, the hint or the nav (desktop)
  const tmpH = new THREE.Vector3();

  function overHud(fl) {
    if (!hudRects.length) return false;
    let x0 = Infinity,
      y0 = Infinity,
      x1 = -Infinity,
      y1 = -Infinity;
    for (const [cx, cy] of BOUND_CORNERS) {
      tmpH.set(cx, cy, 0).applyMatrix4(fl.mesh.matrixWorld).project(camera);
      if (tmpH.z > 1) return false;
      const x = ((tmpH.x + 1) / 2) * view.w,
        y = ((1 - tmpH.y) / 2) * view.h;
      x0 = Math.min(x0, x);
      x1 = Math.max(x1, x);
      y0 = Math.min(y0, y);
      y1 = Math.max(y1, y);
    }
    return hudRects.some((r) => x0 < r.x1 + 4 && x1 > r.x0 - 4 && y0 < r.y1 + 4 && y1 > r.y0 - 4);
  }

  function dropFloaters(inst) {
    for (const fl of inst.floaters) {
      scene.remove(fl.g);
      gpuFree(fl.tex);
      gpuFree(fl.mat);
    }
    inst.floaters = null;
    gpuDirty = true;
  }

  // -- Space furniture: the dashed route through the slots, and a lattice of small crosses
  let route = null,
    routeAt = null;
  const routeMat = new THREE.LineDashedMaterial({ color: LAB.route, dashSize: 0.32, gapSize: 0.26,
    transparent: true });

  function buildRoute(kr) {
    const pts = [];
    for (let k = kr - 3; k <= kr + 5; k++) {
      const a = anchor(k, new THREE.Vector3());
      a.z -= 1.4;
      pts.push(a);
    }
    // Only the stretches between experiments: the dashes stop short of each cluster
    const P = new THREE.CatmullRomCurve3(pts).getPoints(8 * 28),
      seg = [];
    for (let i = 0; i < P.length - 1; i++) {
      const f = (i % 28) / 28;
      if (f >= 0.24 && f < 0.76) seg.push(P[i], P[i + 1]);
    }
    const geo = new THREE.BufferGeometry().setFromPoints(seg);
    if (!route) {
      route = new THREE.LineSegments(geo, routeMat);
      route.renderOrder = -2;
      scene.add(route);
    } else {
      gpuFree(route.geometry);
      route.geometry = geo;
    }
    route.computeLineDistances();
    routeAt = kr;
  }
  const crosses = [];
  let crossGeo = null,
    crossMat = null;

  function buildCrosses() {
    const L = TURNS * SPACING;
    const cx = -HELIX.rx * Math.cos(PHASE),
      cy = -HELIX.ry * Math.sin(PHASE);
    const hw = (LB.w * S) / 2 + 2.6,
      hh = (LB.h * S) / 2 + 2.2;
    const pts = [],
      a = new THREE.Vector3();
    const sx = PHONE ? 4.5 : 7,
      sy = 6;
    for (let z = 0; z > -L; z -= 13)
      for (let x = cx - sx * 5; x <= cx + sx * 5 + 0.01; x += sx)
        for (let y = cy - sy * 4; y <= cy + sy * 4 + 0.01; y += sy) {
          let skip = false;
          for (let k = -1; k <= TURNS; k++) {
            anchor(k, a);
            if (Math.abs(x - a.x) < hw && Math.abs(y - a.y) < hh && z > a.z - 4 && z < a.z + DIST +
              3) {
              skip = true;
              break;
            }
          }
          if (!skip) pts.push(x, y, z);
        }
    crossGeo = new THREE.BufferGeometry();
    crossGeo.setAttribute("position", new THREE.Float32BufferAttribute(pts, 3));
    crossMat = new THREE.ShaderMaterial({
      uniforms: { uProj: U.proj, uSize: { value: 0.2 }, uColor: { value: new THREE.Color(LAB
            .cross) } },
      vertexShader: LAB_CROSS_VERT,
      fragmentShader: LAB_CROSS_FRAG,
      transparent: true,
      depthWrite: false,
    });
    for (let i = 0; i < 3; i++) {
      const p = new THREE.Points(crossGeo, crossMat);
      p.frustumCulled = false;
      p.renderOrder = -3;
      scene.add(p);
      crosses.push(p);
    }
  }

  // -- Sizing (from the stage, not the window)
  const view = { w: 1, h: 1 };
  let PT = 0; // portrait blend of the desktop layout (fit)
  let gpuDirty =
  true; // the scene changed in a way the frame signature doesn't see (reduced motion)
  function resize() {
    if (!alive) return;
    view.w = Math.max(1, stage.clientWidth);
    view.h = Math.max(1, stage.clientHeight);
    // Device pixels, capped: a 2560 px stage at 2x would be a 14 Mpx buffer (with 4x MSAA)
    const dpr = Math.min(window.devicePixelRatio || 1, PHONE ? 1.5 : 2);
    renderer.setPixelRatio(Math.max(Math.min(dpr, 1), Math.min(dpr, Math.sqrt(LAB.bufferPx / (view
      .w * view.h)))));
    renderer.setSize(view.w, view.h, false);
    camera.aspect = view.w / view.h;
    camera.updateProjectionMatrix();
    const db = renderer.getDrawingBufferSize(new THREE.Vector2());
    U.proj.value = db.y / (2 * TAN);
    fit();
    if (started && !hintFly) setHint(0);
    if (started) measureCopy();
    queueUnder();
    if (started && !raf) draw();
  }

  function fit() {
    const vh = 2 * DIST * TAN,
      vw = vh * camera.aspect;
    const mid = !PHONE && view.w < 1180;
    // Desktop layout on a tall stage (portrait tablets, narrow windows): the cluster grows and
    // moves right of the copy, the foreground windows shrink and the palette rises above the
    // project name. 0 on landscape stages (aspect >= 1.45), 1 on square or taller ones
    PT = PHONE ? 0 : smooth(1.45, 1.0, camera.aspect);
    const share = (PHONE ? 0.8 : mid ? 0.4 : 0.42) + PT * (0.52 - (mid ? 0.4 : 0.42));
    S = Math.min((vw * share) / LB.w, (vh * (PHONE ? 0.76 : 0.78 - 0.18 * PT)) / LB.h);
    const shiftX = (mid ? 0.08 : 0.03) + PT * (0.18 - (mid ? 0.08 : 0.03));
    SHIFT.set(PHONE ? 0 : vw * shiftX, PHONE ? vh * 0.02 : -vh * 0.01, 0);
    for (const inst of insts.values())
      if (inst.ready) placeInst(inst);
    if (flight) restPose(K, flight.p1, flight.t1);
    else if (started) restPose(K, base.pos, base.tgt);
    if (started) resharp();
    gpuDirty = true;
  }

  // -- Copy around the scene
  let copyTimer = 0;

  function setCopy(i, instant) {
    if (copyTimer) cancel(copyTimer);
    copyTimer = 0;
    const apply = () => {
      copyTimer = 0;
      labWriteCopy(root, items[i], i, N);
      copyBoxes.forEach((el) => el.classList.remove("lab-is-out"));
      measureCopy();
    };
    if (instant || reduced()) return apply();
    copyBoxes.forEach((el) => el.classList.add("lab-is-out"));
    copyTimer = later(apply, 280);
  }
  // The short hint on narrower desktop stages: the long one runs under the palette window
  const hint = () => PHONE && COARSE ? (N < 2 ? "Tap a window for details" :
      "Swipe to fly — tap a window for details") :
    N < 2 ? (COARSE || PHONE ? "Drag to turn" : "Move to look — drag to turn") :
    COARSE ? "Drag to turn — tap a far window to fly" :
    PHONE ? "Drag to turn — pick a far window to fly" :
    view.w < 1180 ? "Drag to turn — click a far window to fly" :
    "Move to look — drag to turn — click a far window to fly";
  let hintFly = 0;

  function setHint(fly) {
    hintFly = fly;
    hintEl.classList.toggle("is-fly", !!fly);
    hintTxt.textContent = fly ? `Flying to ${pad2(fly)} — ${items[fly - 1].name}` : hint();
  }

  function updateNav() {
    navCount.textContent = `${pad2(index + 1)} / ${pad2(N)}`;
    if (navName) navName.textContent = items[index].name || "";
    queueUnder();
  }

  // Far clusters that pass behind the copy (desktop: the copy sits over the stage) dim, so the
  // words stay legible; the foreground windows keep clear of the copy, the hint and the nav.
  // Rects in stage px (text extents, not the blocks), measured on resize and when the copy changes
  let copyRects = [],
    hudRects = [],
    hintRect = null;
  const textRect = (el) => {
    const rg = document.createRange();
    rg.selectNodeContents(el);
    const r = rg.getBoundingClientRect();
    return r.width > 0 && r.height > 0 ? r : el.getBoundingClientRect();
  };

  function measureCopy() {
    copyRects = [];
    hudRects = [];
    if (PHONE || !alive) return;
    const sr = sceneEl.getBoundingClientRect();
    const toStage = (r) => ({ x0: r.left - sr.left, y0: r.top - sr.top, x1: r.right - sr.left, y1: r
        .bottom - sr.top });
    // The resting hint (a flight shows another one for a while)
    if (!hintFly) hintRect = toStage(hintEl.getBoundingClientRect());
    // The concept block is centred on the stage: it may reach down to just above the hint
    const below = hintRect && hintRect.y0 > view.h / 2 ? hintRect.y0 - 12 : view.h - 24;
    fitConcept(Math.min(view.h - 48, 2 * (below - view.h / 2)));
    for (const el of copyBoxes) {
      const r = textRect(el);
      if (r.width < 1 || r.height < 1) continue;
      const box = toStage(r);
      if (box.x1 > 0 && box.y1 > 0 && box.x0 < view.w && box.y0 < view.h) copyRects.push(box);
    }
    const navRect = navEl.hidden ? null : toStage(navEl.getBoundingClientRect());
    hudRects = [...copyRects, hintRect, navRect].filter((r) => r && r.x1 - r.x0 > 0);
    const cur = insts.get(K);
    if (cur) placeFloaters(cur);
  }
  const BOUND_CORNERS = [
    [-0.5, -0.5],
    [0.5, -0.5],
    [-0.5, 0.5],
    [0.5, 0.5]
  ];

  function underCopy(inst) {
    if (!copyRects.length || !inst.bound) return false;
    const { width, height } = inst.bound.geometry.parameters;
    let x0 = Infinity,
      y0 = Infinity,
      x1 = -Infinity,
      y1 = -Infinity;
    for (const [cx, cy] of BOUND_CORNERS) {
      tmpV.set(cx * width, cy * height, 0);
      inst.bound.localToWorld(tmpV).project(camera);
      if (tmpV.z > 1) return false; // behind the camera
      const x = (tmpV.x + 1) / 2 * view.w,
        y = (1 - tmpV.y) / 2 * view.h;
      x0 = Math.min(x0, x);
      x1 = Math.max(x1, x);
      y0 = Math.min(y0, y);
      y1 = Math.max(y1, y);
    }
    return copyRects.some((r) => x0 < r.x1 && x1 > r.x0 && y0 < r.y1 && y1 > r.y0);
  }

  // -- Hover window (HTML) anchored to the plate's top right corner
  let hovered = -1,
    pinned = -1,
    hotInst = null,
    hotRow = -1,
    techShown = false;

  function fillTech(p) {
    const e = p.inst.e;
    techTitle.textContent = `Plate ${p.k} — ${p.im.name}`;
    techWhat.textContent = p.im.note;
    techList.textContent = "";
    const rows = [...e.tools.map((r) => [...r, false]),
      ["Render", "three.js, depth window, one pass", true],
      ["Map", p.baked ? `Baked, ${p.baked} px` : "Estimated from focus", true]
    ];
    if (p.im.score !== null) rows.push(["Score", `${p.im.score}%`, false]);
    for (const [k, v, opt] of rows) {
      const dt = document.createElement("dt"),
        dd = document.createElement("dd");
      dt.textContent = k;
      dd.textContent = v;
      if (opt) {
        dt.className = "lab-opt";
        dd.className = "lab-opt";
      }
      techList.append(dt, dd);
    }
  }
  // The tech window, its lead and the fly tag move in whole CSS px, and only when a value really
  // changes: at a sub-px left / top the box snaps to the pixel grid while its words are drawn at
  // the fraction, so the text slid inside a still box (and every write repainted the full-stage
  // lead layer the window shares). Rounding to device px is not enough, it has to be whole CSS px
  const written = new Map();
  const putAttr = (el, name, v) => {
    const key = el === leadLine ? `l${name}` : el === leadDot ? `d${name}` : name;
    if (written.get(key) === v) return;
    written.set(key, v);
    el.setAttribute(name, v);
  };
  const putPx = (el, prop, v) => {
    const key = `${el === tech ? "t" : "f"}${prop}`;
    if (written.get(key) === v) return;
    written.set(key, v);
    el.style[prop] = `${v}px`;
  };

  function placeTech() {
    const cur = insts.get(K);
    const i = pinned >= 0 ? pinned : hovered;
    const p = cur && cur.ready && !flight && i >= 0 ? cur.panels[i] : null;
    tech.classList.toggle("is-on", !!p);
    if (techShown !== !!p) {
      techShown = !!p;
      tech.setAttribute("aria-hidden", techShown ? "false" : "true");
    }
    const lead = p && !PHONE ? 1 : 0;
    putAttr(leadLine, "opacity", lead);
    putAttr(leadDot, "opacity", lead);
    if (!p || PHONE) return;
    tmpV.set(p.w / 2, p.h / 2, 0);
    p.g.localToWorld(tmpV).project(camera);
    let ax = (tmpV.x + 1) / 2 * view.w,
      ay = (1 - tmpV.y) / 2 * view.h;
    const tw = tech.offsetWidth,
      th = tech.offsetHeight;
    let x = ax + 36,
      y = ay - 18,
      lx = 0;
    if (x + tw > view.w - 16) {
      // Not enough room on the right: open to the left of the plate's top left corner
      tmpV.set(-p.w / 2, p.h / 2, 0);
      p.g.localToWorld(tmpV).project(camera);
      ax = (tmpV.x + 1) / 2 * view.w;
      ay = (1 - tmpV.y) / 2 * view.h;
      x = ax - 36 - tw;
      y = ay - 18;
      lx = tw;
    }
    x = Math.round(x);
    y = Math.round(clamp(y, 12, view.h - th - 12));
    ax = Math.round(ax);
    ay = Math.round(ay);
    putPx(tech, "left", x);
    putPx(tech, "top", y);
    // A 1 px line is crisp on the half px; the 5 px dot is centred on the line's end
    putAttr(leadLine, "x1", ax + 0.5);
    putAttr(leadLine, "y1", ay + 0.5);
    putAttr(leadLine, "x2", x + lx + 0.5);
    putAttr(leadLine, "y2", y + 14.5);
    putAttr(leadDot, "x", ax - 2);
    putAttr(leadDot, "y", ay - 2);
  }
  // Tag that follows the cursor over a far experiment (or an index row)
  function placeFly() {
    const target = hotInst ? hotInst.idx : hotRow;
    const on = target >= 0 && !flight && mouse.in && !COARSE;
    flyEl.classList.toggle("is-on", on);
    if (!on) return;
    const r = sceneEl.getBoundingClientRect();
    putPx(flyEl, "left", Math.round(Math.min(mouse.x - r.left, view.w - flyEl.offsetWidth - 24)));
    putPx(flyEl, "top", Math.round(Math.min(mouse.y - r.top, view.h - 48)));
  }

  // -- Camera: a resting pose per slot, a flight between poses, and on top an orbit around the
  // target (drag, with inertia), a lean that follows the mouse and a slow sway when idle
  const base = { pos: new THREE.Vector3(), tgt: new THREE.Vector3() };
  const orbit = { yaw: 0, pitch: 0 },
    vel = { yaw: 0, pitch: 0 },
    lean = { yaw: 0, pitch: 0 },
    leanT = { yaw: 0, pitch: 0 };
  const qRot = new THREE.Quaternion(),
    eul = new THREE.Euler(0, 0, 0, "YXZ");

  function orbitOffset(out, yaw, pitch) {
    out.copy(base.pos).sub(base.tgt);
    eul.set(-pitch, yaw, 0);
    return out.applyQuaternion(qRot.setFromEuler(eul));
  }

  function applyCamera() {
    orbitOffset(tmpO, orbit.yaw + lean.yaw, orbit.pitch + lean.pitch);
    camera.position.copy(base.tgt).add(tmpO);
    camera.lookAt(base.tgt);
    camera.updateMatrixWorld();
  }

  function flyTo(k1) {
    if (!started || (k1 === K && !flight)) return;
    // The windows in front stay where the view left them: they stop riding with it
    const was = insts.get(K);
    if (was && was.floaters) {
      rideTurn(was, was.hold);
      was.ride = 0;
    }
    // Fold the current orbit into the start pose, so nothing jumps
    orbitOffset(tmpO, orbit.yaw, orbit.pitch);
    const p0 = base.tgt.clone().add(tmpO),
      t0 = base.tgt.clone();
    orbit.yaw = orbit.pitch = vel.yaw = vel.pitch = 0;
    const p1 = new THREE.Vector3(),
      t1 = new THREE.Vector3();
    restPose(k1, p1, t1);
    const d = p0.distanceTo(p1);
    if (k1 !== K) prevInst = insts.get(K) || null;
    K = k1;
    index = mod(k1, N);
    o.onIndex(index);
    pinned = hovered = -1;
    hotInst = null;
    hotRow = -1;
    sceneEl.classList.remove("is-over");
    setHint(index + 1);
    updateNav();
    // Reduced motion: a short, straight move instead of the long arc
    flight = reduced() ? { p0, t0, p1, t1, ms: 450, start: performance.now(), lift: 0,
      copied: false } : { p0, t0, p1, t1, ms: clamp(1300 + d * 22, 1600, 3600), start: performance
          .now(), lift: Math.min(4, 0.8 + d * 0.035), copied: false };
    prepare(insts.get(K));
    updateSharp();
  }

  function stepFlight(now) {
    const f = flight;
    if (!f) return;
    const t = clamp((now - f.start) / f.ms, 0, 1);
    const u = easeInOut(t),
      ut = easeInOut(clamp(t * 1.2, 0, 1)); // the gaze leads the body
    base.pos.lerpVectors(f.p0, f.p1, u);
    base.pos.y += Math.sin(Math.PI * u) * f.lift;
    base.tgt.lerpVectors(f.t0, f.t1, ut);
    if (!f.copied && t > 0.42) {
      f.copied = true;
      setCopy(index);
    }
    if (t >= 1) {
      flight = null;
      arrive();
    }
  }

  function arrive() {
    restPose(K, base.pos, base.tgt);
    lastInput = performance.now();
    setHint(0);
    srEl.textContent = `Experiment ${pad2(index + 1)} of ${pad2(N)}: ${items[index].name}`;
  }
  // Fly by d experiments
  const go = (d) => {
    if (N < 2) return;
    flyTo(K + d);
  };
  // Fly to experiment idx: its cluster in the window if there is one, else the shortest way
  function flyToIdx(idx) {
    if (idx === index && !flight) return;
    let best = null;
    for (let k = K - 2; k <= K + 4; k++) {
      if (mod(k, N) === idx && k !== K && (best === null || Math.abs(k - K) < Math.abs(best - K)))
        best = k;
    }
    if (best === null) {
      let d = mod(idx - index, N);
      if (d > N / 2) d -= N;
      best = K + d;
    }
    flyTo(best);
  }
  // The experiment in front: its foreground windows and sharp pictures
  function prepare(inst) {
    if (!inst || !inst.ready) return;
    buildFloaters(inst);
  }

  // -- Input
  let drag = null,
    lastInput = -1e9,
    needPick = false;
  let settleYaw = false; // phone: the view eases back after a drag that didn't fly
  // Phone, touch or pen: a sideways drag leans the view with the finger and flies on release
  const swipes = (e) => PHONE && e.pointerType !== "mouse";
  const mouse = { x: 0, y: 0, in: false };
  const ray = new THREE.Raycaster();
  const ndc = new THREE.Vector2();

  function pickAt(cx, cy) {
    if (!started) return null;
    const r = sceneEl.getBoundingClientRect();
    ndc.set(((cx - r.left) / r.width) * 2 - 1, -((cy - r.top) / r.height) * 2 + 1);
    ray.setFromCamera(ndc, camera);
    const cur = insts.get(K),
      list = [];
    if (cur && cur.ready && !flight) list.push(...cur.hits);
    for (const inst of insts.values()) {
      if (!inst.ready) continue;
      if (inst.floaters && inst.floatOn > 0.5)
        for (const fl of inst.floaters)
          if (fl.clear > 0.5) list.push(fl.mesh);
      if (inst !== cur && inst.idx !== index && inst.alpha > 0.5 && inst.depth < 98) list.push(inst
        .bound);
    }
    const hit = ray.intersectObjects(list, false)[0];
    if (!hit) return null;
    const h = hit.object.userData.hit;
    if (h.type === "index") {
      const row = flight || N < 2 ? -1 : indexRowAt(h.inst, hit.uv);
      return row >= 0 && row !== index ? { type: "row", idx: row } : { type: "block" };
    }
    return h;
  }
  // A mouse press doesn't focus the stage (no focus ring after a drag and an arrow key; the keys
  // work on the page anyway). Tab still focuses it
  sceneEl.addEventListener("mousedown", (e) => {
    if (!e.target.closest(".lab-nav")) e.preventDefault();
  }, { signal });
  sceneEl.addEventListener("pointerdown", (e) => {
    if (e.target.closest(".lab-nav")) return;
    drag = {
      id: e.pointerId,
      x: e.clientX,
      y: e.clientY,
      moved: 0,
      x0: e.clientX,
      y0: e.clientY,
      t0: performance.now(),
      lx: e.clientX,
      yaw0: orbit.yaw
    };
    queueUnder(); // before a tap opens the tech window
    vel.yaw = vel.pitch = 0;
    settleYaw = false;
    lastInput = performance.now();
    if (e.pointerType === "mouse") {
      try { sceneEl.setPointerCapture(e.pointerId); } catch (err) { /* already released */ }
    }
  }, { signal });
  sceneEl.addEventListener("pointermove", (e) => {
    const r = sceneEl.getBoundingClientRect();
    mouse.x = e.clientX;
    mouse.y = e.clientY;
    mouse.in = true;
    if (e.pointerType === "mouse") {
      // Looking towards the mouse: what sits on that side comes into view, so a far experiment
      // drifts towards the cursor; near windows slide the other way
      leanT.yaw = -((e.clientX - r.left) / r.width - 0.5) * 0.22;
      leanT.pitch = ((e.clientY - r.top) / r.height - 0.5) * 0.13;
    }
    if (drag && e.pointerId === drag.id) {
      const dx = e.clientX - drag.x,
        dy = e.clientY - drag.y;
      drag.x = e.clientX;
      drag.y = e.clientY;
      drag.moved += Math.abs(dx) + Math.abs(dy);
      if (drag.moved > 4) sceneEl.classList.add("is-dragging");
      if (flight && swipes(e)) {
        // A flight owns the view: the lean starts again from wherever it ends, without a jump
        drag.lx = e.clientX;
        drag.yaw0 = orbit.yaw;
      } else if (swipes(e)) {
        // The lean is a cue, half the desktop turn and capped, from the yaw the view had (the idle
        // sway); the swipe itself is read on release
        const k = 3.6 / Math.max(500, view.w);
        orbit.yaw = clamp(drag.yaw0 - (e.clientX - drag.lx) * k * 0.5, -YAW * 0.6, YAW * 0.6);
        vel.yaw = 0;
      } else if (!flight) {
        const k = 3.6 / Math.max(500, view.w);
        vel.yaw = -dx * k;
        vel.pitch = PITCH ? dy * k * 0.7 : 0;
        orbit.yaw = clamp(orbit.yaw + vel.yaw, -YAW, YAW);
        orbit.pitch = clamp(orbit.pitch + vel.pitch, -PITCH, PITCH);
      }
      lastInput = performance.now();
    } else needPick = true;
  }, { signal });
  const endDrag = (e) => {
    if (!drag || e.pointerId !== drag.id) return;
    const tap = drag.moved < 6;
    const dx = e.clientX - drag.x0,
      dy = e.clientY - drag.y0;
    const ms = Math.max(1, performance.now() - drag.t0);
    drag = null;
    sceneEl.classList.remove("is-dragging");
    if (swipes(e)) {
      // Far enough, or a quick flick, and more sideways than up or down
      const far = Math.abs(dx) > Math.max(48, view.w * 0.14);
      const flick = Math.abs(dx) > 24 && Math.abs(dx) / ms > 0.3;
      if (!tap && N > 1 && (far || flick) && Math.abs(dx) > 1.4 * Math.abs(dy)) {
        pinned = hovered = -1;
        lastInput = performance.now();
        return go(dx < 0 ? 1 : -1);
      }
      settleYaw = true;
    }
    if (!tap) return;
    const h = pickAt(e.clientX, e.clientY);
    if (h && h.type === "far") return flyTo(h.inst.slot);
    if (h && h.type === "row") return flyToIdx(h.idx);
    const cur = insts.get(K);
    const i = h && h.type === "plate" ? h.panel : -1;
    if (e.pointerType !== "mouse") {
      // Touch: tap a plate to open its window, tap it again or anywhere else to close
      pinned = i === pinned ? -1 : i;
      hovered = pinned;
      if (pinned >= 0 && cur) fillTech(cur.panels[pinned]);
    } else {
      pinned = i >= 0 && i !== pinned ? i : -1;
    }
  };
  sceneEl.addEventListener("pointerup", endDrag, { signal });
  sceneEl.addEventListener("pointercancel", (e) => {
    if (drag && e.pointerId === drag.id) {
      drag = null;
      settleYaw = PHONE; // the page took the gesture (a vertical scroll)
      sceneEl.classList.remove("is-dragging");
    }
  }, { signal });
  sceneEl.addEventListener("pointerleave", (e) => {
    if (e.pointerType !== "mouse") return;
    mouse.in = false;
    leanT.yaw = leanT.pitch = 0;
    if (pinned < 0) hovered = -1;
    hotInst = null;
    hotRow = -1;
    sceneEl.classList.remove("is-over");
  }, { signal });
  // Desktop: the wheel flies (one experiment per gesture), a sideways swipe turns the view
  let wheelAcc = 0,
    wheelLock = false,
    wheelTimer = 0;
  if (!PHONE) {
    sceneEl.addEventListener("wheel", (e) => {
      if (e.ctrlKey) return; // pinch zoom
      e.preventDefault();
      const unit = e.deltaMode === 1 ? 16 : e.deltaMode === 2 ? view.h : 1;
      const dx = e.deltaX * unit,
        dy = e.deltaY * unit;
      lastInput = performance.now();
      if (wheelTimer) cancel(wheelTimer);
      wheelTimer = later(() => {
        wheelTimer = 0;
        wheelAcc = 0;
        wheelLock = false;
      }, 220);
      if (Math.abs(dx) > Math.abs(dy)) {
        if (flight) return;
        const k = 3.6 / Math.max(500, view.w);
        orbit.yaw = clamp(orbit.yaw - dx * k, -YAW, YAW);
        vel.yaw = -dx * k * 0.3;
        return;
      }
      if (wheelLock || N < 2) return;
      wheelAcc += dy;
      if (Math.abs(wheelAcc) > 60) {
        wheelLock = true;
        wheelAcc = 0;
        go(Math.sign(dy));
      }
    }, { passive: false, signal });
  }
  window.addEventListener("keydown", (e) => {
    if (e.defaultPrevented || e.altKey || e.ctrlKey || e.metaKey || !inView) return;
    const t = e.target;
    if (t && (t.isContentEditable || (t.closest && t.closest("input, textarea, select"))))
      return;
    if (e.key === "ArrowRight" && N > 1) {
      e.preventDefault();
      go(1);
    } else if (e.key === "ArrowLeft" && N > 1) {
      e.preventDefault();
      go(-1);
    } else if (e.key === "Escape" && (pinned >= 0 || hovered >= 0)) {
      pinned = hovered = -1;
    }
  }, { signal });
  navEl.addEventListener("click", (e) => {
    const b = e.target.closest("[data-go]");
    if (b) go(Number(b.getAttribute("data-go")));
  }, { signal });

  // -- Loop (paused while the tab or the stage is out of sight)
  const FRAME_C = new THREE.Color(LAB.frame),
    ACCENT_C = new THREE.Color(LAB.accent);
  const order = [];
  let raf = 0,
    inView = true,
    pausedAt = 0,
    lastNow = performance.now(),
    readyFired = false,
    lastSig = NaN;
  const tStart = performance.now();

  function frame(now) {
    raf = requestAnimationFrame(frame);
    step(now);
  }

  function draw() {
    step(performance.now());
  }

  function step(now) {
    if (!started || !alive) return;
    const dt = clamp((now - lastNow) / (1000 / 60), 0, 4); // frames at 60 Hz: same feel at 120 Hz
    const k = (x) => 1 - Math.pow(1 - x, dt);
    lastNow = now;
    const t = (now - tStart) / 1000;
    const still = reduced();
    stepFlight(now);

    // Clusters hop to their slot in the window around the camera while out of sight
    const kc = slotAt(base.pos.z),
      kr = Math.round(kc);
    if (kr !== windowAt) reconcile(kr);
    if (kr !== routeAt) buildRoute(kr);
    const tile = Math.floor(kc / TURNS);
    crosses.forEach((p, i) => { p.position.z = -TURNS * SPACING * (tile - 1 + i); });

    // Orbit: inertia after a drag, then a slow sway once idle; it settles during a flight
    if (flight) {
      orbit.yaw *= Math.pow(0.9, dt);
      orbit.pitch *= Math.pow(0.9, dt);
    } else if (!drag) {
      if (settleYaw) {
        orbit.yaw += (0 - orbit.yaw) * k(0.12);
        if (Math.abs(orbit.yaw) < 1e-3) settleYaw = false;
      }
      orbit.yaw = clamp(orbit.yaw + vel.yaw * dt, -YAW, YAW);
      orbit.pitch = clamp(orbit.pitch + vel.pitch * dt, -PITCH, PITCH);
      vel.yaw *= Math.pow(0.93, dt);
      vel.pitch *= Math.pow(0.93, dt);
      if (!still && now - lastInput > 2600) {
        orbit.yaw += (Math.sin(t * 0.21) * 0.15 - orbit.yaw) * k(0.012);
        orbit.pitch += (Math.sin(t * 0.29 + 1.2) * 0.05 * (PITCH ? 1 : 0) - orbit.pitch) * k(0.012);
      }
    }
    lean.yaw += (leanT.yaw - lean.yaw) * k(0.05);
    lean.pitch += (leanT.pitch - lean.pitch) * k(0.05);
    applyCamera();

    const cur = insts.get(K);
    if (needPick && !drag && !COARSE) {
      needPick = false;
      const h = mouse.in && !flight ? pickAt(mouse.x, mouse.y) : null;
      hotInst = h && h.type === "far" ? h.inst : null;
      hotRow = h && h.type === "row" ? h.idx : -1;
      const target = hotInst ? hotInst.idx : hotRow;
      if (target >= 0) flyTxt.textContent = `→ ${pad2(target + 1)} ${items[target].name}`;
      if (pinned < 0) {
        const i = h && h.type === "plate" ? h.panel : -1;
        if (i !== hovered) {
          hovered = i;
          if (i >= 0 && cur) fillTech(cur.panels[i]);
        }
      }
      sceneEl.classList.toggle("is-over", !!h && (h.type === "far" || h.type === "plate" || h
        .type === "row"));
    }
    const active = flight ? -1 : pinned >= 0 ? pinned : hovered;

    // Reduced motion: a signature of everything that moves, so a settled frame isn't redrawn
    let sig = 0,
      si = 0;
    const addSig = still ? (v) => { sig += v * (1 + ((++si * 0.6180339887) % 1)); } : () => {};
    if (still) {
      const cp = camera.position,
        cq = camera.quaternion;
      [cp.x, cp.y, cp.z, cq.x, cq.y, cq.z, cq.w].forEach(addSig);
    }

    order.length = 0;
    for (const inst of insts.values()) {
      if (!inst.ready) continue;
      const isCur = inst === cur;
      const dim = !isCur && inst !== prevInst && underCopy(inst);
      inst.alpha += ((dim ? LAB.underCopy : 1) - inst.alpha) * k(0.04);
      inst.hot += ((hotInst === inst ? 1 : 0) - inst.hot) * k(0.15);
      inst.gain.value += ((isCur && !flight ? GAIN : 1) - inst.gain.value) * k(0.05);
      inst.maxOff.value += ((isCur && !flight ? MAX_OFF : 0.1) - inst.maxOff.value) * k(0.05);
      // Foreground windows: the current experiment's, and the last one's while we fly past them
      const keep = isCur || inst === prevInst;
      if (inst.floaters) {
        inst.floatOn += ((keep ? 1 : 0) - inst.floatOn) * k(0.05);
        if (!keep && inst.floatOn < 0.01) dropFloaters(inst);
      }
      inst.depth = inst.root.getWorldPosition(tmpV).distanceTo(camera.position);
      inst.wires.material.opacity = inst.alpha;
      addSig(inst.alpha);
      addSig(inst.hot);
      addSig(inst.gain.value);
      addSig(inst.maxOff.value);

      inst.panels.forEach((p, pi) => {
        p.g.getWorldPosition(tmpV);
        p.d = tmpV.distanceTo(camera.position);
        const zv = -tmpV.applyMatrix4(camera.matrixWorldInverse).z;
        const near = smooth(1.2, 4.5, zv); // fade what passes close to the camera
        if (p.kind === "plate") {
          p.hover.value += ((isCur && pi === active ? 1 : 0) - p.hover.value) * k(0.12);
          p.g.position.z = p.z + p.hover.value * 0.45;
          // The camera in this plate's space, and the tilt towards the mouse on hover
          p.g.updateMatrixWorld();
          p.g.worldToLocal(p.eye.value.copy(camera.position));
          let lx = 0,
            ly = 0;
          if (isCur && pi === active && mouse.in && !COARSE) {
            const sr = sceneEl.getBoundingClientRect();
            const mx = ((mouse.x - sr.left) / sr.width) * 2 - 1,
              my = 1 - ((mouse.y - sr.top) / sr.height) * 2;
            p.g.getWorldPosition(tmpV).project(camera);
            const hx = (p.w * S) / (2 * p.d * TAN * camera.aspect),
              hy = (p.h * S) / (2 * p.d * TAN);
            lx = clamp((mx - tmpV.x) / hx, -1, 1);
            ly = clamp((my - tmpV.y) / hy, -1, 1);
          }
          p.lookT.set(lx * 0.24, ly * 0.24);
          p.look.value.lerp(p.lookT, k(0.07));
          const qa = inst.alpha * near;
          p.quad.material.uniforms.uAlpha.value = qa;
          p.quad.visible = qa > 0.003;
          p.frame.material.opacity = qa;
          p.frame.material.color.lerpColors(FRAME_C, ACCENT_C, Math.max(p.hover.value, inst
            .hot));
          p.label.material.opacity = qa;
          addSig(p.hover.value);
          addSig(p.look.value.x);
          addSig(p.look.value.y);
        } else if (p.kind === "title") {
          p.g.material.opacity = inst.alpha * near * smooth(24, 34, p.d);
        } else {
          p.objs[0].material.opacity = inst.alpha * near;
        }
        order.push(p);
      });
      if (inst.floaters) {
        // They ride with the view only while this experiment is the one in front
        inst.ride += ((isCur && !flight ? 1 : 0) - inst.ride) * k(0.06);
        rideFloaters(inst, k(0.08));
        for (const fl of inst.floaters) {
          fl.g.getWorldPosition(tmpV);
          fl.d = tmpV.distanceTo(camera.position);
          const zv = -tmpV.applyMatrix4(camera.matrixWorldInverse).z;
          // Over the copy, the hint or the nav: nearly gone (and not clickable)
          fl.clear += ((overHud(fl) ? LAB.floatClear : 1) - fl.clear) * k(0.08);
          fl.mesh.material.opacity = inst.floatOn * smooth(1.2, 4.5, zv) * (1 - 0.85 * smooth(0.3,
            0.6, Math.abs(rideTurn(inst).orbitYaw))) * fl.clear;
          fl.mesh.visible = fl.mesh.material.opacity > 0.003;
          addSig(fl.mesh.material.opacity);
          addSig(fl.g.position.x);
          addSig(fl.g.position.y);
          order.push(fl);
        }
      }
    }

    // Back to front across the whole space, so the panes blend over what is behind
    order.sort((a, b) => b.d - a.d);
    order.forEach((p, i) => p.objs.forEach((ob, j) => { if (ob) ob.renderOrder = i * 5 + j; }));

    const settled = still && !flight && !drag && !gpuDirty && Math.abs(sig - lastSig) < 1e-6;
    lastSig = sig;
    gpuDirty = false;
    if (!settled && !glDown) renderer.render(scene, camera);
    placeTech();
    placeFly();
    if (!readyFired && cur && cur.ready) {
      readyFired = true;
      o.onReady();
    }
  }

  function setRunning() {
    const on = alive && inView && !document.hidden;
    if (on && !raf) {
      const now = performance.now();
      // Time stood still while paused: a flight resumes where it was
      if (pausedAt) {
        if (flight && Number.isFinite(flight.start)) flight.start += now - pausedAt;
        lastInput += now - pausedAt;
        pausedAt = 0;
      }
      lastNow = now;
      raf = requestAnimationFrame(frame);
    }
    if (!on && raf) {
      cancelAnimationFrame(raf);
      raf = 0;
      pausedAt = performance.now();
    }
  }
  document.addEventListener("visibilitychange", setRunning, { signal });
  const io = new IntersectionObserver(([entry]) => {
    inView = entry.isIntersecting;
    setRunning();
  });
  io.observe(stage);
  const ro = new ResizeObserver(() => resize());
  ro.observe(stage);

  // -- Boot: the first experiment, a fly-in from deep behind it, then the rest of the lab
  resize();
  restPose(K, base.pos, base.tgt);
  const intro = o.intro && !reduced();
  if (intro) {
    const p1 = base.pos.clone(),
      t1 = base.tgt.clone();
    base.pos.add(new THREE.Vector3(-3, 5, 72));
    // The fly-in waits for the first experiment and for the page to be in view
    flight = { p0: base.pos.clone(), t0: base.tgt.clone(), p1, t1, ms: 2800, start: Infinity,
      lift: 3, copied: true, intro: true };
  }
  buildRoute(Math.round(slotAt(base.pos.z)));
  buildCrosses();
  setCopy(index, true);
  setHint(0);
  updateNav();
  started = true;
  measureCopy();
  applyCamera();
  showLoading(`Loading the lab ${pad2(index + 1)} / ${pad2(N)}`);
  reconcile(Math.round(slotAt(base.pos.z)));
  setRunning();
  if (intro) {
    let shown = false,
      revealed = false;
    const go2 = () => {
      if (!alive || !flight || !flight.intro || !shown || !revealed) return;
      flight.start = performance.now();
    };
    Promise.resolve(o.reveal).then(() => {
      revealed = true;
      go2();
    });
    // Ready once the current cluster is in
    const wait = () => {
      if (!alive) return;
      const cur = insts.get(K);
      if (cur && cur.ready) {
        shown = true;
        go2();
      } else if (!cur || !cur.failed) later(wait, 50);
    };
    wait();
  }

  function destroy() {
    if (!alive) return;
    alive = false;
    ac.abort();
    if (raf) cancelAnimationFrame(raf);
    raf = 0;
    if (underRaf) cancelAnimationFrame(underRaf);
    timers.forEach((id) => clearTimeout(id));
    timers.clear();
    ro.disconnect();
    io.disconnect();
    for (const inst of insts.values()) disposeInst(inst);
    insts.clear();
    if (route) {
      gpuFree(route.geometry);
      scene.remove(route);
    }
    gpuFree(routeMat);
    if (crossGeo) gpuFree(crossGeo);
    if (crossMat) gpuFree(crossMat);
    crosses.forEach((p) => scene.remove(p));
    gpuFree(UNIT_PLANE);
    gpuFree(renderer.renderLists);
    if (!glDown) renderer.dispose();
    if (!renderer.getContext().isContextLost()) renderer.forceContextLoss();
    teardownDom();
  }

  const debug = {
    state: () => ({
      index,
      K,
      hovered,
      pinned,
      flight: !!flight,
      phone: PHONE,
      orbit: { yaw: +orbit.yaw.toFixed(4), pitch: +orbit.pitch.toFixed(4) },
      lean: { yaw: +lean.yaw.toFixed(4), pitch: +lean.pitch.toFixed(4) },
      insts: [...insts.values()].map((i) => ({ slot: i.slot, idx: i.idx, ready: i.ready,
        sharp: i.sharp, alpha: +i.alpha.toFixed(2), failed: i.failed })),
      floats: (insts.get(K)?.floaters || []).map((fl) => ({ kind: fl.f.kind, clear: +fl.clear
          .toFixed(2), opacity: +fl.mesh.material.opacity.toFixed(2) })),
      pixelRatio: renderer.getPixelRatio(),
      plates: (insts.get(K)?.panels || []).filter((p) => p.kind === "plate")
        .map((p) => ({ id: p.id, k: p.k, w: +p.w.toFixed(3), h: +p.h.toFixed(3), ia: +p.ia
            .toFixed(3), pa: +p.pa.toFixed(3), flip: p.flip })),
    }),
    // Where experiment idx's nearest cluster sits on screen (client px)
    at(idx) {
      let best = null;
      for (const inst of insts.values()) {
        if (inst.ready && inst.idx === idx && (!best || Math.abs(inst.slot - K) < Math.abs(best
            .slot - K))) best = inst;
      }
      if (!best) return null;
      best.root.getWorldPosition(tmpV).project(camera);
      const r = sceneEl.getBoundingClientRect();
      return { x: r.left + (tmpV.x + 1) / 2 * r.width, y: r.top + (1 - tmpV.y) / 2 * r.height,
        z: tmpV.z };
    },
    // Where the foreground windows sit on screen (client px) and how visible they are
    floatsAt() {
      const r = sceneEl.getBoundingClientRect(),
        out = [];
      for (const inst of insts.values()) {
        for (const fl of inst.floaters || []) {
          fl.g.getWorldPosition(tmpV).project(camera);
          out.push({ idx: inst.idx, kind: fl.f.kind, x: Math.round(r.left + (tmpV.x + 1) / 2 * r
            .width), y: Math.round(r.top + (1 - tmpV.y) / 2 * r.height), opacity: +fl.mesh.material
            .opacity.toFixed(2) });
        }
      }
      return out;
    },
    pick: (x, y) => pickAt(x, y),
    go,
    flyToIdx,
    renderer,
  };

  return { destroy, debug };
}

// three r170 as an ES module, only on /lab
const LAB_THREE_URL = "https://cdn.jsdelivr.net/npm/three@0.170.0/+esm";
let labThreePromise = null;

function loadLabThree() {
  if (!labThreePromise) {
    labThreePromise = import(LAB_THREE_URL);
    // A later visit can retry after a network error
    labThreePromise.catch(() => { labThreePromise = null; });
  }
  return labThreePromise;
}

// beforeEnter: the copy is written now (before anything measures or splits text), the scene is
// built while the band runs. The sheet of a hard load waits for the first cluster (holdIntro),
// the fly-in starts when the page is in view
function initLab() {
  const page = nextPage;
  const root = page.querySelector("[data-lab]");
  const stage = root && root.querySelector("[data-lab-stage]");
  if (!root || !stage) return;
  labInjectCss();
  const items = labReadItems(root);
  if (!items.length) {
    console.warn("[lab] the CMS list has no experiment with an image");
    debugLog("✗ lab: no experiment with an image", true);
    return;
  }
  labWriteCopy(root, items[0], 0, items.length);

  let lab = null;
  let dead = false;
  let revealed;
  const reveal = new Promise((resolve) => { revealed = resolve; });
  revealOnEntry(stage, () => revealed(), page);
  const fontsReady = new Promise((resolve) => whenTextFontsReady(resolve));

  const ready = loadLabThree()
    .then((THREE) => {
      if (dead) return null;
      lab = createLab(THREE, {
        root,
        stage,
        items,
        reduced: () => reducedMotion,
        reveal,
        fontsReady,
        log: debugLog,
      });
      if (DEBUG) window.__lab = lab;
      return lab.ready;
    })
    .catch((err) => {
      console.warn("[lab] three.js could not be loaded: the lab stays a still page.", err);
      debugLog(`✗ lab: ${err && err.message}`, true);
    });
  holdIntro(ready);

  onPageLeave(() => {
    dead = true;
    lab?.destroy();
    if (window.__lab === lab) window.__lab = undefined;
    lab = null;
  });
}
// ==== LAB end

// ==== PROFILE DITHER
// The Profile's face as a dither point cloud: one point per 2px cell of the photo, each at its
// depth (the depth map), turning towards the mouse like a 3D scan. The points carry only a
// tone; the 1-bit Bayer grid stays fixed on the screen like the site's other dithers, so a
// turn moves the tone through the grid. The face flies in from the depth (a dither cloud
// passes over it), then boils a little, and more where the mouse moves fast.
// Markup (Webflow): .pf__card > .pf__win.is--photo > .pf__photo[data-pf-dither]
// [data-pf-dither-depth] > img, optional data-pf-dither-head="x y h" (the head in the photo, uv:
// centre and height, for another photo). The canvas covers the card on desktop (the face is
// centred on it, at the card's height) and the photo window's box below 992px. .is-dither
// hides the window's frame and photo while the dots stand in for them; without WebGL2, or
// when an image fails, the window shows the photo as before.

const PFD = {
  deskQuery: "(min-width: 992px)",
  cell: 2, // CSS px per dither cell, the site's dither dot
  ink: [0x1c / 255, 0x1c / 255, 0x1a / 255], // HOME_DITHER.ink
  head: [0.5, 0.335, 0.435], // the head in the photo (uv): centre x, centre y, height
  fill: { desk: 0.555, small: 0.6 }, // head height, share of the frame (desk: the card's content box)
  centre: 0.45, // the head's centre, share of the frame's height from its top
  fade: [0.84, 1], // the bottom dissolves between these shares of the frame
  sides: [0.27, 0.47], // the shoulders dissolve between these distances from the photo's centre (uv)
  cut: [0.2, 0.34], // depth that cuts the wall away from the person
  tone: { lift: 0.16, gamma: 1.1, sharp: 1 }, // paper kept for the skin; contrast; unsharp mask
  yaw: 0.26, // rad, turn towards a mouse at the card's edge
  pitch: 0.16,
  sway: [0.4, 0.35], // idle sway, share of yaw and pitch
  ease: 3.2, // per second, how fast the turn follows
  depth: 0.6, // depth range in CSS px, of the head's height
  plane: 0.62, // depth that holds still while turning (the face)
  persp: 2.4, // camera distance, in frame heights
  lens: { radius: 110, speed: 1600, decay: 2.6 }, // CSS px; px/s for a full lens; per second
  boil: { base: 0.1, lens: 0.7, fps: 9 }, // threshold jitter, still and under the lens; frames/s
  introS: 1.7,
  idleMs: 3500, // after the last mouse move, the sway takes over
  bleed: 0.12, // below 992px: canvas margin around the window, share of its height
  photoW: 1000, // smallest srcset width read for the dots
  bufferPx: 7e6, // device px, cap on the drawing buffer
  leaveMs: 1500, // the last frame stays while the page leaves, then the context goes
};

const PFD_VERT = `#version 300 es
precision highp float;
uniform sampler2D uImg;
uniform sampler2D uDepth;
uniform vec2 uView;     // stage, CSS px
uniform float uDpr;
uniform float uCell;
uniform int uCols;
uniform vec2 uCell0;    // first cell of the lattice (the photo's box on the stage)
uniform vec2 uAnchor;   // the head's centre on the stage
uniform vec2 uImgSize;  // the photo's size on the stage
uniform vec2 uHead;     // the head's centre in the photo (uv)
uniform vec2 uFrame;    // top and height of the frame the face fills
uniform vec4 uCut;      // depth cut (x, y), sides (z, w)
uniform vec2 uFade;
uniform vec3 uTone;     // lift, gamma, sharp
uniform vec2 uRot;      // yaw, pitch
uniform float uDepthPx;
uniform float uPlane;
uniform float uPersp;
uniform float uTime;
uniform float uIntro;
uniform float uMotion;  // 0 with reduced motion
uniform vec4 uMouse;    // x, y, strength, radius
uniform vec2 uBoil;     // still, under the lens
uniform float uFps;
uniform float uLod;
uniform float uMaxSize;
out float vTone;
out float vBoil;

float hash(vec2 p) { return fract(sin(dot(p, vec2(127.1, 311.7))) * 43758.5453); }
float noise(vec2 p) {
  vec2 i = floor(p);
  vec2 f = fract(p);
  f = f * f * (3.0 - 2.0 * f);
  return mix(mix(hash(i), hash(i + vec2(1.0, 0.0)), f.x),
    mix(hash(i + vec2(0.0, 1.0)), hash(i + vec2(1.0, 1.0)), f.x), f.y);
}
float luma(vec3 c) { return dot(c, vec3(0.299, 0.587, 0.114)); }

void main() {
  vTone = 0.0;
  vBoil = 0.0;
  gl_PointSize = 0.0;
  gl_Position = vec4(2.0, 2.0, 2.0, 1.0); // culled unless placed below

  vec2 cell = uCell0 + vec2(float(gl_VertexID % uCols), float(gl_VertexID / uCols));
  vec2 p0 = (cell + 0.5) * uCell;
  vec2 uv = (p0 - uAnchor) / uImgSize + uHead;
  if (uv.x < 0.0 || uv.x > 1.0 || uv.y < 0.0 || uv.y > 1.0) return;

  // Tone: luma with a little unsharp mask, so eyes and brows hold at this size
  float l = luma(textureLod(uImg, uv, uLod).rgb);
  float lb = luma(textureLod(uImg, uv, uLod + 2.0).rgb);
  l = clamp(l + (l - lb) * uTone.z, 0.0, 1.0);
  float t = pow(clamp((1.0 - l - uTone.x) / (0.9 - uTone.x), 0.0, 1.0), uTone.y);

  // Only the person: the depth map cuts the wall; the shoulders and the bottom dissolve
  float d = textureLod(uDepth, uv, 0.0).r;
  float m = smoothstep(uCut.x, uCut.y, d);
  m *= 1.0 - smoothstep(uFade.x, uFade.y, (p0.y - uFrame.x) / uFrame.y);
  m *= 1.0 - smoothstep(uCut.z, uCut.w, abs(uv.x - 0.5));
  if (m < 0.003) return;

  // Intro: a dither cloud passes over the face while its points fly in from the depth
  float f = noise(uv * 5.0) * 0.6 + hash(cell) * 0.4;
  float r = clamp((uIntro * 1.5 - f - 0.05) / 0.4, 0.0, 1.0);
  if (r <= 0.0) return;
  float fly = (1.0 - r) * (1.0 - r) * uMotion;

  // Lens: the points part and boil where the mouse moves fast
  vec2 dm = p0 - uMouse.xy;
  float k = (1.0 - smoothstep(0.0, uMouse.w, length(dm))) * uMouse.z * uMotion;
  vec2 shove = normalize(dm + 1e-4) * k * 10.0;

  // The point in 3D, turned (yaw, then pitch) about the face's plane, with perspective
  float x = p0.x - uAnchor.x + shove.x;
  float y = p0.y - uAnchor.y + shove.y;
  float z = (d - uPlane) * uDepthPx + (hash(cell.yx + 3.1) - 0.5) * uDepthPx * 4.0 * fly + k * 30.0;
  float cy = cos(uRot.x), sy = sin(uRot.x), cp = cos(uRot.y), sp = sin(uRot.y);
  float x1 = x * cy + z * sy;
  float z1 = -x * sy + z * cy;
  float y1 = y * cp + z1 * sp;
  float z2 = -y * sp + z1 * cp;
  float F = uFrame.y * uPersp;
  float s = F / max(F - z2, 1.0);
  vec2 P = uAnchor + vec2(x1, y1) * s;

  float tone = t * m * r;
  if (tone < 0.004) return;
  vTone = tone;
  vBoil = (uBoil.x + k * uBoil.y) * uMotion;
  // Points overlap (1.6 cells), so the turned cloud has no gaps; the grid decides the dots
  gl_PointSize = min(ceil(uCell * uDpr * s * 1.6), uMaxSize);
  gl_Position = vec4(P.x / uView.x * 2.0 - 1.0, 1.0 - P.y / uView.y * 2.0, 0.0, 1.0);
}`;

const PFD_FRAG = `#version 300 es
precision highp float;
uniform vec3 uColor;
uniform float uCellPx;
uniform float uTime;
uniform float uFps;
in float vTone;
in float vBoil;
out vec4 o;
${DITHER_BAYER_GLSL}
float hash(vec2 p) { return fract(sin(dot(p, vec2(127.1, 311.7))) * 43758.5453); }
void main() {
  // 1-bit ordered dither in screen cells; the boil is per cell, so overlapping points agree
  vec2 sc = floor(gl_FragCoord.xy / uCellPx);
  float n = hash(sc + floor(uTime * uFps) * vec2(7.13, 3.71)) - 0.5;
  if (bayer8(sc) + n * vBoil > vTone) discard;
  o = vec4(uColor, 1.0);
}`;

// The srcset candidate of at least minW px (the largest when none is), else the src
function pfdSource(img, minW) {
  const list = (img.getAttribute("srcset") || "")
    .split(",")
    .map((s) => s.trim().split(/\s+/))
    .filter((p) => p[0] && /^\d+w$/.test(p[1] || ""))
    .map((p) => ({ url: p[0], w: parseInt(p[1], 10) }))
    .sort((a, b) => a.w - b.w);
  const hit = list.find((c) => c.w >= minW) || list[list.length - 1];
  return (hit && hit.url) || img.currentSrc || img.getAttribute("src");
}

function initProfileDither() {
  const page = nextPage;
  const box = page.querySelector("[data-pf-dither]");
  const win = box && box.closest(".pf__win");
  const card = box && box.closest(".pf__card");
  const img = box && box.querySelector("img");
  const depthUrl = box && box.getAttribute("data-pf-dither-depth");
  if (!box || !win || !card || !img || !depthUrl) return;
  const head = (() => {
    const v = (box.getAttribute("data-pf-dither-head") || "").trim().split(/[\s,]+/).map(Number);
    return v.length === 3 && v.every((n) => Number.isFinite(n) && n > 0) ? v : PFD.head;
  })();
  const desk = window.matchMedia(PFD.deskQuery);
  const controller = new AbortController();
  const { signal } = controller;

  const canvas = document.createElement("canvas");
  canvas.className = "pfd__gl";
  canvas.setAttribute("aria-hidden", "true");
  canvas.setAttribute("data-intro-skip", ""); // the face has its own entry
  const gl = canvas.getContext("webgl2", { alpha: true, premultipliedAlpha: true, antialias: false,
    depth: false, stencil: false });
  if (!gl) return; // the window keeps the photo
  card.append(canvas);

  // While the dots stand in for the photo, the window's content hides: the window takes the
  // photo's name (the canvas is decoration). Hidden from the start, so the frame never flashes
  // before the dots, and the page transition's preview skips the photo the dots replace
  const alt = img.getAttribute("alt") || "";
  function setDither(on) {
    win.classList.toggle("is-dither", on);
    if (on && alt) {
      win.setAttribute("role", "img");
      win.setAttribute("aria-label", alt);
    } else {
      win.removeAttribute("role");
      win.removeAttribute("aria-label");
    }
  }
  setDither(true);

  let left = false;
  let down = false; // the context is lost
  let G = null; // the program, its uniforms and textures, once built
  let photo = null,
    depth = null;

  function fail(err) {
    if (left) return;
    console.warn("[profile dither] the portrait stays a photo:", err && (err.message || err));
    debugLog(`✗ profile dither: ${err && err.message}`, true);
    G = null;
    stopLoop();
    controller.abort(); // final: a later context restore must not hide the photo again
    setDither(false);
    canvas.remove();
  }

  function texture(image) {
    const tx = gl.createTexture();
    gl.bindTexture(gl.TEXTURE_2D, tx);
    gl.texImage2D(gl.TEXTURE_2D, 0, gl.RGBA, gl.RGBA, gl.UNSIGNED_BYTE, image);
    gl.generateMipmap(gl.TEXTURE_2D);
    gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_MIN_FILTER, gl.LINEAR_MIPMAP_LINEAR);
    gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_MAG_FILTER, gl.LINEAR);
    gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_WRAP_S, gl.CLAMP_TO_EDGE);
    gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_WRAP_T, gl.CLAMP_TO_EDGE);
    return tx;
  }

  function shader(type, src) {
    const sh = gl.createShader(type);
    gl.shaderSource(sh, src);
    gl.compileShader(sh);
    if (!gl.getShaderParameter(sh, gl.COMPILE_STATUS) && !gl.isContextLost()) {
      throw new Error(gl.getShaderInfoLog(sh) || "shader");
    }
    return sh;
  }

  // Program, uniforms and both textures: again after a context restore
  function build() {
    const prog = gl.createProgram();
    const vs = shader(gl.VERTEX_SHADER, PFD_VERT);
    const fs = shader(gl.FRAGMENT_SHADER, PFD_FRAG);
    gl.attachShader(prog, vs);
    gl.attachShader(prog, fs);
    gl.linkProgram(prog);
    if (!gl.getProgramParameter(prog, gl.LINK_STATUS) && !gl.isContextLost()) {
      throw new Error(gl.getProgramInfoLog(prog) || "link");
    }
    gl.deleteShader(vs);
    gl.deleteShader(fs);
    gl.useProgram(prog);
    const U = {};
    const n = gl.getProgramParameter(prog, gl.ACTIVE_UNIFORMS) || 0;
    for (let i = 0; i < n; i++) {
      const name = gl.getActiveUniform(prog, i).name;
      U[name] = gl.getUniformLocation(prog, name);
    }
    const vao = gl.createVertexArray(); // the points come from gl_VertexID: no attributes
    gl.bindVertexArray(vao);
    gl.activeTexture(gl.TEXTURE0);
    const tImg = texture(photo);
    gl.activeTexture(gl.TEXTURE1);
    const tDepth = texture(depth);
    gl.uniform1i(U.uImg, 0);
    gl.uniform1i(U.uDepth, 1);
    gl.disable(gl.DEPTH_TEST);
    gl.disable(gl.BLEND); // ink is opaque, the rest is discarded
    G = { prog, vao, tImg, tDepth, U, maxSize: gl.getParameter(gl.ALIASED_POINT_SIZE_RANGE)[1] || 64 };
  }

  function free() {
    if (!G || gl.isContextLost()) return;
    gl.deleteTexture(G.tImg);
    gl.deleteTexture(G.tDepth);
    gl.deleteVertexArray(G.vao);
    gl.deleteProgram(G.prog);
  }

  // -- Layout. Desktop: the stage is the card and the face fills its content box, centred.
  // Below: the stage is the photo window plus a margin, and the face fills the window
  const L = { x: 0, y: 0, w: 1, h: 1, cardW: 1, cardH: 1, dpr: 1, cols: 1, rows: 1, cell0: [0, 0], anchor: [0, 0],
    frame: [0, 1], imgW: 1, imgH: 1, lod: 0 };

  function cardOrigin() {
    const r = card.getBoundingClientRect();
    return { x: r.left + card.clientLeft, y: r.top + card.clientTop };
  }

  function layout() {
    if (left || !photo) return;
    const o = cardOrigin();
    const W = card.clientWidth;
    const H = card.clientHeight;
    let sx = 0,
      sy = 0,
      sw = W,
      sh = H,
      top,
      fh,
      cx;
    if (desk.matches) {
      const cs = getComputedStyle(card);
      top = parseFloat(cs.paddingTop) || 0;
      fh = H - top - (parseFloat(cs.paddingBottom) || 0);
      cx = W / 2;
    } else {
      const wr = win.getBoundingClientRect();
      const wl = wr.left - o.x;
      const wt = wr.top - o.y;
      const bleed = wr.height * PFD.bleed;
      sx = Math.max(0, Math.floor(wl - bleed));
      sy = Math.max(0, Math.floor(wt - bleed));
      sw = Math.min(W, Math.ceil(wl + wr.width + bleed)) - sx;
      sh = Math.min(H, Math.ceil(wt + wr.height + bleed)) - sy;
      top = wt;
      fh = wr.height;
      cx = wl + wr.width / 2;
    }
    if (sw < 4 || sh < 4 || fh < 4) return;
    // Whole device px per cell, so the squares stay even; fewer when the buffer would be huge
    const want = Math.min(2, Math.max(1, Math.round((window.devicePixelRatio || 1) * PFD.cell) / PFD.cell));
    const room = Math.sqrt(PFD.bufferPx / (sw * sh));
    const dpr = Math.max(1 / PFD.cell, Math.min(want, Math.floor(room * PFD.cell) / PFD.cell));
    Object.assign(L, { x: sx, y: sy, w: sw, h: sh, cardW: W, cardH: H, dpr });
    canvas.style.left = sx + "px";
    canvas.style.top = sy + "px";
    canvas.style.width = sw + "px";
    canvas.style.height = sh + "px";
    const bw = Math.round(sw * dpr);
    const bh = Math.round(sh * dpr);
    if (canvas.width !== bw) canvas.width = bw;
    if (canvas.height !== bh) canvas.height = bh;
    const fill = desk.matches ? PFD.fill.desk : PFD.fill.small;
    L.frame = [top - sy, fh];
    L.imgH = (fh * fill) / head[2];
    L.imgW = (L.imgH * photo.naturalWidth) / photo.naturalHeight;
    L.anchor = [cx - sx, top - sy + fh * PFD.centre];
    // Points only where the face can be: the photo's box, inside the shoulders' fade, above the
    // frame's bottom, on the stage (the lattice is the photo at rest; turning moves its points)
    const c = PFD.cell;
    const x0 = L.anchor[0] + (0.5 - PFD.sides[1] - head[0]) * L.imgW;
    const x1 = L.anchor[0] + (0.5 + PFD.sides[1] - head[0]) * L.imgW;
    const y0 = L.anchor[1] - head[1] * L.imgH;
    const y1 = Math.min(L.anchor[1] + (1 - head[1]) * L.imgH, L.frame[0] + L.frame[1]);
    const cx0 = Math.max(0, Math.floor(x0 / c));
    const cy0 = Math.max(0, Math.floor(y0 / c));
    const cx1 = Math.min(Math.ceil(sw / c), Math.ceil(x1 / c));
    const cy1 = Math.min(Math.ceil(sh / c), Math.ceil(y1 / c));
    L.cell0 = [cx0, cy0];
    L.cols = Math.max(0, cx1 - cx0 + 1);
    L.rows = Math.max(0, cy1 - cy0 + 1);
    L.lod = Math.max(0, Math.log2((photo.naturalWidth / L.imgW) * PFD.cell));
  }

  // -- Motion state
  // The mouse is kept in client px and mapped to the stage every frame, so a scroll under a
  // still cursor neither counts as movement nor leaves the lens where the cursor was
  const P = { cx: null, cy: null, x: -1e4, y: -1e4, moved: 0, at: -1e9, lens: 0 }; // x/y: stage px
  const rot = [0, 0];
  let introAt = null; // when the face started to fly in
  let lastNow = performance.now();
  const t0 = lastNow;

  window.addEventListener("pointermove", (e) => {
    if (e.pointerType === "touch") return; // fingers scroll; the face sways on its own
    // Speed only counts while the loop runs: moves made while it slept are not a burst
    if (P.cx != null && raf) P.moved += Math.hypot(e.clientX - P.cx, e.clientY - P.cy);
    P.cx = e.clientX;
    P.cy = e.clientY;
    P.at = performance.now();
    wake();
  }, { signal, passive: true });
  // When the pointer stream breaks (out of the page, another app or tab), the next move only
  // seeds the position: the jump back is not speed
  const forgetPointer = () => {
    P.cx = P.cy = null;
    P.at = -1e9;
  };
  document.documentElement.addEventListener("pointerleave", forgetPointer, { signal });
  window.addEventListener("blur", forgetPointer, { signal });

  function step(now) {
    const dt = Math.min(0.05, Math.max(0, (now - lastNow) / 1000));
    lastNow = now;
    const time = (now - t0) / 1000;
    const motion = reducedMotion ? 0 : 1;
    if (P.cx != null) {
      const o = cardOrigin();
      P.x = P.cx - o.x - L.x;
      P.y = P.cy - o.y - L.y;
    }
    let tx = 0,
      ty = 0;
    if (motion && now - P.at < PFD.idleMs) {
      // Towards the mouse, full turn at the card's edge
      const ax = L.anchor[0],
        ay = L.anchor[1];
      tx = labClamp((P.x - ax) / (L.cardW * 0.5), -1, 1) * PFD.yaw;
      ty = labClamp((P.y - ay) / (L.cardH * 0.5), -1, 1) * PFD.pitch;
    } else if (motion) {
      tx = Math.sin(time * 0.31) * PFD.sway[0] * PFD.yaw;
      ty = Math.sin(time * 0.23 + 1.2) * PFD.sway[1] * PFD.pitch;
    }
    const k = 1 - Math.exp(-dt * PFD.ease);
    rot[0] += (tx - rot[0]) * k;
    rot[1] += (ty - rot[1]) * k;
    const speed = dt > 0 ? P.moved / dt : 0;
    P.moved = 0;
    P.lens = Math.max(P.lens * Math.exp(-dt * PFD.lens.decay), Math.min(1, speed / PFD.lens.speed));
    draw(time);
  }

  function introNow(now) {
    if (introAt == null) return 0;
    if (reducedMotion) return 1;
    const x = labClamp((now - introAt) / (PFD.introS * 1000), 0, 1);
    return 1 - Math.pow(1 - x, 2.2);
  }

  function draw(time = (performance.now() - t0) / 1000) {
    if (!G || down || left) return;
    const U = G.U;
    gl.viewport(0, 0, canvas.width, canvas.height);
    gl.clearColor(0, 0, 0, 0);
    gl.clear(gl.COLOR_BUFFER_BIT);
    const intro = introNow(performance.now());
    if (intro <= 0 || !L.cols || !L.rows) return;
    const motion = reducedMotion ? 0 : 1;
    gl.useProgram(G.prog);
    gl.bindVertexArray(G.vao);
    gl.uniform2f(U.uView, L.w, L.h);
    gl.uniform1f(U.uDpr, L.dpr);
    gl.uniform1f(U.uCell, PFD.cell);
    gl.uniform1i(U.uCols, Math.max(1, L.cols));
    gl.uniform2f(U.uCell0, L.cell0[0], L.cell0[1]);
    gl.uniform2f(U.uAnchor, L.anchor[0], L.anchor[1]);
    gl.uniform2f(U.uImgSize, L.imgW, L.imgH);
    gl.uniform2f(U.uHead, head[0], head[1]);
    gl.uniform2f(U.uFrame, L.frame[0], L.frame[1]);
    gl.uniform4f(U.uCut, PFD.cut[0], PFD.cut[1], PFD.sides[0], PFD.sides[1]);
    gl.uniform2f(U.uFade, PFD.fade[0], PFD.fade[1]);
    gl.uniform3f(U.uTone, PFD.tone.lift, PFD.tone.gamma, PFD.tone.sharp);
    gl.uniform2f(U.uRot, rot[0], rot[1]);
    gl.uniform1f(U.uDepthPx, L.frame[1] * (desk.matches ? PFD.fill.desk : PFD.fill.small) * PFD.depth);
    gl.uniform1f(U.uPlane, PFD.plane);
    gl.uniform1f(U.uPersp, PFD.persp);
    gl.uniform1f(U.uTime, time);
    gl.uniform1f(U.uIntro, intro);
    gl.uniform1f(U.uMotion, motion);
    gl.uniform4f(U.uMouse, P.x, P.y, P.lens, PFD.lens.radius);
    gl.uniform2f(U.uBoil, PFD.boil.base, PFD.boil.lens);
    gl.uniform1f(U.uFps, PFD.boil.fps);
    gl.uniform1f(U.uLod, L.lod);
    gl.uniform1f(U.uMaxSize, G.maxSize);
    gl.uniform1f(U.uCellPx, PFD.cell * L.dpr);
    gl.uniform3f(U.uColor, PFD.ink[0], PFD.ink[1], PFD.ink[2]);
    gl.drawArrays(gl.POINTS, 0, L.cols * L.rows);
  }

  // -- Loop: only while the face is on screen and the tab visible. With reduced motion it
  // draws once per change instead
  let raf = 0,
    onScreen = false,
    layoutQueued = false;

  function wake() {
    if (raf || left || down || !G || !onScreen || document.hidden) return;
    lastNow = performance.now();
    P.moved = 0;
    raf = requestAnimationFrame(loop);
  }

  function stopLoop() {
    if (raf) cancelAnimationFrame(raf);
    raf = 0;
  }

  function loop(now) {
    raf = 0;
    if (left || down || !G || !onScreen || document.hidden) return;
    step(now);
    const entering = introAt != null && now - introAt < PFD.introS * 1000;
    if (!reducedMotion || entering) raf = requestAnimationFrame(loop);
  }

  const queueLayout = () => {
    if (layoutQueued || left) return;
    layoutQueued = true;
    requestAnimationFrame(() => {
      layoutQueued = false;
      layout();
      draw();
      wake();
    });
  };
  const ro = new ResizeObserver(queueLayout);
  [card, win].forEach((el) => ro.observe(el));
  desk.addEventListener("change", queueLayout, { signal });
  document.addEventListener("visibilitychange", () => {
    if (document.hidden) {
      stopLoop();
      forgetPointer();
    } else wake();
  }, { signal });

  // -- Entry: once the page shows, the images are in and the face is on screen (on phones it
  // sits below the statement), the points fly in
  let revealed = false,
    ready = false;
  // Only with a live build: an entry started while the context is down would run unseen
  const tryEnter = () => {
    if (introAt != null || left || down || !G || !revealed || !ready || !onScreen) return;
    introAt = performance.now();
    draw();
    wake();
  };
  const io = new IntersectionObserver((entries) => {
    onScreen = entries[entries.length - 1].isIntersecting;
    if (onScreen) {
      tryEnter();
      wake();
    } else stopLoop();
  });
  io.observe(canvas);
  revealOnEntry(win, () => {
    revealed = true;
    tryEnter();
  }, page);

  canvas.addEventListener("webglcontextlost", (e) => {
    e.preventDefault();
    down = true;
    stopLoop();
    setDither(false); // the photo while the dots are away
  }, { signal });
  // A restore before the images arrive only clears `down`: the load builds. After them, it
  // rebuilds and still runs the entry if the loss came before it
  canvas.addEventListener("webglcontextrestored", () => {
    if (left) return;
    down = false;
    if (!photo) return;
    try {
      build();
      layout();
      setDither(true);
      draw();
      tryEnter();
      wake();
    } catch (err) {
      fail(err);
    }
  }, { signal });

  // The sheet of a hard load waits for the images and the first build (capped by the intro).
  // `ready` means the images are in, so a restore after a loss here can enter
  const load = Promise.all([profileImage(pfdSource(img, PFD.photoW)), profileImage(depthUrl)])
    .then(([p, d]) => {
      if (left) return;
      photo = p;
      depth = d;
      ready = true;
      if (gl.isContextLost()) {
        down = true;
        setDither(false);
        return;
      }
      down = false;
      build();
      layout();
      setDither(true);
      tryEnter();
      wake();
    })
    .catch(fail);
  holdIntro(load);

  if (DEBUG) {
    window.__pfd = {
      state: () => ({
        gl: !!G,
        down,
        lost: gl.isContextLost(),
        dither: win.classList.contains("is-dither"),
        onScreen,
        looping: !!raf,
        intro: introNow(performance.now()),
        rot: [...rot],
        lens: P.lens,
        stage: [L.x, L.y, L.w, L.h],
        buffer: [canvas.width, canvas.height],
        dpr: L.dpr,
        points: L.cols * L.rows,
        anchor: [...L.anchor],
        frame: [...L.frame],
        img: [L.imgW, L.imgH],
      }),
    };
  }

  onPageLeave(() => {
    left = true;
    controller.abort();
    stopLoop();
    ro.disconnect();
    io.disconnect();
    if (window.__pfd) window.__pfd = undefined;
    // The last frame stays while the band covers the page, then the context goes
    setTimeout(() => {
      free();
      G = null;
      const lose = !gl.isContextLost() && gl.getExtension("WEBGL_lose_context");
      if (lose) lose.loseContext();
    }, PFD.leaveMs);
  });
}
// ==== PROFILE DITHER end

// -----------------------------------------
// START
// -----------------------------------------
// Last statement of the file: every const/let above is initialized by now

function startSite() {
  if (!window.gsap || !window.barba) {
    console.warn(
      "[portfolio] GSAP or Barba missing: load them in Webflow before global-code.js");
    return;
  }

  barba.init({
    debug: false, // Set to 'true' while debugging
    timeout: 7000,
    preventRunning: true,
    transitions: [
    {
      name: "default",
      sync: true,

      // First load
      async once(data) {
        initOnceFunctions();

        return runPageOnceAnimation(data.next.container);
      },

      // Current page leaves
      async leave(data) {
        return runPageLeaveAnimation(data.current.container, data.next.container,
          navIsBack ? "back" : "forward", pageLabel(data.next));
      },

      // New page enters
      async enter(data) {
        return runPageEnterAnimation(data.next.container);
      }
    }],
  });

  stampNavPos();

  // Barba only flags a transition as running once the next page is fetched (sync
  // transitions await the fetch first), so a second click during the fetch would start
  // a second transition. Flag it as soon as a navigation starts; Barba resets it.
  const barbaPage = barba.page.bind(barba);
  barba.page = (...args) => {
    barba.transitions.isRunning = true;
    return barbaPage(...args);
  };
}

startSite();
