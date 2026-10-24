// Song list. Each beatmap JSON is produced offline by
// scripts/extract_beatmap.py from the full track: it picks a ~60s high-energy
// cut, fits a linear beat grid to it and samples per-16th onset strengths in
// three frequency bands (low = kick/bass, mid = snare/guitar, high = cymbals).
// The cut audio itself lives in public/assets/bgm/*.cut.mp3 and starts exactly
// on beats[0].

import crimson from "./beatmaps/crimson-horizon.json";
import freedom from "./beatmaps/freedom.json";
import cosmos from "./beatmaps/isolated-cosmos.json";
import metalroad from "./beatmaps/metal-road.json";
import metropolis from "./beatmaps/metropolis.json";
import rolling from "./beatmaps/rolling-dice.json";

export interface Beatmap {
  bpm: number;
  cutStart: number;
  cutLength: number;
  /** Beat times (s) relative to the start of the cut audio. */
  beats: number[];
  /** Per-bar loudness, normalised 0..1. */
  bars: number[];
  /** Per-16th onset strengths, normalised 0..1. */
  low: number[];
  mid: number[];
  high: number[];
}

export interface Song {
  id: string;
  title: string;
  /** Short flavor line shown on song select. */
  blurb: string;
  file: string;
  /** 1..5 overall feel; the per-part chart decides the real density. */
  level: number;
  map: Beatmap;
}

const base = import.meta.env.BASE_URL;
const src = (f: string) => `${base}assets/bgm/${f}.cut.mp3`;

export const SONGS: Song[] = [
  { id: "metal-road", title: "Metal Road", blurb: "バンドの始まりの一曲。まずはここから。", file: src("metal-road"), level: 2, map: metalroad },
  { id: "freedom", title: "Freedom", blurb: "疾走する開放感。ノリで押し切れ。", file: src("freedom"), level: 2, map: freedom },
  { id: "isolated-cosmos", title: "Isolated Cosmos", blurb: "宇宙の孤独を叫ぶミドルチューン。", file: src("isolated-cosmos"), level: 3, map: cosmos },
  { id: "metropolis", title: "Metropolis", blurb: "大都会を蹂躙する重低音。", file: src("metropolis"), level: 4, map: metropolis },
  { id: "rolling-dice", title: "Rolling Dice", blurb: "運命を転がせ。終盤の怒涛ラッシュ。", file: src("rolling-dice"), level: 4, map: rolling },
  { id: "crimson-horizon", title: "Crimson Horizon", blurb: "紅蓮の地平線。最終決戦のクライマックス。", file: src("crimson-horizon"), level: 5, map: crimson },
];
