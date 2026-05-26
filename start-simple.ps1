# 3D-Builder 一鍵啟動腳本 (簡單版)
# 同時啟動前端 (Next.js) 和後端 (FastAPI)

Write-Host "========================================" -ForegroundColor Cyan
Write-Host "   3D-Builder Start" -ForegroundColor Cyan
Write-Host "========================================" -ForegroundColor Cyan
Write-Host ""

Write-Host "[INFO] Starting Backend (localhost:8400)" -ForegroundColor Magenta
Write-Host "[INFO] Starting Frontend (localhost:3000)" -ForegroundColor Blue
Write-Host ""
Write-Host "Press Ctrl+C to stop all services" -ForegroundColor Gray
Write-Host "========================================" -ForegroundColor Cyan
Write-Host ""

# Set execution policy and start both servers
Set-ExecutionPolicy -Scope Process -ExecutionPolicy Bypass
npx concurrently "cd backend && python -m uvicorn app.main:app --host 0.0.0.0 --port 8400 --reload" "npm run dev" --names "BACKEND,FRONTEND" --prefix-colors "magenta,blue"
