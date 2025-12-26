(() => {
  if (!window.gsap || !window.SplitText) return;

  /* ==========================================================================
   * CONFIGURATION & CONSTANTS
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
    // Nuova configurazione per il Reveal
    reveal: {
      lines: { duration: 0.8, stagger: 0.08 },
      words: { duration: 0.6, stagger: 0.06 },
      chars: { duration: 0.4, stagger: 0.01 }
    }
  };

  const DOM = {
    preloader: document.querySelector(".preloader"),
    wrap: document.querySelector("[data-load-wrap]"),
    overlay: document.querySelector(".page-transition"),
    blinkTexts: Array.from(document.querySelectorAll("[data-blink-text]")),
    eyebrows: Array.from(document.querySelectorAll("[data-eyebrow]")),
    headings: Array.from(document.querySelectorAll('[data-split="heading"]')), // Nuovi target
    heroTab: document.querySelector(".hero__tab-wrap"),
  };

  /* ==========================================================================
   * ANIMATION: MASK TEXT REVEAL (Sostituisce ScrollTrigger)
   * ========================================================================== */
  const initMaskTextReveal = () => {
    DOM.headings.forEach(heading => {
      if (heading.dataset.revealDone) return;

      gsap.set(heading, { autoAlpha: 1 });

      const type = heading.dataset.splitReveal || 'lines';
      const typesToSplit = type === 'lines' ? 'lines' : (type === 'words' ? 'lines,words' : 'lines,words,chars');

      const split = new SplitText(heading, {
        type: typesToSplit,
        linesClass: "line-parent" // Necessario per l'effetto maschera (overflow hidden)
      });

      // Se vogliamo l'effetto maschera, dobbiamo avvolgere le linee
      // Nota: SplitText ha bisogno di un secondo passaggio o di CSS per l'overflow hidden
      split.lines.forEach(line => {
        const wrapper = document.createElement('div');
        wrapper.style.overflow = 'hidden';
        line.parentNode.insertBefore(wrapper, line);
        wrapper.appendChild(line);
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
   * OTHER ANIMATIONS (Blink, Eyebrows, etc.)
   * ========================================================================== */
  // ... (Mantieni runSplitAnimation e initBlinkAndEyebrows dal tuo codice originale)
  
  const runAllEntryAnimations = () => {
    initBlinkAndEyebrows(); // Effetto blink
    initMaskTextReveal();   // Il tuo nuovo effetto reveal (senza scroll)
  };

  /* ==========================================================================
   * LOGIC: TRANSITIONS & BFCACHE
   * ========================================================================== */
  
  // Modifica la funzione di caricamento pagina
  const handlePageLoadTransition = () => {
    if (!DOM.overlay) return false;
    if (sessionStorage.getItem(STORAGE_KEYS.PENDING) === "1") {
      sessionStorage.removeItem(STORAGE_KEYS.PENDING);
      gsap.fromTo(DOM.overlay, 
        { opacity: 1, display: "block" },
        { 
          opacity: 0, 
          duration: ANIM_CONFIG.pageTransition.out, 
          ease: ANIM_CONFIG.pageTransition.ease,
          onStart: runAllEntryAnimations, // Parte al via della transizione
          onComplete: () => gsap.set(DOM.overlay, { display: "none" })
        }
      );
      return true;
    }
    return false;
  };

  // Fix per tasto indietro
  window.addEventListener("pageshow", (e) => {
    if (e.persisted) {
      DOM.headings.forEach(h => delete h.dataset.revealDone);
      runAllEntryAnimations();
    }
  });

  /* ==========================================================================
   * MAIN INITIALIZATION
   * ========================================================================== */
  const init = () => {
    const UI = DOM.preloader ? {
      count: DOM.preloader.querySelector("[data-count]"),
      lineFill: DOM.preloader.querySelector(".line__animate"),
      // ...altri elementi UI
    } : {};
    
    const images = DOM.wrap ? Array.from(DOM.wrap.querySelectorAll("[data-load-img]")) : [];
    const hasSeenPreloader = sessionStorage.getItem(STORAGE_KEYS.SEEN) === "1";

    document.addEventListener("click", handleInternalLinkClick); // (Mantieni la tua funzione originale)

    if (DOM.preloader && images.length && !hasSeenPreloader) {
      // LOGICA PRELOADER (Identica alla tua, ma cambia il trigger finale)
      // ... (Tutta la tua timeline del preloader) ...
      
      // Al termine del preloader:
      tl.call(runAllEntryAnimations, null, fadeOutStartTime); 
      
    } else {
      if (DOM.preloader) DOM.preloader.style.display = "none";
      const isTransitioning = handlePageLoadTransition();
      if (!isTransitioning) runAllEntryAnimations();
    }
  };

  init();
})();
