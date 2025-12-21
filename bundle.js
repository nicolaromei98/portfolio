/**
 * SISTEMA DI NAVIGAZIONE AVANZATO
 * Preloader (Session-based) + Navigation API + View Transitions + GSAP
 */

(() => {
  if (!window.gsap) return;

  /* ==========================================================================
   * CONFIGURAZIONE E STATO
   * ========================================================================== */
  const STORAGE_KEYS = { SEEN: "preloader_seen_session" };
  
  const DOM = {
    get preloader() { return document.querySelector(".preloader"); },
    get overlay() { return document.querySelector(".page-transition"); },
    get blinkTexts() { return document.querySelectorAll("[data-blink-text]"); },
    // Aggiungi qui altri elementi globali se necessario
  };

  let isNavigating = false;

  /* ==========================================================================
   * EFFETTI TIPOGRAFICI (BLINK)
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

      // Animazione iniziale a cascata (Burst)
      const tl = gsap.timeline({ delay: index * 0.1 });
      chars.forEach(char => {
        tl.to(char, { 
          opacity: 1, 
          filter: "brightness(1)", 
          duration: 0.1, 
          ease: "none" 
        }, gsap.utils.random(0, 0.5));
      });
    });
  };

  /* ==========================================================================
   * LOGICA PRELOADER (Solo primo avvio)
   * ========================================================================== */
  const runPreloader = () => {
    const preloader = DOM.preloader;
    if (!preloader) return;

    // Esempio animazione preloader (personalizzabile)
    const tl = gsap.timeline({
      onComplete: () => {
        sessionStorage.setItem(STORAGE_KEYS.SEEN, "1");
        gsap.to(preloader, { 
          opacity: 0, 
          duration: 0.8, 
          display: "none", 
          onComplete: initBlinkEffect 
        });
      }
    });

    tl.to(".preloader__line .line__animate", { scaleX: 1, duration: 2, ease: "power2.inOut" })
      .to("[data-count]", { innerText: 100, snap: { innerText: 1 }, duration: 2 }, 0);
  };

  /* ==========================================================================
   * NAVIGATION API & VIEW TRANSITIONS (Il "motore")
   * ========================================================================== */
  const initModernNavigation = () => {
    if (!window.navigation) {
      console.warn("Navigation API non supportata in questo browser.");
      return;
    }

    navigation.addEventListener("navigate", (event) => {
      const url = new URL(event.destination.url);

      // Filtri: solo link interni, no download, no stessa pagina
      if (
        url.origin !== location.origin || 
        event.downloadRequest || 
        !event.canIntercept || 
        url.href === location.href
      ) return;

      event.intercept({
        handler: async () => {
          isNavigating = true;

          // 1. Fetch della nuova pagina
          const response = await fetch(url.href);
          const html = await response.text();
          const parser = new DOMParser();
          const nextDoc = parser.parseFromString(html, "text/html");

          // 2. Esecuzione View Transition (se supportata)
          if (document.startViewTransition) {
            const transition = document.startViewTransition(() => {
              // Sostituzione atomica del contenuto
              document.body.innerHTML = nextDoc.body.innerHTML;
              document.title = nextDoc.title;
              window.scrollTo(0, 0);
            });

            await transition.finished;
          } else {
            // Fallback per browser vecchi
            document.body.innerHTML = nextDoc.body.innerHTML;
            document.title = nextDoc.title;
            window.scrollTo(0, 0);
          }

          // 3. Riavvio effetti sulla nuova pagina
          reinitPage();
          isNavigating = false;
        }
      });
    });
  };

  /* ==========================================================================
   * REINIZIALIZZAZIONE
   * ========================================================================== */
  const reinitPage = () => {
    initBlinkEffect();
    // Aggiungi qui altre funzioni GSAP che devono ripartire (es. ScrollTrigger)
    if (window.Lenis) {
       // Se usi Lenis, resetta lo scroll qui
    }
  };

  /* ==========================================================================
   * BOOTSTRAP
   * ========================================================================== */
  const init = () => {
    const hasSeenPreloader = sessionStorage.getItem(STORAGE_KEYS.SEEN) === "1";

    if (DOM.preloader && !hasSeenPreloader) {
      runPreloader();
    } else {
      if (DOM.preloader) DOM.preloader.style.display = "none";
      initBlinkEffect();
    }

    initModernNavigation();
  };

  // Esegui al caricamento
  if (document.readyState === "complete") init();
  else window.addEventListener("load", init);

  // Fix per il tasto "Indietro" del browser (BFCache)
  window.addEventListener("pageshow", (event) => {
    if (event.persisted) reinitPage();
  });

})();
