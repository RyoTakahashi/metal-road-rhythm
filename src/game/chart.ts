// Chart (譜面) generation. Everything here is pure: it only reads a Beatmap,
// so scripts/sim.ts can run it under Node.
//
// Two kinds of part:
//  - Vo / Gt are *adaptive*: the chart is generated one bar at a time just
//    before it scrolls into view, and the pattern used depends on the current
//    performance level (driven by combo). Keep the combo going and the melody /
//    riff gets busier: long tones and shouts for Vo, chords, gallops and shred
//    runs for Gt. Drop the combo and it falls back to the basic rhythm.
//  - Ba / Dr are *fixed*: the whole chart is built up front from the song's
//    kick / snare / cymbal onsets and is dense from the first bar.

import type { Beatmap } from "../data/songs";

export type Part = "Vo" | "Gt" | "Ba" | "Dr";

export interface Note {
  id: number;
  /** Hit time (s) relative to the cut audio. */
  t: number;
  lane: number;
  /** End time for hold notes. */
  end?: number;
  /** Notes sharing a group are hit together (chords); used for drawing. */
  chord?: boolean;
}

export const LANES = 4;
export const STEPS_PER_BEAT = 4;
export const STEPS_PER_BAR = 16;
/** Bar 0 is a count-in: no notes. */
export const FIRST_BAR = 1;

export const ADAPTIVE: Record<Part, boolean> = { Vo: true, Gt: true, Ba: false, Dr: false };

/** Combo needed to reach performance level 1..4 for adaptive parts. */
export const LEVEL_COMBO = [0, 12, 36, 72] as const;
export const levelForCombo = (combo: number): number => {
  let lv = 1;
  for (let i = 0; i < LEVEL_COMBO.length; i++) if (combo >= LEVEL_COMBO[i]) lv = i + 1;
  return lv;
};

