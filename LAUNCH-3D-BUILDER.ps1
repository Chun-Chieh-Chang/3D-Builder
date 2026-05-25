# 3D-Builder Unified Launcher (One-Click)
# Launches both the Python Geometry Backend and the Electron Frontend

$ErrorActionPreference = "Continue"
Clear-Host

Write-Host "====================================================" -ForegroundColor Cyan
Write-Host "       3D-Builder v2.0 Professional CAD             " -ForegroundColor Cyan
Write-Host "          One-Click Launcher Initializing           " -ForegroundColor Cyan
Write-Host "====================================================" -ForegroundColor Cyan
Write-Host ""

$RootPath = Get-Location
$BackendPath = Join-Path $RootPath "backend"

# 1. Start Python Backend in a background process
Write-Host "[1/3] Starting Python Geometry Kernel (Port 8400)..." -ForegroundColor Yellow
Start-Process -FilePath "python" -ArgumentList "-m uvicorn app.main:app --host 0.0.0.0 --port 8400" -WorkingDirectory $BackendPath -WindowStyle Hidden

# Give backend a moment to warm up
Start-Sleep -Seconds 3

# 2. Check health of backend
Write-Host "[2/3] Verifying Backend Health..." -ForegroundColor Yellow
try {
    $response = Invoke-WebRequest -Uri "http://localhost:8400/" -UseBasicParsing -TimeoutSec 5
    if ($response.StatusCode -eq 200) {
        Write-Host "      - Backend is ONLINE." -ForegroundColor Green
    } else {
        Write-Host "      - Backend returned status $($response.StatusCode). Proceeding anyway..." -ForegroundColor Yellow
    }
} catch {
    Write-Host "      - Backend health check failed. Ensure 'uvicorn' and 'fastapi' are installed in your python environment." -ForegroundColor Red
}

# 3. Launch Electron Frontend
Write-Host "[3/3] Launching Desktop Interface..." -ForegroundColor Green
Write-Host ""
Write-Host "----------------------------------------------------" -ForegroundColor Gray
Write-Host "  Backend: Running (Hidden Process)" -ForegroundColor Gray
Write-Host "  Frontend: Initializing (Next.js + Electron)..." -ForegroundColor Gray
Write-Host "----------------------------------------------------" -ForegroundColor Gray
Write-Host ""

# Check if node_modules exists
if (-not (Test-Path (Join-Path $RootPath "node_modules"))) {
    Write-Host "[INFO] Installing dependencies..." -ForegroundColor Cyan
    npm install
}

npm run electron:dev