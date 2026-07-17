@echo off
REM ---------------------------------------------------------------------------
REM Launch the static server and open the Planet Economy sandbox.
REM
REM Why a server is needed at all: the page auto-loads the default map with
REM fetch("../../maps/sample-map.json"), and fetch() is blocked on file:// --
REM the origin is opaque, so the browser refuses regardless of where the JSON
REM sits. Double-clicking the .html therefore always drops you on the
REM "Load a map..." picker; serving over http is what makes it load by itself.
REM
REM This must serve the REPO ROOT (not game/toy), because the page reaches up
REM two levels for the map. Keep this script at the repo root: it serves %~dp0.
REM ---------------------------------------------------------------------------
setlocal
cd /d "%~dp0"

set "PORT=8765"
set "URL=http://localhost:%PORT%/game/toy/planet_economy.html"

if not exist "maps\sample-map.json" (
  echo ERROR: maps\sample-map.json not found next to this script.
  echo This script must live in the repo root, which is the directory it serves.
  pause
  exit /b 1
)

REM Reuse a server already on this port -- a second one would just fail to bind.
netstat -ano | findstr /c:":%PORT% " | findstr /c:"LISTENING" >nul
if %errorlevel%==0 (
  echo Static server already listening on port %PORT% - reusing it.
) else (
  echo Starting static server on port %PORT% ...
  start "plangen static server" /min python -m http.server %PORT%
  REM Wait for it to actually bind before the browser asks for a page, else the
  REM first hit is refused. Poll rather than sleep a fixed amount: a flat delay
  REM races the server on a slow start. "ping" is the sleep -- "timeout" reads
  REM stdin and dies with "Input redirection is not supported" whenever this
  REM script is run non-interactively.
  set "READY="
  for /l %%i in (1,1,20) do (
    if not defined READY (
      netstat -ano | findstr /c:":%PORT% " | findstr /c:"LISTENING" >nul && set "READY=1"
      if not defined READY ping -n 2 127.0.0.1 >nul
    )
  )
  if not defined READY echo WARNING: port %PORT% never came up - opening anyway, try reloading.
)

echo Opening %URL%
start "" "%URL%"
echo.
echo Close the minimised "plangen static server" window to stop the server.
endlocal
