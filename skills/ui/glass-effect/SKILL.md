---
name: glass-effect
description: "一套基於『高階秩序 (High-End Order)』的毛玻璃設計系統。包含層次控制、三層邊緣法則與內容克制原則，用於打造極致通透、具備呼吸感的 Premium UI。"
author: "Antigravity Art Director"
version: "1.2.0"
---

# GlassEffect 核心秩序 (The Glass Order)

## 1. 核心五步驟 (The 5 Steps)
[略：保留原有的三層邊緣法則與內容克制原則]

## 2. 工程實現禁令 (Engineering Commandments) - **進化版**

1.  **標度源審計 (Source Scale Audit) [CRITICAL]**：
    *   **規則**：在進行 JS 變數標準化（如 `/ 100`）前，**必須**先檢查 UI 組件（如 Slider）的 `min`, `max` 屬性。
    *   **教訓**：嚴禁盲目假設標度。若 Slider 已產出 0.0-1.0，則 JS 橋接層應直接透傳。二次標準化會導致數值趨近於零，造成「視覺失效」。
2.  **全域焦土搜索 (Scorched-Earth CSS Sweep)**：
    *   **規則**：實作玻璃化時，必須對全專案執行 `grep`，搜索所有硬編碼背景色（如 `#ffffff`, `#000000`, `background: white`）。
    *   **教訓**：即便 `:root` 定義了玻璃變數，深層組件或 `@media` 區塊中的硬編碼背景依然會「殺死」透明度。
3.  **移除隱性補償 (No Hidden Compensation)**：
    *   **規則**：禁止在 CSS 中使用 `* 0.4` 或 `brightness(1.5)` 等硬編碼補償系數來對付深色模式。
    *   **教訓**：補償系數會縮減用戶調整的有效頻譜，應將主導權交還給 Design Tokens。
4.  **對比度救贖 (Contrast Salvation) [NEW]**：
    *   **規則**：在深色模式下，位於 `glass-bg` 上的次要文字（Labels/Metadata）**嚴禁**使用低於 0.8 透明度的灰色（如 Slate 400）。
    *   **做法**：優先使用 `var(--text-primary)` 並搭配 `opacity: 0.7` 或以上，或使用亮色系的 `rgba(255,255,255,0.8)`。
    *   **理由**：毛玻璃的模糊效果會進一步降低背景與文字的邊界感，必須提升文字亮度來補償。

## 3. 推薦 CSS 變數系統 (Standard Tokens)
[略：保留標準變數定義]

## 4. 故障排除清單 (Troubleshooting Checklist)
- **Q: 調低透明度但感覺沒變化？**
    - A1: 檢查是否有硬編碼 `background` 覆蓋（使用 Grep 搜索）。
    - A2: 檢查 `Modal Overlay` 是否過重（建議 < 0.15）。
    - A3: 檢查 JS 層是否發生了「重複標準化」（0.1 / 100 = 0.001）。
