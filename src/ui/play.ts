// The play screen: note highway (canvas), crowd, HUD and input handling.

import { ADAPTIVE, AdaptiveCharter, FIRST_BAR, Grid, LANES, fixedChart, hashString, levelForCombo, nominalNotes, type Note } from "../game/chart";
import { SongPlayer, loadBuffer, tick, unlock } from "../game/audio";
import { Scorer, voltageLabel, windowsFor, type Judge, type Result } from "../game/scoring";
import { sprite, type Member, type Mood } from "../data/members";
import type { Song } from "../data/songs";
import { settings } from "./settings";

const LEAD_IN = 2.0;
/** `?auto=1` plays the chart by itself (demo / testing). */
const AUTO = new URLSearchParams(location.search).has("auto");
const KEYS = ["KeyD", "KeyF", "KeyJ", "KeyK"];
const KEY_LABELS = ["D", "F", "J", "K"];
const ALT_KEYS: Record<string, number> = { ArrowLeft: 0, ArrowDown: 1, ArrowUp: 2, ArrowRight: 3 };

const JUDGE_COLOR: Record<Judge, string> = {
  PERFECT: "#ffe65c",
  GREAT: "#5cf0ff",
  GOOD: "#9dff7a",
  MISS: "#ff4d6a",
};

const LEVEL_NAMES = ["", "基本リズム", "ノリノリ", "ヒートアップ", "暴走モード"];

interface Live extends Note {
  /** 0 pending, 1 holding, 2 done (hit), 3 missed */
  st: 0 | 1 | 2 | 3;
}

interface Fx {
  lane: number;
  at: number;
  color: string;
}

export interface PlayHandle {
  destroy(): void;
}

