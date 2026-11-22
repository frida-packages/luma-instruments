@echo off
setlocal
set driver=%1
if "%driver%"=="" set driver=warp
set repeats=%2
if "%repeats%"=="" set repeats=1
set observe=%3
if "%observe%"=="" set observe=0
cd /d %~dp0
del ready.txt target.log inject.log 2> nul

start "" /b cmd /c "d3d11-target.exe %driver% %repeats% > target.log 2>&1"
set tries=0
:wait
if exist ready.txt goto attach
set /a tries+=1
if %tries% gtr 60 goto never_ready
ping -n 2 127.0.0.1 > nul
goto wait

:attach
start "" /b cmd /c "frida-inject.exe -n d3d11-target.exe -s harness.js -P {\"observeSeconds\":%observe%} > inject.log 2>&1"
set tries=0
:running
tasklist /fi "imagename eq d3d11-target.exe" | find "d3d11-target" > nul
if errorlevel 1 goto finished
set /a tries+=1
if %tries% gtr 300 goto stuck
ping -n 2 127.0.0.1 > nul
goto running

:stuck
echo The target was still running after ten minutes.
taskkill /f /im d3d11-target.exe > nul 2>&1
:finished
ping -n 3 127.0.0.1 > nul
taskkill /f /im frida-inject.exe > nul 2>&1
echo ---- harness ----
type inject.log
echo ---- target ----
type target.log
find "exiting with 0 failures" target.log > nul
exit /b %errorlevel%

:never_ready
echo The target never became ready.
type target.log
exit /b 2
