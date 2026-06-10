# 3D-Builder 學習筆記 (Lessons Learned)

> **來源**：DEBUG_SUMMARY.md + 開發過程中遇到的所有問題
> **更新頻率**：每次遇到新問題或 CI 失敗時自動更新

---

## 🔴 致命錯誤 (Fatal — 絕對不能再犯)

### 1. OpenCASCADE 不支援 apt 安裝
- **症狀**：`E: Unable to locate package libopencascade-dev`
- **原因**：`libopencascade-dev` 不存在於任何 Ubuntu apt 倉庫
- **解決**：使用 `conda-forge` 安裝 `pythonocc-core`
- **預防**：在任何 CI 中禁止 `apt-get install libopencascade-dev`
- **知識標記**：`NO_OPENCASCADE_APT`

### 2. pythonocc-core 不支援 Python 3.13+
- **症狀**：`pythonocc-core 7.8.1 would require python >=3.8,<3.9.0a0`
- **原因**：GitHub Actions runner pinned Python 3.13
- **解決**：手動指定 `python=3.10.13`
- **預防**：所有 Python 環境必須明確指定版本 `python=3.10.x`
- **知識標記**：`PY_OCC_PY310_REQUIRED`

### 3. conda init bash 跨 step 無效
- **症狀**：`CondaError: Run 'conda init' before 'conda activate'`
- **原因**：GitHub Actions 的每個 step 是獨立進程
- **解決**：使用 `$HOME/miniforge3/etc/profile.d/conda.sh`
- **預防**：每個 conda step 開頭必須 `source $HOME/miniforge3/etc/profile.d/conda.sh`
- **知識標記**：`CONDA_SH_PROFILE_D`

---

## 🟡 常見錯誤 (Common — 應自動檢查)

### 4. TopTools_ListOfShape 不能直接遍歷
- **症狀**：`'TopTools_ListOfShape' object is not iterable`
- **原因**：pythonocc 7.8+ API 變更
- **解決**：使用 `TopTools_ListIteratorOfListOfShape`
- **預防**：任何 `Generated()` 呼叫都必須用 iterator
- **知識標記**：`OCC_ITERATOR_REQUIRED`

### 5. TopTools_ListOfShape 沒有 IsNull()
- **症狀**：`'TopTools_ListOfShape' object has no attribute 'IsNull'`
- **原因**：pythonocc 7.8+ API 變更
- **解決**：改用 `Extent()` 檢查
- **預防**：所有 `IsNull()` 呼叫改為 `Extent() > 0`
- **知識標記**：`OCC_EXTENT_NOT_ISNULL`

### 6. BRepFill_PipeShell.SetGuide() 已移除
- **症狀**：`'BRepFill_PipeShell' object has no attribute 'SetGuide'`
- **原因**：OCC 7.7+ 移除此 API
- **解決**：改用 `BRepOffsetAPI_MakePipeShell`
- **預防**：任何 sweep/pipe 相關的 OCCT 程式碼使用 `MakePipeShell`
- **知識標記**：`OCC_MAKEPIPE_SHEll_NOT_PIPE_SHELL`

### 7. Electron @types/node 型別衝突
- **症狀**：TS2687 `All declarations of 'noDeprecation' must have identical modifiers`
- **原因**：root 與 electron 的 `@types/node` 宣告不一致
- **解決**：`electron/tsconfig.json` 設定 `typeRoots: ["./node_modules/@types"]`
- **預防**：任何新增的 `@types/*` 必須檢查與 electron 的相容性
- **知識標記**：`ELECTRON_TYPE_ROOTS_PIN`

---

## 🟢 最佳實踐 (Best Practices — 應該遵守)

### 8. 固定所有依賴版本
- **原因**：API 變更導致意外失敗
- **做法**：`requirements.txt` 或 `environment.yml` 明確指定版本
- **例子**：`pythonocc-core==7.8.1`, `pytest==8.0`

### 9. 使用 conda-lock 或 uv.lock
- **原因**：確保可重現的依賴解析
- **做法**：生成鎖定檔案並提交至 repo

### 10. CI 中加入 API 相容性檢查
- **原因**：提前發現 API 變更
- **做法**：在測試前驗證關鍵方法是否存在

### 11. Mock 測試
- **原因**：降低 CI 對 pythonocc 的依賴
- **做法**：對於依賴特定 CAD 核心的功能，用 mock 測試邏輯

---

## 📊 統計數據

| 類別 | 次數 | 已修復 | 待修復 |
|------|------|--------|--------|
| 致命錯誤 | 3 | 3 | 0 |
| 常見錯誤 | 4 | 1 | 3 |
| 最佳實踐 | 4 | 2 | 2 |

**總學習次數**：12 次
**首次學習**：2025-06-10
**最後更新**：2026-06-10

---

*這份文件由 DEBUG_SUMMARY.md 自動轉換並持續更新。*

## PYTHON Issues
- [FIXED] pythonocc-core build fails on Python 3.13+
- 原因：Always use Python 3.10-3.12 with conda-forge
- 預防：任何相關程式碼必須檢查此問題
- 知識標記：`AUTO_LEARN_PYTHON_2026-06-10`
