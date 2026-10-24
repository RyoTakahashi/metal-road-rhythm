// Player settings (per-browser convenience only), persisted to localStorage.

export interface Settings {
  /** Seconds a note takes to fall from the top to the judgement line. */
  scroll: number;
  /** Audio/visual offset calibration in ms (+ = notes judged later). */
  offset: number;
  /** Tap sound volume 0..1. */
  tick: number;
}

const KEY = "mrr_settings";
const DEFAULTS: Settings = { scroll: 1.4, offset: 0, tick: 0.5 };

function load(): Settings {
  try {
    const raw = localStorage.getItem(KEY);
    if (raw) return { ...DEFAULTS, ...JSON.parse(raw) };
  } catch {
    /* storage unavailable */
  }
  return { ...DEFAULTS };
}

export const settings: Settings = load();

export function saveSettings(): void {
  try {
    localStorage.setItem(KEY, JSON.stringify(settings));
  } catch {
    /* storage unavailable */
  }
}

/* best results per part × song */

export interface Best {
  rank: string;
  score: number;
  fullCombo: boolean;
}

const bestKey = (part: string, song: string) => `mrr_best_${part}_${song}`;

export function getBest(part: string, song: string): Best | null {
  try {
    const raw = localStorage.getItem(bestKey(part, song));
    return raw ? (JSON.parse(raw) as Best) : null;
  } catch {
    return null;
  }
}

/** Stores the result if it beats the previous best; returns true when it did. */
export function putBest(part: string, song: string, b: Best): boolean {
  const prev = getBest(part, song);
  if (prev && prev.score >= b.score && (prev.fullCombo || !b.fullCombo)) return false;
  const merged: Best = prev && prev.score > b.score ? { ...prev, fullCombo: true } : b;
  try {
    localStorage.setItem(bestKey(part, song), JSON.stringify(merged));
  } catch {
    /* storage unavailable */
  }
  return !prev || b.score > prev.score;
}
