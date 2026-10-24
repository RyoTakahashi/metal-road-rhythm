import "./ui/styles.css";
import { MEMBERS, sprite, type Member } from "./data/members";
import { SONGS, type Song } from "./data/songs";
import { LEVEL_COMBO } from "./game/chart";
import { CLEAR_RANK, RANKS, rankOrder, type Rank, type Result } from "./game/scoring";
import { unlock } from "./game/audio";
import { startPlay, type PlayHandle } from "./ui/play";
import { getBest, putBest, saveSettings, settings } from "./ui/settings";

const app = document.getElementById("app")!;
const base = import.meta.env.BASE_URL;

let play: PlayHandle | null = null;
let preview: HTMLAudioElement | null = null;
let member: Member = MEMBERS[0];
let song: Song = SONGS[0];

function stopPreview(): void {
  if (preview) {
    preview.pause();
    preview = null;
  }
}

function leave(): void {
  play?.destroy();
  play = null;
  stopPreview();
}

function bindKeys(map: Record<string, () => void>): void {
  const h = (e: KeyboardEvent) => {
    const f = map[e.code];
    if (f) {
      e.preventDefault();
      window.removeEventListener("keydown", h);
      f();
    }
  };
  window.addEventListener("keydown", h);
  currentKeyHandler?.();
  currentKeyHandler = () => window.removeEventListener("keydown", h);
}
let currentKeyHandler: (() => void) | null = null;

/* ------------------------------------------------------------------ */

function title(): void {
  leave();
  app.innerHTML = `
    <section class="screen title" style="background-image:url(${base}assets/bg/venue_big.webp)">
      <div class="title-chars">
        ${MEMBERS.map((m) => `<img src="${sprite(m, "fired")}" alt="${m.name}" />`).join("")}
      </div>
      <div class="logo">
        <h1>METAL ROAD</h1>
        <p class="sub">~ Rhythm! ~</p>
      </div>
      <button class="btn big start">START</button>
      <div class="title-links">
        <button class="btn ghost small howto-btn">遊び方</button>
        <button class="btn ghost small settings-btn">設定</button>
      </div>
      <p class="hint">PC: D F J K キー（または ←↓↑→）／ スマホ: レーンをタップ</p>
    </section>`;
  const go = async () => {
    await unlock();
    partSelect();
  };
  app.querySelector(".start")!.addEventListener("click", go);
  app.querySelector(".howto-btn")!.addEventListener("click", howTo);
  app.querySelector(".settings-btn")!.addEventListener("click", settingsDialog);
  bindKeys({ Enter: go, Space: go });
}

function howTo(): void {
  modal(`
    <h2>遊び方</h2>
    <p>パート（メンバー）を選んで、そのパートの譜面をクリアしよう。落ちてくるノーツが判定ラインに重なった瞬間に <kbd>D</kbd><kbd>F</kbd><kbd>J</kbd><kbd>K</kbd> を叩く。長いノーツは離さずに押し続ける。</p>
    <h3>Vo / Gt ― アドリブ型</h3>
    <p>最初は基本のリズムだけ。コンボが続いて観客が沸くほど、演奏Lvが上がって譜面が複雑になる（Lv2: ${LEVEL_COMBO[1]}コンボ / Lv3: ${LEVEL_COMBO[2]} / Lv4: ${LEVEL_COMBO[3]}）。ミスすると基本リズムに戻る。</p>
    <h3>Ba / Dr ― リズム厳守型</h3>
    <p>譜面は固定で、最初から手数が多い。判定が厳しく、<b>GOODでもコンボが切れる</b>。</p>
    <h3>観客ボルテージと評価</h3>
    <p>ヒットでボルテージが上がり（コンボ中ほど大きく）、ミスで下がる。曲の最後に「終了時のボルテージ」と「曲全体の平均ボルテージ」から <b>S / A / B / C / D</b> を判定。${CLEAR_RANK}以上でクリア。</p>
    <p class="small">音ズレを感じたら「設定」のタイミング調整で合わせてください。Esc で一時停止。</p>`);
}

