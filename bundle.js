(() => {
  if (!window.gsap) return;

  /* ==========================================================================
   * CONFIGURATION & STYLES INJECTION
   * ========================================================================== */
  const STORAGE_KEYS = { SEEN: "preloader_seen_session", PENDING: "page_transition_pending" };
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
    pageTransition: { in: 0.6, out: 0.6, ease: "sine.inOut" },
    reveal: { duration: 0.8, stagger: 0.15, ease: "power2.out" }
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
    revealElements: selectAll("[data-reveal]"),
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
   * INITIAL STATE (NO-CSS ARCHITECTURE)
   * ========================================================================== */
  const setInitialStyles = () => {
    // Nascondiamo subito gli elementi reveal
    if (DOM.revealElements.length) {
      gsap.set(DOM.revealElements, { autoAlpha: 0, y: 20 });
    }
    
    // Prepariamo l'overlay di transizione
    if (DOM.overlay) {
      gsap.set(DOM.overlay, { 
        position: "fixed", inset: 0, backgroundColor: "#000", 
        zIndex: 2147483646, display: "none", autoAlpha: 0 
      });
    }

    // Prepariamo il preloader se esiste
    if (DOM.preloader) {
      gsap.set(DOM.preloader, { 
        position: "fixed", inset: 0, backgroundColor: "#000", 
        zIndex: 2147483647, display: "none", autoAlpha: 0 
      });
    }
  };

  setInitialStyles();

  /* ==========================================================================
   * LOGIC: BLINK & REVEAL
   * ========================================================================== */
  const initBlinkEffect = () => {
    // Animazione REVEAL (JS Only trigger)
    if (DOM.revealElements.length > 0) {
      gsap.to(DOM.revealElements, {
        autoAlpha: 1,
        y: 0,
        duration: ANIM_CONFIG.reveal.duration,
        stagger: ANIM_CONFIG.reveal.stagger,
        ease: ANIM_CONFIG.reveal.ease,
        overwrite: "auto"
      });
    }

    // Animazione BLINK TEXT
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

      const createFlash = (target) => {
        const tl = gsap.timeline();
        tl.to(target, { opacity: 1, filter: "brightness(2)", duration: 0.05, ease: "none" })
          .to(target, { opacity: 0.2, filter: "brightness(0.5)", duration: 0.05, ease: "none" })
          .to(target, { opacity: 1, filter: "brightness(1)", duration: 0.1, ease: "none" });
        return tl;
      };

      const doBurst = () => {
        if (hoverTL) hoverTL.kill();
        const tl = gsap.timeline({ delay: index * 0.1 });
        const flashesCount = Math.min(30, chars.length * 2); 
        for (let i = 0; i < flashesCount; i++) {
          tl.add(createFlash(chars[gsap.utils.random(0, chars.length - 1, 1)]), gsap.utils.random(0, 0.6));
        }
        tl.to(chars, { opacity: 1, filter: "brightness(1)", duration: 0.5, stagger: 0.01, ease: "power2.out" }, 0.5);
      };

      doBurst();
      el.addEventListener("mouseenter", () => {
        if (hoverTL) hoverTL.kill();
        hoverTL = gsap.timeline({ repeat: -1 });
        for (let i = 0; i < 5; i++) {
          hoverTL.add(createFlash(chars[gsap.utils.random(0, chars.length - 1, 1)]), gsap.utils.random(0, 1.5));
        }
      }, { passive: true });
      
      el.addEventListener("mouseleave", () => {
        if (hoverTL) hoverTL.kill();
        gsap.to(chars, { opacity: 1, filter: "brightness(1)", duration: 0.3 });
      }, { passive: true });
    });
  };

  /* ==========================================================================
   * TRANSITIONS & LINK INTERCEPTION
   * ========================================================================== */
  const handlePageLoadTransition = (onAnimationStart) => {
    if (!DOM.overlay || sessionStorage.getItem(STORAGE_KEYS.PENDING) !== "1") return false;
    sessionStorage.removeItem(STORAGE_KEYS.PENDING);
    gsap.fromTo(DOM.overlay, { autoAlpha: 1, display: "block" }, {
      autoAlpha: 0, duration: ANIM_CONFIG.pageTransition.out, ease: ANIM_CONFIG.pageTransition.ease,
      onStart: onAnimationStart,
      onComplete: () => gsap.set(DOM.overlay, { display: "none" })
    });
    return true;
  };

  const handleInternalLinkClick = (e) => {
    if (isAnimationRunning) return;
    const a = e.target.closest("a");
    if (!a || a.target === "_blank" || a.hasAttribute("download") || !a.href.includes(location.hostname)) return;
    
    e.preventDefault();
    sessionStorage.setItem(STORAGE_KEYS.PENDING, "1");
    gsap.to(DOM.overlay, { display: "block", autoAlpha: 1, duration: ANIM_CONFIG.pageTransition.in, onComplete: () => location.href = a.href });
  };

  /* ==========================================================================
   * MAIN INIT
   * ========================================================================== */
  const init = () => {
    const hasPreloaderUI = DOM.preloader && UI.count && images.length > 0;
    const alreadySeen = sessionStorage.getItem(STORAGE_KEYS.SEEN) === "1";

    if (DOM.overlay) document.addEventListener("click", handleInternalLinkClick);

    if (hasPreloaderUI && !alreadySeen) {
      isAnimationRunning = true;
      gsap.set(DOM.preloader, { display: "flex", autoAlpha: 1 });
      
      // Setup Immagini (clip-path via JS)
      images.forEach((img, i) => {
        img.style.position = "absolute";
        img.style.inset = "0";
        img.style.objectFit = "cover";
        img.style.zIndex = i + 1;
        gsap.set(img, { clipPath: "inset(0 0 100% 0)" });
      });

      const tl = gsap.timeline({ 
        onComplete: () => {
          sessionStorage.setItem(STORAGE_KEYS.SEEN, "1");
          isAnimationRunning = false;
        }
      });

      const prog = { val: 0 };
      tl.to(prog, { val: 100, duration: ANIM_CONFIG.preloader.durationMs/1000, ease: "none", 
        onUpdate: () => {
          UI.count.textContent = Math.floor(prog.val);
          gsap.set(UI.lineFill, { scaleX: prog.val / 100 });
        }
      }, 0);

      images.forEach((img, i) => {
        tl.to(img, { clipPath: "inset(0 0 0% 0)", duration: 0.3 }, 0.2 + (i * 0.2));
      });

      const end = ANIM_CONFIG.preloader.durationMs/1000;
      tl.to([UI.lineWrap, UI.count, UI.text], { autoAlpha: 0, duration: 0.3 }, end - 0.2);
      
      [...images].reverse().forEach((img, i) => {
        tl.to(img, { clipPath: "inset(100% 0 0 0)", duration: 0.4 }, end + (i * 0.2));
      });

      tl.call(initBlinkEffect, null, ">");
      tl.to(DOM.preloader, { autoAlpha: 0, duration: 0.6, display: "none" });

    } else {
      if (DOM.preloader) DOM.preloader.style.display = "none";
      if (!handlePageLoadTransition(initBlinkEffect)) initBlinkEffect();
    }
  };

  // Supporto BFCache (Back button)
  window.addEventListener("pageshow", (e) => { if (e.persisted) location.reload(); });

  window.addEventListener("DOMContentLoaded", init);
})();
