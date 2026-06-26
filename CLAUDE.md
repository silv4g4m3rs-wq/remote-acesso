# RemoteAcesso — Contexto do Projeto

Aplicação de acesso remoto LAN em Electron + Node.js. Três componentes independentes com código compartilhado.

## Estrutura

```
REMOTEACESSO/
├── app/        — Painel combinado (agent + viewer numa janela só)
├── agent/      — Apenas o lado servidor (quem compartilha a tela)
├── viewer/     — Apenas o cliente (quem controla)
├── shared/     — Código comum: crypto.js, logger.js, protocol.js
├── icon.ico / icon.png
└── codesign.pfx
```

## Versão atual: 1.1.1

O único exe distribuído é `app/dist/Remote Acesso Setup 1.1.1.exe`.
`agent/` e `viewer/` existem como código-fonte mas não são mais distribuídos separadamente — o `app/` já cobre ambos os modos.

## Stack

- Electron 31 + Node.js
- WebSocket (`ws`) para comunicação
- NSIS para instaladores Windows
- `electron-builder` para empacotar

## Protocolo (v2 — criptografado)

- **Discovery**: UDP broadcast na porta `5454` a cada 2s
- **Comunicação**: WebSocket na porta `8765`
- **Handshake**: ao conectar, servidor envia KEX (byte `0xFE` + JSON com pubkey P-256 ECDH)
- **Criptografia**: ECDH P-256 + AES-256-GCM + HKDF-SHA256 — todas as mensagens após o KEX são binárias: `[12B nonce][16B tag][ciphertext]`
- **Auth**: senha de 6 chars (A-Z2-9), timeout 10s, máx 10 tentativas/30s por IP
- Constantes em `shared/protocol.js`

## Shared

| Arquivo | Responsabilidade |
|---|---|
| `protocol.js` | Constantes: MSG types, portas, limites, FPS, qualidade |
| `crypto.js` | ECDH P-256, AES-256-GCM, HKDF — funções: `createECDH`, `deriveKey`, `encrypt`, `decrypt`, `makeKexMessage`, `parseKexMessage` |
| `logger.js` | Logger JSON estruturado → `AppData/Local/RemoteAcesso/logs/` |

## App (painel combinado — `app/src/`)

| Arquivo | Responsabilidade |
|---|---|
| `main.js` | Processo principal — gerencia todas as janelas, server, discovery, IPC |
| `server.js` | WebSocket server do lado agent |
| `capture.js` | Captura de tela via `desktopCapturer` |
| `input.js` | Injeção de input via PowerShell |
| `input_helper.ps1` | Script PS1 embutido para `MapVirtualKey` e SendInput |
| `firewall.js` | Garante regras de firewall (porta 8765/TCP e 5454/UDP) |
| `agent-discovery.js` | UDP broadcast — anuncia o agent na LAN |
| `viewer-discovery.js` | UDP listener — descobre agents na LAN |
| `updater.js` | Auto-update via GitHub Releases (`latest.yml`) |
| `launcher.html` | Tela inicial (escolher agent ou viewer) |
| `agent-ui.html` | UI do lado agent (senha, clipboard toggle, etc.) |
| `viewer.html` | UI do lado viewer (lista de agents, conexão) |
| `capture.html` | Janela oculta de captura de tela |

## Agent standalone (`agent/src/`)

Subconjunto do `app/`: `main.js`, `server.js`, `capture.js`, `input.js`, `input_helper.ps1`, `firewall.js`, `discovery.js`, `ui.html`, `preload.js`, `updater.js`.

## Viewer standalone (`viewer/src/`)

`main.js`, `discovery.js`, `firewall.js`, `preload.js`, `renderer/app.js`, `renderer/index.html`, `renderer/style.css`.

## Build e publicação

```bash
# Build:
cd app && npm run build
# Output: app\dist\Remote Acesso Setup 1.1.0.exe

# Publicar (requer GH_TOKEN):
cd app && npm run publish
```

Auto-update via GitHub Releases (`silv4g4m3rs-wq/remote-acesso`), channel `latest` → `latest.yml`.

## Instaladores NSIS

- `app/installer.nsi` — instalador manual do app (alternativo ao electron-builder)
- `viewer/installer.nsh` — customInstall/customUnInstall: adiciona/remove regras de firewall via `netsh`

## Problemas conhecidos / Decisões

### Windows 11 24H2 — Freeze na captura de tela
`getUserMedia` com `chromeMediaSource: 'desktop'` ao iniciar congela todas as janelas Electron por causa do novo sistema de consentimento do OS.

**Fix obrigatório**: criar `captureWin` de forma lazy — somente quando o primeiro viewer conectar:
```javascript
agentServer.on('viewer-count', count => {
  if (count > 0 && !captureWin) {
    captureWin = new BrowserWindow({ show: false, ... });
    captureWin.loadFile('capture.html');
  }
});
```

### Teclado
- Usar `e.code` → `CODE_VK` para lookup de Virtual Key (não `e.key`)
- Flag `ext: true` para teclas estendidas (Delete, Home, setas, AltGr, Win)
- `releaseModifiers()` no evento `blur` do viewer

### Clipboard
- Desativado por padrão (toggle `chk-clip` na UI do agent)

### Limites
- Arquivo máx: 500 MB (`MAX_FILE_SIZE`)
- Agents descobertos máx: 50 (`MAX_AGENTS`)
- FPS: 5–30 adaptativo, padrão 15

## Build unificado

`build-all.bat` — compila os três componentes e gera `dist\Remote Acesso Setup 1.1.0.exe` via `setup-all.nsi`.

Instala em:
- `%ProgramFiles%\Remote Acesso\App\` — painel completo
- `%ProgramFiles%\Remote Acesso\Agent\` — agent standalone
- `%ProgramFiles%\Remote Acesso\Viewer\` — viewer standalone

Atalhos: desktop (`Remote Acesso`) + menu iniciar (`Remote Acesso`, `Remote Acesso Agent`, `Remote Acesso Viewer`, `Desinstalar`).

## Pendências conhecidas

- Testes automatizados: não existem
- WAN/relay: não implementado (só funciona em LAN)
- Código duplicado entre `agent/` e `app/` (server.js, input.js, capture.js)
- Versão não centralizada (cada package.json tem a própria)

## Padrões do projeto

- Sem comentários óbvios no código
- Sem pseudocódigo — implementação completa ou não faz
- Validar compilando e rodando antes de considerar concluído
- PT-BR nas mensagens de UI e nas conversas
- Prioridade em produção-ready: sem logs de debug, sem fallbacks desnecessários
