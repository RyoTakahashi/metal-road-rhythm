// The four members of the band, carried over unchanged from
// Metal Road ~Success!~ (see that repo's dna/*.yaml).

export type PartId = "Vo" | "Gt" | "Ba" | "Dr";
export type Mood = "normal" | "happy" | "fired" | "sad";

export interface Member {
  id: string;
  name: string;
  part: PartId;
  partName: string;
  animal: string;
  color: string;
  accent: string;
  /** Note colors per lane (bright enough to read on the dark highway). */
  laneColors: [string, string, string, string];
  /** Lane labels shown at the judgement line. */
  lanes: [string, string, string, string];
  /** Rule summary for the part-select card. */
  style: string;
  rule: string;
  quote: string;
  /** Result-screen lines per rank group. */
  lines: { top: string; mid: string; low: string };
}

export const MEMBERS: Member[] = [
  {
    id: "ryo",
    laneColors: ["#e8a83b", "#ffd27a", "#ff8fa6", "#ff5577"],
    name: "RYO",
    part: "Vo",
    partName: "ボーカル",
    animal: "ライオン",
    color: "#e8a83b",
    accent: "#ff5577",
    lanes: ["LOW", "MID", "HIGH", "SHOUT"],
    style: "アドリブ型",
    rule: "基本はリズムに乗るだけ。観客が沸くほど（コンボが続くほど）メロディが暴れ出し、ロングトーンやシャウトが増える。",
    quote: "客を煽って巻き込め！もっと声出していけぇ！",
    lines: {
      top: "最高の夜だ！お前らの声、ちゃんと届いてたぜ！",
      mid: "悪くねえ。でも次はもっと煽ってやる。",
      low: "くっ…喉が温まってなかっただけだ！もう一回！",
    },
  },
  {
    id: "ken",
    laneColors: ["#ffcf3a", "#fff08a", "#ffb35c", "#ff8a3a"],
    name: "KEN",
    part: "Gt",
    partName: "ギター",
    animal: "トリ",
    color: "#ffcf3a",
    accent: "#7a5a3a",
    lanes: ["6弦", "4弦", "2弦", "1弦"],
    style: "アドリブ型",
    rule: "最初はシンプルなリフ。ボルテージが上がるほど和音・ギャロップ・速弾きソロへと進化していく。",
    quote: "このリフ、もっと邪悪にできるだろ？",
    lines: {
      top: "今のソロ、羽が逆立ったぜ！最高に邪悪だった！",
      mid: "まあまあだな。次はもっとBPMあげまくろうぜ！",
      low: "指がもつれた…弦のせいだ、弦の！",
    },
  },
  {
    id: "mio",
    laneColors: ["#3aa0ff", "#7fd0ff", "#5fd6a8", "#4fe0b0"],
    name: "MIO",
    part: "Ba",
    partName: "ベース",
    animal: "カエル",
    color: "#3aa0ff",
    accent: "#3f8a6e",
    lanes: ["E", "A", "D", "G"],
    style: "リズム厳守型",
    rule: "譜面は固定。判定は厳しめで、GOODでもコンボが切れる。キックに合わせた刻みとギャロップが絶え間なく続く。",
    quote: "…低音は、裏切らない。",
    lines: {
      top: "…完璧。バンドの土台、守り切った。",
      mid: "…悪くない。でも、まだ揺れてた。",
      low: "…テンポ、もう一度合わせよう。",
    },
  },
  {
    id: "go",
    laneColors: ["#2fbf71", "#e6e6e6", "#7dffb0", "#7dffb0"],
    name: "GO",
    part: "Dr",
    partName: "ドラム",
    animal: "ウサギ",
    color: "#2fbf71",
    accent: "#e6e6e6",
    lanes: ["CY", "SN", "BD-L", "BD-R"],
    style: "リズム厳守型",
    rule: "譜面は固定。判定は厳しめで、GOODでもコンボが切れる。ツーバス連打とスネア、クラッシュで手数勝負！",
    quote: "いっくよー！ツーバス全開で踏みまくるよ！",
    lines: {
      top: "やったー！足が止まらなかった！みんなありがと～！",
      mid: "いい感じ！でももっと速く踏めるはず！",
      low: "うぅ…足がつりそう…もう一回やらせて！",
    },
  },
];

export const memberByPart = (p: PartId): Member => MEMBERS.find((m) => m.part === p)!;

const base = import.meta.env.BASE_URL;
export const sprite = (m: Member, mood: Mood): string => `${base}assets/chars/${m.id}.${mood}.webp`;
