# Metal Road ~Rhythm!~

[Metal Road ~Success!~](https://github.com/RyoTakahashi/metal-road-success)（社会人メタルバンド育成シミュレーション）のスピンオフ。
キャラクター設定はそのままに、**パート別のリズムゲーム**にしたもの。

## 遊び方

1. タイトル → **パート（メンバー）を選択** → 曲を選択 → LIVE START
2. 落ちてくるノーツが判定ラインに重なった瞬間に叩く
   - PC: `D` `F` `J` `K`（または `←` `↓` `↑` `→`）、`Esc` で一時停止
   - スマホ: レーンをタップ（長押しノーツは押しっぱなし）
3. 曲の最後に **観客ボルテージ** から **S / A / B / C / D** を判定（C以上でクリア）

| メンバー | パート | タイプ | 譜面の特徴 |
|---|---|---|---|
| RYO（ライオン） | Vo | アドリブ型 | 基本はビートに乗るだけ。コンボが続くほど 8分→シンコペーション→メリスマ（16分の節回し）、ロングトーン、SHOUTレーンの同時押しが増える |
| KEN（トリ） | Gt | アドリブ型 | 4分のリフ → 8分リフ → パワーコード＋ギャロップ → 16分のスケール速弾き・タッピングのソロ小節 |
| MIO（カエル） | Ba | リズム厳守型 | 譜面固定。キックに合わせた8分の刻み＋ギャロップ、4小節ごとのウォークアップ |
| GO（ウサギ） | Dr | リズム厳守型 | 譜面固定。ツーバス（BD-L/BD-R交互）16分連打、スネア、クラッシュ、8小節ごとのフィル |

### アドリブ型（Vo / Gt）の演奏Lv

譜面は1小節ずつ「画面に入る直前」に生成され、そのときのコンボ数で演奏Lvが決まる。

| 演奏Lv | 必要コンボ | 名称 |
|---|---|---|
| 1 | 0 | 基本リズム |
| 2 | 12 | ノリノリ |
| 3 | 36 | ヒートアップ |
| 4 | 72 | 暴走モード |

ミスでコンボが切れると基本リズムに戻る（＝上手い人ほど譜面が派手になる）。

### リズム厳守型（Ba / Dr）

判定幅が狭く（PERFECT ±33ms / GREAT ±58ms / GOOD ±85ms。アドリブ型は ±50 / ±90 / ±130ms）、**GOODでもコンボが切れる**。

### 観客ボルテージと評価

- 0〜100、開始時 50。PERFECT / GREAT で上昇（コンボ中ほど上昇量が大きい、最大×1.6）、MISS で大きく下降。
- 評価値 = 終了時ボルテージ × 0.4 ＋ 曲全体の平均ボルテージ × 0.6
- S ≥ 90 / A ≥ 78 / B ≥ 62 / C ≥ 45 / D それ未満

`npm run sim` で、命中率別の模擬プレイヤーの評価と、各曲×パートの譜面密度（ノーツ数・NPS）を確認できる。

## 楽曲とカット

元プロジェクトの BGM 6曲（`metal-road-success` の `public/assets/bgm/`）を約60秒にカットして使用。

- `scripts/extract_beatmap.py` がフル音源を解析し、イントロ/アウトロを除いた最もエネルギーの高い60秒区間を小節頭にスナップして選ぶ。
- 同スクリプトがビートグリッド（BPM・位相）と、16分ごとのオンセット強度を3帯域（low=キック/ベース、mid=スネア/ギター、high=シンバル）で書き出す → `src/data/beatmaps/*.json`
- 譜面はこのデータから実行時に生成（`src/game/chart.ts`）。Ba/Dr は曲ごとに固定シード、Vo/Gt は小節単位で適応生成。
- カット音源は ffmpeg で切り出し（末尾2秒フェードアウト）→ `public/assets/bgm/*.cut.mp3`

再生成する場合：

```bash
pip install librosa
python3 scripts/extract_beatmap.py <full.mp3> src/data/beatmaps/<id>.json
# 出力された cutStart / cutLength で切り出し
ffmpeg -ss <cutStart> -t <cutLength> -i <full.mp3> -af "afade=t=in:d=0.03,afade=t=out:st=<cutLength-2>:d=2" -b:a 128k public/assets/bgm/<id>.cut.mp3
```

## 開発

```bash
npm install
npm run dev      # http://localhost:5173
npm run build    # 型チェック + 本番ビルド (dist/)
npm run sim      # 譜面密度・評価バランスの確認
```

- `?auto=1` を付けるとオートプレイ（デモ・動作確認用）。
- 設定（ノーツ速度・タイミング調整・打鍵音）とベスト記録は localStorage に保存。

## 構成

- `src/game/chart.ts` 譜面生成（固定 / 適応）
- `src/game/scoring.ts` 判定幅・観客ボルテージ・ランク
- `src/game/audio.ts` Web Audio 再生と曲時計
- `src/ui/play.ts` プレイ画面（Canvas のハイウェイ・観客・入力）
- `src/main.ts` タイトル / パート選択 / 曲選択 / リザルト
- `public/assets/chars/` 立ち絵（元プロジェクトの v2 スプライト：normal / happy / fired / sad）
