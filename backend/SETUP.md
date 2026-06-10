# 3D-Builder Python 開發環境設定指南
# ================================
# Python 版本混用問題已透過 uv + .venv 解決。
# 後端依賴 pythonocc-core（OpenCASCADE），該套件
# 在 Windows 上只有 conda-forge 提供安裝管道。
# 請依照你的平台選擇對應設定。

## 開發環境要求
- Python 3.10 - 3.12（pythonocc-core 不支援 3.13+）
- uv（Python 套件管理器）
- conda-forge（僅用於 pythonocc-core 安裝）

## 快速設定（Windows / 推薦）

```powershell
# 1. 進入 backend 目錄
cd backend

# 2. 使用 uv 建立 Python 虛擬環境（自動選擇 3.10-3.12）
uv venv .venv
.venv\Scripts\activate

# 3. 安裝一般依賴（透過 uv pip）
uv pip install -r requirements.txt

# 4. 安裝 pythonocc-core（透過 conda-forge）
#    如果 uv 找不到 pythonocc-core，使用 conda：
conda install -c conda-forge pythonocc-core=7.8.1 -y
```

## 快速設定（Linux / CI 環境）

參見 `.github/workflows/` 中的 CI 設定，
或使用 DEBUG_SUMMARY.md 中的完整流程。

## 注意事項

### ❌ 不要做的事
1. 不要在 system Python 直接 `pip install`
2. 不要用 Python 3.13+（pythonocc-core 不支援）
3. 不要手動修改 `uv.lock` 或 `.venv` 目錄
4. 不要使用 `pip install pythonocc-core`（無 wheel）

### ✅ 正確做法
1. 始終使用 `.venv` 虛擬環境
2. 使用 `uv` 管理非 OCCT 套件
3. pythonocc-core 只能從 conda-forge 安裝
4. CI 環境請參考 DEBUG_SUMMARY.md

## 常見問題

### Q: 應該用 python 3.11 還是 3.14？
A: 使用 3.10 - 3.12。pythonocc-core 有編譯限制。

### Q: uv 找不到 pythonocc-core 怎麼辦？
A: 這是正常的。uv pip 只會從 PyPI 拉套件，
   pythonocc-core 在 PyPI 上沒有預編譯 wheel。
   改用 `conda install -c conda-forge pythonocc-core`。

### Q: Electron 型別衝突怎麼辦？
A: 這是 electron/node_modules 和 root 的
   @types/node 版本衝突。使用 `skipLibCheck`
   或統一 @types/node 版本。
