/**
 * ULTRA-FLUID NAVIGATION SYSTEM
 * Preloader + Navigation API + View Transitions + GSAP Synchronizer
 */

(() => {
  // Controllo compatibilità GSAP
  if (!window.gsap) return;

  /* ==========================================================================
   * 1. CONFIGURAZIONE E ELEMENTI
   * ========================================================================== */
  const STORAGE_KEYS = { SEEN: "preloader_seen_session" };

  // Utilizziamo getter per assicurarci di trovare gli elementi anche dopo il cambio DOM
  const DOM = {
    get preloader() { return document.querySelector(".preloader"); },
    get overlay() { return document.querySelector(".page-transition"); },
    get blinkTexts() { return document.querySelectorAll("[data-blink-text]"); },
    get count() { return document.querySelector("[data-count]"); },
    get lineFill() { return document.querySelector(".line__animate"); }
  };

  /* ==========================================================================
   * 2. LOGICA ANIMAZIONI (Sincronizzazione)
   * ========================================================================== */
  
  // Chiude il sipario prima di cambiare pagina
  const hidePage = () => {
    return gsap.to(DOM.overlay, {
      display: "block",
      opacity: 1,
      duration: 0.5,
      ease: "power2.inOut",
      pointerEvents: "all"
    });
  };

  // Apre il sipario dopo che la nuova pagina è pronta
  const showPage = () => {
    return gsap.fromTo(DOM.overlay, 
      { opacity: 1 },
      { 
        opacity: 0, 
        duration: 0.6, 
        ease: "sine.inOut",
        onComplete: () => gsap.set(DOM.overlay, { display: "none", pointerEvents: "none" }) 
      }
    );
  };

  /* ==========================================================================
   * 3. EFFETTO TIPOGRAFICO (BLINK)
   * ========================================================================== */
  const initBlinkEffect = () => {
    DOM.blinkTexts.forEach((el, index) => {
      if (el.dataset.wrapped) return;

      const raw = el.innerHTML.replace(/<br\s*\/?>/gi, "\n");
      el.innerHTML = raw.split("").map(ch => {
        if (ch === "\n") return "<br>";
        const safeChar = ch === " " ? "&nbsp;" : ch;
        return `<span class="blink-char" style="opacity:0; filter:brightness(0.5); display:inline-block; will-change:opacity, filter;">${safeChar}</span>`;
      }).join("");
      
      el.dataset.wrapped = "1";
      const chars = el.querySelectorAll(".blink-char");

      const tl = gsap.timeline({ delay: index * 0.1 });
      chars.forEach(char => {
        tl.to(char, { 
          opacity: 1, 
          filter: "brightness(1)", 
          duration: 0.05, 
          ease: "none" 
        }, gsap.utils.random(0, 0.5));
      });
    });
  };

  /* ==========================================================================
   * 4. NAVIGATION API & VIEW TRANSITIONS
   * ========================================================================== */
  const initModernNavigation = () => {
    if (!window.navigation) return;

    navigation.addEventListener("navigate", (event) => {
      const url = new URL(event.destination.url);

      // Filtri di sicurezza
      if (
        url.origin !== location.origin || 
        event.downloadRequest || 
        !event.canIntercept ||
        url.href === location.href
      ) return;

      event.intercept({
        handler: async () => {
          // A. Chiudi il sipario (Attendiamo che GSAP finisca)
          await hidePage();

          // B. Carica la nuova pagina
          const response = await fetch(url.href);
          const html = await response.text();
          const parser = new DOMParser();
          const nextDoc = parser.parseFromString(html, "text/html");

          // C. Scambio contenuto con View Transition API
          if (document.startViewTransition) {
            const transition = document.startViewTransition(() => {
              applyNewContent(nextDoc);
            });
            await transition.finished;
          } else {
            applyNewContent(nextDoc);
          }

          // D. Riavvio e Apertura
          reinitializeAll();
          showPage();
        }
      });
    });
  };

  const applyNewContent = (nextDoc) => {
    document.body.innerHTML = nextDoc.body.innerHTML;
    document.title = nextDoc.title;
    window.scrollTo(0, 0);
  };

  /* ==========================================================================
   * 5. GESTIONE PRELOADER (Primo Accesso)
   * ========================================================================== */
  const runPreloader = () => {
    const tl = gsap.timeline({
      onComplete: () => {
        sessionStorage.setItem(STORAGE_KEYS.SEEN, "1");
        gsap.to(DOM.preloader, { 
          opacity: 0, 
          duration: 0.8, 
          display: "none", 
          onComplete: () => {
            initBlinkEffect();
            showPage();
          }
        });
      }
    });

    if (DOM.lineFill) tl.to(DOM.lineFill, { scaleX: 1, duration: 1.5, ease: "power2.inOut" });
    if (DOM.count) tl.to(DOM.count, { innerText: 100, snap: { innerText: 1 }, duration: 1.5 }, 0);
  };

  /* ==========================================================================
   * 6. BOOTSTRAP
   * ========================================================================== */
  const reinitializeAll = () => {
    initBlinkEffect();
    // Inserisci qui altre init per scroll-trigger, lenis, etc.
  };

  const init = () => {
    const hasSeenPreloader = sessionStorage.getItem(STORAGE_KEYS.SEEN) === "1";

    if (DOM.preloader && !hasSeenPreloader) {
      // Setup iniziale preloader
      gsap.set(DOM.preloader, { display: "flex", opacity: 1 });
      runPreloader();
    } else {
      // Salta preloader
      if (DOM.preloader) DOM.preloader.style.display = "none";
      initBlinkEffect();
      // Se veniamo da un ricaricamento forzato, assicuriamoci che l'overlay sia via
      gsap.set(DOM.overlay, { display: "none", opacity: 0 });
    }

    initModernNavigation();
  };

  // Avvio al caricamento del DOM
  window.addEventListener("load", init);

  // Fix BFCache (tasto indietro)
  window.addEventListener("pageshow", (event) => {
    if (event.persisted) {
      gsap.set(DOM.overlay, { display: "none", opacity: 0 });
      reinitializeAll();
    }
  });

})();
