@echo off
setlocal

echo ============================================================
echo  Remote Acesso ^| Build
echo ============================================================

echo.
echo Compilando App...
cd /d "%~dp0app"
call npm run build
if errorlevel 1 ( echo. && echo ERRO: falha ao compilar && exit /b 1 )
cd /d "%~dp0"

echo.
echo ============================================================
echo  Pronto!
echo  app\dist\Remote Acesso Setup 1.2.0.exe
echo ============================================================
endlocal
