/* 1. Durata complessiva della transizione */
::view-transition-old(root),
::view-transition-new(root) {
  animation-duration: 0.8s;
  animation-timing-function: cubic-bezier(0.87, 0, 0.13, 1);
  animation-fill-mode: both;
}

/* 2. Definizione dell'uscita della vecchia pagina */
::view-transition-old(root) {
  animation-name: move-out;
}

/* 3. Definizione dell'entrata della nuova pagina */
::view-transition-new(root) {
  animation-name: move-in;
}

/* 4. I Keyframes delle animazioni */

@keyframes move-out {
  from {
    opacity: 1;
    transform: translateY(0);
  }
  to {
    opacity: 0;
    transform: translateY(-50px); /* Slitta leggermente verso l'alto */
  }
}

@keyframes move-in {
  from {
    /* Effetto sipario: parte dal basso e svela la pagina */
    clip-path: polygon(0% 100%, 100% 100%, 100% 100%, 0% 100%);
  }
  to {
    clip-path: polygon(0% 100%, 100% 100%, 100% 0%, 0% 0%);
  }
}
