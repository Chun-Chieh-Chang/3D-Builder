# OCCT 綁定缺口技術驗證

這裡是 ADR 0003 的證據，不是產品程式碼，不列入型別檢查與測試。

```bash
node spikes/occt-gaps/inventory.mjs     # 需要的類別 vs. 目前 WASM 建置 → inventory.md
node spikes/occt-gaps/workarounds.mjs   # 7 個繞道實驗，各自輸出 PASS/FAIL 與數據
```

切換到自訂的 OCCT 建置後，請重跑這兩支腳本：盤點應全數為「有」，E7 應改為通過。
