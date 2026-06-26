Unicode True
!define APP_NAME "Remote Acesso"
!define APP_VERSION "1.0.0"
!define APP_EXE "Remote Acesso.exe"
!define APP_DIR "$PROGRAMFILES64\${APP_NAME}"
!define UNINSTALLER "${APP_DIR}\Uninstall.exe"
!define SRC_DIR "dist\win-unpacked"
!define REG_UNINST "Software\Microsoft\Windows\CurrentVersion\Uninstall\${APP_NAME}"

Name "${APP_NAME}"
OutFile "dist\Remote Acesso Setup 1.0.0.exe"
InstallDir "${APP_DIR}"
InstallDirRegKey HKLM "Software\${APP_NAME}" "InstallDir"
RequestExecutionLevel admin
SetCompressor /SOLID lzma

!include "MUI2.nsh"

!define MUI_ABORTWARNING
!insertmacro MUI_PAGE_DIRECTORY
!insertmacro MUI_PAGE_INSTFILES
!insertmacro MUI_UNPAGE_CONFIRM
!insertmacro MUI_UNPAGE_INSTFILES
!insertmacro MUI_LANGUAGE "PortugueseBR"

Section "Main" SecMain
  ; Kill any running instance before installing
  nsExec::Exec 'taskkill /F /IM "${APP_EXE}" /T'

  SetOutPath "$INSTDIR"
  File /r "${SRC_DIR}\*"

  WriteUninstaller "${UNINSTALLER}"

  ; Internal install dir key
  WriteRegStr HKLM "Software\${APP_NAME}" "InstallDir" "$INSTDIR"

  ; Register in Programs and Features
  WriteRegStr   HKLM "${REG_UNINST}" "DisplayName"     "${APP_NAME}"
  WriteRegStr   HKLM "${REG_UNINST}" "DisplayVersion"  "${APP_VERSION}"
  WriteRegStr   HKLM "${REG_UNINST}" "Publisher"       "Remote Acesso"
  WriteRegStr   HKLM "${REG_UNINST}" "InstallLocation" "$INSTDIR"
  WriteRegStr   HKLM "${REG_UNINST}" "UninstallString" '"${UNINSTALLER}"'
  WriteRegStr   HKLM "${REG_UNINST}" "QuietUninstallString" '"${UNINSTALLER}" /S'
  WriteRegDWORD HKLM "${REG_UNINST}" "NoModify"        1
  WriteRegDWORD HKLM "${REG_UNINST}" "NoRepair"        1

  ; Shortcuts
  CreateShortcut "$DESKTOP\${APP_NAME}.lnk" "$INSTDIR\${APP_EXE}"
  CreateDirectory "$SMPROGRAMS\${APP_NAME}"
  CreateShortcut "$SMPROGRAMS\${APP_NAME}\${APP_NAME}.lnk" "$INSTDIR\${APP_EXE}"
  CreateShortcut "$SMPROGRAMS\${APP_NAME}\Desinstalar.lnk" "${UNINSTALLER}"
SectionEnd

Section "Uninstall"
  ; Kill all running instances
  nsExec::Exec 'taskkill /F /IM "${APP_EXE}" /T'

  ; Remove files
  RMDir /r "$INSTDIR"

  ; Remove shortcuts
  Delete "$DESKTOP\${APP_NAME}.lnk"
  RMDir /r "$SMPROGRAMS\${APP_NAME}"

  ; Remove registry entries
  DeleteRegKey HKLM "${REG_UNINST}"
  DeleteRegKey HKLM "Software\${APP_NAME}"
SectionEnd
