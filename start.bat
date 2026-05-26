@echo off
REM 3D-Builder 一鍵啟動
REM 同時啟動前端 (Next.js) 和後端 (FastAPI)

echo ========================================
echo    3D-Builder Start
echo ========================================
echo.
echo [INFO] Starting Backend (localhost:8400)
echo [INFO] Starting Frontend (localhost:3000)
echo.
echo Press Ctrl+C to stop all services
echo ========================================
echo.

REM 使用 concurrently 同時啟動前後端
npx concurrently "cd backend && python -m uvicorn app.main:app --host 0.0.0.0 --port 8400 --reload" "npm run dev" --names "BACKEND,FRONTEND" --prefix-colors "magenta,blue"

pause
