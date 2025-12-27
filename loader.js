(() => {
  // Controllo dipendenze
  if (!window.gsap || !window.SplitText) return;

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
    },
    reveal: {
      lines: { duration: 0.8, stagger: 0.08 },
      words: { duration: 0.6, stagger: 0.06 },
      chars: { duration: 0.4, stagger: 0.01 }
    }
  };

  /* ==========================================================================
   * DOM ELEMENTS
   * ========================================================================== */
  const select = (sel) => document.querySelector(sel);
  const selectAll = (sel) => Array.from(document.querySelectorAll(sel));

  const DOM = {
    preloader: select(".preloader"),
    wrap: select("[data-load-wrap]"),
    overlay: select(".page-transition"),
    blinkTexts: selectAll("[data-blink-text]"),
    eyebrows: selectAll("[data-eyebrow]"),
    headings: selectAll('[data-split="heading"]'),
    heroTab: select(".hero__tab-wrap"),
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
   * ANIMATIONS LOGIC
   * ========================================================================== */
  
  const initMaskTextReveal = () => {
    DOM.headings.forEach(heading => {
      if (heading.dataset.revealDone) return;
      
      const type = heading.dataset.splitReveal || 'lines';
      const typesToSplit = type === 'lines' ? 'lines' : (type === 'words' ? 'lines,words' : 'lines,words,chars');

      const split = new SplitText(heading, {
        type: typesToSplit,
        linesClass: "split-line"
      });

      split.lines.forEach(line => {
        const wrap = document.createElement('div');
        wrap.className = "line-mask";
        Object.assign(wrap.style, { overflow: 'hidden', display: 'block' });
        line.parentNode.insertBefore(wrap, line);
        wrap.appendChild(line);
      });

      const targets = split[type];
      const config = ANIM_CONFIG.reveal[type];

      gsap.set(targets, { yPercent: 110 });
      gsap.set(heading, { autoAlpha: 1 });

      gsap.to(targets, {
        yPercent: 0,
        duration: config.duration,
        stagger: config.stagger,
        ease: 'expo.out',
        onComplete: () => { heading.dataset.revealDone = "1"; }
      });
    });
  };

  const runSplitAnimation = (elements, config = ANIM_CONFIG.preloader.text) => {
    if (!elements.length) return;
    elements.forEach(el => {
      if (el.dataset.splitDone) return;
      const split = new SplitText(el, { type: "words, chars", charsClass: "st-char" });
      
      gsap.set(split.chars, { opacity: 0 });
      gsap.set(el, { autoAlpha: 1 }); // Rende visibile l'elemento solo dopo lo split

      gsap.to(split.chars, {
        opacity: 1,
        duration: config.duration,
        ease: config.ease,
        stagger: config.stagger,
        onComplete: () => { el.dataset.splitDone = "1"; }
      });
    });
  };

  const initBlinkAndEyebrows = () => {
    runSplitAnimation(DOM.eyebrows);
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
      const createFlash = (target) => {
        const tl = gsap.timeline();
        tl.to(target, { opacity: 1, filter: "brightness(2)", duration: 0.05, ease: "none" })
          .to(target, { opacity: 0.2, filter: "brightness(0.5)", duration: 0.05, ease: "none" })
          .to(target, { opacity: 1, filter: "brightness(1)", duration: 0.1, ease: "none" });
        return tl;
      };
      const doBurst = () => {
        const tl = gsap.timeline({ delay: index * 0.1 });
        for (let i = 0; i < Math.min(30, chars.length * 2); i++) {
          tl.add(createFlash(chars[gsap.utils.random(0, chars.length - 1, 1)]), gsap.utils.random(0, 0.6));
        }
        tl.to(chars, { opacity: 1, filter: "brightness(1)", duration: 0.5, stagger: 0.01, ease: "power2.out" }, 0.5);
      };
      doBurst();
    });
  };

  const runAllEntryAnimations = () => {
    initBlinkAndEyebrows();
    initMaskTextReveal();
  };

  /* ==========================================================================
   * TRANSITIONS LOGIC
   * ========================================================================== */
  const shouldInterceptLink = (a) => {
    if (!a || (a.target && a.target !== "_self") || a.hasAttribute("download")) return false;
    const href = a.getAttribute("href");
    if (!href || href.startsWith("#") || href.startsWith("mailto:") || href.startsWith("tel:")) return false;
    try {
      const url = new URL(a.href, window.location.origin);
      return url.hostname === window.location.hostname;
    } catch (e) { return false; }
  };

  const handlePageLoadTransition = () => {
    if (!DOM.overlay) return false;
    if (sessionStorage.getItem(STORAGE_KEYS.PENDING) === "1") {
      sessionStorage.removeItem(STORAGE_KEYS.PENDING);
      gsap.fromTo(DOM.overlay, 
        { opacity: 1, display: "block", pointerEvents: "all" },
        { 
          opacity: 0, 
          duration: ANIM_CONFIG.pageTransition.out, 
          ease: ANIM_CONFIG.pageTransition.ease,
          onStart: runAllEntryAnimations,
          onComplete: () => gsap.set(DOM.overlay, { display: "none", pointerEvents: "none" })
        }
      );
      return true;
    }
    return false;
  };

  const handleInternalLinkClick = (e) => {
    const link = e.target.closest("a");
    if (isAnimationRunning || !shouldInterceptLink(link)) return;
    e.preventDefault();
    sessionStorage.setItem(STORAGE_KEYS.PENDING, "1");
    gsap.to(DOM.overlay, {
      display: "block", opacity: 1, duration: ANIM_CONFIG.pageTransition.in,
      ease: ANIM_CONFIG.pageTransition.ease, pointerEvents: "all",
      onComplete: () => { window.location.href = link.href; }
    });
  };

  /* ==========================================================================
   * MAIN INITIALIZATION
   * ========================================================================== */
  const init = () => {
    const hasRequiredUI = DOM.preloader && UI.count && UI.lineFill;
    const hasSeenPreloader = sessionStorage.getItem(STORAGE_KEYS.SEEN) === "1";

    document.addEventListener("click", handleInternalLinkClick);

    if (hasRequiredUI && !hasSeenPreloader) {
      isAnimationRunning = true;
      
      // SETUP INIZIALE (Reset e preparazione per evitare flash)
      gsap.set(DOM.preloader, { display: "flex", opacity: 1 });
      gsap.set(UI.lineFill, { scaleX: 0, transformOrigin: "left center" });
      gsap.set(UI.count, { opacity: 1 }); // Lo mostriamo solo ora che siamo pronti a contare
      if (DOM.heroTab) gsap.set(DOM.heroTab, { opacity: 0 });
      
      images.forEach((img, i) => {
        img.style.zIndex = i + 1;
        gsap.set(img, { clipPath: "inset(0 0 100% 0)" });
      });

      // TIMELINE PRELOADER
      const C = ANIM_CONFIG.preloader;
      const tl = gsap.timeline({ defaults: { ease: C.clipEase } });
      const endAt = C.durationMs / 1000;

      // 1. Animazione Counter e Linea
      tl.to({ val: 0 }, {
        val: 100, duration: endAt, ease: "none",
        onUpdate: function() {
          const p = this.targets()[0].val | 0;
          UI.count.textContent = p;
          gsap.set(UI.lineFill, { scaleX: p / 100 });
        }
      }, 0);

      // 2. Animazione Testo "Loading" (SplitText)
      if (UI.text) {
        tl.add(() => runSplitAnimation([UI.text]), 0);
      }

      // 3. Immagini centrali
      images.forEach((img, i) => {
        tl.to(img, { clipPath: "inset(0 0 0% 0)", duration: C.open.duration }, C.clipDelay + (i * C.open.stagger));
      });

      // 4. Fade out UI (linea, count, testo)
      tl.to([UI.lineWrap, UI.count, UI.text].filter(Boolean), { opacity: 0, duration: C.uiFade }, endAt - 0.1);

      // 5. Chiusura immagini
      [...images].reverse().forEach((img, i) => {
        tl.to(img, { clipPath: "inset(0 0 100% 0)", duration: C.close.duration }, endAt + (i * C.close.stagger));
      });

      const fadeOutStartTime = endAt + (C.close.stagger * (images.length - 1)) + C.close.duration + 0.06;

      // 6. Uscita finale e avvio animazioni pagina
      tl.call(runAllEntryAnimations, null, fadeOutStartTime);
      if (DOM.heroTab) tl.to(DOM.heroTab, { opacity: 1, duration: 1 }, fadeOutStartTime);
      
      tl.to(DOM.preloader, { opacity: 0, duration: C.out.duration, ease: C.out.ease }, fadeOutStartTime);
      tl.set(DOM.preloader, { display: "none" }).add(() => {
        sessionStorage.setItem(STORAGE_KEYS.SEEN, "1");
        isAnimationRunning = false;
      });

    } else {
      // Se il preloader non serve, puliamo tutto
      if (DOM.preloader) DOM.preloader.style.display = "none";
      if (DOM.heroTab) gsap.set(DOM.heroTab, { opacity: 1 });
      const isTransitioning = handlePageLoadTransition();
      if (!isTransitioning) runAllEntryAnimations();
    }
  };

  // Fix BFCache
  window.addEventListener("pageshow", (e) => {
    if (e.persisted) {
      isAnimationRunning = false;
      sessionStorage.removeItem(STORAGE_KEYS.PENDING);
      if (DOM.overlay) gsap.set(DOM.overlay, { opacity: 0, display: "none" });
      DOM.headings.forEach(h => delete h.dataset.revealDone);
      runAllEntryAnimations();
    }
  });

  init();
})();
