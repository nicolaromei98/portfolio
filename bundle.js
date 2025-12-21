(() => {
  // Controllo librerie necessarie
  if (!window.gsap) {
    console.warn("GSAP non trovato. Assicurati di caricarlo prima di questo script.");
    return;
  }

  /* ==========================================================================
   * CONFIGURAZIONE
   * ========================================================================== */
  const STORAGE_KEYS = { SEEN: "preloader_seen_session" };
  
  // Selettori dinamici (da ricalcolare a ogni cambio pagina)
  const getDOM = () => ({
    preloader: document.querySelector(".preloader"),
    wrap: document.querySelector("[data-load-wrap]"),
    blinkTexts: document.querySelectorAll("[data-blink-text]"),
    revealElements: document.querySelectorAll("[data-reveal]"),
    images: document.querySelectorAll("[data-load-img]")
  });

  let lenis;
  let isAnimationRunning = false;

  /* ==========================================================================
   * SMOOTH SCROLL (LENIS)
   * ========================================================================== */
  const initLenis = () => {
    if (lenis) lenis.destroy();
    // Assicurati che la libreria Lenis sia caricata nel progetto
    if (window.Lenis) {
      lenis = new Lenis({ autoRaf: true, smoothWheel: true });
      const raf = (time) => { lenis.raf(time); requestAnimationFrame(raf); };
      requestAnimationFrame(raf);
    }
  };

  /* ==========================================================================
   * LOGIC: BLINK & REVEAL
   * ========================================================================== */
  const initEffects = () => {
    const DOM = getDOM();

    // 1. Reveal Elements (Opacity + Y movement)
    if (DOM.revealElements.length) {
      gsap.fromTo(DOM.revealElements, 
        { opacity: 0, y: 40 }, 
        { opacity: 1, y: 0, duration: 1.2, stagger: 0.1, ease: "power4.out", overwrite: "auto" }
      );
    }

    // 2. Blink Text Effect
    DOM.blinkTexts.forEach((el) => {
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

      const tl = gsap.timeline();
      for (let i = 0; i < Math.min(30, chars.length * 2); i++) {
        tl.add(createFlash(chars[gsap.utils.random(0, chars.length - 1, 1)]), gsap.utils.random(0, 0.6));
      }
      tl.to(chars, { opacity: 1, filter: "brightness(1)", duration: 0.5, stagger: 0.01 }, 0.5);
    });
  };

  /* ==========================================================================
   * NAVIGAZIONE: VIEW TRANSITIONS API (JS Only)
   * ========================================================================== */
  const handleNavigation = () => {
    // Se il browser non supporta l'API, la navigazione resta standard
    if (!document.startViewTransition) return;

    window.addEventListener("click", (e) => {
      const link = e.target.closest("a");
      if (!link || !link.href.includes(location.hostname) || link.target === "_blank" || link.hasAttribute("download")) return;
      
      // Escludi anchor link interni (#)
      if (link.getAttribute("href").startsWith("#")) return;

      e.preventDefault();

      document.startViewTransition(async () => {
        try {
          const response = await fetch(link.href);
          const text = await response.text();
          const nextHtml = new DOMParser().parseFromString(text, "text/html");
          
          // Cambio contenuti
          document.body.innerHTML = nextHtml.body.innerHTML;
          document.title = nextHtml.title;
          
          // Reset post-navigazione
          window.scrollTo(0, 0);
          initLenis();
          initEffects();
        } catch (err) {
          console.error("Errore nel caricamento pagina:", err);
          location.href = link.href; // Fallback in caso di errore fetch
        }
      });
    });
  };

  /* ==========================================================================
   * LOGICA PRELOADER
   * ========================================================================== */
  const runPreloader = (DOM) => {
    const UI = {
      count: document.querySelector("[data-count]"),
      lineFill: document.querySelector(".line__animate"),
    };

    isAnimationRunning = true;
    gsap.set(DOM.preloader, { display: "flex", opacity: 1, position: "fixed", inset: 0, zIndex: 9999 });
    
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

    DOM.images.forEach((img, i) => {
      gsap.set(img, { clipPath: "inset(0 0 100% 0)" });
      tl.to(img, { clipPath: "inset(0 0 0% 0)", duration: 0.3 }, 0.2 + (i * 0.2));
    });

    tl.to(DOM.preloader, { opacity: 0, duration: 0.6, ease: "sine.inOut" });
    tl.set(DOM.preloader, { display: "none" });
  };

  /* ==========================================================================
   * INITIALIZATION
   * ========================================================================== */
  const init = () => {
    const DOM = getDOM();
    initLenis();
    handleNavigation();

    const alreadySeen = sessionStorage.getItem(STORAGE_KEYS.SEEN) === "1";
    
    if (DOM.preloader && !alreadySeen && DOM.images.length > 0) {
      runPreloader(DOM);
    } else {
      if (DOM.preloader) DOM.preloader.style.display = "none";
      initEffects();
    }
  };

  // Avvio
  init();

  // Gestione BFCache (Back button)
  window.addEventListener("pageshow", (e) => {
    if (e.persisted) {
      initLenis();
      initEffects();
    }
  });

})();
