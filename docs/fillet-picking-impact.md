# 圓角在工程圖上可點選的影響面盤點（E1a）

- 日期：2026-10-11。來源：第二輪待裁決事項 **E1**「圓角在圖上點不到，也標不出來」→ **E1a：先盤點影響面，再決定做不做**。
- **狀態：第一步已完成並實作**（圓角可在視圖上點選、可標半徑；自動尺寸未動）；**第二步（圓角納入自動尺寸）仍待裁定**。
  第 0 節到第 5 節是當時的盤點（保留原樣，供對照）；第 6.1 節補上實作結果。
- 相關：[ADR 0125](adr/0125-drawing-surface-finish-and-one-sided-tolerance.md)（單向極限與表面粗糙度）、`DEV_LOG.md`「尚未處理」第 1 條、`tests/kit/drawing-parts.kit.ts`。

## 0. 一句話結論

**評估與繪製那一半已經完成**（B3a 順手修好，kit 測試正在守）；缺的只有**編寫**那一半——在視圖上點圓角弧、以及自動尺寸把圓角半徑列進去。改動集中在 **4 個檔案、3 個套件**，**不需動 schema**。主要風險有兩個：一個視圖裡「近弧／遠弧怎麼分」，以及「自動尺寸輸出會變」。

> 2026-10-11 更新：**「點圓角弧」已實作完成**（見 6.1）；「自動尺寸把圓角半徑列進去」仍待裁定。
> 另註：`DEV_LOG.md`「尚未處理」第 1 條已因本次實作而過時，該檔當時有另一個 agent 的在製品未便更動，待其落地後一併更正。

## 1. 現況：哪一半已經好了（先講清楚，避免重做）

| 能力 | 位置 | 狀態 |
|---|---|---|
| 由面名（`Ref`）取得圓角事實 | `packages/regen/src/drawingDimensions.ts:172` | 已回 `{ kind:'face', type:'torus', point: 環心, dir: 軸, radius: minor, major }` |
| 把弧心算在 `major` 處、依 leader 傾向往哪一側 | `packages/drawing/src/dimension.ts:325-342`（`circleCentre`） | 已完成；真形判準對 torus 是「軸**躺在**圖面內」（`|dot(dir, viewDir)| ≤ PERPENDICULAR`），與圓柱相反 |
| 端到端標出 `R0.2`／`R0.5`，leader 落在弧上 | `tests/kit/drawing-parts.kit.ts:462-471` | 已在守（d7 在軸上方、d8 在軸下方，觸點在 `major + minor`） |

→ 「文件層可以標圓角半徑」已成立，**無需重做**。DEV_LOG 第 1 條描述的 `elementFacts` 未接 torus、`circle()` 真形判準為圓柱而寫，**都已經修好**。

## 2. 缺口（精確定位）

`viewFeatures`（`packages/regen/src/drawingDimensions.ts:182`）只認三種面：

- edge-on 平面 → `plane`（方軸）或 `slant`（斜的）；
- 沿視線的圓柱 → `circle`；
- 橫躺的整圓柱 → `axis`。

**沒有 torus 分支**，所以圓角面不產生任何 `ViewFeature`。後果二連：

1. **點不到**：`featureAt`（`packages/drawing/src/pick.ts:40`）只對 `plane`／`slant`／`circle` 給分，圓角沒有東西可以命中——點在圓角弧上會穿過去，選到後面的孔圓，或什麼都沒有。
2. **就算硬塞也標不出來**：`factsOf`（`pick.ts:78-84`）的 fallthrough 一律回 `{ type:'cylinder', radius }`、**不帶 `major`**，而 `circleCentre`（`dimension.ts:331`）要求 `major !== undefined` 才肯算——會直接以 `drawing.dimNotTrueShape` 拒絕。所以 `ViewFeature` 必須**一起**帶 torus 資訊。

另外 `autoDimensions`（`packages/drawing/src/autoDimension.ts:46`）只對 `circle` 分組，圓角半徑因此不會進自動尺寸。

## 3. 一個容易搞錯的細節：圓角在圖上是「兩條弧」

torus（甜甜圈）的軸躺在圖面內時，視線把管**切在兩處**（近側與遠側），所以**一個圓角面在該視圖看到兩條弧**（各約四分之一圓）。DEV_LOG 第 1 條也提到「輸出成兩個 `circle` 特徵」。

影響：命中測試必須知道點到的是哪一條；但兩條弧指向**同一個 torus 面、同一個 `Ref`**，所以標出來的仍是同一個尺寸（不會出現重複標註），差別只在 leader 落點。**這一點要寫成測試**，否則很容易退化成「標出兩個相同的 R」。

## 4. 受影響檔案（改動面）

