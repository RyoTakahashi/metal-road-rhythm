// Judgement and audience voltage (観客ボルテージ). Pure logic, no DOM.
//
// Voltage (0..100) rises with good hits — more so while a combo is running —
// and drops on every miss. The final rank (D..S) is decided from a mix of the
// voltage at the end of the song and the average voltage over the whole song,
// so a strong finish matters but you can't coast for 50s and rescue it at the end.

import type { Part } from "./chart";

export type Judge = "PERFECT" | "GREAT" | "GOOD" | "MISS";
export type Rank = "S" | "A" | "B" | "C" | "D";

export interface Windows {
  perfect: number;
  great: number;
  good: number;
  /** Presses earlier than `good` but within this count as a MISS on that note. */
  miss: number;
}

/** Vo/Gt ride the groove; Ba/Dr must lock in (リズム厳守). */
export const WINDOWS: Record<"loose" | "strict", Windows> = {
  loose: { perfect: 0.05, great: 0.09, good: 0.13, miss: 0.18 },
  strict: { perfect: 0.033, great: 0.058, good: 0.085, miss: 0.13 },
};

export const isStrict = (p: Part): boolean => p === "Ba" || p === "Dr";
export const windowsFor = (p: Part): Windows => WINDOWS[isStrict(p) ? "strict" : "loose"];

export const START_VOLTAGE = 50;

export const RANKS: { rank: Rank; min: number }[] = [
  { rank: "S", min: 90 },
  { rank: "A", min: 78 },
  { rank: "B", min: 62 },
  { rank: "C", min: 45 },
  { rank: "D", min: 0 },
];
export const CLEAR_RANK: Rank = "C";
export const rankOrder = (r: Rank): number => ["D", "C", "B", "A", "S"].indexOf(r);

export function voltageLabel(v: number): string {
  if (v >= 85) return "熱狂!!";
  if (v >= 65) return "大盛り上がり";
  if (v >= 45) return "ノってきた";
  if (v >= 25) return "様子見";
  return "冷え切り…";
}

export interface Result {
  rank: Rank;
  score: number;
  finalVoltage: number;
  avgVoltage: number;
  maxCombo: number;
  total: number;
  counts: Record<Judge, number>;
  fullCombo: boolean;
  history: number[];
  cleared: boolean;
}

export class Scorer {
  voltage = START_VOLTAGE;
  combo = 0;
  maxCombo = 0;
  counts: Record<Judge, number> = { PERFECT: 0, GREAT: 0, GOOD: 0, MISS: 0 };
  history: number[] = [];
  private sum = 0;
  private samples = 0;
  private readonly unit: number;
  private readonly strict: boolean;

  /** `nominal`: expected number of judgements in the song, to scale gains. */
  constructor(part: Part, nominal: number) {
    this.strict = isStrict(part);
    this.unit = 100 / Math.max(60, nominal);
  }

  /** Combo multiplier: up to ×1.6 at 100 combo. */
  private get mult(): number {
    return 1 + Math.min(this.combo, 100) / 166;
  }

  judge(j: Judge): void {
    this.counts[j]++;
    let dv = 0;
    switch (j) {
      case "PERFECT":
        dv = 1.3 * this.unit * this.mult;
        this.combo++;
        break;
      case "GREAT":
        dv = 0.8 * this.unit * this.mult;
        this.combo++;
        break;
      case "GOOD":
        // Ba/Dr: a GOOD is still off the grid → the groove (combo) breaks.
        if (this.strict) {
          dv = 0;
          this.combo = 0;
        } else {
          dv = 0.3 * this.unit;
          this.combo++;
        }
        break;
      case "MISS":
        dv = -Math.max(3.5, 9 * this.unit);
        this.combo = 0;
        break;
    }
    this.maxCombo = Math.max(this.maxCombo, this.combo);
    this.voltage = Math.max(0, Math.min(100, this.voltage + dv));
  }

  /** Call at a steady rate (e.g. every beat) to build the average / graph. */
  sample(): void {
    this.sum += this.voltage;
    this.samples++;
    this.history.push(Math.round(this.voltage * 10) / 10);
  }

  result(): Result {
    const avg = this.samples ? this.sum / this.samples : this.voltage;
    const score = Math.round((0.4 * this.voltage + 0.6 * avg) * 10) / 10;
    const rank = RANKS.find((r) => score >= r.min)!.rank;
    const total = this.counts.PERFECT + this.counts.GREAT + this.counts.GOOD + this.counts.MISS;
    const breaks = this.counts.MISS + (this.strict ? this.counts.GOOD : 0);
    return {
      rank,
      score,
      finalVoltage: Math.round(this.voltage * 10) / 10,
      avgVoltage: Math.round(avg * 10) / 10,
      maxCombo: this.maxCombo,
      total,
      counts: { ...this.counts },
      fullCombo: total > 0 && breaks === 0,
      history: this.history,
      cleared: rankOrder(rank) >= rankOrder(CLEAR_RANK),
    };
  }
}
