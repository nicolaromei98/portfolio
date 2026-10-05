/**
 * Archive – Hover Effects (solo desktop)
 * Includes: Directional List Hover, Image Reveal on hover
 */

document.addEventListener("DOMContentLoaded", () => {
  // Solo dispositivi con hover reale (mouse/trackpad): su touch non parte nulla
  if (!window.matchMedia("(hover: hover) and (pointer: fine)").matches) return;

  initDirectionalListHover();
  initImageReveal();
});


// --- 1. DIRECTIONAL LIST HOVER ---
function initDirectionalListHover() {
  const directionMap = {
    top: "translateY(-100%)",
    bottom: "translateY(100%)",
    left: "translateX(-100%)",
    right: "translateX(100%)"
  };

  const getDirection = (event, el, type) => {
    const { left, top, width: w, height: h } = el.getBoundingClientRect();
    const x = event.clientX - left;
    const y = event.clientY - top;

    if (type === "y") return y < h / 2 ? "top" : "bottom";
    if (type === "x") return x < w / 2 ? "left" : "right";

    const distances = { top: y, right: w - x, bottom: h - y, left: x };
    return Object.entries(distances).reduce((a, b) => (a[1] < b[1] ? a : b))[0];
  };

  document.querySelectorAll("[data-directional-hover]").forEach((container) => {
    const type = container.getAttribute("data-type") || "all";

    container.querySelectorAll("[data-directional-hover-item]").forEach((item) => {
      const tile = item.querySelector("[data-directional-hover-tile]");
      if (!tile) return;

      item.addEventListener("mouseenter", (e) => {
        const dir = getDirection(e, item, type);
        tile.style.transition = "none";
        tile.style.transform = directionMap[dir] || "translate(0, 0)";
        void tile.offsetHeight;
        tile.style.transition = "";
        tile.style.transform = "translate(0%, 0%)";
        item.setAttribute("data-status", `enter-${dir}`);
      });

      item.addEventListener("mouseleave", (e) => {
        const dir = getDirection(e, item, type);
        item.setAttribute("data-status", `leave-${dir}`);
        tile.style.transform = directionMap[dir] || "translate(0, 0)";
      });
    });
  });
}


// --- 2. IMAGE REVEAL (hover su [data-item] → [data-img] con lo stesso slug) ---
function initImageReveal() {
  const items = document.querySelectorAll("[data-item]");
  const imgs = document.querySelectorAll("[data-img]");
  if (!items.length || !imgs.length) return;

  const list = imgs[0].parentElement;
  // Precarica tutte le immagini, così il reveal non parte mai su un'immagine vuota
  imgs.forEach((el) => el.querySelectorAll("img").forEach((img) => (img.loading = "eager")));

  let layers = []; // dal basso verso l'alto
  let topSlug = imgs[0].dataset.img;

  const makeLayer = (src) => {
    const layer = src.cloneNode(true);
    layer.removeAttribute("data-img");
    layer.classList.add("img-layer");
    list.appendChild(layer);
    return layer;
  };

  // Base iniziale: prima immagine già piena
  const base = makeLayer(imgs[0]);
  base.classList.add("is-base");
  layers.push(base);

  const show = (slug) => {
    if (slug === topSlug) return;
    const src = list.querySelector(`[data-img="${slug}"]`);
    if (!src) return;
    topSlug = slug;

    const layer = makeLayer(src);
    layers.push(layer);
    void layer.offsetWidth;        // parte da size 0
    layer.classList.add("is-in");  // si apre fino a piena

    // Quando è completamente aperto, rimuove i layer sotto (ormai coperti)
    const onEnd = (e) => {
      if (e.target !== layer || e.propertyName !== "clip-path") return;
      layer.removeEventListener("transitionend", onEnd);
      const i = layers.indexOf(layer);
      layers.slice(0, i).forEach((l) => l.remove());
      layers = layers.slice(i);
    };
    layer.addEventListener("transitionend", onEnd);
  };

  items.forEach((item) => {
    item.addEventListener("mouseenter", () => show(item.dataset.item));
  });
}