function settingsDialog(): void {
  const m = modal(`
    <h2>設定</h2>
    <label class="field">ノーツ速度 <output class="o-scroll"></output>
      <input type="range" class="i-scroll" min="0.2" max="1.9" step="0.1" /></label>
    <label class="field">タイミング調整 <output class="o-offset"></output>
      <input type="range" class="i-offset" min="-200" max="200" step="5" /></label>
    <p class="small">判定が「SLOW」ばかりならマイナス、「FAST」ばかりならプラスへ。</p>
    <label class="field">打鍵音 <output class="o-tick"></output>
      <input type="range" class="i-tick" min="0" max="1" step="0.1" /></label>`);
  // `flip` maps between slider value and stored value (for speed, faster = shorter fall time)
  const bind = (cls: string, key: "scroll" | "offset" | "tick", fmt: (v: number) => string, flip = (v: number) => v) => {
    const i = m.querySelector(`.i-${cls}`) as HTMLInputElement;
    const o = m.querySelector(`.o-${cls}`) as HTMLOutputElement;
    i.value = String(flip(settings[key]));
    o.textContent = fmt(settings[key]);
    i.addEventListener("input", () => {
      settings[key] = Math.round(flip(Number(i.value)) * 100) / 100;
      o.textContent = fmt(settings[key]);
      saveSettings();
    });
  };
  bind("scroll", "scroll", (v) => `${((2.6 - v) * 5).toFixed(1)}`, (v) => 2.6 - v);
  bind("offset", "offset", (v) => `${v > 0 ? "+" : ""}${v}ms`);
  bind("tick", "tick", (v) => (v === 0 ? "OFF" : `${Math.round(v * 100)}%`));
}

function modal(html: string): HTMLElement {
  const wrap = document.createElement("div");
  wrap.className = "overlay modal";
  wrap.innerHTML = `<div class="panel wide">${html}<button class="btn close">閉じる</button></div>`;
  document.body.appendChild(wrap);
  const close = () => wrap.remove();
  wrap.querySelector(".close")!.addEventListener("click", close);
  wrap.addEventListener("click", (e) => {
    if (e.target === wrap) close();
  });
  return wrap;
}

/* ------------------------------------------------------------------ */

function clearedCount(m: Member): number {
  return SONGS.filter((s) => {
    const b = getBest(m.part, s.id);
    return b && rankOrder(b.rank as Rank) >= rankOrder(CLEAR_RANK);
  }).length;
}

function partSelect(): void {
  leave();
  app.innerHTML = `
    <section class="screen select">
      <header><button class="btn ghost small back">← タイトル</button><h2>パートを選択</h2><span></span></header>
      <div class="cards">
        ${MEMBERS.map(
          (m, i) => `
          <button class="card" data-i="${i}" style="--c:${m.color};--a:${m.accent}">
            <div class="card-part">${m.part}<small>${m.partName}</small></div>
            <img src="${sprite(m, "normal")}" alt="${m.name}" />
            <div class="card-body">
              <h3>${m.name} <small>${m.animal}</small></h3>
              <div class="tag ${m.part === "Vo" || m.part === "Gt" ? "ad" : "st"}">${m.style}</div>
              <p>${m.rule}</p>
              <q>${m.quote}</q>
              <div class="cleared">クリア ${clearedCount(m)} / ${SONGS.length}</div>
            </div>
          </button>`,
        ).join("")}
      </div>
    </section>`;
  app.querySelector(".back")!.addEventListener("click", title);
  app.querySelectorAll<HTMLButtonElement>(".card").forEach((c) =>
    c.addEventListener("click", () => {
      member = MEMBERS[Number(c.dataset.i)];
      songSelect();
    }),
  );
  bindKeys({ Escape: title });
}

function songSelect(): void {
  leave();
  const allCleared = MEMBERS.every((m) => clearedCount(m) === SONGS.length);
  app.innerHTML = `
    <section class="screen songs" style="--c:${member.color};--a:${member.accent}">
      <header><button class="btn ghost small back">← パート選択</button><h2>曲を選択</h2><span class="who">${member.name} / ${member.part}</span></header>
      <div class="songs-main">
        <img class="songs-char" src="${sprite(member, "happy")}" alt="${member.name}" />
        <ul class="song-list">
          ${SONGS.map((s, i) => {
            const b = getBest(member.part, s.id);
            return `<li><button class="song" data-i="${i}">
              <span class="stars">${"★".repeat(s.level)}${"☆".repeat(5 - s.level)}</span>
              <span class="song-title">${s.title}<small>${s.blurb}</small></span>
              <span class="song-meta">BPM ${Math.round(s.map.bpm)}<br />${Math.round(s.map.cutLength)}秒</span>
              <span class="best">${b ? `<b class="rank r-${b.rank}">${b.rank}</b>${b.fullCombo ? '<em class="fc">FC</em>' : ""}` : '<b class="rank none">-</b>'}</span>
            </button></li>`;
          }).join("")}
        </ul>
      </div>
      ${allCleared ? '<p class="all-clear">全パート全曲クリア！ METAL ROAD 完走おめでとう！</p>' : ""}
      <div class="songs-foot"><span class="sel-name"></span><button class="btn big play-btn" disabled>LIVE START</button></div>
    </section>`;
  const buttons = [...app.querySelectorAll<HTMLButtonElement>(".song")];
  const playBtn = app.querySelector<HTMLButtonElement>(".play-btn")!;
  const selName = app.querySelector<HTMLElement>(".sel-name")!;
  let sel = -1;
  const choose = (i: number) => {
    if (i === sel) return;
    sel = i;
    song = SONGS[i];
    buttons.forEach((b, k) => b.classList.toggle("on", k === i));
    buttons[i].scrollIntoView({ block: "nearest" });
    playBtn.disabled = false;
    selName.textContent = song.title;
    stopPreview();
    preview = new Audio(song.file);
    preview.volume = 0.5;
    preview.currentTime = 8;
    preview.loop = true;
    void preview.play().catch(() => {});
  };
  buttons.forEach((b, i) =>
    b.addEventListener("click", () => {
      if (sel === i) startLive();
      else choose(i);
    }),
  );
  const startLive = () => {
    if (sel < 0) return;
    stopPreview();
    live();
  };
  playBtn.addEventListener("click", startLive);
  app.querySelector(".back")!.addEventListener("click", partSelect);
  const keys = (): void =>
    bindKeys({
      ArrowDown: () => (choose(Math.min(SONGS.length - 1, sel + 1)), keys()),
      ArrowUp: () => (choose(Math.max(0, sel - 1)), keys()),
      Enter: () => (sel < 0 ? (choose(0), keys()) : startLive()),
      Escape: partSelect,
    });
  keys();
}

