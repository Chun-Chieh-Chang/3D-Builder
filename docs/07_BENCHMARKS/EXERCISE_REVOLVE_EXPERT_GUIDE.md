# SolidWorks Expert Guide: Revolve Boss/Base Logic

**Source**: [YouTube: SolidWorks create revolutions](https://www.youtube.com/watch?v=KIxyS5mb7zY)
**Reference**: Standard SOLIDWORKS 2000+ Revolve Feature

## 1. Revolve (旋轉) 特徵邏輯
Revolve 是將一個 2D 剖面繞著一條軸線旋轉產生的 3D 實體。

### A. 自動軸線識別 (Automatic Axis Detection)
在 SolidWorks 中，當使用者啟動 Revolve 指令時：
1. **優先順序**：
   - 如果草圖中只有一條 **中心線 (Centerline/Construction Line)**，系統會自動將其選為「旋轉軸」。
   - 如果草圖中有多條中心線，系統會保留選取框供使用者指定。
   - 如果草圖中沒有中心線但有直線邊界，系統可能會提示使用者選取。
2. **封閉輪廓檢測**：系統會自動尋找不包含中心線的封閉區域作為剖面。

### B. 特徵參數
- **旋轉類型 (Revolve Type)**：
  - `Blind` (給定深度)：指定旋轉角度（預設 360°）。
  - `Mid Plane` (兩側對稱)：以草圖平面為中心，對稱旋轉。
  - `Up to Vertex/Surface`：旋轉至指定幾何。
- **薄件特徵 (Thin Feature)**：如果剖面不封閉，可以開啟薄件選項給予厚度。

## 2. 專案對標缺口 (Gap Checklist)
- [ ] **自動軸識別**：`useFeatureBuilders.ts` 目前未提取中心線 ID。
- [ ] **UI 選取介面**：`PartFeaturePropertyManager.tsx` 的旋轉軸部分僅是靜態文字，無法手動更換軸。
- [ ] **後端穩定性**：`geometry_service.py` 的旋轉邏輯需確保在 3D 空間中各向同性（無論草圖在哪個基準面上，軸線向量都應正確）。

## 3. 預期行為 (SOP)
1. 繪製一條 **中心線 (Center Line)** 作為對稱軸。
2. 在軸的一側繪製封閉剖面（如 L 型或瓶身剖面）。
3. 點擊 **Revolve**，系統應自動鎖定中心線，生成 360 度旋轉體。
