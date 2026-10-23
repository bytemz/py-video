@echo off
chcp 65001 >nul
cd /d "%~dp0"

echo ============================================
echo   影阁 PyVideo - 打包为单文件 exe
echo ============================================
echo.

echo [1/3] 安装运行与打包依赖...
python -m pip install -r requirements.txt
python -m pip install pyinstaller pillow
if errorlevel 1 goto :fail

echo.
echo [2/3] 清理旧构建...
if exist build rmdir /s /q build
if exist dist rmdir /s /q dist

echo.
echo [3/3] 开始打包...
python -m PyInstaller --clean --noconfirm py-video.spec
if errorlevel 1 goto :fail

echo.
echo ============================================
echo   打包完成：dist\PyVideo.exe
echo   提示：如需把 FFmpeg 一起塞进 exe，
echo   请先把 ffmpeg.exe / ffprobe.exe 放到 bin\ 再重新打包。
echo ============================================
pause
exit /b 0

:fail
echo.
echo 打包失败，请查看上方错误信息。
pause
exit /b 1
