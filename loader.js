function initDynamicCurrentTime() {
  const defaultTimezone = "Europe/Amsterdam";

  // Helper function to format numbers with leading zero
  const formatNumber = (number) => number.toString().padStart(2, '0');

  // Function to create a time formatter with the correct timezone
  const createFormatter = (timezone) => {
    return new Intl.DateTimeFormat([], {
      timeZone: timezone,
      timeZoneName: 'short',
      hour: '2-digit',
      minute: '2-digit',
      second: '2-digit',
      hour12: false, // Optional: Remove to match your simpler script
    });
  };

  // Function to parse the formatted string into parts
  const parseFormattedTime = (formattedDateTime) => {
    const match = formattedDateTime.match(/(\d+):(\d+):(\d+)\s*([\w+]+)/);
    if (match) {
      return {
        hours: match[1],
        minutes: match[2],
        seconds: match[3],
        timezone: match[4], // Handles both GMT+X and CET cases
      };
    }
    return null;
  };

  // Function to update the time for all elements
  const updateTime = () => {
    document.querySelectorAll('[data-current-time]').forEach((element) => {
      const timezone = element.getAttribute('data-current-time') || defaultTimezone;
      const formatter = createFormatter(timezone);
      const now = new Date();
      const formattedDateTime = formatter.format(now);

      const timeParts = parseFormattedTime(formattedDateTime);
      if (timeParts) {
        const {
          hours,
          minutes,
          seconds,
          timezone
        } = timeParts;

        // Update child elements if they exist
        const hoursElem = element.querySelector('[data-current-time-hours]');
        const minutesElem = element.querySelector('[data-current-time-minutes]');
        const secondsElem = element.querySelector('[data-current-time-seconds]');
        const timezoneElem = element.querySelector('[data-current-time-timezone]');

        if (hoursElem) hoursElem.textContent = hours;
        if (minutesElem) minutesElem.textContent = minutes;
        if (secondsElem) secondsElem.textContent = seconds;
        if (timezoneElem) timezoneElem.textContent = timezone;
      }
    });
  };

  // Initial update and interval for subsequent updates
  updateTime();
  setInterval(updateTime, 1000);
}

// Initialize Dynamic Current Time
document.addEventListener('DOMContentLoaded', () => {
  initDynamicCurrentTime();
});
</script>

