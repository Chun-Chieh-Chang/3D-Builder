# Concept: The Glass Order (玻璃秩序)

## 1. 核心哲學 (Philosophy)
玻璃秩序追求的是一種「高階秩序 (High-End Order)」與「通透感」。它不只是簡單的透明，而是透過多層物理特徵模擬真實世界的材質質感。

## 2. 三層邊緣法則 (Triple-Layer Edge)
為了建立物理深度，每個玻璃組件必須具備：
1.  **外邊框 (Outer Border)**: `1px solid rgba(255, 255, 255, 0.1)` (深色模式) 或 `rgba(0, 0, 0, 0.05)` (淺色模式)。
2.  **內發光 (Inner Glow)**: `inset 0 1px 0 rgba(255, 255, 255, 0.1)`。
3.  **動態陰影 (Dynamic Shadow)**: 隨懸停狀態改變的柔和擴散陰影。

## 3. 對比度救贖 (Contrast Salvation) [CRITICAL]
**核心禁令**：嚴禁在深色模式的玻璃背景上使用低亮度灰色（如 Slate 400）。
- **原因**：毛玻璃的模糊效果 (Blur) 會模糊文字邊界，導致視覺疲勞。
- **標準**：次要標籤與元數據必須提升至 `opacity: 0.7` 以上的 `text-primary`，或直接使用亮色系 `rgba`。

## 4. 工程實現 (Implementation)
- **背板模糊**: `backdrop-filter: blur(16px) saturate(180%)`。
- **飽和度補償**: 使用 `saturate` 確保玻璃下的內容顏色不會顯得死寂。
