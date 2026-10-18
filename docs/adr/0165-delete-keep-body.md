# ADR 0165: 實體刪除與保留本體特徵 (Delete / Keep Body Feature, C7.3)

## 狀態
已核准 (Approved)

## 日期
2026-10-18

## 背景與問題陳述
在 SolidWorks 多本體建模（Multi-body Modeling）與夾治具主模型設計中，使用者常需要建立中間過程的「輔助實體」或「切削工具本體（Tool Body）」。
例如：
1. 透過拉伸或旋轉建立一組輔助實體，用於「結合特徵（Combine）」進行布林差集切除或交集運算。
2. 透過「分割實體（Split Feature, C7.4）」將工件分割成多個本體後，部分邊角廢料（Offcuts/Runners）需要被剔除。
3. 透過「移動/複製本體（Move/Copy Body, C7.3）」產生鏡像或排樣副本後，部分原始本體需要被清除。

如果缺乏參數化的「刪除/保留本體特徵」，這些輔助實體會一直殘留於模型中，干擾工程圖投影視圖、造成 STEP 匯出包含廢料、以及在組合件中產生不必要的干涉報錯。

因此，依據藍圖 C7.3 規範，本專案需要實作標準的「刪除/保留本體特徵 (Delete / Keep Body Feature)」。

## 決策分析與核心第一性原理

### 1. 兩種操作模式（Delete vs Keep）
- **`'delete'`（刪除本體模式 / 黑名單）**：
  - 指定一個或多個目標本體，在該特徵時間節點將其自實體集合（`BodySet`）中剔除。
  - 保留所有未被指定的本體。
  - 適用情境：模型中大部分本體要保留，僅需清除 1~2 個輔助刀具本體。
- **`'keep'`（保留本體模式 / 白名單）**：
  - 指定一個或多個目標本體，在該特徵時間節點「僅保留」所選本體，其餘所有本體全部剔除。
  - 適用情境：分割特徵產生了大量碎料，使用者僅需要其中 1 個成品本體。

### 2. 幾何運算零 WASM 開銷與確定性
- 刪除/保留本體屬於**集合過濾運算（Set Filtering Operation）**，不改動殘留本體內部的任何拓樸形狀、頂點坐標、面邊命名。
- 運算直接在 `engine.ts` 的 `BodySet` 集合層以常數時間（$O(N)$）完成，**不呼叫任何 OCCT 布林運算（零 WASM 堆記憶體洩漏）**。
- 殘留本體拓樸完全保真，體積與表面積物理守恆（$\Delta V = 0$）。

### 3. 依賴圖（DAG）與歷史回溯相依
- **父相依**：`DeleteKeepBodyFeature` 的父特徵為生成被選中目標本體的來源特徵（透過 `bodyFeature(r.name)` 追蹤）。
- **子相依與遺失參考防禦**：
  - 若下游特徵引用了已被刪除本體上的面、邊或頂點，再生引擎與命名解析層將依照既有機制精確回報「遺失參考（Dangling / Missing Reference）」，並指出該實體已於 `deleteKeepBody` 特徵被消除，防止靜默使用幽靈幾何。
- **回溯（Rollback）與抑制（Suppress）**：
  - 當回溯控制棒移到該特徵之前，或該特徵被抑制（Suppressed）時，被刪除的本體將自然重現於 3D 視圖與特徵樹中，完全符合參數式 CAD 之歷史可逆性。

---

## 4. 資料模型與 Schema 演進 (Schema 64)

```ts
export interface DeleteKeepBodyFeature extends FeatureBase {
  type: 'deleteKeepBody';
  /** Operation mode: 'delete' (blacklist) or 'keep' (whitelist). Default 'delete'. */
  mode: 'delete' | 'keep';
  /** Target bodies to delete or keep. Must not be empty. */
  targets: Ref[];
}
```

### 序列化遷移
- `SCHEMA_VERSION` 升級為 `64`。
- `serialize.ts` 新增 Schema 63 遷移函式。

---

## 5. 自我紅隊四問檢驗標準（AGENTS.md §2.1）

1. **輸入破壞 (Input Corruption)**：
   - 目標列表為空（`targets.length === 0`）：指令層 `checkFeature` 顯式拋出 `CommandError` 攔截。
   - 模式非合法字串：型別系統與命令層防禦。
2. **拓樸與幾何相交破壞 (Geometric Self-Intersection Defense)**：
   - 集合過濾不產生新的幾何，無自相交問題。
   - 全刪除邊界（All Bodies Deleted）：若操作導致模型內所有本體均被刪除，引擎正常返回空實體集合 `bodies = []`，並於特徵狀態掛載警示，確保下游運算安全不崩潰。
3. **依賴鏈完整性 (Dependency Graph Integrity)**：
   - 依賴鏈全鏈路接通：`schema.ts` $\to$ `serialize.ts` $\to$ `commands.ts` $\to$ `refs.ts` $\to$ `dag.ts` $\to$ `engine.ts` $\to$ `store.ts` $\to$ `PropertyManager.tsx` $\to$ i18n 雙語字典。
4. **規格真實性與零 Mock 原則 (Zero-Mock & Ground Truth)**：
   - 多實體場景驗證：長出兩顆分離立方體（Body 1: $1000\text{ mm}^3$, Body 2: $8000\text{ mm}^3$）。
   - 'delete' 模式刪除 Body 1：驗證最終實體數為 1，剩餘 Body 2 體積實測精確為 $8000.0\text{ mm}^3$。
   - 'keep' 模式保留 Body 1：驗證最終實體數為 1，剩餘 Body 1 體積實測精確為 $1000.0\text{ mm}^3$。
   - 記憶體真實指標防呆：斷言 `(oc as any).wasmMemory?.buffer?.byteLength > 0`。
