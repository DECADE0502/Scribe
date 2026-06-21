@echo off
setlocal enabledelayedexpansion

rem ============================================================
rem  Scribe Manager
rem ============================================================

set "ROOT=%~dp0"
set "ROOT=%ROOT:~0,-1%"
set "BE_PORT=6789"
set "FE_PORT=5173"
set "BE_LOG=%ROOT%\logs\backend.log"
set "FE_LOG=%ROOT%\logs\frontend.log"

if not exist "%ROOT%\logs" mkdir "%ROOT%\logs"

:menu
cls
echo.
echo   ================================================
echo    Scribe Manager
echo   ================================================
echo.

set "be_alive=0"
for /f "delims=" %%r in ('powershell -NoProfile -Command "try{(Invoke-WebRequest -Uri 'http://127.0.0.1:%BE_PORT%/api/health' -UseBasicParsing -TimeoutSec 1).StatusCode}catch{0}"') do set hp=%%r
if "!hp!"=="200" set "be_alive=1"

set "fe_alive=0"
for /f "delims=" %%r in ('powershell -NoProfile -Command "try{(Invoke-WebRequest -Uri 'http://localhost:%FE_PORT%' -UseBasicParsing -TimeoutSec 1).StatusCode}catch{0}"') do set fp=%%r
if "!fp!"=="200" set "fe_alive=1"

if "!be_alive!"=="1" (echo    backend  [RUNNING]  http://127.0.0.1:%BE_PORT%) else (echo    backend  [stopped]  http://127.0.0.1:%BE_PORT%)
if "!fe_alive!"=="1" (echo    frontend [RUNNING]  http://localhost:%FE_PORT%) else (echo    frontend [stopped]  http://localhost:%FE_PORT%)

echo.
echo   ------------------------------------------------
echo    1  Start all (backend + frontend)
echo    2  Stop all
echo    3  Restart all
echo    4  Start backend only
echo    5  Start frontend only
echo   ------------------------------------------------
echo    6  Tail backend log (Ctrl+C to exit)
echo    7  Tail frontend log (Ctrl+C to exit)
echo    8  Clear logs
echo   ------------------------------------------------
echo    9  Run tests (pnpm test)
echo    a  Typecheck (pnpm typecheck)
echo    b  Install deps (pnpm install)
echo    c  Open browser
echo   ------------------------------------------------
echo    0  Exit
echo   ================================================
set /p choice=Select: 

if "!choice!"=="1" goto start_both
if "!choice!"=="2" goto stop_both
if "!choice!"=="3" goto restart_both
if "!choice!"=="4" goto start_be_menu
if "!choice!"=="5" goto start_fe_menu
if "!choice!"=="6" goto tail_be
if "!choice!"=="7" goto tail_fe
if "!choice!"=="8" goto clear_logs
if "!choice!"=="9" goto run_tests
if /i "!choice!"=="a" goto run_typecheck
if /i "!choice!"=="b" goto install_deps
if /i "!choice!"=="c" goto open_browser
if "!choice!"=="0" goto end
goto menu

:start_both
call :stop_port "%BE_PORT%"
call :stop_port "%FE_PORT%"
call :launch_be
call :launch_fe
echo.
pause
goto menu

:start_be_menu
call :stop_port "%BE_PORT%"
call :launch_be
echo.
pause
goto menu

:start_fe_menu
call :stop_port "%FE_PORT%"
call :launch_fe
echo.
pause
goto menu

:stop_both
call :stop_port "%BE_PORT%"
call :stop_port "%FE_PORT%"
echo All services stopped.
timeout /t 1 >nul
goto menu

:restart_both
call :stop_port "%BE_PORT%"
call :stop_port "%FE_PORT%"
timeout /t 1 >nul
call :launch_be
call :launch_fe
echo.
pause
goto menu

:tail_be
if not exist "%BE_LOG%" (echo Log not found & pause & goto menu)
echo === backend log (Ctrl+C to exit) ===
powershell -NoProfile -Command "Get-Content -LiteralPath '%BE_LOG%' -Tail 50 -Wait"
goto menu

:tail_fe
if not exist "%FE_LOG%" (echo Log not found & pause & goto menu)
echo === frontend log (Ctrl+C to exit) ===
powershell -NoProfile -Command "Get-Content -LiteralPath '%FE_LOG%' -Tail 50 -Wait"
goto menu

:clear_logs
if exist "%BE_LOG%" del /q "%BE_LOG%"
if exist "%FE_LOG%" del /q "%FE_LOG%"
echo Logs cleared.
timeout /t 1 >nul
goto menu

:run_tests
echo === Running tests ===
cmd /c "cd /d "%ROOT%" && pnpm test"
echo.
pause
goto menu

:run_typecheck
echo === Typecheck ===
cmd /c "cd /d "%ROOT%" && pnpm typecheck"
echo.
pause
goto menu

:install_deps
echo === Install deps ===
cmd /c "cd /d "%ROOT%" && pnpm install"
echo.
pause
goto menu

:open_browser
start http://localhost:%FE_PORT%
goto menu

:launch_be
echo Starting backend...
start "Scribe-Backend" /min cmd /c "pnpm --filter @scribe/server exec tsx src/main.ts > "%BE_LOG%" 2>&1"
set "be_ok=0"
for /L %%i in (1,1,30) do (
  timeout /t 1 >nul
  for /f "delims=" %%r in ('powershell -NoProfile -Command "try{(Invoke-WebRequest -Uri 'http://127.0.0.1:%BE_PORT%/api/health' -UseBasicParsing -TimeoutSec 1).StatusCode}catch{0}"') do set hp=%%r
  if "!hp!"=="200" ( set "be_ok=1" & goto be_done )
)
:be_done
if "!be_ok!"=="1" (
  echo   backend ready - http://127.0.0.1:%BE_PORT%
) else (
  echo   [ERROR] backend not ready in 30s. Check %BE_LOG%
)
goto :eof

:launch_fe
echo Starting frontend...
start "Scribe-Frontend" /min cmd /c "pnpm --filter @scribe/client dev > "%FE_LOG%" 2>&1"
set "fe_ok=0"
for /L %%i in (1,1,30) do (
  timeout /t 1 >nul
  for /f "delims=" %%r in ('powershell -NoProfile -Command "try{(Invoke-WebRequest -Uri 'http://localhost:%FE_PORT%' -UseBasicParsing -TimeoutSec 1).StatusCode}catch{0}"') do set fp=%%r
  if "!fp!"=="200" ( set "fe_ok=1" & goto fe_done )
)
:fe_done
if "!fe_ok!"=="1" (
  echo   frontend ready - http://localhost:%FE_PORT%
) else (
  echo   [ERROR] frontend not ready in 30s. Check %FE_LOG%
)
goto :eof

:stop_port
powershell -NoProfile -Command "$c=Get-NetTCPConnection -State Listen -LocalPort %~1 -ErrorAction SilentlyContinue; foreach($x in $c){try{$p=Get-Process -Id $x.OwningProcess -ErrorAction Stop; Write-Host ('  killing '+$p.ProcessName+' PID='+$p.Id); Stop-Process -Id $p.Id -Force}catch{}}"
goto :eof

:end
echo Bye.
exit /b 0
