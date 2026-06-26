Unicode True

!define APP_NAME    "Remote Acesso"
!define APP_VERSION "1.1.1"
!define BASE_DIR    "$PROGRAMFILES64\Remote Acesso"
!define UNINSTALLER "${BASE_DIR}\Uninstall.exe"
!define REG_UNINST  "Software\Microsoft\Windows\CurrentVersion\Uninstall\Remote Acesso"

!define SRC_APP    "app\dist\win-unpacked"

Name "${APP_NAME} ${APP_VERSION}"
OutFile "dist\Remote Acesso Setup ${APP_VERSION}.exe"
InstallDir "${BASE_DIR}"
InstallDirRegKey HKLM "Software\${APP_NAME}" "InstallDir"
RequestExecutionLevel admin
SetCompressor /SOLID lzma

!include "MUI2.nsh"

!define MUI_ICON "icon.ico"
!define MUI_UNICON "icon.ico"
!define MUI_ABORTWARNING

!insertmacro MUI_PAGE_WELCOME
!insertmacro MUI_PAGE_DIRECTORY
!insertmacro MUI_PAGE_INSTFILES
!insertmacro MUI_PAGE_FINISH
!insertmacro MUI_UNPAGE_CONFIRM
!insertmacro MUI_UNPAGE_INSTFILES
!insertmacro MUI_LANGUAGE "PortugueseBR"

Section "Instalar" SecMain
  nsExec::Exec 'taskkill /F /IM "Remote Acesso.exe" /T'

  SetOutPath "$INSTDIR"
  File /r "${SRC_APP}\*"

  ; ── Firewall ──────────────────────────────────────────────────────────────
  nsExec::ExecToLog '"netsh" advfirewall firewall add rule name="RemoteAcesso WebSocket" dir=in action=allow protocol=TCP localport=8765 enable=yes'
  nsExec::ExecToLog '"netsh" advfirewall firewall add rule name="RemoteAcesso Discovery" dir=in action=allow protocol=UDP localport=5454 enable=yes'

  ; ── Registry ──────────────────────────────────────────────────────────────
  WriteRegStr   HKLM "Software\${APP_NAME}"  "InstallDir"           "$INSTDIR"
  WriteRegStr   HKLM "${REG_UNINST}"         "DisplayName"          "${APP_NAME}"
  WriteRegStr   HKLM "${REG_UNINST}"         "DisplayVersion"       "${APP_VERSION}"
  WriteRegStr   HKLM "${REG_UNINST}"         "Publisher"            "Remote Acesso"
  WriteRegStr   HKLM "${REG_UNINST}"         "InstallLocation"      "$INSTDIR"
  WriteRegStr   HKLM "${REG_UNINST}"         "UninstallString"      '"${UNINSTALLER}"'
  WriteRegStr   HKLM "${REG_UNINST}"         "QuietUninstallString" '"${UNINSTALLER}" /S'
  WriteRegDWORD HKLM "${REG_UNINST}"         "NoModify"             1
  WriteRegDWORD HKLM "${REG_UNINST}"         "NoRepair"             1

  WriteUninstaller "${UNINSTALLER}"

  ; ── Atalhos ───────────────────────────────────────────────────────────────
  CreateShortcut "$DESKTOP\Remote Acesso.lnk" "$INSTDIR\Remote Acesso.exe"

  CreateDirectory "$SMPROGRAMS\Remote Acesso"
  CreateShortcut "$SMPROGRAMS\Remote Acesso\Remote Acesso.lnk" "$INSTDIR\Remote Acesso.exe"
  CreateShortcut "$SMPROGRAMS\Remote Acesso\Desinstalar.lnk"   "${UNINSTALLER}"
SectionEnd

Section "Uninstall"
  nsExec::Exec 'taskkill /F /IM "Remote Acesso.exe" /T'

  RMDir /r "$INSTDIR"

  Delete "$DESKTOP\Remote Acesso.lnk"
  RMDir /r "$SMPROGRAMS\Remote Acesso"

  nsExec::ExecToLog '"netsh" advfirewall firewall delete rule name="RemoteAcesso WebSocket"'
  nsExec::ExecToLog '"netsh" advfirewall firewall delete rule name="RemoteAcesso Discovery"'

  DeleteRegKey HKLM "${REG_UNINST}"
  DeleteRegKey HKLM "Software\${APP_NAME}"
SectionEnd
