# 「專案落地」穩定性手術計畫 (The Project Landing Plan)

## 🩺 手術背景
目前的 3D-Builder 處於「大腦強健（算法通）但神經斷裂（UI 不穩）」的狀態。本計畫旨在縫補技術斷層，讓系統達到真正的工業級魯棒性。

---

## 🏗️ 手術階段 (Sprint STABLE 1-4)

### Phase 1: 拓撲命名服務升級 (TNS v2 - 核心穩定性)
- **目標**：解決「修改 A 特徵後，B 特徵（如圓角）因找不到面而噴錯」的問題。
- **步驟**：
    - [ ] 在 `geometry_service.py` 中引入 **幾何指紋 (Geometric Fingerprinting)**。
    - [ ] 當原始 ID 匹配失敗時，啟動「鄰近性搜尋」：根據面的法向量、中心點偏移與面積比對，自動重新綁定面引用。
- **預計成果**：修改基礎尺寸後，後續的 Shell/Draft/Fillet 能自動適應新幾何而不失效。

### Phase 2: 全透明錯誤診斷系統 (Transparent Error Reporting)
- **目標**：消除「介面沒反應」的黑箱狀態。
- **步驟**：
    - [ ] 修改後端返回結構，將 `Standard_ConstructionError` 轉化為人類可讀的中文訊息。
    - [ ] 前端實作 `ErrorRibbon` 或強化 `CadToast`，精確顯示：「圓角半徑 5mm 過大，請縮小至 2mm 以下」或「抽殼面選擇與實體不交」。
- **預計成果**：使用者能根據提示自我修正，不再盲目嘗試。

### Phase 3: 動態特徵預覽引擎 (Visual Ghosting)
- **目標**：實現「所見即所得」。
- **步驟**：
    - [ ] 在 PropertyManager 輸入參數時，自動觸發 `PreviewSolve`。
    - [ ] 前端在 Viewport 中利用 `meshStandardMaterial` 的 `opacity: 0.5` 渲染預覽幾何 (Ghost Shape)。
- **預計成果**：使用者在拖動數值時，能即時看見模型變化的影子。

### Phase 4: 真．參數化存儲 (Persistent Formulas)
- **目標**：讓算式成為模型的一部分，而非一次性計算。
- **步驟**：
    - [ ] 重構 `CADFeature` 參數結構，區分 `evaluatedValue` 與 `rawFormula`。
    - [ ] UI 始終保留 `=2in+5mm` 的輸入，並在後端異動時自動重新計算。
- **預計成果**：檔案儲存後重新開啟，算式依然存在，實現 100% 參數驅動。

---

## 📈 落地驗收門檻
- **SCS (修正版)**：從 90% (當前實力) 穩步回升至真正的 100%。
- **機器人重測**：重新跑一遍「工業鉸鏈連桿」腳本，必須達到 **0 個 [ERROR]** 且 **0 次人工干預**。
