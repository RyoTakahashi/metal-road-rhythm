// Web Audio playback. The song clock is derived from AudioContext time (the
// only clock locked to what the speakers play), smoothed with
// performance.now() so judgement isn't quantised to audio render chunks.

let ctx: AudioContext | null = null;
const buffers = new Map<string, Promise<AudioBuffer>>();

export function audioCtx(): AudioContext {
  if (!ctx) ctx = new AudioContext({ latencyHint: "interactive" });
  return ctx;
}

/** Must be called from a user gesture at least once (autoplay policy). */
export async function unlock(): Promise<void> {
  const c = audioCtx();
  if (c.state === "suspended") await c.resume();
}

export function loadBuffer(url: string): Promise<AudioBuffer> {
  let p = buffers.get(url);
  if (!p) {
    p = fetch(url)
      .then((r) => {
        if (!r.ok) throw new Error(`${url}: ${r.status}`);
        return r.arrayBuffer();
      })
      .then((ab) => audioCtx().decodeAudioData(ab));
    buffers.set(url, p);
    p.catch(() => buffers.delete(url));
  }
  return p;
}

export class SongPlayer {
  private src: AudioBufferSourceNode | null = null;
  private gain: GainNode;
  /** AudioContext time at which song time 0 is played. */
  private t0 = 0;
  private pausedAt: number | null = null;
  // smoothing between ctx.currentTime and performance.now()
  private lastCtx = -1;
  private lastPerf = 0;
  private smooth = 0;

  constructor(private buffer: AudioBuffer, volume = 0.85) {
    const c = audioCtx();
    this.gain = c.createGain();
    this.gain.gain.value = volume;
    this.gain.connect(c.destination);
  }

  get duration(): number {
    return this.buffer.duration;
  }

  /** Start playback after `leadIn` seconds (song time is negative until then). */
  start(leadIn: number, from = 0): void {
    const c = audioCtx();
    this.stopSource();
    const src = c.createBufferSource();
    src.buffer = this.buffer;
    src.connect(this.gain);
    const when = c.currentTime + leadIn;
    src.start(when, Math.max(0, from));
    this.src = src;
    this.t0 = when - from;
    this.lastCtx = -1;
    this.pausedAt = null;
  }

  pause(): void {
    if (this.pausedAt !== null) return;
    this.pausedAt = this.rawTime();
    this.stopSource();
  }

  /** Resume from where we paused, with a short lead-in so the player can re-orient. */
  resume(leadIn = 1.5): void {
    if (this.pausedAt === null) return;
    const at = this.pausedAt;
    this.pausedAt = null;
    // rewind by the lead-in so the music picks up slightly before the pause point
    const d = at - leadIn;
    if (d >= 0) this.start(0, d);
    else this.start(-d, 0);
  }

  get paused(): boolean {
    return this.pausedAt !== null;
  }

  stop(): void {
    this.stopSource();
    this.gain.disconnect();
  }

  private stopSource(): void {
    if (this.src) {
      try {
        this.src.stop();
      } catch {
        /* already stopped */
      }
      this.src.disconnect();
      this.src = null;
    }
  }

  private outputLatency(): number {
    const c = audioCtx();
    return (c.outputLatency || 0) + (c.baseLatency || 0);
  }

  private rawTime(): number {
    return audioCtx().currentTime - this.t0 - this.outputLatency();
  }

  /** Current song time in seconds, smoothed. `offset` is the user calibration. */
  time(offset = 0): number {
    if (this.pausedAt !== null) return this.pausedAt - offset;
    const c = audioCtx().currentTime;
    const now = performance.now() / 1000;
    if (c !== this.lastCtx) {
      this.lastCtx = c;
      this.lastPerf = now;
      this.smooth = this.rawTime();
    }
    return this.smooth + (now - this.lastPerf) - offset;
  }
}

/** Tiny synthesized hit sound, so taps feel physical without masking the song. */
export function tick(lane: number, volume: number): void {
  if (volume <= 0) return;
  const c = audioCtx();
  const t = c.currentTime;
  const o = c.createOscillator();
  const g = c.createGain();
  o.type = "triangle";
  o.frequency.value = [520, 660, 780, 980][lane] ?? 700;
  g.gain.setValueAtTime(0.0001, t);
  g.gain.exponentialRampToValueAtTime(0.25 * volume, t + 0.003);
  g.gain.exponentialRampToValueAtTime(0.0001, t + 0.06);
  o.connect(g).connect(c.destination);
  o.start(t);
  o.stop(t + 0.07);
}
