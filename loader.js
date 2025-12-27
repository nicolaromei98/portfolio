(() => {
  if (!window.gsap || !window.SplitText) return;

  /* ==========================================================================
   * CONFIGURAZIONE
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
   * ANIMAZIONE: MASK TEXT REVEAL
   * ========================================================================== */
  const initMaskTextReveal = () => {
    DOM.headings.forEach(heading => {
      if (heading.dataset.revealDone) return;
      
      gsap.set(heading, { autoAlpha: 1 });
      const type = heading.dataset.splitReveal || 'lines';
      const typesToSplit = type === 'lines' ? 'lines' : (type === 'words' ? 'lines,words' : 'lines,words,chars');

      const split = new SplitText(heading, {
        type: typesToSplit,
        linesClass: "split-line"
      });

      // Avvolge ogni linea per creare la maschera overflow:hidden
      split.lines.forEach(line => {
        const wrap = document.createElement('div');
        wrap.className = "line-mask";
        line.parentNode.insertBefore(wrap, line);
        wrap.appendChild(line);
      });

      const targets = split[type];
      const config = ANIM_CONFIG.reveal[type];

      gsap.from(targets, {
        yPercent: 110,
        duration: config.duration,
        stagger: config.stagger,
        ease: 'expo.out',
        onComplete: () => { heading.dataset.revealDone = "1"; }
      });
    });
  };

  /* ==========================================================================
   * ANIMAZIONE: BLINK & EYEBROWS
   * ========================================================================== */
  const runSplitAnimation = (elements, config = ANIM_CONFIG.preloader.text) => {
    elements.forEach(el => {
      if (el.dataset.splitDone) return;
      const split = new SplitText(el, { type: "words, chars", charsClass: "st-char" });
      gsap.set(split.chars, { opacity: 0 });
      gsap.to(split.chars, {
        opacity: 1, duration: config.duration, ease: config.ease, stagger: config.stagger,
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
          return `<span class="blink-char" style="opacity:0; filter:brightness(0.5); display:inline-block; will-change:opacity, filter;">${ch === " " ? "&nbsp;" : ch}</span>`;
        }).join("");
        el.dataset.wrapped = "1";
      }
      const chars = el.querySelectorAll(".blink-char");
      const tl = gsap.timeline({ delay: index * 0.1 });
      chars.forEach(char => {
        const flash = gsap.timeline();
        flash.to(char, { opacity: 1, filter: "brightness(2)", duration: 0.05 })
             .to(char, { opacity: 0.2, filter: "brightness(0.5)", duration: 0.05 })
             .to(char, { opacity: 1, filter: "brightness(1)", duration: 0.1 });
        tl.add(flash, gsap.utils.random(0, 0.6));
      });
      tl.to(chars, { opacity: 1, filter: "brightness(1)", duration: 0.5, stagger: 0.01 }, 0.5);
    });
  };

  const runAllEntryAnimations = () => {
    initBlinkAndEyebrows();
    initMaskTextReveal();
  };

  /* ==========================================================================
   * TRANSITIONS LOGIC
   * ========================================================================== */
  const handlePageLoadTransition = () => {
    if (!DOM.overlay || sessionStorage.getItem(STORAGE_KEYS.PENDING) !== "1") return false;
    sessionStorage.removeItem(STORAGE_KEYS.PENDING);
    gsap.fromTo(DOM.overlay, 
      { opacity: 1, display: "block" },
      { 
        opacity: 0, duration: ANIM_CONFIG.pageTransition.out, ease: ANIM_CONFIG.pageTransition.ease,
        onStart: runAllEntryAnimations,
        onComplete: () => gsap.set(DOM.overlay, { display: "none" })
      }
    );
    return true;
  };

  const handleInternalLinkClick = (e) => {
    const link = e.target.closest("a");
    if (!link || isAnimationRunning) return;
    const url = new URL(link.href, window.location.origin);
    if (url.hostname !== window.location.hostname || link.hash || link.target === "_blank") return;

    e.preventDefault();
    sessionStorage.setItem(STORAGE_KEYS.PENDING, "1");
    gsap.to(DOM.overlay, {
      display: "block", opacity: 1, duration: ANIM_CONFIG.pageTransition.in,
      onComplete: () => { window.location.href = link.href; }
    });
  };

  /* ==========================================================================
   * MAIN INIT
   * ========================================================================== */
  const init = () => {
    const hasSeenPreloader = sessionStorage.getItem(STORAGE_KEYS.SEEN) === "1";
    
    document.addEventListener("click", handleInternalLinkClick);

    if (DOM.preloader && images.length && !hasSeenPreloader) {
      isAnimationRunning = true;
      // Una volta iniziato, segniamolo subito come visto per evitare bug al refresh
      sessionStorage.setItem(STORAGE_KEYS.SEEN, "1");

      gsap.set(DOM.preloader, { display: "flex", opacity: 1 });
      gsap.set(UI.lineFill, { scaleX: 0, transformOrigin: "left center" });
      if (DOM.heroTab) gsap.set(DOM.heroTab, { opacity: 0 });
      images.forEach((img, i) => { 
        img.style.zIndex = i + 1; 
        gsap.set(img, { clipPath: "inset(0 0 100% 0)" });
      });

      const C = ANIM_CONFIG.preloader;
      const tl = gsap.timeline();
      const endAt = C.durationMs / 1000;

      tl.to({ v: 0 }, {
        v: 100, duration: endAt, ease: "none",
        onUpdate: function() {
          const p = Math.floor(this.targets()[0].v);
          UI.count.textContent = p;
          gsap.set(UI.lineFill, { scaleX: p / 100 });
        }
      }, 0);

      if (UI.text) tl.add(() => runSplitAnimation([UI.text]), 0);
      images.forEach((img, i) => {
        tl.to(img, { clipPath: "inset(0 0 0% 0)", duration: C.open.duration }, C.clipDelay + (i * C.open.stagger));
      });

      tl.to([UI.lineWrap, UI.count, UI.text].filter(Boolean), { opacity: 0, duration: C.uiFade }, endAt - 0.1);
      [...images].reverse().forEach((img, i) => {
        tl.to(img, { clipPath: "inset(0 0 100% 0)", duration: C.close.duration }, endAt + (i * C.close.stagger));
      });

      const fadeTime = endAt + (C.close.stagger * (images.length - 1)) + C.close.duration + 0.1;
      tl.call(runAllEntryAnimations, null, fadeTime);
      if (DOM.heroTab) tl.to(DOM.heroTab, { opacity: 1, duration: 1 }, fadeTime);
      tl.to(DOM.preloader, { opacity: 0, duration: C.out.duration }, fadeTime);
      tl.set(DOM.preloader, { display: "none" }).add(() => isAnimationRunning = false);

    } else {
      // Pulisci classi del preloader se già visto
      document.documentElement.classList.remove("is-loading-first-time");
      if (DOM.preloader) DOM.preloader.style.display = "none";
      if (DOM.heroTab) gsap.set(DOM.heroTab, { opacity: 1 });
      
      const isTransitioning = handlePageLoadTransition();
      if (!isTransitioning) runAllEntryAnimations();
    }
  };

  window.addEventListener("pageshow", (e) => {
    if (e.persisted) {
      sessionStorage.removeItem(STORAGE_KEYS.PENDING);
      gsap.set(DOM.overlay, { opacity: 0, display: "none" });
      DOM.headings.forEach(h => delete h.dataset.revealDone);
      runAllEntryAnimations();
    }
  });

  init();
})();
