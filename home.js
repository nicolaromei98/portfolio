/**
 * GSAP Unified Script - Part 3
 * Includes: Button Character Stagger & Bunny HLS Background Player
 */

document.addEventListener('DOMContentLoaded', () => {
  // 1. Inizializzazione Stagger Bottoni
  initButtonCharacterStagger();
  
  // 2. Inizializzazione Player Video (Bunny HLS)
  initBunnyPlayerBackground();
});

/**
 * Splitta il testo dei bottoni in span per permettere animazioni CSS/GSAP
 * Target: [data-button-animate-chars]
 */
function initButtonCharacterStagger() {
  const offsetIncrement = 0.01; // Incremento del delay in secondi
  const buttons = document.querySelectorAll('[data-button-animate-chars]');

  buttons.forEach(button => {
    const text = button.textContent;
    button.innerHTML = ''; // Svuota il contenuto originale

    [...text].forEach((char, index) => {
      const span = document.createElement('span');
      span.textContent = char;
      span.style.transitionDelay = `${index * offsetIncrement}s`;

      // Preserva lo spazio vuoto
      if (char === ' ') {
        span.style.whiteSpace = 'pre';
      }

      button.appendChild(span);
    });
  });
}

/**
 * Gestisce i video background con supporto HLS (.m3u8)
 * Supporta: Lazy loading, Autoplay intelligente, Mute/Unmute
 */
function initBunnyPlayerBackground() {
  document.querySelectorAll('[data-bunny-background-init]').forEach(function(player) {
    const src = player.getAttribute('data-player-src');
    const video = player.querySelector('video');
    if (!src || !video) return;

    // Reset iniziale video
    try { video.pause(); } catch(_) {}
    try { video.removeAttribute('src'); video.load(); } catch(_) {}

    // --- Helpers per gli attributi ---
    function setStatus(s) {
      if (player.getAttribute('data-player-status') !== s) {
        player.setAttribute('data-player-status', s);
      }
    }
    
    function setActivated(v) { 
      player.setAttribute('data-player-activated', v ? 'true' : 'false'); 
    }

    if (!player.hasAttribute('data-player-activated')) setActivated(false);

    // Flags e Configurazioni
    const lazyMode = player.getAttribute('data-player-lazy');
    const isLazyTrue = lazyMode === 'true';
    const autoplay = player.getAttribute('data-player-autoplay') === 'true';
    const initialMuted = player.getAttribute('data-player-muted') === 'true';
    let pendingPlay = false;

    // Configurazione attributi video per Background Playback
    if (autoplay) { 
      video.muted = true; 
      video.loop = true; 
    } else { 
      video.muted = initialMuted; 
    }

    video.setAttribute('muted', '');
    video.setAttribute('playsinline', '');
    video.setAttribute('webkit-playsinline', '');
    video.playsInline = true;
    if (typeof video.disableRemotePlayback !== 'undefined') video.disableRemotePlayback = true;
    if (autoplay) video.autoplay = false;

    // Controllo compatibilità HLS
    const isSafariNative = !!video.canPlayType('application/vnd.apple.mpegurl');
    const canUseHlsJs = !!(window.Hls && Hls.isSupported()) && !isSafariNative;

    let isAttached = false;
    let lastPauseBy = ''; // 'io' (IntersectionObserver) | 'manual'

    // Funzione per agganciare lo stream HLS o MP4
    function attachMediaOnce() {
      if (isAttached) return;
      isAttached = true;

      if (player._hls) { 
        try { player._hls.destroy(); } catch(_) {} 
        player._hls = null; 
      }

      if (isSafariNative) {
        video.preload = isLazyTrue ? 'none' : 'auto';
        video.src = src;
        video.addEventListener('loadedmetadata', () => readyIfIdle(player, pendingPlay), { once: true });
      } else if (canUseHlsJs) {
        const hls = new Hls({ maxBufferLength: 10 });
        hls.attachMedia(video);
        hls.on(Hls.Events.MEDIA_ATTACHED, () => hls.loadSource(src));
        hls.on(Hls.Events.MANIFEST_PARSED, () => readyIfIdle(player, pendingPlay));
        player._hls = hls;
      } else {
        video.src = src;
      }
    }

    // Init in base al lazy mode
    if (isLazyTrue) {
      video.preload = 'none';
    } else {
      attachMediaOnce();
    }

    // --- Controlli Playback ---
    function togglePlay() {
      if (video.paused || video.ended) {
        if (isLazyTrue && !isAttached) attachMediaOnce();
        pendingPlay = true;
        lastPauseBy = '';
        setStatus('loading');
        safePlay(video);
      } else {
        lastPauseBy = 'manual';
        video.pause();
      }
    }

    function toggleMute() {
      video.muted = !video.muted;
      player.setAttribute('data-player-muted', video.muted ? 'true' : 'false');
    }

    // Event Delegation per i bottoni interni
    player.addEventListener('click', function(e) {
      const btn = e.target.closest('[data-player-control]');
      if (!btn || !player.contains(btn)) return;
      const type = btn.getAttribute('data-player-control');
      
      if (type === 'play' || type === 'pause' || type === 'playpause') togglePlay();
      else if (type === 'mute') toggleMute();
    });

    // Eventi del tag Video
    video.addEventListener('play', () => { setActivated(true); setStatus('playing'); });
    video.addEventListener('playing', () => { pendingPlay = false; setStatus('playing'); });
    video.addEventListener('pause', () => { pendingPlay = false; setStatus('paused'); });
    video.addEventListener('waiting', () => setStatus('loading'));
    video.addEventListener('canplay', () => readyIfIdle(player, pendingPlay));
    video.addEventListener('ended', () => { pendingPlay = false; setStatus('paused'); setActivated(false); });

    // Intersection Observer per Autoplay
    if (autoplay) {
      if (player._io) { try { player._io.disconnect(); } catch(_) {} }
      const io = new IntersectionObserver((entries) => {
        entries.forEach((entry) => {
          const inView = entry.isIntersecting && entry.intersectionRatio > 0;
          if (inView) {
            if (isLazyTrue && !isAttached) attachMediaOnce();
            if ((lastPauseBy === 'io') || (video.paused && lastPauseBy !== 'manual')) {
              setStatus('loading');
              if (video.paused) togglePlay();
              lastPauseBy = '';
            }
          } else {
            if (!video.paused && !video.ended) {
              lastPauseBy = 'io';
              video.pause();
            }
          }
        });
      }, { threshold: 0.1 });
      io.observe(player);
      player._io = io;
    }
  });

  // Helper: Stato di pronto
  function readyIfIdle(player, pendingPlay) {
    if (!pendingPlay &&
        player.getAttribute('data-player-activated') !== 'true' &&
        player.getAttribute('data-player-status') === 'idle') {
      player.setAttribute('data-player-status', 'ready');
    }
  }

  // Helper: Play sicuro (evita errori console se l'utente non ha interagito)
  function safePlay(video) {
    const p = video.play();
    if (p && typeof p.then === 'function') p.catch(() => {});
  }
}
