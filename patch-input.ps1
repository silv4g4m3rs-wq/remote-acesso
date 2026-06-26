# Patch Remote Acesso - corrige input de mouse e teclado
# Execute como Administrador em qualquer maquina com o app instalado

$ErrorActionPreference = "Stop"

# Encontra onde o app esta instalado
$installDir = $null
$candidates = @(
    "$env:LOCALAPPDATA\Programs\Remote Acesso",
    "$env:ProgramFiles\Remote Acesso",
    "C:\Program Files\Remote Acesso"
)
foreach ($c in $candidates) {
    if (Test-Path "$c\resources\app.asar") { $installDir = $c; break }
}

if (-not $installDir) {
    Write-Host "[ERRO] Remote Acesso nao encontrado. Instale o app primeiro." -ForegroundColor Red
    exit 1
}

Write-Host "Encontrado em: $installDir" -ForegroundColor Cyan
$resDir = "$installDir\resources"

# Para o processo se estiver rodando
$procs = Get-Process "Remote Acesso" -ErrorAction SilentlyContinue
if ($procs) {
    Write-Host "Encerrando Remote Acesso..."
    $procs | Stop-Process -Force
    Start-Sleep 1
}

# Extrai o ASAR
$tmpDir = "$env:TEMP\ra-patch-$(Get-Random)"
Write-Host "Extraindo app.asar..."
& npx --yes asar extract "$resDir\app.asar" $tmpDir 2>$null
if ($LASTEXITCODE -ne 0) {
    Write-Host "[ERRO] Falha ao extrair ASAR." -ForegroundColor Red; exit 1
}

# Aplica o patch em input.js
$inputJs = "$tmpDir\src\input.js"
$content = Get-Content $inputJs -Raw

if ($content -match "isPackaged") {
    Write-Host "Patch ja aplicado." -ForegroundColor Yellow
} else {
    $content = $content -replace `
        "const script = path\.join\(__dirname, 'input_helper\.ps1'\);",
        "const { app } = require('electron');`n  const script = app.isPackaged`n    ? path.join(process.resourcesPath, 'input_helper.ps1')`n    : path.join(__dirname, 'input_helper.ps1');"
    Set-Content $inputJs $content -Encoding UTF8
    Write-Host "input.js patchado." -ForegroundColor Green
}

# Copia input_helper.ps1 para resources (fora do ASAR)
Copy-Item "$tmpDir\src\input_helper.ps1" "$resDir\input_helper.ps1" -Force
Write-Host "input_helper.ps1 copiado para resources." -ForegroundColor Green

# Faz backup e repacota o ASAR
Copy-Item "$resDir\app.asar" "$resDir\app.asar.bak" -Force -ErrorAction SilentlyContinue
Write-Host "Repacotando ASAR..."
& npx --yes asar pack $tmpDir "$resDir\app.asar" 2>$null
if ($LASTEXITCODE -ne 0) {
    Write-Host "[ERRO] Falha ao repacotar ASAR." -ForegroundColor Red; exit 1
}

Remove-Item $tmpDir -Recurse -Force

Write-Host ""
Write-Host "[OK] Patch aplicado com sucesso! Reinicie o Remote Acesso." -ForegroundColor Green
