# 3D-Builder 自進化防呆系統 (Self-Evolving Guard System)

## 🎯 設計目標

> **從 DEBUG_SUMMARY.md 的教訓：**
> - 12 次 CI 修正從 0/13 → 13/13
> - 每次修正都記錄了「不可行的路徑」和「可行的路徑」
> - 這些知識應該被**自動化記錄**並**自動執行**，避免重複踩坑

## 🏗️ 架構

```
git push
  ↓
[1] 本地預檢 (pre-push hook) — 執行 5 層檢查
  ↓
[2] 如果任何一層失敗，自動記錄到 KNOWLEDGE_BASE.md
  ↓
[3] 推送至 GitHub
  ↓
[4] CI/CD 執行進一步檢查
  ↓
[5] CI 失敗 → 自動生成 PR 加入新的 pre-push 檢查
```

## 📋 5 層檢查

### Layer 1: Root TypeScript
```bash
npx tsc --noEmit --skipLibCheck
```
- 檢查 root 所有 .ts/.tsx 檔案
- 已知問題：`page.tsx` 的 `setHint` 不存在
- 如果失敗，顯示具體行號和錯誤訊息

### Layer 2: Electron TypeScript
```bash
cd electron && npx tsc --noEmit
```
- 檢查 electron 目錄
- 已知問題：`@types/node` 與 `electron.d.ts` 的 `noDeprecation` 衝突
- 已修復：`electron/tsconfig.json` 設定 `typeRoots: ["./node_modules/@types"]`

### Layer 3: Lint
```bash
npm run lint
```
- ESLint 檢查所有前端程式碼

### Layer 4: 環境相容性檢查
```bash
# 檢查 Python 版本
python3 --version  # 應該在 3.10 - 3.12 之間
# 檢查 uv 是否安裝
uv --version
# 檢查 .env 檔案是否存在
test -f .env.local || echo "WARNING: .env.local not found, using defaults"
```

### Layer 5: 知識庫檢查
```bash
# 檢查 KNOWLEDGE_BASE.md 中的KnownIssues是否被違反
if grep -q "NO_OPENCASCADE_IN_APT" scripts/learnings.sh; then
    echo "Checking: OpenCASCADE should NOT be installed via apt"
fi
```

## 🔄 自進化機制

### 觸發條件
每次 CI 或本地檢查失敗時，自動：
1. 記錄失敗的詳細資訊到 `docs/LEARNINGS.md`
2. 檢查是否已有對應的防呆規則
3. 如果沒有，自動生成新的檢查規則
4. 在下次 `git push` 時自動執行

### 知識庫結構 (`docs/LEARNINGS.md`)
```markdown
## Known Issues (已修復)
- [FIXED] `libopencascade-dev` 不存在於任何 Ubuntu apt 倉庫
- [FIXED] `pythonocc-core` 不支援 Python 3.13+
- [FIXED] `TopTools_ListOfShape` 需要 iterator
- [FIXED] electron `@types/node` 型別衝突

## Known Issues (待修復)
- [OPEN] page.tsx `setHint` 不存在

## Lessons Learned
### Python 版本混用
- 問題：`package.json` 硬編碼 `C:\3D_ENV_FINAL\python.exe`
- 解決：改用 `uv run` + `.venv`
- 預防：所有 Python 相關指令必須使用 `uv run`

### Electron 型別衝突
- 問題：`@types/node` 與 `electron.d.ts` 的 `noDeprecation` 不一致
- 解決：`electron/tsconfig.json` 設定 `typeRoots: ["./node_modules/@types"]`
- 預防：任何新增的 `@types/*` 套件必須檢查與 electron 的相容性
```

## 🚀 快速使用

```bash
# 手動執行全部檢查
npm run pdca:full

# 手動執行特定檢查層
npm run check:typecheck      # 第 1 層
npm run check:electron       # 第 2 層
npm run check:lint           # 第 3 層
npm run check:env            # 第 4 層
npm run check:knowledge      # 第 5 層

# 新增新的防呆規則
npm run learn -- --from "new failure message" --category "category"
```

## 📊 統計數據

| 類別 | 次數 | 已修復 | 待修復 |
|------|------|--------|--------|
| 致命錯誤 | 3 | 3 | 0 |
| 常見錯誤 | 4 | 1 | 3 |
| 最佳實踐 | 4 | 2 | 2 |

**總學習次數**：12 次
**首次學習**：2025-06-10
**最後更新**：2026-06-10

## 📝 未來擴展

1. **自動測試生成**：每次 CI 失敗，自動生成對應的单元测试
2. **依賴更新檢查**：定期檢查 `@types/node` 更新，預先相容測試
3. **CI 效能分析**：記錄每次 CI 執行時間，發現瓶頸
4. **知識庫視覺化**：生成學習曲線圖，顯示「已避免的失敗次數」