function live(): void {
  leave();
  currentKeyHandler?.();
  currentKeyHandler = null;
  play = startPlay(app, member, song, result, songSelect);
}

/* ------------------------------------------------------------------ */

function result(r: Result): void {
  leave();
  const isNew = putBest(member.part, song.id, { rank: r.rank, score: r.score, fullCombo: r.fullCombo });
  const top = rankOrder(r.rank) >= rankOrder("A");
  const mood = top ? "happy" : r.cleared ? "normal" : "sad";
  const line = top ? member.lines.top : r.cleared ? member.lines.mid : member.lines.low;
  const pts = r.history
    .map((v, i) => `${((i / Math.max(1, r.history.length - 1)) * 300).toFixed(1)},${(100 - v).toFixed(1)}`)
    .join(" ");
  const rankLines = RANKS.filter((x) => x.min > 0)
    .map((x) => `<line x1="0" x2="300" y1="${100 - x.min}" y2="${100 - x.min}" /><text x="302" y="${103 - x.min}">${x.rank}</text>`)
    .join("");
  app.innerHTML = `
    <section class="screen result" style="--c:${member.color};--a:${member.accent}">
      <div class="result-left">
        <img src="${sprite(member, mood)}" alt="${member.name}" />
        <div class="bubble">${line}</div>
      </div>
      <div class="result-right">
        <p class="res-song">${song.title} <span>${member.name} / ${member.part}</span></p>
        <div class="rank-big r-${r.rank}">${r.rank}</div>
        <p class="res-flags">${r.cleared ? '<b class="ok">LIVE CLEAR</b>' : '<b class="ng">LIVE FAILED</b>'}${r.fullCombo ? '<b class="fc">FULL COMBO</b>' : ""}${isNew && r.cleared ? '<b class="new">NEW RECORD</b>' : ""}</p>
        <div class="res-volt">
          <div><span>評価値</span><b>${r.score.toFixed(1)}</b></div>
          <div><span>終了時ボルテージ</span><b>${r.finalVoltage.toFixed(0)}</b></div>
          <div><span>平均ボルテージ</span><b>${r.avgVoltage.toFixed(0)}</b></div>
          <div><span>最大コンボ</span><b>${r.maxCombo}</b></div>
        </div>
        <svg class="graph" viewBox="0 0 312 100" preserveAspectRatio="none">
          <g class="ranks">${rankLines}</g>
          <polyline points="${pts}" />
        </svg>
        <table class="counts">
          <tr><th class="j-p">PERFECT</th><td>${r.counts.PERFECT}</td><th class="j-gr">GREAT</th><td>${r.counts.GREAT}</td></tr>
          <tr><th class="j-g">GOOD</th><td>${r.counts.GOOD}</td><th class="j-m">MISS</th><td>${r.counts.MISS}</td></tr>
        </table>
        <div class="res-buttons">
          <button class="btn retry">もう一度</button>
          <button class="btn ghost songs-btn">曲選択</button>
          <button class="btn ghost parts-btn">パート選択</button>
        </div>
      </div>
    </section>`;
  app.querySelector(".retry")!.addEventListener("click", live);
  app.querySelector(".songs-btn")!.addEventListener("click", songSelect);
  app.querySelector(".parts-btn")!.addEventListener("click", partSelect);
  bindKeys({ Enter: live, Escape: songSelect });
}

title();
