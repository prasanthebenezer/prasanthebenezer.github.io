// Synthesized audio cues for the projector — no files to host, license, or
// preload. Browsers require a user gesture before AudioContext can play, so
// we lazily resume on the first click/keydown anywhere on the page.
(function () {
  const KEY = 'quiz.audio.muted';
  let ctx = null;
  let muted = false;
  try { muted = localStorage.getItem(KEY) === '1'; } catch {}

  function getCtx() {
    if (!ctx) {
      try { ctx = new (window.AudioContext || window.webkitAudioContext)(); }
      catch { return null; }
    }
    if (ctx.state === 'suspended') ctx.resume().catch(() => {});
    return ctx;
  }

  // Resume on first interaction (browser autoplay policy).
  const resumeOnce = () => { getCtx(); };
  ['click', 'keydown', 'touchstart'].forEach((e) =>
    document.addEventListener(e, resumeOnce, { once: true, passive: true })
  );

  // Schedule a single oscillator note with an ADSR-ish envelope. All sound
  // helpers compose these.
  function note(opts) {
    const ac = getCtx(); if (!ac || muted) return;
    const {
      freq, type = 'sine', vol = 0.16,
      attack = 0.005, hold = 0.05, release = 0.08,
      freqEnd = null, delay = 0,
    } = opts;
    const t0 = ac.currentTime + delay;
    const t1 = t0 + attack;
    const t2 = t1 + hold;
    const t3 = t2 + release;
    const osc = ac.createOscillator();
    const gain = ac.createGain();
    osc.type = type;
    osc.frequency.setValueAtTime(freq, t0);
    if (freqEnd) {
      try { osc.frequency.exponentialRampToValueAtTime(Math.max(20, freqEnd), t2); }
      catch { osc.frequency.linearRampToValueAtTime(freqEnd, t2); }
    }
    gain.gain.setValueAtTime(0, t0);
    gain.gain.linearRampToValueAtTime(vol, t1);
    gain.gain.linearRampToValueAtTime(vol * 0.85, t2);
    gain.gain.linearRampToValueAtTime(0, t3);
    osc.connect(gain).connect(ac.destination);
    osc.start(t0); osc.stop(t3 + 0.02);
  }

  // Public sound API ------------------------------------------------------

  // Bright ascending arpeggio — C5, E5, G5
  function playCorrect() {
    note({ freq: 523.25, type: 'triangle', vol: 0.18, hold: 0.10, release: 0.10 });
    note({ freq: 659.25, type: 'triangle', vol: 0.18, hold: 0.10, release: 0.10, delay: 0.10 });
    note({ freq: 783.99, type: 'triangle', vol: 0.20, hold: 0.16, release: 0.16, delay: 0.20 });
  }

  // Low descending sawtooth — short and unmistakable
  function playWrong() {
    note({ freq: 220, freqEnd: 110, type: 'sawtooth', vol: 0.18,
           attack: 0.005, hold: 0.30, release: 0.10 });
  }

  // Sharp tick for the last few seconds of the timer
  function playTick() {
    note({ freq: 880, type: 'square', vol: 0.10,
           attack: 0.001, hold: 0.04, release: 0.04 });
  }

  // Two-tone end-of-timer alarm
  function playTimerUp() {
    note({ freq: 660, type: 'square', vol: 0.20, attack: 0.005, hold: 0.14, release: 0.10 });
    note({ freq: 440, type: 'square', vol: 0.20, attack: 0.005, hold: 0.20, release: 0.14, delay: 0.18 });
  }

  // Low resonant pulse to signal "buzzers are LIVE" — F2
  function playBuzzerArmed() {
    note({ freq: 196.00, type: 'sine',     vol: 0.22, hold: 0.18, release: 0.10 });
    note({ freq: 293.66, type: 'triangle', vol: 0.18, hold: 0.16, release: 0.18, delay: 0.12 });
  }

  // Sharp ding when a team locks the buzzer
  function playBuzzerLocked() {
    note({ freq: 988, type: 'triangle', vol: 0.22, hold: 0.10, release: 0.14 });
    note({ freq: 1318, type: 'triangle', vol: 0.18, hold: 0.10, release: 0.18, delay: 0.06 });
  }

  function isMuted() { return muted; }
  function setMuted(v) {
    muted = !!v;
    try { localStorage.setItem(KEY, muted ? '1' : '0'); } catch {}
    paintToggles();
  }
  function toggleMuted() { setMuted(!muted); }

  function paintToggles() {
    document.querySelectorAll('.audio-toggle').forEach((btn) => {
      btn.classList.toggle('muted', muted);
      const ic = btn.querySelector('.audio-icon');
      if (ic) ic.textContent = muted ? '🔇' : '🔊';
      btn.setAttribute('aria-label', muted ? 'Unmute sound' : 'Mute sound');
      btn.title = muted ? 'Unmute sound' : 'Mute sound';
    });
  }

  if (document.readyState === 'loading') {
    document.addEventListener('DOMContentLoaded', paintToggles);
  } else {
    paintToggles();
  }

  window.QuizAudio = {
    playCorrect, playWrong, playTick, playTimerUp,
    playBuzzerArmed, playBuzzerLocked,
    isMuted, setMuted, toggleMuted,
  };
})();
