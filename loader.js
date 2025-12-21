(() => {
  if (!window.gsap) return;

  /* ==========================================================================
   * CONFIGURATION
   * ========================================================================== */
  const STORAGE_KEYS = {
    SEEN: "preloader_seen_session",
    PENDING: "page_transition_pending",
  };

  const ANIM_CONFIG = {
    preloader: {
      durationMs: 2400,
      clipEase: "power2.inOut",
      clipDelay: 0.18,
      open: { duration: 0.28, stagger: 0.28 },
      uiFade: 0.28,
      close: { duration: 0.42, stagger: 0.42 },
      out: { duration: 0.6, ease: "sine.inOut" },
      text: { duration: 0.1, stagger: 0.03, ease: "none" },
    },
    pageTransition: {
      in: 0.6,
      out: 0.6,
      ease: "sine.inOut"
    }
  };

  /* ==========================================================================
   * DOM ELEMENTS
   * ========================================================================== */
  const select = (sel, root = document) => root.querySelector(sel);
  const selectAll = (sel, root = document) => Array.from(root.querySelectorAll(sel));

  const DOM = {
    preloader: select(".preloader"),
    wrap: select("[data-load-wrap]"),
    overlay: select(".page-transition"),
    blinkTexts: selectAll("[data-blink-text]"),
    eyebrows: selectAll("[data-eyebrow]"), // Nuovi elementi
  };

  const UI = DOM.preloader ? {
    count: select("[data-count]", DOM.preloader),
    lineWrap: select(".preloader__line", DOM.preloader),
    lineFill: select(".line__animate", DOM.preloader),
    text: select("[data-load-text]", DOM.preloader),
  } : {};

  const images = DOM.wrap ? selectAll("[data-load-img]", DOM.wrap) : [];
  let isAnimationRunning = false;

  /* ==========================================================================
   * SHARED ANIMATION: SPLIT TEXT (EYEBROWS & PRELOADER)
   * ========================================================================== */
  const runSplitAnimation = (elements, config = ANIM_CONFIG.preloader.text) => {
    if (!window.SplitText || !elements.length) return;

    elements.forEach(el => {
      // Evita doppie inizializzazioni
      if (el.dataset.splitDone) return;
      
      const split = new SplitText(el, { type: "words, chars", charsClass: "st-char" });
      gsap.set(split.chars, { opacity: 0 });
      
      gsap.to(split.chars, {
        opacity: 1,
        duration: config.duration,
        ease: config.ease,
        stagger: config.stagger,
        onComplete: () => {
          el.dataset.splitDone = "1";
          // Opzionale: split.revert(); // Scommenta se vuoi pulire il DOM dopo l'animazione
        }
      });
    });
  };

  /* ==========================================================================
   * LOGIC: BLINK TEXT EFFECT + EYEBROWS
   * ========================================================================== */
  const initBlinkAndEyebrows = () => {
    // 1. Anima i testi "eyebrow" con lo stile split-text
    runSplitAnimation(DOM.eyebrows);

    // 2. Anima l'effetto Blink (codice originale)
    DOM.blinkTexts.forEach((el, index) => {
      if (!el.dataset.wrapped) {
        const raw = el.innerHTML.replace(/<br\s*\/?>/gi, "\n");
        el.innerHTML = raw.split("").map(ch => {
          if (ch === "\n") return "<br>";
          const safeChar = ch === " " ? "&nbsp;" : ch;
          return `<span class="blink-char" style="opacity:0; filter:brightness(0.5); display:inline-block; will-change:opacity, filter;">${safeChar}</span>`;
        }).join("");
        el.dataset.wrapped = "1";
      }

      const chars = el.querySelectorAll(".blink-char");
      let hoverTL;

      const settleAll = () => gsap.to(chars, { 
        opacity: 1, filter: "brightness(1)", duration: 0.5, stagger: 0.01, ease: "power2.out", overwrite: "auto" 
      });

      const createFlash = (target) => {
        const tl = gsap.timeline();
        tl.to(target, { opacity: 1, filter: "brightness(2)", duration: 0.05, ease: "none" })
          .to(target, { opacity: 0.2, filter: "brightness(0.5)", duration: 0.05, ease: "none" })
          .to(target, { opacity: 1, filter: "brightness(1)", duration: 0.1, ease: "none" });
        return tl;
      };

      const getRandomChar = () => chars[gsap.utils.random(0, chars.length - 1, 1)];

      const doBurst = () => {
        if (hoverTL) hoverTL.kill();
        const tl = gsap.timeline({ delay: index * 0.1 });
        const flashesCount = Math.min(30, chars.length * 2); 
        for (let i = 0; i < flashesCount; i++) {
          tl.add(createFlash(getRandomChar()), gsap.utils.random(0, 0.6));
        }
        tl.add(settleAll(), 0.5);
      };

      const startHover = () => {
        if (hoverTL) hoverTL.kill();
        gsap.set(chars, { opacity: 1 });
        hoverTL = gsap.timeline({ repeat: -1 });
        const flashes = Math.max(5, Math.floor(chars.length / 3));
        for (let i = 0; i < flashes; i++) {
          hoverTL.add(createFlash(getRandomChar()), gsap.utils.random(0, 1.5));
        }
      };

      const stopHover = () => { 
        if (hoverTL) hoverTL.kill(); 
        gsap.to(chars, { opacity: 1, filter: "brightness(1)", duration: 0.3, overwrite: "auto" });
      };

      doBurst();
      el.addEventListener("mouseenter", startHover, { passive: true });
      el.addEventListener("mouseleave", stopHover, { passive: true });
    });
  };

  /* ==========================================================================
   * PAGE TRANSITIONS LOGIC
   * ========================================================================== */
  const handlePageLoadTransition = (onAnimationStart) => {
    if (!DOM.overlay) return false;
    
    if (sessionStorage.getItem(STORAGE_KEYS.PENDING) === "1") {
      sessionStorage.removeItem(STORAGE_KEYS.PENDING);
      
      gsap.fromTo(DOM.overlay, 
        { opacity: 1, display: "block", pointerEvents: "all" },
        { 
          opacity: 0, 
          duration: ANIM_CONFIG.pageTransition.out, 
          ease: ANIM_CONFIG.pageTransition.ease,
          onStart: () => { if (onAnimationStart) onAnimationStart(); },
          onComplete: () => gsap.set(DOM.overlay, { display: "none", pointerEvents: "none" })
        }
      );
      return true;
    }
    
    gsap.set(DOM.overlay, { opacity: 0, display: "none", pointerEvents: "none" });
    return false;
  };

  const handleInternalLinkClick = (e) => {
    if (isAnimationRunning) return;
    const link = e.target.closest("a");
    if (!shouldInterceptLink(link)) return;

    e.preventDefault();
    sessionStorage.setItem(STORAGE_KEYS.PENDING, "1");

    gsap.to(DOM.overlay, {
      display: "block",
      opacity: 1,
      duration: ANIM_CONFIG.pageTransition.in,
      ease: ANIM_CONFIG.pageTransition.ease,
      pointerEvents: "all",
      onComplete: () => (location.href = link.href),
    });
  };

  const shouldInterceptLink = (a) => {
    if (!a || (a.target && a.target !== "_self") || a.hasAttribute("download")) return false;
    const href = a.getAttribute("href");
    if (!href || href === "#" || href.startsWith("mailto:") || href.startsWith("tel:")) return false;
    let url; try { url = new URL(a.href, location.href); } catch { return false; }
    if (url.origin !== location.origin) return false;
    if (url.pathname === location.pathname && url.search === location.search && url.hash) return false;
    if (sessionStorage.getItem(STORAGE_KEYS.SEEN) !== "1") return false;
    return true;
  };

  /* ==========================================================================
   * BFCache / BACK BUTTON FIX
   * ========================================================================== */
  window.addEventListener("pageshow", (event) => {
    if (event.persisted) {
      isAnimationRunning = false;
      sessionStorage.removeItem(STORAGE_KEYS.PENDING);
      if (DOM.overlay) {
        gsap.set(DOM.overlay, { opacity: 0, display: "none", pointerEvents: "none" });
      }
      // Reset attributi per riattivare le animazioni
      DOM.eyebrows.forEach(el => delete el.dataset.splitDone);
      initBlinkAndEyebrows();
    }
  });

  /* ==========================================================================
   * MAIN INITIALIZATION
   * ========================================================================== */
  const init = () => {
    const hasRequiredUI = DOM.preloader && images.length && UI.count && UI.lineWrap && UI.lineFill;
    const hasSeenPreloader = sessionStorage.getItem(STORAGE_KEYS.SEEN) === "1";

    if (DOM.overlay) {
      document.addEventListener("click", handleInternalLinkClick, { passive: false });
    }

    if (hasRequiredUI && !hasSeenPreloader) {
      isAnimationRunning = true;
      
      const setupInitialState = () => {
        Object.assign(DOM.preloader.style, { position: "fixed", inset: "0", zIndex: "2147483647", display: "flex", opacity: "1" });
        UI.count.textContent = "0";
        Object.assign(UI.lineFill.style, { transformOrigin: "left center", transform: "scaleX(0)" });
        images.forEach((img, i) => {
           img.style.zIndex = String(i + 1);
           gsap.set(img, { clipPath: "inset(0 0 100% 0)" });
        });
      };

      const runPreloader = () => {
        const C = ANIM_CONFIG.preloader;
        const tl = gsap.timeline({ defaults: { ease: C.clipEase } });
        const endAt = C.durationMs / 1000;

        const progress = { val: 0 };
        tl.to(progress, {
          val: 100, duration: endAt, ease: "none",
          onUpdate: () => {
            const p = progress.val | 0;
            UI.count.textContent = p;
            gsap.set(UI.lineFill, { scaleX: p / 100 });
          }
        }, 0);

        // Anima il testo del preloader usando la nuova funzione condivisa
        if (UI.text) {
            tl.add(() => runSplitAnimation([UI.text]), 0);
        }

        images.forEach((img, i) => { 
            tl.to(img, { clipPath: "inset(0 0 0% 0)", duration: C.open.duration }, C.clipDelay + (i * C.open.stagger)); 
        });
        
        const uiElements = [UI.lineWrap, UI.count, UI.text].filter(Boolean);
        tl.to(uiElements, { opacity: 0, duration: C.uiFade, ease: "power2.out" }, endAt - 0.1);

        const reversedImages = [...images].reverse();
        reversedImages.forEach((img, i) => { 
            tl.to(img, { clipPath: "inset(0 0 100% 0)", duration: C.close.duration }, endAt + (i * C.close.stagger)); 
        });

        const totalCloseTime = (C.close.stagger * (reversedImages.length - 1)) + C.close.duration;
        const fadeOutStartTime = endAt + totalCloseTime + 0.06;

        tl.call(initBlinkAndEyebrows, null, fadeOutStartTime);
        tl.to(DOM.preloader, { opacity: 0, duration: C.out.duration, ease: C.out.ease }, fadeOutStartTime);
        tl.set(DOM.preloader, { display: "none" })
          .add(() => {
            sessionStorage.setItem(STORAGE_KEYS.SEEN, "1");
            isAnimationRunning = false;
          });
      };

      setupInitialState();
      runPreloader();

    } else {
      if (DOM.preloader) DOM.preloader.style.display = "none";
      const isTransitioning = handlePageLoadTransition(initBlinkAndEyebrows);
      if (!isTransitioning) initBlinkAndEyebrows();
    }
  };

  init();

})();
