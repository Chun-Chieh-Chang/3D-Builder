# ADR 0265 的探針與量測資料

這裡是 [ADR 0265](../../docs/adr/0265-fillet-across-c1-joints.md) 與 2026-11-24「長測試效能」那一節 DEV_LOG 的探針原稿，以及當時量到的原始輸出。它們不在 `vitest.config.ts` 的 `include` 裡，`npm test` 不會跑；也不在 `tsconfig.json` 的範圍內，`typecheck` 不檢查。每個探針都寫進 `out/prof46/` 或 `out/fillet-probe/`（兩者都被 `.gitignore` 排除）。

## 怎麼跑

單一探針（探針設定只收這個資料夾的 `*.test.ts`；不要改成 `mergeConfig`，它會把 `include` 串接成整套測試）：

```powershell
npx vitest run --config spikes/0265-fillet-c1-joints/vitest.prof.mts spikes/0265-fillet-c1-joints/split100.test.ts
```

接受環境變數的探針（PowerShell）：

```powershell
$env:SEEDS = '96,53,7,46,92'; npx vitest run --config spikes/0265-fillet-c1-joints/vitest.prof.mts spikes/0265-fillet-c1-joints/c2.test.ts
```

全套件圓角探針（ADR 0265 驗收標準第 1 項的基準；同樣的檔案與 worker 數，每次 `Kernel.fillet` 記一行到 `out/fillet-probe/<pid>.jsonl`，本機約 70 分鐘）：

```powershell
npx vitest run --config spikes/0265-fillet-c1-joints/vitest.fillet.mts
```

```powershell
node spikes/0265-fillet-c1-joints/summarize.mjs out/fillet-probe
```

## 各檔是什麼

| 檔案 | 量什麼 | 原始輸出 |
|---|---|---|
| `p46.test.ts`、`analyze.mjs` | seed 46 在 worker 內以 inspector 取樣（`--cpu-prof` 在 worker 被結束時不寫檔）；`analyze.mjs` 依函式彙總 | （2.4 MB，未入庫） |
| `t46.test.ts`、`t96.test.ts` | 包住 `Kernel` 的方法，逐次計時每次圓角、每種形狀 | `data/t46.log`、`data/t96.log` |
| `g46.test.ts`、`x46.test.ts` | seed 46 重建件寫成 STEP；原件與重建件同一條邊的曲線與 OCCT 圓角耗時 | `data/g46.log`、`data/x46.log`、`data/rebuilt.step` |
| `diag.test.ts` | OCCT 自己的診斷：`Simulate` 與 `Build` 分開計時、`StripeStatus`、算出的面數；`SEEDS`、`RADII` | `data/diag.log`、`data/diag-slow.log` |
| `curv.test.ts`、`ends.test.ts` | 100 組的最緊凹彎半徑、樣條兩端轉角（已排除的兩個原因） | `data/curv.json`、`data/ends.json` |
| `c2.test.ts` | 同一輪廓換成 C2 曲線、或先在接縫切開，圓角的成敗與時間；`SEEDS` | `data/c2.log` |
| `split100.test.ts` | 100 組全做：不切開與切開後的成敗、時間、體積、拓樸 | `data/split100.json` |
| `s39.test.ts` | seed 39 的退步，以及精確滾球圓角在切開後的結果 | `data/s39.log` |
| `fillet-setup.ts`、`vitest.fillet.mts`、`summarize.mjs` | 全套件圓角探針與彙總（2026-11-24 的證據：189 次容差被拒、救回 0） | `data/fillet-calls.jsonl`（3353 次） |
| `compare.mjs` | 本機 fuzz 輸出與 CI 日誌的逐件比對（注意：CI 日誌沒有檔案標頭，`#種子` 的列印在不同 kit 間撞號） | — |
| `mutate.mjs` | 提交 `b49a50e6` 的三項突變檢查（每項比對須恰好一次，跑完逐位元組還原） | — |
| `w54.test.ts` | 2026-11-26 CI 紅燈（window-rounds fuzz-14）：單一種子在全新 Heap 上做零件並辨識，逐次記下每次圓角（切開與否、時間、Heap）與每次重建；`SEEDS`、`CUT=on\|off`（off：`cutAtJoints` 回傳 null）、`NOLIMIT=1`（取消 512 MiB 預算，看最後結果）、`FRESH=1`（在另一個全新 Heap 上只重建一次結果） | `data/w54-off-*`、`data/w54-on-nolimit-*`（共用重建之前）、`data/w54-old-54.log`（核心三檔換回 `464366fa`）、`data/w54-shared-*`（共用重建之後） |
| `chamfer100.test.ts` | ADR 0265 §11：100 組樣條牆倒角，不切開與切開的成敗、時間、補上的體積對 d²/2 × 邊長 | `data/chamfer100.jsonl` |
| `w54heap.test.ts` | 同一件辨識時，依 `Kernel` 方法彙總 Heap 成長與時間 | `data/w54heap-on-54.log` |
| `window-outcomes.mjs` | window-rounds 100 組逐件分類，三份日誌對照（只認該 fuzz 檔標頭下的 `#種子`） | `data/window-outcomes.txt` |
| `mutate-shared.mjs` | 共用重建的四項突變（每項比對須恰好一次，跑完逐位元組還原） | — |
| `mutate-0265.mjs` | ADR 0265 實作的八項突變（§9.5）：先確認目標測試未突變時全綠，每項比對須恰好一次，跑完逐位元組還原；可只跑一項：`node spikes/0265-fillet-c1-joints/mutate-0265.mjs no-cut` | `out/mutate-0265.log` |

量測當時的提交：`908ca3b6`（探針本身與產品程式無關，只讀）。