<script>
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
  };

  const UI = DOM.preloader ? {
    count: select("[data-count]", DOM.preloader),
    lineWrap: select(".preloader__line", DOM.preloader),
    lineFill: select(".line__animate", DOM.preloader),
    text: select("[data-load-text]", DOM.preloader),
  } : {};

  const images = DOM.wrap ? selectAll("[data-load-img]", DOM.wrap) : [];
  
  const hasRequiredUI = DOM.preloader && images.length && UI.count && UI.lineWrap && UI.lineFill;
  const hasSeenPreloader = sessionStorage.getItem(STORAGE_KEYS.SEEN) === "1";
  let isAnimationRunning = false;

  /* ==========================================================================
   * LOGIC: BLINK TEXT EFFECT
   * ========================================================================== */
  const initBlinkEffect = () => {
    DOM.blinkTexts.forEach((el, index) => {
      // 1. Setup Wrapper
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

      // 2. Helpers
      const settleAll = () => {
        return gsap.to(chars, { 
          opacity: 1, filter: "brightness(1)", duration: 0.5, stagger: 0.01, ease: "power2.out", overwrite: "auto" 
        });
      };

      const createFlash = (target) => {
        const tl = gsap.timeline();
        tl.to(target, { opacity: 1, filter: "brightness(2)", duration: 0.05, ease: "none" })
          .to(target, { opacity: 0.2, filter: "brightness(0.5)", duration: 0.05, ease: "none" })
          .to(target, { opacity: 1, filter: "brightness(1)", duration: 0.1, ease: "none" });
        return tl;
      };

      const getRandomChar = () => chars[gsap.utils.random(0, chars.length - 1, 1)];

      // 3. Main Animation (BURST)
      const doBurst = () => {
        if (hoverTL) hoverTL.kill();
        const tl = gsap.timeline({ delay: index * 0.1 });

        const flashesCount = Math.min(30, chars.length * 2); 
        for (let i = 0; i < flashesCount; i++) {
          tl.add(createFlash(getRandomChar()), gsap.utils.random(0, 0.6));
        }
        tl.add(settleAll(), 0.5);
      };

      // 4. Hover Effects
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

      // 5. Run Immediately
      doBurst();

      // 6. Events
      el.addEventListener("mouseenter", startHover, { passive: true });
      el.addEventListener("mouseleave", stopHover, { passive: true });
    });
  };

  /* ==========================================================================
   * PAGE TRANSITIONS
   * ========================================================================== */
  // Ritorna TRUE se sta gestendo una transizione (entrata nella pagina)
  const handlePageLoadTransition = (onAnimationStart) => {
    if (!DOM.overlay) return false;
    
    // Default state: overlay nascosto
    gsap.set(DOM.overlay, { opacity: 0, pointerEvents: "none" });

    // Se arriviamo da un link interno...
    if (sessionStorage.getItem(STORAGE_KEYS.PENDING) === "1") {
      sessionStorage.removeItem(STORAGE_KEYS.PENDING);
      
      // ...l'overlay parte visibile e sfuma a 0
      gsap.fromTo(DOM.overlay, 
        { opacity: 1 },
        { 
          opacity: 0, 
          duration: ANIM_CONFIG.pageTransition.out, 
          ease: ANIM_CONFIG.pageTransition.ease,
          overwrite: "auto",
          // PUNTO CHIAVE: Lancia l'effetto blink quando inizia il fade out
          onStart: () => {
             if (onAnimationStart) onAnimationStart();
          }
        }
      );
      return true; // Transizione attiva!
    }
    return false; // Nessuna transizione
  };

  const handleInternalLinkClick = (e) => {
    if (isAnimationRunning) return;
    const link = e.target.closest("a");
    if (!shouldInterceptLink(link)) return;

    e.preventDefault();
    sessionStorage.setItem(STORAGE_KEYS.PENDING, "1");

    gsap.to(DOM.overlay, {
      opacity: 1,
      duration: ANIM_CONFIG.pageTransition.in,
      ease: ANIM_CONFIG.pageTransition.ease,
      overwrite: "auto",
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
    // Se è la prima visita assoluta (preloader mai visto), non intercettiamo
    // perché il preloader gestisce l'entrata.
    if (sessionStorage.getItem(STORAGE_KEYS.SEEN) !== "1") return false;
    return true;
  };

  const initPageTransitions = () => {
    if (!DOM.overlay) return;
    // Nota: handlePageLoadTransition viene chiamato nella logica principale in fondo
    document.addEventListener("click", handleInternalLinkClick, { passive: false });
  };

  initPageTransitions();

  /* ==========================================================================
   * MAIN LOGIC & PRELOADER
   * ========================================================================== */
  
  // 1. Se dobbiamo mostrare il Preloader
  if (hasRequiredUI && !hasSeenPreloader) {
    isAnimationRunning = true;
    
    // --- Preloader Functions ---
    const setupInitialState = () => {
      Object.assign(DOM.preloader.style, { position: "fixed", inset: "0", zIndex: "2147483647", display: "flex", opacity: "1" });
      UI.count.textContent = "0";
      Object.assign(UI.lineFill.style, { transformOrigin: "left center", transform: "scaleX(0)" });
      images.forEach((img, i) => {
         img.style.zIndex = String(i + 1);
         gsap.set(img, { clipPath: "inset(0 0 100% 0)" });
      });
    };

    let splitInstance = null, splitChars = [];
    const setupPreloaderText = () => {
      if (!UI.text) return;
      UI.text.style.visibility = "hidden";
      if (window.SplitText) {
        splitInstance = new SplitText(UI.text, { type: "words, chars", charsClass: "st-char" });
        splitChars = splitInstance.chars || [];
        gsap.set(splitChars, { opacity: 0 });
      }
      UI.text.style.visibility = "visible";
    };

    const runPreloader = () => {
      const C = ANIM_CONFIG.preloader;
      const tl = gsap.timeline({ defaults: { ease: C.clipEase } });
      const endAt = C.durationMs / 1000;

      // ... Preloader Animation steps ...
      const progress = { val: 0 };
      tl.to(progress, {
        val: 100, duration: endAt, ease: "none",
        onUpdate: () => {
          const p = progress.val | 0;
          UI.count.textContent = p;
          gsap.set(UI.lineFill, { scaleX: p / 100 });
        }
      }, 0);

      if (splitChars.length) tl.to(splitChars, { opacity: 1, duration: C.text.duration, ease: C.text.ease, stagger: C.text.stagger }, 0); 
      images.forEach((img, i) => { tl.to(img, { clipPath: "inset(0 0 0% 0)", duration: C.open.duration }, C.clipDelay + (i * C.open.stagger)); });
      
      const uiElements = [UI.lineWrap, UI.count, UI.text].filter(Boolean);
      tl.to(uiElements, { opacity: 0, duration: C.uiFade, ease: "power2.out" }, endAt - 0.1);

      const reversedImages = [...images].reverse();
      reversedImages.forEach((img, i) => { tl.to(img, { clipPath: "inset(0 0 100% 0)", duration: C.close.duration }, endAt + (i * C.close.stagger)); });

      const totalCloseTime = (C.close.stagger * (reversedImages.length - 1)) + C.close.duration;
      const fadeOutStartTime = endAt + totalCloseTime + 0.06;

      // SYNC: Blink Text on Preloader Fade Out
      tl.call(initBlinkEffect, null, fadeOutStartTime);

      tl.to(DOM.preloader, { opacity: 0, duration: C.out.duration, ease: C.out.ease }, fadeOutStartTime);

      tl.set(DOM.preloader, { display: "none" })
        .add(() => {
          sessionStorage.setItem(STORAGE_KEYS.SEEN, "1");
          isAnimationRunning = false;
          if (splitInstance?.revert) splitInstance.revert();
        });
    };

    setupInitialState();
    setupPreloaderText();
    runPreloader();

  } else {
    // 2. Se NON mostriamo il Preloader (Visita successiva o Reload)
    
    if (DOM.preloader) DOM.preloader.style.display = "none";
    
    // Controlliamo se stiamo entrando da una transizione di pagina
    // Passiamo initBlinkEffect come callback
    const isTransitioning = handlePageLoadTransition(initBlinkEffect);

    // Se NON c'è una transizione in corso (es. semplice F5 refresh),
    // dobbiamo lanciare l'effetto immediatamente
    if (!isTransitioning) {
      initBlinkEffect();
    }
  }

})();
