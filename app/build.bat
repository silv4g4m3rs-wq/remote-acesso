@echo off
REM Build do Remote Acesso com assinatura auto-assinada
REM O instalador final e copiado para o Desktop para evitar bloqueio do Defender na pasta dist

echo Preparando ambiente de build...

set AB_DIR=%USERPROFILE%\AppData\Local\eb-build-%RANDOM%
if not exist "%AB_DIR%" mkdir "%AB_DIR%"
copy /Y "%~dp0node_modules\app-builder-bin\win\x64\app-builder.exe" "%AB_DIR%\app-builder.exe" >nul

set USE_SYSTEM_APP_BUILDER=true
set PATH=%AB_DIR%;%PATH%
echo Iniciando build...
call npm run build

echo.
if errorlevel 1 (
  echo [ERRO] Build falhou.
) else (
  set OUT="%~dp0dist\Remote Acesso Setup 1.0.0.exe"
  set DEST="%USERPROFILE%\Desktop\Remote Acesso Setup 1.0.0.exe"
  copy /Y %OUT% %DEST% >nul
  echo [OK] Build concluido!
  echo     Instalador copiado para: %DEST%
  rmdir /S /Q "%AB_DIR%" 2>nul
)
