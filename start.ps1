# 3D-Builder 一鍵啟動腳本
# 同時啟動前端 (Next.js) 和後端 (FastAPI)

Write-Host "========================================" -ForegroundColor Cyan
Write-Host "   3D-Builder 一鍵啟動" -ForegroundColor Cyan
Write-Host "========================================" -ForegroundColor Cyan
Write-Host ""

# 檢查 Python 是否安裝
try {
    $pythonVersion = python --version 2>&1
    Write-Host "[OK] 找到 Python: $pythonVersion" -ForegroundColor Green
} catch {
    Write-Host "[ERROR] 未找到 Python，請先安裝 Python" -ForegroundColor Red
    Read-Host "按任意鍵退出"
    exit 1
}

# 檢查 Node.js 是否安裝
try {
    $nodeVersion = node --version
    Write-Host "[OK] 找到 Node.js: $nodeVersion" -ForegroundColor Green
} catch {
    Write-Host "[ERROR] 未找到 Node.js，請先安裝 Node.js" -ForegroundColor Red
    Read-Host "按任意鍵退出"
    exit 1
}

Write-Host ""
Write-Host "正在檢查後端相依性..." -ForegroundColor Yellow

# 檢查並安裝後端相依性
$backendPath = Join-Path $PSScriptRoot "backend"
$requirementsPath = Join-Path $backendPath "requirements.txt"

if (Test-Path $requirementsPath) {
    Write-Host "[INFO] 檢查後端套件..." -ForegroundColor Yellow
    python -m pip install -r $requirementsPath --quiet
    Write-Host "[OK] 後端相依性已就緒" -ForegroundColor Green
} else {
    Write-Host "[WARNING] 未找到 requirements.txt" -ForegroundColor Yellow
}

Write-Host ""
Write-Host "正在啟動服務..." -ForegroundColor Cyan
Write-Host ""

# 使用 concurrently 同時啟動前後端
Write-Host "[啟動] 後端伺服器 (localhost:8400)" -ForegroundColor Magenta
Write-Host "[啟動] 前端開發伺服器 (localhost:3000)" -ForegroundColor Blue
Write-Host ""
Write-Host "按 Ctrl+C 停止所有服務" -ForegroundColor Gray
Write-Host "========================================" -ForegroundColor Cyan
Write-Host ""

# 設定 PowerShell 執行原則並啟動
Set-ExecutionPolicy -Scope Process -ExecutionPolicy Bypass
npx concurrently "cd backend && python -m uvicorn app.main:app --host 0.0.0.0 --port 8400 --reload" "npm run dev" --names "BACKEND,FRONTEND" --prefix-colors "magenta,blue"
