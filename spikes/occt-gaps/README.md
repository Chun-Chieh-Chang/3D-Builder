# OCCT 綁定缺口技術驗證

這裡是 ADR 0003 的證據，不是產品程式碼，不列入型別檢查與測試。

```bash
node spikes/occt-gaps/inventory.mjs     # 46 個需要的類別：replicad vs. libcascade → inventory.md
node spikes/occt-gaps/workarounds.mjs   # 在 replicad 建置上的 7 個繞道實驗
node spikes/occt-gaps/libcascade.mjs    # libcascade 3.0.2 的 9 項驗證（含組合件 STEP 輸入與網格效能）
```

`replicad-opencascadejs` 與 `libcascade` 都以根目錄 devDependency 安裝，專門給這些腳本使用。產品程式碼只依賴 `libcascade`。
