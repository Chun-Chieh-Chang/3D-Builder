@echo off
chcp 65001 >nul
cd /d "D:\Self-developed_Apps\G3\3D-Builder"
where claude >nul 2>nul || (echo Claude Code CLI not found. Install it, then run this file again. & pause & exit /b 1)
rem heartbeat for the progress page while the CLI runs
start "3DB livebeat" /min node scratch\claude-takeover\tools\livebeat.mjs
node scratch\claude-takeover\tools\prog.mjs log "CLI 接手開始"
claude "Read AGENTS.md and handoff.md, starting with the top entry dated 2026-11-10 (late night, Linux VM, CLI takeover). Continue C2.14d: replace the remaining EvalD1/EvalD2 hot spots in packages/kernel/src/exactRound.ts with D1/D2 into reused outputs as described there, verify seed 41 with N=40 stays flat (scratch/ff/heaprep.test.ts), raise exact-round-heap.test.ts to at least 40 runs with the EvalD1 control, then rerun exact-round tests, fuzz 1-6 and the recognition regression. Keep the progress page scratch/claude-takeover/dev/index.html live: run node scratch/claude-takeover/tools/prog.mjs (item/now/log) at the start and end of every sub-step and at least every 5 minutes during long runs, split work into fine-grained sub-items (prog.mjs add), and run prog.mjs stop with the reason whenever you stop or wait for the user. Do not push."
echo.> scratch\claude-takeover\dev\beat-stop
node scratch\claude-takeover\tools\prog.mjs stop "CLI 結束"
