(() => {
  const STORAGE_KEY = "preloader_seen_session";
  const MIN_SHOW_MS = 350;    // rapidissimo, evita flash
  const MAX_SHOW_MS = 2200;   // safety cap: non blocca mai troppo

  const preloader = document.querySelector(".preloader");
  if (!preloader) return;

  const countEl = preloader.querySelector("[data-count]");
  const lineWrap = preloader.querySelector(".preloader__line");
  const lineFill = preloader.querySelector(".line__animate");
  if (!countEl || !lineWrap || !lineFill) return;

  // Solo prima volta per sessione (finché il tab/browser resta aperto)
  if (sessionStorage.getItem(STORAGE_KEY) === "1") {
    preloader.style.display = "none";
    preloader.style.opacity = "0";
    return;
  }

  // Init
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
    countEl.style.transform = "translateY(0px)";
    lineWrap.style.transform = "translateY(0px)";
  }

  // Gate veloce: DOM ready
  const domReady =
    document.readyState !== "loading"
      ? Promise.resolve()
      : new Promise((res) =>
          document.addEventListener("DOMContentLoaded", res, { once: true })
        );

  // Traccia SOLO immagini sopra il fold (più veloce, più UX-friendly)
  const imgs = Array.from(document.images || []).filter((img) => {
    const r = img.getBoundingClientRect();
    return r.top < window.innerHeight * 1.2;
  });

  let done = 0;
  const total = Math.max(1, imgs.length) + 1; // +1 per domReady

  const markDone = () => {
    done = Math.min(total, done + 1);
  };

  domReady.then(markDone);

  if (imgs.length) {
    imgs.forEach((img) => {
      if (img.complete && img.naturalWidth > 0) {
        markDone();
      } else {
        const onDone = () => markDone();
        img.addEventListener("load", onDone, { once: true });
        img.addEventListener("error", onDone, { once: true });
      }
    });
  }

  // Sblocco extra se qualche immagine tarda troppo (non bloccare mai UX)
  const earlyReleaseTimer = setTimeout(markDone, 550);

  // Smooth progress loop
  const tStart = performance.now();
  let displayed = 0;
  let finished = false;

  const clamp = (n, a, b) => Math.min(b, Math.max(a, n));
  const lerp = (a, b, t) => a + (b - a) * t;

  function tick() {
    if (finished) return;

    const now = performance.now();
    const elapsed = now - tStart;

    const rawTarget = (done / total) * 100; // progress reale (veloce)
    const timeGate = clamp((elapsed / MIN_SHOW_MS) * 100, 0, 100);

    // Lascia correre: sempre fluido, ma non “spara” a 100 subito
    const target = clamp(Math.max(rawTarget, timeGate), 0, 99.5);
    displayed = lerp(displayed, target, 0.12);

    const pct = Math.floor(displayed);
    countEl.textContent = pct;

    const scaleX = pct / 100;
    if (hasGSAP) gsap.set(lineFill, { scaleX });
    else lineFill.style.transform = `scaleX(${scaleX})`;

    const allDone = done >= total && elapsed >= MIN_SHOW_MS;
    const safety = elapsed >= MAX_SHOW_MS;

    if (allDone || safety) {
      clearTimeout(earlyReleaseTimer);
      finish();
      return;
    }

    requestAnimationFrame(tick);
  }

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
            ease: "power3.out",
          },
          "+=0.10"
        )
        .to(
          preloader,
          {
            opacity: 0,
            duration: 0.9,
            ease: "power2.out",
          },
          "<+=0.10"
        )
        .set(preloader, { display: "none" });
    } else {
      // Fallback smooth senza GSAP
      lineFill.style.transform = "scaleX(1)";

      lineWrap.style.willChange = "opacity, transform";
      countEl.style.willChange = "opacity, transform";
      preloader.style.willChange = "opacity";

      const e1 = "cubic-bezier(.16,1,.3,1)";
      const e2 = "cubic-bezier(.22,1,.36,1)";

      lineWrap.style.transition = `opacity 550ms ${e1}, transform 550ms ${e1}`;
      countEl.style.transition = `opacity 550ms ${e1}, transform 550ms ${e1}`;
      preloader.style.transition = `opacity 900ms ${e2}`;

      setTimeout(() => {
        lineWrap.style.opacity = "0";
        countEl.style.opacity = "0";
        lineWrap.style.transform = "translateY(-6px)";
        countEl.style.transform = "translateY(-6px)";

        setTimeout(() => {
          preloader.style.opacity = "0";
          setTimeout(() => {
            preloader.style.display = "none";
          }, 920);
        }, 120);
      }, 100);
    }

    sessionStorage.setItem(STORAGE_KEY, "1");
  }

  requestAnimationFrame(tick);
})();
