# 3D-Builder One-Click Start (PowerShell)
# Start both Frontend (Next.js) and Backend (FastAPI)

Write-Host "========================================" -ForegroundColor Cyan
Write-Host "   3D-Builder One-Click Start" -ForegroundColor Cyan
Write-Host "========================================" -ForegroundColor Cyan
Write-Host ""
Write-Host "[INFO] Starting Backend on port 8400" -ForegroundColor Green
Write-Host "[INFO] Starting Frontend on port 3000" -ForegroundColor Green
Write-Host ""
Write-Host "Press Ctrl+C to stop all services" -ForegroundColor Yellow
Write-Host "========================================" -ForegroundColor Cyan
Write-Host ""

# Set execution policy for this session
Set-ExecutionPolicy -Scope Process -ExecutionPolicy Bypass -Force

# Start backend
$backendJob = Start-Job -ScriptBlock {
    Set-Location $using:PWD\backend
    python -m uvicorn app.main:app --host 0.0.0.0 --port 8400 --reload
}

# Wait a bit
Start-Sleep -Seconds 2

# Start frontend
$frontendJob = Start-Job -ScriptBlock {
    Set-Location $using:PWD
    npm run dev
}

# Wait for frontend to be ready
Write-Host "[INFO] Waiting for frontend to start..." -ForegroundColor Yellow
Start-Sleep -Seconds 5

# Open browser
Write-Host "[INFO] Opening browser..." -ForegroundColor Green
Start-Process "http://localhost:3000"

Write-Host ""
Write-Host "========================================" -ForegroundColor Cyan
Write-Host "   Services started successfully!" -ForegroundColor Green
Write-Host "========================================" -ForegroundColor Cyan
Write-Host ""
Write-Host "Backend:  http://localhost:8400" -ForegroundColor Magenta
Write-Host "Frontend: http://localhost:3000" -ForegroundColor Blue
Write-Host ""
Write-Host "Press any key to stop all services and exit..." -ForegroundColor Yellow
$null = $Host.UI.RawUI.ReadKey("NoEcho,IncludeKeyDown")

# Cleanup
Write-Host ""
Write-Host "[INFO] Stopping services..." -ForegroundColor Red
Stop-Job $backendJob -ErrorAction SilentlyContinue
Stop-Job $frontendJob -ErrorAction SilentlyContinue
Remove-Job $backendJob -Force -ErrorAction SilentlyContinue
Remove-Job $frontendJob -Force -ErrorAction SilentlyContinue

Write-Host "[INFO] All services stopped." -ForegroundColor Green