| 檔案 | 要改什麼 | 風險 |
|---|---|---|
| `packages/model/src/drawing.ts:235` | `ViewFeature` 聯集新增 torus 成員：帶 `major`，以及軸在**視圖座標**的 2D 分量（供 `factsOf` 重建 3D `dir`） | 是型別，但**不落地**：`DrawingDoc` 不存 `ViewFeature`（`serialize.ts` 的 `features` 是**零件**特徵），`apps/web/src/state/drawing.ts:142` 的 `featureCache` 只活在記憶體 → **不需升 schema** |
| `packages/regen/src/drawingDimensions.ts:182` | `viewFeatures` 新增 `g.type === 'torus'` 分支；條件與 `circleCentre` 一致（軸躺在圖面內才輸出） | 邊界：軸接近垂直時不輸出，避免退化為整圓 |
| `packages/drawing/src/pick.ts:40,78` | `featureAt` 新增 torus 命中：距**弧** = `|hypot(p − 弧心) − minor|`，且角度落在弧的張角內；`factsOf` 新增 torus → `point = 環心, dir = 軸, radius = minor, major` | 命中歧義：近弧／遠弧、與孔圓重疊時的優先序（現行規則是「距離同分則面積大者勝」，torus 要決定它算多大） |
| `packages/drawing/src/autoDimension.ts:46` | 新增 torus 分組 → 草稿 `{ kind:'radius' }` | **會改變既有輸出**：任何含圓角的視圖按「自動尺寸」會多出半徑草稿 |
| `apps/web/src/components/DrawingViewport.tsx` | **不用改**（對 `Pickable` 是通用的；`featureAt`／`planDimension` 修好即可） | 低；僅 hover 標示若要顯示弧需微調 |
| `apps/web/src/components/DimensionPanel.tsx` | **不用改** | 低 |
| `apps/web/src/state/drawing.ts:655` | **不用改**（`isNew` 去重對新草稿一樣有效） | 低 |

## 5. 既有斷言會不會被打破（逐一查過）

- **`tests/phase5/drawing-dimensions.test.ts:242`**（`arcs` 長度 4）：那是 **R10 立角圓**——立角圓是**圓柱**、軸沿視線，早就會輸出 `circle, full:false`。該 golden 件**沒有 fillet 特徵** → **不受影響**。
- **`tests/phase5/drawing-pick.test.ts`**：特徵清單是**手造的**（`const features = [plane…, circle…]`）→ 既有案例不受影響；torus 需**新增**案例。
- **`tests/kit/drawing-parts.kit.ts`**：Part 2 的兩個圓角是用**明確 `ref`**（d7／d8）標的，不經過 `viewFeatures`；即使 `viewFeatures` 開始輸出 torus，kit 斷言也不變。這裡是**最適合加「點得到」驗證**的地方。
- **自動尺寸相關**：`apps/web/src/state/drawing.ts:655` 的 `isNew` 會去重，行為一致；但**若**未來某個 golden 件含 fillet，輸出會變，需一起改。

## 6. 風險與建議切法

風險（依嚴重度）：

1. **命中歧義**——近弧／遠弧、與孔圓重疊時的優先序。最需要測試，也最容易做錯。
2. **自動尺寸輸出變動**——影響「按一下就自動標好」的既有體驗，且會動到 golden。
3. **`factsOf` 需由 2D 重建 3D 軸向**——存得不夠就會算錯弧心；kit 既有的 `major` 落點斷言可當護欄。

建議（最小、低風險）切法：

- **第一步：只做「點得到、標得出來」**——`ViewFeature` ＋ `viewFeatures` ＋ `featureAt` ＋ `factsOf`，**先不動 `autoDimensions`**。如此不會動到既有自動尺寸輸出，**golden 件零變動**。
- **第二步（另案裁定）** 才把圓角納入自動尺寸，屆時連同 golden 一起改。
- **驗證放 kit**（Part 2 的兩個圓角）：對「軸躺在圖面內」的側視，斷言點在弧上能選到該 torus 面、`planDimension` 給出 `{ kind:'radius', ref: 同一面 }`、`evaluateDimension` 的值等於 `minor`；並斷言近弧與遠弧選到的是**同一個 `Ref`**。

**結論：建議做第一步**（小、可回退、補上「點得到」這個真缺口）；**第二步另開一項裁定**。

### 6.1 實作結果（2026-10-11，第一步）

使用者裁定「要做」，第一步已實作：

- **`ViewFeature` 新增獨立的 `torus` 成員**（`{ ref, centre, at, radius, major, axis, convex, outward }`），**不是**把圓角偽裝成 `circle`。
  這一點是刻意的：`autoDimensions` 只讀 `circle`，所以圓角**天生**不會被自動尺寸撈到，第二步的界線由型別自己守住，不必在 `autoDimensions` 裡加例外。
- **`viewFeatures`** 在 `|dot(axis, 視圖方向)| < 1e-6`（與 `circleCentre` 的 `PERPENDICULAR` 同一個條件）時，為每個 torus 面輸出**兩條**弧（管子被切兩次），兩者 `ref.name` 相同。
- **`pick.ts`**：`featureAt` 命中「以 `at` 為心、`radius` 為半徑」的弧；`areaOf` 讓 torus 與圓同一個量級；`factsOf` 回 `point = 環心`、`dir = 軸`、`radius = minor`、`major`；`planDimension` 單選圓角→半徑，**與第二個元素一起選則明確拒絕**（新鍵 `drawing.dimTorusAlone`）——弧沒有可以量距離的「位置」，與其猜一個不如說不行。
- **介面**：`DimensionPanel` 的清單顯示「圓角 R{size}」；`DrawingViewport` 的 hover 以 `at` 為心畫弧。**兩者都不需改架構**，與盤點預期一致。
- **驗證**：`tests/phase5/drawing-pick.test.ts` 新增 4 項（兩弧同一面、`factsOf`、單選得 R 且箭頭落在弧上、拒絕與第二元素同標）；kit 的 Part 2 以**真實幾何**斷言——側視圖 4 條圓角弧、兩弧對稱於軸、點選後 `factsOf` 與該面 `elementFacts` 一致、`evaluateDimension` 得 `R0.2`／`R0.5`，並斷言**自動尺寸 1 項、其中 0 項是圓角**（第一步的保證）。
- **無需升 schema**（`ViewFeature` 不落地），與盤點第 4 節的判斷一致。
