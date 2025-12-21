(() => {
  if (!window.gsap) return;

  /* ==========================================================================
   * CONFIGURAZIONE & SELETTORI
   * ========================================================================== */
  const STORAGE_KEYS = { SEEN: "preloader_seen_session" };
  
  const DOM = {
    preloader: document.querySelector(".preloader"),
    wrap: document.querySelector("[data-load-wrap]"),
    // Usiamo funzioni per i selettori così da trovarli anche dopo il cambio pagina
    blinkTexts: () => document.querySelectorAll("[data-blink-text]"),
    revealElements: () => document.querySelectorAll("[data-reveal]"),
  };

  const images = DOM.wrap ? Array.from(DOM.wrap.querySelectorAll("[data-load-img]")) : [];
  let isAnimationRunning = false;
  let lenis;

  /* ==========================================================================
   * SMOOTH SCROLL (LENIS)
   * ========================================================================== */
  const initLenis = () => {
    if (lenis) lenis.destroy();
    lenis = new Lenis({ autoRaf: true, smoothWheel: true });
    
    function raf(time) {
      lenis.raf(time);
      requestAnimationFrame(raf);
    }
    requestAnimationFrame(raf);
  };

  /* ==========================================================================
   * EFFETTI: BLINK & REVEAL
   * ========================================================================== */
  const initEffects = () => {
    // 1. Reveal Elements (Stagger)
    const reveals = DOM.revealElements();
    if (reveals.length) {
      gsap.fromTo(reveals, 
        { opacity: 0, y: 30 }, 
        { opacity: 1, y: 0, duration: 1, stagger: 0.15, ease: "power4.out", overwrite: "auto" }
      );
    }

    // 2. Blink Text Effect
    DOM.blinkTexts().forEach((el) => {
      if (el.dataset.wrapped) return;
      
      const raw = el.innerHTML.replace(/<br\s*\/?>/gi, "\n");
      el.innerHTML = raw.split("").map(ch => {
        if (ch === "\n") return "<br>";
        const safeChar = ch === " " ? "&nbsp;" : ch;
        return `<span class="blink-char" style="opacity:0; filter:brightness(0.5); display:inline-block; will-change:opacity, filter;">${safeChar}</span>`;
      }).join("");
      el.dataset.wrapped = "1";

      const chars = el.querySelectorAll(".blink-char");
      
      const createFlash = (target) => {
        return gsap.timeline()
          .to(target, { opacity: 1, filter: "brightness(2)", duration: 0.05 })
          .to(target, { opacity: 0.2, filter: "brightness(0.5)", duration: 0.05 })
          .to(target, { opacity: 1, filter: "brightness(1)", duration: 0.1 });
      };

      // Burst iniziale
      const tl = gsap.timeline();
      for (let i = 0; i < Math.min(30, chars.length * 2); i++) {
        tl.add(createFlash(chars[gsap.utils.random(0, chars.length - 1, 1)]), gsap.utils.random(0, 0.6));
      }
      tl.to(chars, { opacity: 1, filter: "brightness(1)", duration: 0.5, stagger: 0.01 }, 0.5);
    });
  };

  /* ==========================================================================
   * NAVIGAZIONE: VIEW TRANSITIONS API
   * ========================================================================== */
  const handleNavigation = () => {
    // Se il browser non supporta le View Transitions, usiamo il metodo classico
    if (!document.startViewTransition) return;

    window.addEventListener("click", (e) => {
      const link = e.target.closest("a");
      // Intercettiamo solo link interni, non download, non nuovi tab
      if (!link || !link.href.includes(location.hostname) || link.target === "_blank" || link.hasAttribute("download")) return;
      
      e.preventDefault();

      document.startViewTransition(async () => {
        // Carichiamo la nuova pagina in background
        const response = await fetch(link.href);
        const text = await response.text();
        const nextHtml = new DOMParser().parseFromString(text, "text/html");
        
        // Sostituiamo il contenuto
        document.body.innerHTML = nextHtml.body.innerHTML;
        document.title = nextHtml.title;
        
        // Reset e riavvio animazioni
        window.scrollTo(0, 0);
        initLenis();
        initEffects();
      });
    });
  };

  /* ==========================================================================
   * PRELOADER LOGIC
   * ========================================================================== */
  const runPreloader = () => {
    const UI = {
      count: document.querySelector("[data-count]"),
      lineFill: document.querySelector(".line__animate"),
    };

    isAnimationRunning = true;
    gsap.set(DOM.preloader, { display: "flex", opacity: 1 });
    
    const tl = gsap.timeline({
      onComplete: () => {
        sessionStorage.setItem(STORAGE_KEYS.SEEN, "1");
        isAnimationRunning = false;
        initEffects();
      }
    });

    const prog = { val: 0 };
    tl.to(prog, { val: 100, duration: 2.4, ease: "none", onUpdate: () => {
      if (UI.count) UI.count.textContent = Math.floor(prog.val);
      if (UI.lineFill) gsap.set(UI.lineFill, { scaleX: prog.val / 100 });
    }});

    images.forEach((img, i) => {
      gsap.set(img, { clipPath: "inset(0 0 100% 0)" });
      tl.to(img, { clipPath: "inset(0 0 0% 0)", duration: 0.3 }, 0.2 + (i * 0.2));
    });

    tl.to(DOM.preloader, { opacity: 0, duration: 0.6 });
    tl.set(DOM.preloader, { display: "none" });
  };

  /* ==========================================================================
   * INITIALIZATION
   * ========================================================================== */
  const init = () => {
    initLenis();
    handleNavigation();

    const alreadySeen = sessionStorage.getItem(STORAGE_KEYS.SEEN) === "1";
    if (DOM.preloader && !alreadySeen && images.length > 0) {
      runPreloader();
    } else {
      if (DOM.preloader) DOM.preloader.style.display = "none";
      initEffects();
    }
  };

  // Avvio al caricamento
  init();
  
  // Fix per il tasto "Back" del browser
  window.addEventListener("pageshow", (e) => { if (e.persisted) location.reload(); });

})();
