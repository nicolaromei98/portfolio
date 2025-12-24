/**
 * GSAP Animations Unified Script
 * Includes: Heading Split Reveal & Character Blink Effect
 */

document.addEventListener("DOMContentLoaded", () => {
  // 1. Registrazione Plugin (singola volta)
  gsap.registerPlugin(SplitText, ScrollTrigger);

  // --- SEZIONE A: HEADING SPLIT REVEAL [data-split="heading"] ---
  const headings = document.querySelectorAll('[data-split="heading"]');

  headings.forEach(heading => {
    // Resetta la visibilità iniziale
    gsap.set(heading, { autoAlpha: 1 });

    // Esegui lo SplitText per righe
    const split = new SplitText(heading, {
      type: "lines",
      linesClass: "mask-line", // Assicurati di avere .mask-line { overflow: hidden; } nel CSS
    });

    split.lines.forEach(line => {
      // Crea il wrapper interno per l'effetto reveal
      const wrapper = document.createElement('div');
      wrapper.style.display = 'block';
      
      while (line.firstChild) {
        wrapper.appendChild(line.firstChild);
      }
      line.appendChild(wrapper);
    });

    // Animazione dei wrapper interni
    const animationTargets = heading.querySelectorAll('.mask-line > div');

    gsap.from(animationTargets, {
      yPercent: 100,
      duration: 0.6,
      stagger: 0.1,
      ease: 'power4.out',
      scrollTrigger: {
        trigger: heading,
        start: 'top 80%',
        toggleActions: "play none none none"
      }
    });
  });


  // --- SEZIONE B: CHARACTER BLINK EFFECT [data-blink-text] ---
  document.querySelectorAll("[data-blink-text]").forEach(el => {
    
    // 1. Preparazione del testo (Wrapping in span)
    if (!el.dataset.wrapped) {
      const raw = el.innerHTML.replace(/<br\s*\/?>/gi, "\n");
      el.innerHTML = raw.split("").map(ch => {
        if (ch === "\n") return "<br>";
        
        const isOff = Math.random() < 0.25;
        const opacity = isOff ? 0 : gsap.utils.random(0.2, 1);
        const safeChar = ch === " " ? "&nbsp;" : ch;
        
        return `<span class="blink-char" style="display:inline-block; will-change:opacity,filter; opacity:${opacity}; filter:brightness(.7)">${safeChar}</span>`;
      }).join("");
      el.dataset.wrapped = "1";
    }

    const chars = el.querySelectorAll(".blink-char");
    let hoverTL;

    // Funzione per riportare i caratteri allo stato normale
    const settleAll = () => {
      gsap.to(chars, { 
        opacity: 1, 
        filter: "brightness(1)", 
        duration: 0.18, 
        stagger: 0.008, 
        overwrite: "auto" 
      });
    };

    // Creazione del singolo flash
    const createFlash = (target) => {
      return gsap.timeline()
        .to(target, { 
          opacity: gsap.utils.random(0.0, 0.18), 
          filter: "brightness(.35)", 
          duration: gsap.utils.random(0.012, 0.03), 
          ease: "none", 
          overwrite: "auto" 
        })
        .to(target, { 
          opacity: 1, 
          filter: `brightness(${gsap.utils.random(1.1, 2.2)})`, 
          duration: gsap.utils.random(0.012, 0.04), 
          ease: "none", 
          overwrite: "auto" 
        })
        .to(target, { 
          opacity: gsap.utils.random(0.05, 0.35), 
          filter: "brightness(.55)", 
          duration: gsap.utils.random(0.012, 0.03), 
          ease: "none", 
          overwrite: "auto" 
        })
        .to(target, { 
          opacity: 1, 
          filter: "brightness(1)", 
          duration: gsap.utils.random(0.02, 0.06), 
          ease: "none", 
          overwrite: "auto" 
        });
    };

    const getRandomChar = () => chars[gsap.utils.random(0, chars.length - 1, 1)];

    // Burst iniziale all'entrata nello scroll
    const doBurst = () => {
      if (hoverTL) hoverTL.kill();
      const tl = gsap.timeline({ onComplete: settleAll });
      const flashes = Math.min(140, Math.max(70, chars.length * 6));

      for (let i = 0; i < flashes; i++) {
        tl.add(createFlash(getRandomChar()), gsap.utils.random(0, 0.9));
      }
    };

    // Loop continuo su Hover
    const startHover = () => {
      if (hoverTL) hoverTL.kill();
      hoverTL = gsap.timeline({ repeat: -1 });
      const flashes = Math.min(220, Math.max(120, chars.length * 8));

      for (let i = 0; i < flashes; i++) {
        hoverTL.add(createFlash(getRandomChar()), gsap.utils.random(0, 1.0));
      }
    };

    const stopHover = () => { 
      if (hoverTL) hoverTL.kill(); 
      settleAll(); 
    };

    // Event Listeners Blink Effect
    ScrollTrigger.create({ 
      trigger: el, 
      start: "top 85%", 
      onEnter: doBurst 
    });

    el.addEventListener("mouseenter", startHover, { passive: true });
    el.addEventListener("mouseleave", stopHover, { passive: true });
  });
});
