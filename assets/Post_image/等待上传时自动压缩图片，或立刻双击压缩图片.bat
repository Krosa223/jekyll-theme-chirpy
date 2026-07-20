@echo off
chcp 65001 >nul
setlocal
cd /d "%~dp0"

set "PYTHON_EXE="

for /d %%D in ("%LocalAppData%\Programs\Python\Python*") do (
  if not defined PYTHON_EXE if exist "%%~fD\python.exe" set "PYTHON_EXE=%%~fD\python.exe"
)

if not defined PYTHON_EXE if exist "%UserProfile%\scoop\apps\python\current\python.exe" set "PYTHON_EXE=%UserProfile%\scoop\apps\python\current\python.exe"

if not defined PYTHON_EXE (
  for /f "delims=" %%P in ('powershell.exe -NoProfile -Command "$p = Get-Command python.exe -ErrorAction SilentlyContinue; if ($p) { $p.Source }"') do set "PYTHON_EXE=%%P"
)

if not defined PYTHON_EXE goto :python_missing

"%PYTHON_EXE%" -c "from PIL import Image" >nul 2>nul
if errorlevel 1 goto :pillow_missing

"%PYTHON_EXE%" "%CD%\_image_compressor.py"
goto :finish

:python_missing
echo [Cannot run] Python was not found on this computer.
goto :finish

:pillow_missing
echo [Cannot run] Pillow is missing from Python.
echo Install it with: "%PYTHON_EXE%" -m pip install Pillow

:finish
echo.
pause
