/**
 * GSAP Unified Script - Part 2
 * Includes: Tab Switcher, Client Hover Preview, and Inertial Gallery
 */

document.addEventListener("DOMContentLoaded", () => {
  // Registrazione Plugin
  gsap.registerPlugin(CustomEase, ScrollTrigger);

  // Creazione Easing Personalizzati
  CustomEase.create("hop", "M0,0 C0.071,0.505 0.192,0.726 0.318,0.852 0.45,0.984 0.504,1 1,1");
  const easeClients = "cubic-bezier(.596, .002, 0, 1.002)";

  // --- 1. TAB SWITCHER (Gallery vs Clients) ---
  const btnGallery = document.querySelector('[data-control="gallery"]');
  const btnClients = document.querySelector('[data-control="clients"]');
  const galleryGroup = [
    document.querySelector('.gallery__container'),
    document.querySelector('[fallery]'),
    document.querySelector('.controls__left')
  ];
  const clientsGroup = [
    document.querySelector('.clients'),
    document.querySelector('[list]'),
    document.querySelector('.controls__right')
  ];

  const switchTab = (toShow, toHide) => {
    toHide.forEach(el => el?.classList.remove('active'));
    toShow.forEach(el => el?.classList.add('active'));
  };

  btnGallery?.addEventListener('click', () => switchTab(galleryGroup, clientsGroup));
  btnClients?.addEventListener('click', () => switchTab(clientsGroup, galleryGroup));


  // --- 2. CLIENTS REVEAL (MutationObserver) ---
  const clientsContainer = document.querySelector('.clients');
  const clientItems = document.querySelectorAll('.client-name .cn__wrap');

  gsap.set(clientItems, { y: "100%", opacity: 0 });

  const animateClientsIn = () => {
    gsap.to(clientItems, {
      y: "0%", opacity: 1, duration: 0.77, ease: easeClients, stagger: 0.05, overwrite: "auto"
    });
  };

  const animateClientsOut = () => {
    gsap.to(clientItems, {
      y: "100%", opacity: 0, duration: 0.5, ease: "power2.inOut", overwrite: "auto"
    });
  };

  const observer = new MutationObserver((mutations) => {
    mutations.forEach((mutation) => {
      if (mutation.attributeName === "class") {
        clientsContainer.classList.contains('active') ? animateClientsIn() : animateClientsOut();
      }
    });
  });

  if (clientsContainer) observer.observe(clientsContainer, { attributes: true });


  // --- 3. CLIENTS PREVIEW (Hover Image Reveal) ---
  const clientsPreview = document.querySelector(".clients-preview");
  const clientNames = document.querySelectorAll(".client-name");
  let activeClientIndex = -1;

  const cleanUpOldImages = () => {
    const allImages = clientsPreview?.querySelectorAll(".client-img-wrapper");
    if (allImages && allImages.length > 2) allImages[0].remove();
  };

  clientNames.forEach((client, index) => {
    client.addEventListener("mouseover", () => {
      if (activeClientIndex === index || !clientsPreview) return;
      activeClientIndex = index;

      const urlElement = client.querySelector(".cms-image-url");
      const imageUrl = urlElement?.textContent.trim();
      if (!imageUrl) return;

      const clientImgWrapper = document.createElement("div");
      clientImgWrapper.className = "client-img-wrapper";
      gsap.set(clientImgWrapper, {
        position: "absolute", top: 0, left: 0, width: "100%", height: "100%",
        overflow: "hidden", clipPath: "polygon(0% 0%, 100% 0%, 100% 0%, 0% 0%)"
      });

      const clientImg = document.createElement("img");
      clientImg.src = imageUrl;
      Object.assign(clientImg.style, { width: "100%", height: "100%", objectFit: "cover" });
      gsap.set(clientImg, { scale: 1.25 });

      clientImgWrapper.appendChild(clientImg);
      clientsPreview.appendChild(clientImgWrapper);

      gsap.to(clientImgWrapper, {
        clipPath: "polygon(0% 0%, 100% 0%, 100% 100%, 0% 100%)",
        duration: 0.5, ease: "hop", onComplete: cleanUpOldImages
      });

      gsap.to(clientImg, { scale: 1, duration: 1.25, ease: "hop" });
    });

    client.addEventListener("mouseout", (event) => {
      if (event.relatedTarget && event.relatedTarget.closest(".client-name")) return;
      activeClientIndex = -1;
      const allWrappers = clientsPreview?.querySelectorAll(".client-img-wrapper");
      if (allWrappers) {
        gsap.to(allWrappers, {
          opacity: 0, duration: 0.4, ease: "power2.out", onComplete: () => allWrappers.forEach(el => el.remove())
        });
      }
    });
  });


  // --- 4. INERTIAL GALLERY (Lerp & Scroll) ---
  const container = document.querySelector(".gallery__container");
  const itemsList = document.querySelector(".items");
  const indicator = document.querySelector(".indicator");
  const itemElements = document.querySelectorAll(".item");
  const previewContainer = document.querySelector(".img-preview");
  const itemImages = document.querySelectorAll(".item img");
  const galleryItems = document.querySelectorAll(".gallery__item");

  if (!container || !itemsList || !indicator || itemElements.length === 0) return;

  const CONFIG = { ease: "power4.inOut", duration: 1.0, clipRadius: "0.2em", sensitivity: 0.5, lerp: 0.07 };
  let isHorizontal = window.innerWidth <= 900;
  let dims = { itemSize: 0, containerSize: 0, indicatorSize: 0 };
  let maxTranslate = 0, currentTranslate = 0, targetTranslate = 0, isClickMove = false, currentImageIndex = -1, scrollTimeout;

  const lerp = (start, end, factor) => start + (end - start) * factor;

  function updateDimensions() {
    isHorizontal = window.innerWidth <= 900;
    const firstRect = itemElements[0].getBoundingClientRect();
    const indRect = indicator.getBoundingClientRect();
    dims = isHorizontal 
      ? { itemSize: firstRect.width, containerSize: itemsList.scrollWidth, indicatorSize: indRect.width }
      : { itemSize: firstRect.height, containerSize: itemsList.scrollHeight, indicatorSize: indRect.height };
    maxTranslate = dims.containerSize - dims.indicatorSize;
  }

  function updateActiveElements(index) {
    if (currentImageIndex === index) return;
    currentImageIndex = index;
    const activeSlug = itemElements[index].getAttribute("data-name");
    const targetImg = itemElements[index].querySelector("img");

    if (targetImg && previewContainer) {
      const oldImg = previewContainer.querySelector("img");
      const newImg = document.createElement("img");
      newImg.src = targetImg.src;
      if (targetImg.srcset) newImg.srcset = targetImg.srcset;
      Object.assign(newImg.style, { position: "absolute", top: "0", left: "0", width: "100%", height: "100%", objectFit: "cover", zIndex: "2" });
      
      gsap.set(newImg, { clipPath: `inset(50% round ${CONFIG.clipRadius})` });
      previewContainer.appendChild(newImg);
      gsap.to(newImg, {
        clipPath: `inset(0% round ${CONFIG.clipRadius})`, duration: CONFIG.duration, ease: CONFIG.ease,
        onComplete: () => { if (oldImg) oldImg.remove(); newImg.style.zIndex = "1"; }
      });
    }

    galleryItems.forEach((gItem) => {
      const isMatch = gItem.getAttribute("data-name") === activeSlug;
      gsap.to(gItem, { opacity: isMatch ? 1 : 0.5, duration: 0.6, ease: "power2.out" });
    });
  }

  function animateGallery() {
    currentTranslate = lerp(currentTranslate, targetTranslate, CONFIG.lerp);
    itemsList.style.transform = isHorizontal ? `translateX(${currentTranslate}px)` : `translateY(${currentTranslate}px)`;

    const indicatorCenter = (-currentTranslate) + (dims.indicatorSize / 2);
    let index = Math.floor(indicatorCenter / dims.itemSize);
    index = Math.max(0, Math.min(index, itemElements.length - 1));

    itemImages.forEach((img, i) => {
      const targetOp = (i === index) ? 0.3 : 1;
      const currentOp = parseFloat(img.style.opacity) || 1;
      img.style.opacity = lerp(currentOp, targetOp, 0.1);
    });

    updateActiveElements(index);
    requestAnimationFrame(animateGallery);
  }

  function snapToNearest() {
    const centerOffset = (dims.indicatorSize - dims.itemSize) / 2;
    const closestIndex = Math.round((targetTranslate - centerOffset) / -dims.itemSize);
    targetTranslate = Math.max(Math.min(-closestIndex * dims.itemSize + centerOffset, 0), -maxTranslate);
  }

  container.addEventListener("wheel", (e) => {
    e.preventDefault();
    const velocity = Math.min(Math.max(e.deltaY * CONFIG.sensitivity, -40), 40);
    targetTranslate = Math.min(Math.max(targetTranslate - velocity, -maxTranslate), 0);
    clearTimeout(scrollTimeout);
    scrollTimeout = setTimeout(snapToNearest, 200);
  }, { passive: false });

  itemElements.forEach((item, index) => {
    item.addEventListener("click", () => {
      const centerOffset = (dims.indicatorSize - dims.itemSize) / 2;
      targetTranslate = Math.max(Math.min(-index * dims.itemSize + centerOffset, 0), -maxTranslate);
    });
  });

  window.addEventListener("resize", () => { updateDimensions(); snapToNearest(); });

  // Init Gallery
  updateDimensions();
  targetTranslate = (dims.indicatorSize - dims.itemSize) / 2;
  currentTranslate = targetTranslate;
  animateGallery();
});
