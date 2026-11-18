# 接手指令：part-3 重建（STEP 特徵辨識）

把本檔整段貼給本機（Windows）的 Claude Code，作為第一則訊息。part-3 的探針與開發要在你的電腦跑：實件在 `D:\3DB實機確認`，單次辨識用 400～800 MiB 以上記憶體，稽核一輪要好幾分鐘。

---

你要接手 3D-Builder 的 part-3 重建。使用者已核准驗收清單（設計文件 §6s）。請用 ASD-STE100 的方式回覆：句子短、一句一件事、主動語態、用詞一致，以繁體中文回答。

## 1. 先做這些，再動手

```bash
git status --short --branch
git fetch origin
git switch main
git pull --ff-only
git log -8 --oneline
```

工作區有在途變更時，先確認歸屬並保留，不直接切換或覆寫。

依序閱讀：
1. `AGENTS.md`：強制規則（§3.3 不得放寬門檻、§3.5 堆量測、§3.6 CI 失敗不得標「既有」）。
2. `handoff.md` §0：待辦與接手守則。
3. `docs/design/feature-recognition/freeform-generalization.md` §6l、§6m、§6o、§6o-A、§6o-B、§6p、**§6s（已核准的驗收清單）**。
4. `DEV_LOG.md` 2026-11-17 與 2026-11-18 的條目。

取回探針工具（`scratch/` 不追蹤）：

```bash
git fetch origin handoff/scratch-tools && git checkout origin/handoff/scratch-tools -- scratch && git reset scratch
```

實件 STEP 在 `D:\3DB實機確認` 根目錄。跑探針前 `export STEP_DIR=...`，用 `scratch/ff/c5a-run.mjs` 各自一個行程執行。

## 2. 進度頁（使用者要求）

使用者要看到一個會動、每 3 分鐘自動更新的進度頁。檔案已在 `scratch/claude-takeover/dev/`：
- `part3.html`：頁面。用瀏覽器開，每 3 分鐘重新讀 `part3-data.js`。
- `part3-set.mjs`：更新狀態。用法：`node part3-set.mjs --mode running --now "現在在做什麼" "項目id=ok" "項目id=doing" "項目id=fail:原因"`。備註含空格時整段要加引號。

規則：
- 每完成一個小項目就更新一次，讓進度條動起來。
- 工作期間 `--mode running`；停下來等使用者時 `--mode waiting`。
- 頁面在 15 分鐘沒更新時，自動顯示紅色「工作已中斷」。所以長時間的單一指令（例如稽核）之前，先更新一次，並在指令跑的時候每幾分鐘再更新一次。
- 需要新增項目時直接改 `part3-state.json`，再跑一次 `part3-set.mjs`。

## 3. 工作內容

**只做 Stage 0′ 重試。** 它是探針，不改產品程式（§6s）。

1. 取回 B 區窗口各面的清單（f66、f70、f79、f80、f81、f149、f150、f152、f154、f156、f158、f160）。
2. 不經 `Kernel.deleteFaces`，建銳邊窗口本體：殼減 f80 拔模工具，端接與真實窗口一致，包含與 f150、f154 相接的角點。
3. 在其上以 OCCT 圓角重建 r 0.127 邊緣倒角。`Kernel.fillet(..., exact)` 不處理角點，不得當作通過依據。
4. 逐面比對原件：各面離原面最大距離 ≤ τ、面數與圓角數等於原件該區、體積差在 τ 級。
5. 過關判定：全部成立才進 Stage 1。不成立就**停**，回報偏差與卡在哪一步，不繞過。

Stage 1 的內容在 §6s。**Stage 0′ 通過後，先把結果給使用者看，取得同意再開始 Stage 1。**

## 4. 已知陷阱

- §6p：局部盒的端面會讓精確圓角失敗，不能用盒當測試。端接要和真實窗口一致。
- §6o：把工具直接切 part-3 會切掉圓角。圓角必須在切除之後才加。
- 堆只用 `(oc as any).wasmMemory?.buffer?.byteLength`，並先斷言 `> 0`。不用 JS handle 數量，不寫 `?? 0`。
- 探針比對要量「點到面的距離」，不要比裁切範圍（§6p `c10d` 的錯誤）。
- 執行 `verify:ui` 期間不改原始碼。
- 新增檔案後執行 `npm run docs:sync`，否則 `lint:repo` 會紅。

## 5. 回報

- 每階段結束：通過或停止、量到的數字、探針檔路徑。
- **commit 與 push 前先問使用者。**
- 結果寫進 `DEV_LOG.md` 與 `handoff.md`。不要把沒驗證的事寫成既成事實。
