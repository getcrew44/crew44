// Shared AudioContext — must be primed during a user gesture (Send click)
// because Chromium autoplay policy starts contexts in "suspended" state
// otherwise. Once running, it stays running for the session, so subsequent
// playDoneSound calls (which fire on a network event, not a gesture) work.
let sharedAudioCtx = null;

function getAudioCtx() {
  if (sharedAudioCtx) return sharedAudioCtx;
  const Ctor = window.AudioContext || window.webkitAudioContext;
  if (!Ctor) return null;
  try {
    sharedAudioCtx = new Ctor();
  } catch (err) {
    console.warn('AudioContext unavailable:', err);
    return null;
  }
  return sharedAudioCtx;
}

export function primeAudioContext() {
  const ctx = getAudioCtx();
  if (ctx && ctx.state === 'suspended') {
    ctx.resume().catch(err => console.warn('AudioContext resume failed:', err));
  }
}

export function playDoneSound() {
  const ctx = getAudioCtx();
  if (!ctx) return;
  const play = () => {
    try {
      const osc = ctx.createOscillator();
      const gain = ctx.createGain();
      osc.connect(gain);
      gain.connect(ctx.destination);
      osc.type = 'sine';
      const now = ctx.currentTime;
      osc.frequency.setValueAtTime(660, now);
      osc.frequency.setValueAtTime(880, now + 0.12);
      gain.gain.setValueAtTime(0.25, now);
      gain.gain.exponentialRampToValueAtTime(0.001, now + 0.5);
      osc.start(now);
      osc.stop(now + 0.5);
    } catch (err) {
      console.warn('playDoneSound failed:', err);
    }
  };
  if (ctx.state === 'suspended') {
    ctx.resume().then(play).catch(err => console.warn('AudioContext resume failed:', err));
  } else {
    play();
  }
}
