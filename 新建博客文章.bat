@echo off
setlocal

set "CODEX_PYTHON=%USERPROFILE%\.cache\codex-runtimes\codex-primary-runtime\dependencies\python\python.exe"
set "POST_TOOL="

if exist "%~dp0tools\new_post.py" set "POST_TOOL=%~dp0tools\new_post.py"
if defined POST_TOOL goto tool_found
for /d %%D in ("%~dp0*") do if exist "%%~fD\tools\new_post.py" set "POST_TOOL=%%~fD\tools\new_post.py"
if defined POST_TOOL goto tool_found

echo The blog folder could not be found.
echo Keep this launcher inside the blog folder or one level above it.
pause
exit /b 1

:tool_found
if not exist "%CODEX_PYTHON%" goto check_py
"%CODEX_PYTHON%" -c "import tkinter; from PIL import Image" >nul 2>nul
if not errorlevel 1 goto use_codex_python

:check_py
py -3 -c "import tkinter; from PIL import Image" >nul 2>nul
if not errorlevel 1 goto use_py
python -c "import tkinter; from PIL import Image" >nul 2>nul
if not errorlevel 1 goto use_python

echo Python 3 was not found. Please install Python 3 and Pillow.
pause
exit /b 1

:use_codex_python
"%CODEX_PYTHON%" "%POST_TOOL%" %*
goto done

:use_py
py -3 "%POST_TOOL%" %*
goto done

:use_python
python "%POST_TOOL%" %*

:done
set "EXIT_CODE=%ERRORLEVEL%"
if not "%EXIT_CODE%"=="0" pause
exit /b %EXIT_CODE%
