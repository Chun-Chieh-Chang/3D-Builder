# OCCT 綁定缺口技術驗證

這裡是 ADR 0003 的證據，不是產品程式碼，不列入型別檢查與測試。

```bash
node spikes/occt-gaps/inventory.mjs     # 46 個需要的類別：replicad vs. libcascade → inventory.md
node spikes/occt-gaps/workarounds.mjs   # 在 replicad 建置上的 7 個繞道實驗
node spikes/occt-gaps/libcascade.mjs    # libcascade 3.0.2 的 9 項驗證（含組合件 STEP 輸入與網格效能）
node spikes/occt-gaps/thread.mjs        # 螺牙 T-0：螺旋掃出＋布林，6 個案例（圓柱／圓錐、單／雙線、左右旋、起始角、部分長度、非對稱牙型）
```

`replicad-opencascadejs` 與 `libcascade` 都以根目錄 devDependency 安裝，專門給這些腳本使用。產品程式碼只依賴 `libcascade`。

## 螺牙 T-0（2026-10-10）

`thread.mjs`：牙型多邊形沿圓柱或圓錐面上的螺旋掃出（`BRepOffsetAPI_MakePipeShell`，`SetMode(gp_Dir)` 固定軸向副法線），掃出比需要的長，再與外框圓柱 Common 修剪成準確長度；多線 = 同一個掃出轉 360°/N；外牙與芯 Fuse，內牙從塊 Cut。6 個案例全過：BRepCheck 有效、體積對解析式（Guldin）誤差 ≤ 0.08 %（圓柱 ≤ 0.002 %）、牙側位置用實體分類器探測在 0.003 mm 內（含線數、旋向、起始角）、每案布林 1.0 到 2.5 秒、STEP 往返體積差 < 1e-6、網格 ≤ 8100 個三角形。反向測試：`MUTATE_PHASE=1` 故意把起始角符號寫反，案例 E 會失敗，證明探測有鑑別力。**螺旋的相位定義：牙在起始面（`zFrom`）、起始角的位置開始。**

**沒驗證的**（要進正式特徵前還要做）：牙與倒角、圓角、其他特徵（螺紋入口的倒角、牙尾收在階梯面上）的布林；牙的面在特徵樹裡的持久命名；牙的面在工程圖隱藏線與剖面的表現；瀏覽器 Worker 內的耗時（這裡是 Node）；更小的牙與更多圈數（M3 等細牙）時的耗時。
