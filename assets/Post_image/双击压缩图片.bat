@echo off
chcp 65001 >nul
setlocal
cd /d "%~dp0"

where py >nul 2>nul
if not errorlevel 1 (
  py -3 -c "from PIL import Image" >nul 2>nul
  if not errorlevel 1 (
    py -3 "%~dp0_image_compressor.py"
    goto :finish
  )
)

where python >nul 2>nul
if not errorlevel 1 (
  python -c "from PIL import Image" >nul 2>nul
  if not errorlevel 1 (
    python "%~dp0_image_compressor.py"
    goto :finish
  )
)

echo [无法运行] 没有找到可用的 Python 和 Pillow。
echo 请先安装 Pillow：python -m pip install Pillow

:finish
echo.
pause
