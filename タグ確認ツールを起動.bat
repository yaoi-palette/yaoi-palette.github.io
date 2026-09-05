@echo off
cd /d "%~dp0"
echo タグ確認ツールを起動しています...
call npm run review-tags
pause