export function startPlay(
  root: HTMLElement,
  member: Member,
  song: Song,
  onFinish: (r: Result) => void,
  onQuit: () => void,
): PlayHandle {
  const part = member.part;
  const grid = new Grid(song.map);
  const seed = hashString(song.id + part);
  const adaptive = ADAPTIVE[part];
  const fixed = adaptive ? null : fixedChart(part, grid, seed);
  const charter = adaptive ? new AdaptiveCharter(part, grid, seed) : null;
  const win = windowsFor(part);
  const scorer = new Scorer(part, nominalNotes(part, grid, fixed));
  const notes: Live[] = fixed ? fixed.map((n) => ({ ...n, st: 0 })) : [];
  let nextBar = 0;
  let level = 1;
  const songEnd = (): number => {
    let e = grid.end;
    for (const n of notes) e = Math.max(e, n.end ?? n.t);
    return e + 1.2;
  };

  root.innerHTML = `
    <div class="play" style="--c:${member.color};--a:${member.accent}">
      <div class="play-bg"></div>
      <div class="hud">
        <div class="hud-song"><b>${song.title}</b><span>${member.name} / ${member.part}</span></div>
        <div class="volt">
          <div class="volt-label">観客ボルテージ <b class="volt-state"></b></div>
          <div class="volt-bar"><div class="volt-fill"></div><div class="volt-mark" style="left:45%"></div><div class="volt-mark s" style="left:90%"></div></div>
        </div>
        <button class="btn small pause-btn" aria-label="一時停止">II</button>
      </div>
      <div class="play-main">
        <div class="member-side">
          <img class="member-img" alt="${member.name}" src="${sprite(member, "normal")}" />
          <div class="level-box ${adaptive ? "" : "hidden"}"><span>演奏Lv</span><b class="lv">1</b><em class="lv-name">${LEVEL_NAMES[1]}</em></div>
          <div class="strict-box ${adaptive ? "hidden" : ""}">リズム厳守<br /><small>GOODでもコンボが切れる</small></div>
        </div>
        <canvas class="highway"></canvas>
      </div>
      <div class="lv-toast hidden"></div>
      <div class="overlay loading"><div class="spinner"></div><p>音源を読み込み中…</p></div>
      <div class="overlay pause hidden">
        <div class="panel">
          <h2>PAUSE</h2>
          <button class="btn" data-act="resume">再開</button>
          <button class="btn" data-act="retry">最初から</button>
          <button class="btn ghost" data-act="quit">曲選択に戻る</button>
        </div>
      </div>
    </div>`;

  const $ = <T extends HTMLElement>(s: string) => root.querySelector(s) as T;
  const canvas = $<HTMLCanvasElement>(".highway");
  const g = canvas.getContext("2d")!;
  const fill = $<HTMLDivElement>(".volt-fill");
  const voltState = $<HTMLElement>(".volt-state");
  const img = $<HTMLImageElement>(".member-img");
  const lvEl = $<HTMLElement>(".lv");
  const lvName = $<HTMLElement>(".lv-name");
  const toast = $<HTMLDivElement>(".lv-toast");
  const pauseOv = $<HTMLDivElement>(".overlay.pause");
  const loadingOv = $<HTMLDivElement>(".overlay.loading");
  $<HTMLDivElement>(".play-bg").style.backgroundImage = `url(${import.meta.env.BASE_URL}assets/bg/${song.level >= 4 ? "venue_big" : "venue_small"}.webp)`;

  // preload mood sprites so swaps don't flicker
  const moods: Mood[] = ["normal", "happy", "fired", "sad"];
  for (const m of moods) new Image().src = sprite(member, m);
  let mood: Mood = "normal";
  let sadUntil = 0;
  const setMood = (m: Mood) => {
    if (m === mood) return;
    mood = m;
    img.src = sprite(member, m);
  };

  let player: SongPlayer | null = null;
  let raf = 0;
  let destroyed = false;
  let finished = false;
  const held = [false, false, false, false];
  const holding: (Live | null)[] = [null, null, null, null];
  const fx: Fx[] = [];
  let popup: { j: Judge; at: number; fast: number } | null = null;
  let nextSample = 0;
  let lastBeatFlash = -1;
  let toastTimer = 0;

  const now = (): number => (player ? player.time(settings.offset / 1000) : -LEAD_IN);

  /* -------------------------------- chart -------------------------------- */

  function generateAhead(t: number): void {
    if (!charter) return;
    const look = settings.scroll + 1.0;
    while (nextBar <= grid.bars && grid.barStart(nextBar) - t < look) {
      const lv = levelForCombo(scorer.combo);
      if (lv !== level) {
        if (lv > level && nextBar > FIRST_BAR) showToast(lv);
        level = lv;
        lvEl.textContent = String(lv);
        lvName.textContent = LEVEL_NAMES[lv];
      }
      for (const n of charter.bar(nextBar, level)) notes.push({ ...n, st: 0 });
      nextBar++;
    }
  }

  function showToast(lv: number): void {
    toast.textContent = lv === 4 ? "観客が熱狂！ 暴走モード突入！" : `観客がヒートアップ！ 演奏Lv.${lv}`;
    toast.classList.remove("hidden");
    toast.classList.remove("pop");
    void toast.offsetWidth;
    toast.classList.add("pop");
    clearTimeout(toastTimer);
    toastTimer = window.setTimeout(() => toast.classList.add("hidden"), 1600);
  }

  /* ------------------------------- judging ------------------------------- */

  function judge(j: Judge, lane: number, t: number, delta = 0): void {
    scorer.judge(j);
    popup = { j, at: t, fast: j === "PERFECT" || j === "MISS" ? 0 : Math.sign(delta) };
    if (j === "MISS") sadUntil = t + 0.9;
    else fx.push({ lane, at: t, color: JUDGE_COLOR[j] });
  }

  function press(lane: number): void {
    if (held[lane]) return;
    held[lane] = true;
    if (!player || player.paused || finished) return;
    const t = now();
    tick(lane, settings.tick);
    let best: Live | null = null;
    for (const n of notes) {
      if (n.st !== 0 || n.lane !== lane) continue;
      if (n.t - t > win.miss) break; // notes are time-sorted
      if (Math.abs(n.t - t) <= win.miss && (!best || n.t < best.t)) best = n;
    }
    if (!best) return;
    const d = t - best.t;
    const ad = Math.abs(d);
    let j: Judge;
    if (ad <= win.perfect) j = "PERFECT";
    else if (ad <= win.great) j = "GREAT";
    else if (ad <= win.good) j = "GOOD";
    else j = "MISS";
    if (j !== "MISS" && best.end !== undefined) {
      best.st = 1;
      holding[lane] = best;
    } else best.st = j === "MISS" ? 3 : 2;
    judge(j, lane, t, d);
  }

  function release(lane: number): void {
    held[lane] = false;
    const h = holding[lane];
    if (!h || !player) return;
    const t = now();
    holding[lane] = null;
    if (t < h.end! - 0.12) {
      h.st = 3;
      judge("MISS", lane, t);
    } else {
      h.st = 2;
      judge("PERFECT", lane, t);
    }
  }

  function autoplay(t: number): void {
    for (let l = 0; l < LANES; l++) {
      const h = holding[l];
      if (held[l] && (!h || t >= h.end!)) release(l);
    }
    for (const n of notes) {
      if (n.t > t) break;
      if (n.st === 0) press(n.lane);
    }
    for (let l = 0; l < LANES; l++) if (held[l] && !holding[l]) release(l);
  }

  function update(t: number): void {
    generateAhead(t);
    if (charter) notes.sort((a, b) => a.t - b.t);
    if (AUTO) autoplay(t);
    for (const n of notes) {
      if (n.st === 0 && t - n.t > win.good) {
        n.st = 3;
        judge("MISS", n.lane, t);
        if (n.end !== undefined) scorer.judge("MISS"); // the tail is lost too
      } else if (n.t > t + win.miss) break;
    }
    for (let l = 0; l < LANES; l++) {
      const h = holding[l];
      if (h && t >= h.end!) {
        holding[l] = null;
        h.st = 2;
        judge("PERFECT", l, t);
      }
    }
    const beats = song.map.beats;
    while (nextSample < beats.length && beats[nextSample] <= t) {
      if (nextSample >= FIRST_BAR * 4) scorer.sample();
      nextSample++;
    }
    // HUD
    const v = scorer.voltage;
    fill.style.width = `${v}%`;
    fill.style.filter = `hue-rotate(${(v - 50) * -1.2}deg)`;
    voltState.textContent = `${voltageLabel(v)} ${Math.round(v)}`;
    if (t < sadUntil) setMood("sad");
    else if (scorer.combo >= 36 || v >= 85) setMood("fired");
    else if (scorer.combo >= 12 || v >= 65) setMood("happy");
    else setMood("normal");

    if (!finished && t > songEnd()) {
      finished = true;
      // drain any still-held holds as completed
      for (let l = 0; l < LANES; l++) if (holding[l]) release(l);
      setTimeout(() => {
        if (!destroyed) onFinish(scorer.result());
      }, 400);
    }
  }

  /* ------------------------------- drawing ------------------------------- */

  let W = 0,
    H = 0,
    dpr = 1;
  function resize(): void {
    dpr = Math.min(2, window.devicePixelRatio || 1);
    const r = canvas.getBoundingClientRect();
    W = r.width;
    H = r.height;
    canvas.width = Math.round(W * dpr);
    canvas.height = Math.round(H * dpr);
  }
  resize();
  const ro = new ResizeObserver(resize);
  ro.observe(canvas);

  const laneColors = member.laneColors;
  const crowdSeeds = Array.from({ length: 34 }, (_, i) => ({ x: (i + 0.5) / 34 + (Math.sin(i * 12.9) * 0.4) / 34, s: 0.7 + ((i * 37) % 10) / 22, ph: (i * 0.37) % 1 }));

  function beatPhase(t: number): { idx: number; frac: number } {
    const b = song.map.beats;
    if (t < b[0]) return { idx: -1, frac: 0 };
    let i = Math.min(b.length - 2, Math.max(0, Math.floor((t - b[0]) / ((b[b.length - 1] - b[0]) / (b.length - 1)))));
    while (i > 0 && b[i] > t) i--;
    while (i < b.length - 2 && b[i + 1] <= t) i++;
    return { idx: i, frac: Math.min(1, (t - b[i]) / (b[i + 1] - b[i])) };
  }

  function draw(t: number): void {
    g.setTransform(dpr, 0, 0, dpr, 0, 0);
    g.clearRect(0, 0, W, H);
    const hw = Math.min(W - 16, 440);
    const x0 = (W - hw) / 2;
    const lw = hw / LANES;
    const crowdH = Math.min(90, H * 0.14);
    const judgeY = H - crowdH - 46;
    const scroll = settings.scroll;
    const yOf = (tt: number) => judgeY - ((tt - t) / scroll) * judgeY;
    const v = scorer.voltage;
    const bp = beatPhase(t);
    const pulse = bp.idx >= 0 ? Math.pow(1 - bp.frac, 3) : 0;

    // highway body
    const grad = g.createLinearGradient(0, 0, 0, judgeY);
    grad.addColorStop(0, "rgba(10,10,18,0.15)");
    grad.addColorStop(1, "rgba(10,10,18,0.82)");
    g.fillStyle = grad;
    g.fillRect(x0, 0, hw, judgeY + 40);
    for (let l = 0; l < LANES; l++) {
      if (held[l]) {
        const lg = g.createLinearGradient(0, judgeY - 220, 0, judgeY);
        lg.addColorStop(0, "rgba(255,255,255,0)");
        lg.addColorStop(1, hexA(laneColors[l], 0.35));
        g.fillStyle = lg;
        g.fillRect(x0 + l * lw, judgeY - 220, lw, 220);
      }
      g.fillStyle = "rgba(255,255,255,0.08)";
      if (l > 0) g.fillRect(x0 + l * lw - 0.5, 0, 1, judgeY + 40);
    }
    g.strokeStyle = hexA(member.color, 0.6);
    g.lineWidth = 2;
    g.strokeRect(x0, -2, hw, judgeY + 42);

    // beat / bar lines
    const beats = song.map.beats;
    for (let i = 0; i < beats.length; i++) {
      const y = yOf(beats[i]);
      if (y < -4) break;
      if (y > judgeY) continue;
      g.fillStyle = i % 4 === 0 ? "rgba(255,255,255,0.28)" : "rgba(255,255,255,0.09)";
      g.fillRect(x0, y, hw, i % 4 === 0 ? 2 : 1);
    }

    // combo (behind notes)
    if (scorer.combo >= 5) {
      g.textAlign = "center";
      g.fillStyle = `rgba(255,255,255,${0.16 + 0.1 * pulse})`;
      g.font = `900 ${Math.round(hw / 4.2)}px "Impact", "Arial Black", sans-serif`;
      g.fillText(String(scorer.combo), x0 + hw / 2, judgeY * 0.42);
      g.font = `700 ${Math.round(hw / 20)}px sans-serif`;
      g.fillText("COMBO", x0 + hw / 2, judgeY * 0.42 + hw / 14);
    }

    // judgement line
    g.fillStyle = hexA(member.color, 0.5 + 0.5 * pulse);
    g.fillRect(x0, judgeY - 2, hw, 4);
    for (let l = 0; l < LANES; l++) {
      const cx = x0 + l * lw + lw / 2;
      g.fillStyle = held[l] ? hexA(laneColors[l], 0.9) : "rgba(255,255,255,0.12)";
      roundRect(g, x0 + l * lw + 4, judgeY + 6, lw - 8, 30, 6);
      g.fill();
      g.fillStyle = held[l] ? "#111" : "rgba(255,255,255,0.75)";
      g.font = `800 ${Math.round(Math.min(15, lw / 5.5))}px sans-serif`;
      g.textAlign = "center";
      g.fillText(`${member.lanes[l]}`, cx, judgeY + 20);
      g.font = `600 10px sans-serif`;
      g.fillStyle = held[l] ? "#111" : "rgba(255,255,255,0.45)";
      g.fillText(KEY_LABELS[l], cx, judgeY + 32);
    }

    // notes
    const nh = Math.max(12, Math.min(20, lw * 0.2));
    let lastChordT = -1;
    for (const n of notes) {
      const y = yOf(n.t);
      if (y < -60 && (n.end === undefined || yOf(n.end) < -60)) break;
      if (n.st === 2 || n.st === 3) continue;
      const nx = x0 + n.lane * lw;
      const c = laneColors[n.lane];
      if (n.end !== undefined) {
        const yTop = Math.max(-10, yOf(n.end));
        const yBot = n.st === 1 ? judgeY : y;
        if (yBot > -10) {
          g.fillStyle = hexA(c, n.st === 1 ? 0.65 : 0.4);
          g.fillRect(nx + lw * 0.3, yTop, lw * 0.4, yBot - yTop);
        }
      }
      if (n.st === 1) continue;
      if (y > H) continue;
      if (n.chord && n.t !== lastChordT) {
        // link the notes of a chord
        const same = notes.filter((m) => m.t === n.t && m.st === 0);
        if (same.length > 1) {
          const ls = same.map((m) => m.lane);
          g.fillStyle = "rgba(255,255,255,0.55)";
          g.fillRect(x0 + Math.min(...ls) * lw + lw / 2, y - 1.5, (Math.max(...ls) - Math.min(...ls)) * lw, 3);
        }
        lastChordT = n.t;
      }
      g.fillStyle = c;
      g.shadowColor = c;
      g.shadowBlur = 10;
      roundRect(g, nx + 5, y - nh / 2, lw - 10, nh, nh / 2.5);
      g.fill();
      g.shadowBlur = 0;
      g.fillStyle = "rgba(255,255,255,0.75)";
      g.fillRect(nx + 12, y - nh / 2 + 3, lw - 24, 2.5);
    }

    // hit effects
    for (let i = fx.length - 1; i >= 0; i--) {
      const e = fx[i];
      const k = (t - e.at) / 0.32;
      if (k >= 1 || k < 0) {
        fx.splice(i, 1);
        continue;
      }
      const cx = x0 + e.lane * lw + lw / 2;
      g.strokeStyle = hexA(e.color, 1 - k);
      g.lineWidth = 4 * (1 - k) + 1;
      g.beginPath();
      g.ellipse(cx, judgeY, lw * (0.3 + 0.5 * k), nh * (0.8 + 1.6 * k), 0, 0, Math.PI * 2);
      g.stroke();
      g.fillStyle = hexA(e.color, 0.35 * (1 - k));
      g.fillRect(x0 + e.lane * lw, 0, lw, judgeY);
    }

    // judgement popup
    if (popup && t - popup.at < 0.5) {
      const k = (t - popup.at) / 0.5;
      g.textAlign = "center";
      g.font = `900 ${Math.round(hw / 10 * (1 + 0.15 * (1 - k)))}px "Impact", "Arial Black", sans-serif`;
      g.fillStyle = hexA(JUDGE_COLOR[popup.j], 1 - k * k);
      g.fillText(popup.j, x0 + hw / 2, judgeY * 0.7);
      if (popup.fast) {
        g.font = "700 13px sans-serif";
        g.fillStyle = popup.fast < 0 ? "rgba(120,200,255,0.9)" : "rgba(255,150,120,0.9)";
        g.fillText(popup.fast < 0 ? "FAST" : "SLOW", x0 + hw / 2, judgeY * 0.7 + 20);
      }
    }

    // count-in
    if (t < grid.barStart(FIRST_BAR)) {
      const left = grid.barStart(FIRST_BAR) - t;
      const ibi = (beats[1] - beats[0]) || 0.6;
      const n = Math.ceil(left / ibi);
      g.textAlign = "center";
      g.font = `900 ${Math.round(hw / 5)}px "Impact", "Arial Black", sans-serif`;
      g.fillStyle = "rgba(255,255,255,0.9)";
      g.fillText(t < 0 ? "READY" : n <= 4 ? String(n) : "", x0 + hw / 2, judgeY * 0.45);
    }

    // crowd
    const cy = H;
    const lit = v / 100;
    if (bp.idx !== lastBeatFlash && bp.idx >= 0) lastBeatFlash = bp.idx;
    for (const c of crowdSeeds) {
      const x = c.x * W;
      const amp = 3 + 18 * lit * lit;
      const ph = (bp.frac + c.ph * (1 - lit)) % 1;
      const bounce = bp.idx >= 0 ? Math.abs(Math.sin(ph * Math.PI)) * amp : 0;
      const r = crowdH * 0.2 * c.s;
      const by = cy - crowdH * 0.35 * c.s - bounce;
      const shade = Math.round(30 + 80 * lit);
      g.fillStyle = `rgb(${shade},${Math.round(shade * 0.6)},${Math.round(shade * 1.1)})`;
      // body
      roundRect(g, x - r * 1.3, by + r * 0.6, r * 2.6, crowdH, r);
      g.fill();
      // head
      g.beginPath();
      g.arc(x, by, r, 0, Math.PI * 2);
      g.fill();
      // arms up once the crowd is into it (horns!)
      if (v >= 55) {
        g.strokeStyle = g.fillStyle as string;
        g.lineWidth = Math.max(2, r * 0.45);
        g.lineCap = "round";
        const up = r * (1.6 + 0.8 * lit) + bounce * 0.3;
        g.beginPath();
        g.moveTo(x + r * 1.0, by + r);
        g.lineTo(x + r * 1.5, by - up);
        if (v >= 80) {
          g.moveTo(x - r * 1.0, by + r);
          g.lineTo(x - r * 1.5, by - up);
        }
        g.stroke();
      }
    }
    // stage light wash tied to voltage
    if (lit > 0.6) {
      g.fillStyle = hexA(member.accent, (lit - 0.6) * 0.25 * (0.5 + pulse));
      g.fillRect(0, cy - crowdH * 1.4, W, crowdH * 1.4);
    }
  }

  /* -------------------------------- loop --------------------------------- */

  function frame(): void {
    if (destroyed) return;
    const t = now();
    if (player && !player.paused) update(t);
    draw(t);
    raf = requestAnimationFrame(frame);
  }

  /* ------------------------------- input --------------------------------- */

  const laneOfKey = (code: string): number => {
    const i = KEYS.indexOf(code);
    return i >= 0 ? i : ALT_KEYS[code] ?? -1;
  };
  const onKeyDown = (e: KeyboardEvent) => {
    if (e.code === "Escape" || e.code === "KeyP") {
      togglePause();
      return;
    }
    const l = laneOfKey(e.code);
    if (l < 0 || e.repeat) return;
    e.preventDefault();
    press(l);
  };
  const onKeyUp = (e: KeyboardEvent) => {
    const l = laneOfKey(e.code);
    if (l >= 0) release(l);
  };
  const pointers = new Map<number, number>();
  const laneAt = (clientX: number): number => {
    const r = canvas.getBoundingClientRect();
    const hw = Math.min(r.width - 16, 440);
    const x0 = r.left + (r.width - hw) / 2;
    // the whole width is touchable, split at the lane boundaries
    return Math.max(0, Math.min(LANES - 1, Math.floor(((clientX - x0) / hw) * LANES)));
  };
  const onPointerDown = (e: PointerEvent) => {
    e.preventDefault();
    const l = laneAt(e.clientX);
    pointers.set(e.pointerId, l);
    press(l);
  };
  const onPointerUp = (e: PointerEvent) => {
    const l = pointers.get(e.pointerId);
    if (l === undefined) return;
    pointers.delete(e.pointerId);
    if (![...pointers.values()].includes(l)) release(l);
  };
  const onVisibility = () => {
    if (document.hidden && player && !player.paused && !finished) togglePause();
  };
  window.addEventListener("keydown", onKeyDown);
  window.addEventListener("keyup", onKeyUp);
  canvas.addEventListener("pointerdown", onPointerDown);
  window.addEventListener("pointerup", onPointerUp);
  window.addEventListener("pointercancel", onPointerUp);
  document.addEventListener("visibilitychange", onVisibility);

  function togglePause(): void {
    if (!player || finished) return;
    if (player.paused) {
      pauseOv.classList.add("hidden");
      player.resume(1.5);
    } else {
      player.pause();
      for (let l = 0; l < LANES; l++) held[l] = false;
      pauseOv.classList.remove("hidden");
    }
  }
  $<HTMLButtonElement>(".pause-btn").addEventListener("click", togglePause);
  pauseOv.addEventListener("click", (e) => {
    const act = (e.target as HTMLElement).dataset.act;
    if (act === "resume") togglePause();
    else if (act === "retry") {
      handle.destroy();
      Object.assign(handle, startPlay(root, member, song, onFinish, onQuit));
    } else if (act === "quit") onQuit();
  });

  /* ------------------------------- start --------------------------------- */

  raf = requestAnimationFrame(frame);
  unlock()
    .then(() => loadBuffer(song.file))
    .then((buf) => {
      if (destroyed) return;
      loadingOv.classList.add("hidden");
      player = new SongPlayer(buf);
      player.start(LEAD_IN);
    })
    .catch((err) => {
      loadingOv.innerHTML = `<p>音源の読み込みに失敗しました<br><small>${String(err)}</small></p><button class="btn">戻る</button>`;
      loadingOv.querySelector("button")!.addEventListener("click", onQuit);
    });

  const handle: PlayHandle = {
    destroy() {
      destroyed = true;
      cancelAnimationFrame(raf);
      clearTimeout(toastTimer);
      ro.disconnect();
      player?.stop();
      window.removeEventListener("keydown", onKeyDown);
      window.removeEventListener("keyup", onKeyUp);
      window.removeEventListener("pointerup", onPointerUp);
      window.removeEventListener("pointercancel", onPointerUp);
      document.removeEventListener("visibilitychange", onVisibility);
    },
  };
  return handle;
}

function hexA(hex: string, a: number): string {
  const h = hex.replace("#", "");
  const n = parseInt(h.length === 3 ? h.replace(/./g, "$&$&") : h, 16);
  return `rgba(${(n >> 16) & 255},${(n >> 8) & 255},${n & 255},${Math.max(0, Math.min(1, a))})`;
}

function roundRect(g: CanvasRenderingContext2D, x: number, y: number, w: number, h: number, r: number): void {
  const rr = Math.min(r, w / 2, h / 2);
  g.beginPath();
  g.moveTo(x + rr, y);
  g.arcTo(x + w, y, x + w, y + h, rr);
  g.arcTo(x + w, y + h, x, y + h, rr);
  g.arcTo(x, y + h, x, y, rr);
  g.arcTo(x, y, x + w, y, rr);
  g.closePath();
}
