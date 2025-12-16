(() => {
  const STORAGE_KEY = "preloader_seen_session";

  // =========================
  // CONFIG
  // =========================
  const DURATION_MS = 3800; // 3–4s (es. 3200–4200)
  const HOLD_PERCENT = 92;  // dove “aspetta” se il contenuto è già pronto

  // =========================
  // ELEMENTS
  // =========================
  const preloader = document.querySelector(".preloader");
  if (!preloader) return;

  const countEl = preloader.querySelector("[data-count]");
  const lineWrap = preloader.querySelector(".preloader__line");
  const lineFill = preloader.querySelector(".line__animate");
  if (!countEl || !lineWrap || !lineFill) return;

  // =========================
  // SESSION (solo prima volta)
  // =========================
  if (sessionStorage.getItem(STORAGE_KEY) === "1") {
    preloader.style.display = "none";
    preloader.style.opacity = "0";
    return;
  }

  // =========================
  // INIT
  // =========================
  preloader.style.display = "flex";
  preloader.style.opacity = "1";

  const hasGSAP = !!window.gsap;

  if (hasGSAP) {
    gsap.set(lineFill, { scaleX: 0, transformOrigin: "left center" });
    gsap.set([countEl, lineWrap], { opacity: 1, y: 0 });
  } else {
    lineFill.style.transformOrigin = "left center";
    lineFill.style.transform = "scaleX(0)";
    countEl.style.opacity = "1";
    lineWrap.style.opacity = "1";
  }

  // =========================
  // CONTENT READY (soft gate)
  // =========================
  let contentReady = false;

  if (document.readyState !== "loading") {
    contentReady = true;
  } else {
    document.addEventListener("DOMContentLoaded", () => {
      contentReady = true;
    }, { once: true });
  }

  // =========================
  // TIMED PROGRESS
  // =========================
  const start = performance.now();
  let displayed = 0;
  let finished = false;

  const clamp = (n, a, b) => Math.min(b, Math.max(a, n));
  const lerp = (a, b, t) => a + (b - a) * t;

  function tick(now) {
    if (finished) return;

    const elapsed = now - start;
    const t = clamp(elapsed / DURATION_MS, 0, 1);

    // progress guidato dal tempo
    let target = t * 100;

    // se il contenuto è già pronto, non fermarti
    // se NON è pronto, fermati elegantemente prima del 100
    if (!contentReady) {
      target = Math.min(target, HOLD_PERCENT);
    }

    displayed = lerp(displayed, target, 0.1);

    const pct = Math.floor(displayed);
    countEl.textContent = pct;

    const scaleX = pct / 100;
    if (hasGSAP) gsap.set(lineFill, { scaleX });
    else lineFill.style.transform = `scaleX(${scaleX})`;

    // fine naturale del timer
    if (elapsed >= DURATION_MS) {
      finish();
      return;
    }

    requestAnimationFrame(tick);
  }

  // =========================
  // FINISH (smooth dissolve)
  // =========================
  function finish() {
    finished = true;
    countEl.textContent = "100";

    if (hasGSAP) {
      const tl = gsap.timeline({ defaults: { ease: "expo.out" } });

      tl.to(lineFill, { scaleX: 1, duration: 0.25 })
        .to(
          [lineWrap, countEl],
          {
            opacity: 0,
            y: -6,
            duration: 0.55,
            ease: "power3.out"
          },
          "+=0.12"
        )
        .to(
          preloader,
          {
            opacity: 0,
            duration: 0.9,
            ease: "power2.out"
          },
          "<+=0.1"
        )
        .set(preloader, { display: "none" });

    } else {
      lineFill.style.transform = "scaleX(1)";
      lineWrap.style.transition = "opacity 550ms ease, transform 550ms ease";
      countEl.style.transition = "opacity 550ms ease, transform 550ms ease";
      preloader.style.transition = "opacity 900ms ease";

      setTimeout(() => {
        lineWrap.style.opacity = "0";
        countEl.style.opacity = "0";
        lineWrap.style.transform = "translateY(-6px)";
        countEl.style.transform = "translateY(-6px)";

        setTimeout(() => {
          preloader.style.opacity = "0";
          setTimeout(() => preloader.style.display = "none", 920);
        }, 120);
      }, 120);
    }

    sessionStorage.setItem(STORAGE_KEY, "1");
  }

  requestAnimationFrame(tick);
})();