export function mulberry32(seed: number): () => number {
  let a = seed >>> 0;
  return () => {
    a = (a + 0x6d2b79f5) >>> 0;
    let t = a;
    t = Math.imul(t ^ (t >>> 15), t | 1);
    t ^= t + Math.imul(t ^ (t >>> 7), t | 61);
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

export const hashString = (s: string): number => {
  let h = 2166136261;
  for (let i = 0; i < s.length; i++) h = Math.imul(h ^ s.charCodeAt(i), 16777619);
  return h >>> 0;
};

/** Timing helpers over a beatmap's beat grid. */
export class Grid {
  readonly bars: number;
  constructor(readonly map: Beatmap) {
    this.bars = Math.floor((map.beats.length - 1) / 4);
  }
  /** Time of a 16th step (may be fractional within the last beat). */
  step(i: number): number {
    const b = this.map.beats;
    const beat = Math.floor(i / STEPS_PER_BEAT);
    if (beat >= b.length - 1) {
      const span = b[b.length - 1] - b[b.length - 2];
      return b[b.length - 1] + span * (i / STEPS_PER_BEAT - (b.length - 1));
    }
    return b[beat] + ((b[beat + 1] - b[beat]) * (i % STEPS_PER_BEAT)) / STEPS_PER_BEAT;
  }
  barStart(bar: number): number {
    return this.step(bar * STEPS_PER_BAR);
  }
  get end(): number {
    return this.barStart(this.bars);
  }
  low(i: number): number {
    return this.map.low[i] ?? 0;
  }
  mid(i: number): number {
    return this.map.mid[i] ?? 0;
  }
  high(i: number): number {
    return this.map.high[i] ?? 0;
  }
  energy(bar: number): number {
    return this.map.bars[bar] ?? 0;
  }
}

class Builder {
  notes: Note[] = [];
  private used = new Set<string>();
  constructor(private grid: Grid, private nextId: () => number) {}

  /** Add a tap/hold at 16th step `s`. Returns false if that slot is taken. */
  add(s: number, lane: number, holdSteps = 0, chord = false): boolean {
    const key = `${s}:${lane}`;
    if (this.used.has(key) || lane < 0 || lane >= LANES) return false;
    this.used.add(key);
    const n: Note = { id: this.nextId(), t: this.grid.step(s), lane };
    if (holdSteps > 0) {
      n.end = this.grid.step(s + holdSteps);
      // block the lane for the hold's duration
      for (let k = 1; k <= holdSteps; k++) this.used.add(`${s + k}:${lane}`);
    }
    if (chord) n.chord = true;
    this.notes.push(n);
    return true;
  }
  busy(s: number, lane: number): boolean {
    return this.used.has(`${s}:${lane}`);
  }
  countAt(s: number): number {
    let c = 0;
    for (let l = 0; l < LANES; l++) if (this.used.has(`${s}:${l}`)) c++;
    return c;
  }
}

/* ------------------------------------------------------------------ */
/* Fixed charts: Ba / Dr                                              */
/* ------------------------------------------------------------------ */

function drumChart(grid: Grid, rng: () => number, nextId: () => number): Note[] {
  const b = new Builder(grid, nextId);
  const CY = 0,
    SN = 1,
    BDL = 2,
    BDR = 3;
  // Does this song's snare sit on every beat (fast metal at half-time bpm) or
  // on 2 and 4? Compare mid-band onsets on beats 1/3 vs 2/4.
  let on13 = 0,
    on24 = 0;
  for (let bar = 0; bar < grid.bars; bar++) {
    const s0 = bar * STEPS_PER_BAR;
    on13 += grid.mid(s0) + grid.mid(s0 + 8);
    on24 += grid.mid(s0 + 4) + grid.mid(s0 + 12);
  }
  const everyBeat = on13 > on24 * 0.92;

  for (let bar = FIRST_BAR; bar < grid.bars; bar++) {
    const s0 = bar * STEPS_PER_BAR;
    const e = grid.energy(bar);
    const phraseEnd = bar % 8 === 7 && bar !== grid.bars - 1;
    // average kick-band activity on 16ths in this bar → double-bass section?
    let lowSum = 0;
    for (let k = 0; k < 16; k++) lowSum += grid.low(s0 + k);
    const blast = lowSum / 16 > 0.38 || e > 0.72;

    // crash on the downbeat
    if (bar % 2 === 1 || e > 0.5 || bar === FIRST_BAR) b.add(s0, CY);

    // backbeat snare
    const snSteps = everyBeat ? [0, 4, 8, 12] : [4, 12];
    for (const k of snSteps) {
      if (phraseEnd && k >= 8) continue;
      if (k === 0 && b.busy(s0, CY) && e < 0.4) continue;
      b.add(s0 + k, SN);
    }

    if (phraseEnd) {
      // fill: snare 16ths with crash accents into the next phrase
      for (let k = 8; k < 16; k++) {
        if (k % 2 === 1 && e < 0.35) continue;
        b.add(s0 + k, k === 15 ? CY : SN);
      }
    }

    // kicks
    let alt = 0;
    const kickLimit = phraseEnd ? 8 : 16;
    for (let k = 0; k < kickLimit; k++) {
      const s = s0 + k;
      if (b.countAt(s) >= 2) continue;
      const strong = grid.low(s);
      let hit: boolean;
      if (blast) hit = k % 2 === 0 || strong > 0.18; // double bass: near-constant 16ths
      else if (e > 0.35) hit = (k % 2 === 0 && strong > 0.22) || strong > 0.55;
      else hit = (k % 4 === 0 && strong > 0.15) || strong > 0.6;
      if (!hit) continue;
      b.add(s, alt % 2 === 0 ? BDL : BDR);
      alt++;
    }
  }
  // final hit: crash + kick on the last downbeat
  const last = grid.bars * STEPS_PER_BAR;
  b.add(last, CY);
  b.add(last, BDL);
  void rng;
  return b.notes;
}

function bassChart(grid: Grid, rng: () => number, nextId: () => number): Note[] {
  const b = new Builder(grid, nextId);
  let root = 0;
  for (let bar = FIRST_BAR; bar < grid.bars; bar++) {
    const s0 = bar * STEPS_PER_BAR;
    const e = grid.energy(bar);
    // roots move mostly between E and A, sometimes D
    if (bar % 2 === 1) {
      const r = rng();
      root = r < 0.45 ? 0 : r < 0.85 ? 1 : 2;
    }
    const fill = bar % 4 === 3;

    if (e < 0.18 && !fill) {
      // quiet bar: sustained roots
      b.add(s0, root, 7);
      b.add(s0 + 8, Math.min(3, root + 1), 7);
      continue;
    }
    for (let k = 0; k < 16; k++) {
      const s = s0 + k;
      if (fill && k >= 12) {
        // walk-up fill: 16ths across the strings
        b.add(s, [0, 1, 2, 3][k - 12]);
        continue;
      }
      const lowS = grid.low(s);
      const beatHalf = k >= 8 ? 1 : 0;
      const lane = beatHalf && rng() < 0.3 ? Math.min(3, root + 1) : root;
      let hit = false;
      if (k % 4 === 0) hit = true; // always on the beat
      else if (k % 2 === 0) hit = lowS > 0.12 || e > 0.25; // driving 8ths
      else hit = e > 0.3 && lowS > 0.36; // gallop 16ths on strong kicks
      if (!hit) continue;
      // octave pop on the "and" of 2 / 4 now and then
      const octave = (k === 6 || k === 14) && rng() < 0.35 ? Math.min(3, lane + 2) : lane;
      b.add(s, octave);
    }
  }
  const last = grid.bars * STEPS_PER_BAR;
  b.add(last, 0);
  return b.notes;
}

export function fixedChart(part: Part, grid: Grid, seed: number): Note[] {
  let id = 0;
  const nextId = () => id++;
  const rng = mulberry32(seed);
  const notes = part === "Dr" ? drumChart(grid, rng, nextId) : bassChart(grid, rng, nextId);
  return notes.sort((a, c) => a.t - c.t || a.lane - c.lane);
}

/* ------------------------------------------------------------------ */
/* Adaptive charts: Vo / Gt                                           */
/* ------------------------------------------------------------------ */

/** Generates one bar at a time; `level` (1..4) is decided by the caller. */
export class AdaptiveCharter {
  private rng: () => number;
  private id = 0;
  private pitch = 1; // current melody lane for Vo, current string for Gt
  constructor(readonly part: Part, readonly grid: Grid, seed: number) {
    this.rng = mulberry32(seed);
  }

  private nextId = () => this.id++;

  /** Notes for bar `bar` at performance level `level`. */
  bar(bar: number, level: number): Note[] {
    if (bar < FIRST_BAR) return [];
    const b = new Builder(this.grid, this.nextId);
    const s0 = bar * STEPS_PER_BAR;
    if (bar >= this.grid.bars) {
      // ending: big chord on the final downbeat
      if (bar === this.grid.bars) {
        b.add(s0, this.part === "Vo" ? 3 : 0, 0, true);
        b.add(s0, this.part === "Vo" ? 1 : 1, 0, true);
      }
      return b.notes;
    }
    if (this.part === "Vo") this.vocal(b, bar, s0, level);
    else this.guitar(b, bar, s0, level);
    return b.notes.sort((a, c) => a.t - c.t || a.lane - c.lane);
  }

  /** Random walk over melody lanes 0..2 (lane 3 is reserved for shouts on Vo). */
  private step(maxLane: number): number {
    const r = this.rng();
    const d = r < 0.35 ? -1 : r < 0.7 ? 1 : 0;
    this.pitch = Math.max(0, Math.min(maxLane, this.pitch + d));
    return this.pitch;
  }

  private vocal(b: Builder, bar: number, s0: number, level: number): void {
    const g = this.grid;
    const phraseEnd = bar % 4 === 3;
    if (level === 1) {
      // on the beat, a long tone at the end of every other bar
      b.add(s0, this.step(2));
      b.add(s0 + 4, this.step(2));
      if (bar % 2 === 1) b.add(s0 + 8, this.step(2), 6);
      else {
        b.add(s0 + 8, this.step(2));
        b.add(s0 + 12, this.step(2));
      }
      return;
    }
    if (level === 2) {
      for (let k = 0; k < 16; k += 2) {
        if (phraseEnd && k >= 8) break;
        const s = s0 + k;
        if (k % 4 === 0 || g.mid(s) > 0.5) b.add(s, this.step(2));
      }
      if (phraseEnd) b.add(s0 + 8, this.step(2), 7);
      return;
    }
    // level 3/4: syncopation, shouts (lane 3), melisma runs
    const runBeat = level === 4 ? Math.floor(this.rng() * 3) : -1;
    for (let k = 0; k < 16; k++) {
      const s = s0 + k;
      if (phraseEnd && k >= 8) break;
      if (Math.floor(k / 4) === runBeat) {
        // melisma: 16ths stepping across the melody lanes
        b.add(s, [0, 1, 2, 1][k % 4]);
        continue;
      }
      const on8 = k % 2 === 0;
      if (k % 4 === 0 || (on8 && g.mid(s) > 0.42) || (!on8 && g.mid(s) > 0.75 && level === 4)) {
        b.add(s, this.step(2));
      }
    }
    // shouts on accented downbeats
    if (g.high(s0) > 0.55 || bar % 2 === 0) b.add(s0, 3, 0, true);
    if (phraseEnd) {
      if (level === 4) {
        b.add(s0 + 8, 3, 7); // scream hold
        b.add(s0 + 8, this.step(2), 0, true);
        b.add(s0 + 12, this.step(2));
      } else {
        b.add(s0 + 8, this.step(2), 7);
      }
    }
  }

  private guitar(b: Builder, bar: number, s0: number, level: number): void {
    const g = this.grid;
    const e = g.energy(bar);
    if (level === 1) {
      // basic riff: quarter notes on the low strings
      for (let k = 0; k < 16; k += 4) b.add(s0 + k, k === 8 ? 1 : 0);
      return;
    }
    if (level === 2) {
      for (let k = 0; k < 16; k += 2) {
        const s = s0 + k;
        if (k % 4 === 0 || g.mid(s) > 0.45) b.add(s, k % 8 === 0 ? 0 : this.step(2));
      }
      return;
    }
    const soloBar = level === 4 && bar % 2 === 1 && e > 0.25;
    if (soloBar) {
      // shred: 16th scale runs and a tapping trill, ending on a held note
      const runs = [
        [0, 1, 2, 3],
        [2, 1, 0, 1],
        [2, 3, 2, 3],
        [3, 2, 1, 0],
      ];
      const order = this.rng() < 0.5 ? [0, 1, 2] : [1, 2, 0];
      for (let beat = 0; beat < 3; beat++) {
        const run = runs[order[beat]];
        for (let k = 0; k < 4; k++) b.add(s0 + beat * 4 + k, run[k]);
      }
      b.add(s0 + 12, 3, 3); // vibrato
      return;
    }
    // level 3 (and non-solo bars of level 4): power chords + gallops
    for (let beat = 0; beat < 4; beat++) {
      const s = s0 + beat * 4;
      const accent = beat === 0 || g.high(s) > 0.6;
      if (accent) {
        const root = this.rng() < 0.6 ? 0 : 1;
        b.add(s, root, 0, true);
        b.add(s, root + 1, 0, true);
      } else {
        b.add(s, 0);
      }
      // gallop: 8th + two 16ths
      if (g.low(s + 2) > 0.3 || (level === 4 && g.low(s) > 0.3)) {
        b.add(s + 2, 0);
        b.add(s + 3, 0);
      } else if (g.mid(s + 2) > 0.45) {
        b.add(s + 2, this.step(2));
      }
    }
  }
}

/** Expected judgement count used to scale voltage gains (adaptive parts vary). */
export function nominalNotes(part: Part, grid: Grid, fixed: Note[] | null): number {
  if (fixed) return fixed.length + fixed.filter((n) => n.end !== undefined).length;
  const bars = grid.bars - FIRST_BAR;
  return bars * (part === "Vo" ? 7 : 8);
}
