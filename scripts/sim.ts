// Prints chart stats for every song × part (note counts, notes/sec, chords)
// so density can be tuned without playing. Run: npm run sim
import { readFileSync, readdirSync } from "node:fs";
import { AdaptiveCharter, FIRST_BAR, Grid, fixedChart, hashString, levelForCombo, type Note, type Part } from "../src/game/chart";
import type { Beatmap } from "../src/data/songs";

const dir = new URL("../src/data/beatmaps/", import.meta.url);
const parts: Part[] = ["Vo", "Gt", "Ba", "Dr"];

function stats(notes: Note[], dur: number) {
  const holds = notes.filter((n) => n.end !== undefined).length;
  const times = new Map<number, number>();
  for (const n of notes) times.set(Math.round(n.t * 1000), (times.get(Math.round(n.t * 1000)) ?? 0) + 1);
  const chords = [...times.values()].filter((c) => c >= 2).length;
  const max = Math.max(...times.values());
  let peak = 0;
  for (const n of notes) peak = Math.max(peak, notes.filter((m) => m.t >= n.t && m.t < n.t + 2).length / 2);
  return `${String(notes.length).padStart(4)} notes  ${(notes.length / dur).toFixed(1).padStart(4)} nps  peak ${peak.toFixed(1).padStart(4)}  holds ${String(holds).padStart(3)}  chords ${String(chords).padStart(3)}  max-simul ${max}`;
}

for (const f of readdirSync(dir).filter((f) => f.endsWith(".json")).sort()) {
  const map: Beatmap = JSON.parse(readFileSync(new URL(f, dir), "utf8"));
  const grid = new Grid(map);
  const dur = grid.end - grid.barStart(FIRST_BAR);
  console.log(`\n${f}  bpm ${map.bpm}  bars ${grid.bars}  ${dur.toFixed(1)}s`);
  for (const p of parts) {
    const seed = hashString(f + p);
    if (p === "Ba" || p === "Dr") {
      console.log(`  ${p}       ${stats(fixedChart(p, grid, seed), dur)}`);
      continue;
    }
    for (const lv of [1, 2, 3, 4]) {
      const ch = new AdaptiveCharter(p, grid, seed);
      const notes: Note[] = [];
      for (let bar = 0; bar <= grid.bars; bar++) notes.push(...ch.bar(bar, lv));
      console.log(`  ${p} Lv${lv}   ${stats(notes, dur)}`);
    }
  }
}

// --- rank sanity check: simulated players of varying accuracy -----------------
import { Scorer, type Judge } from "../src/game/scoring";
import { nominalNotes } from "../src/game/chart";

function play(part: Part, map: Beatmap, seed: number, skill: number): string {
  const grid = new Grid(map);
  const rng = (() => {
    let a = seed;
    return () => ((a = (a * 1103515245 + 12345) >>> 0) / 4294967296);
  })();
  const roll = (): Judge => {
    const r = rng();
    if (r < skill * 0.75) return "PERFECT";
    if (r < skill) return "GREAT";
    if (r < skill + (1 - skill) * 0.4) return "GOOD";
    return "MISS";
  };
  let notes: Note[];
  const fixed = part === "Ba" || part === "Dr" ? fixedChart(part, grid, seed) : null;
  const sc = new Scorer(part, nominalNotes(part, grid, fixed));
  if (fixed) notes = fixed;
  else {
    const ch = new AdaptiveCharter(part, grid, seed);
    notes = [];
    for (let bar = 0; bar <= grid.bars; bar++) {
      // level decided at bar granularity by the combo so far
      const bn = ch.bar(bar, levelForCombo(sc.combo));
      for (const n of bn) {
        sc.judge(roll());
        if (n.end !== undefined) sc.judge(rng() < skill ? "PERFECT" : "MISS");
      }
      sc.sample();
      notes.push(...bn);
    }
    const r = sc.result();
    return `${r.rank}(${r.score.toFixed(0)}) n=${notes.length}`;
  }
  let nextBeat = 0;
  for (const n of notes) {
    while (map.beats[nextBeat] !== undefined && map.beats[nextBeat] <= n.t) {
      sc.sample();
      nextBeat++;
    }
    sc.judge(roll());
    if (n.end !== undefined) sc.judge(rng() < skill ? "PERFECT" : "MISS");
  }
  const r = sc.result();
  return `${r.rank}(${r.score.toFixed(0)})`;
}

console.log("\nsimulated players (hit-rate → rank):");
const skills = [0.6, 0.75, 0.85, 0.92, 0.97, 1.0];
console.log("            " + skills.map((s) => String(s).padEnd(12)).join(""));
for (const f of ["metal-road.json", "crimson-horizon.json"]) {
  const map: Beatmap = JSON.parse(readFileSync(new URL(f, dir), "utf8"));
  for (const p of parts) console.log(`${f.slice(0, 8)} ${p}  ` + skills.map((s) => play(p, map, 7, s).padEnd(12)).join(""));
}
