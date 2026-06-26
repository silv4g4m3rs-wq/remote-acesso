# RemoteAcesso — Contexto do Projeto

Aplicação de acesso remoto LAN em Electron + Node.js. Um único componente distribuído (`app/`) com código compartilhado em `shared/`.

## Estrutura

```
REMOTEACESSO/
├── app/        — Painel combinado (agent + viewer numa janela só) — único exe distribuído
├── shared/     — Código comum: crypto.js, logger.js, protocol.js
├── icon.ico / icon.png
├── codesign.pfx
├── build-all.bat
└── setup-all.nsi
```

## Versão atual: 1.1.1

## Stack

- Electron 31 + Node.js
- WebSocket (`ws`) para comunicação
- NSIS para instalador Windows
- `electron-builder` para empacotar

## Protocolo (v3 — criptografado)

- **Discovery**: UDP broadcast na porta `5454` a cada 2s — pacotes assinados com HMAC-SHA256 (`DISCOVERY_TOKEN`)
- **Comunicação**: WebSocket na porta `8765`
- **Handshake**: ao conectar, servidor envia KEX (byte `0xFE` + JSON com pubkey P-256 ECDH)
- **Criptografia**: ECDH P-256 efêmero por sessão + AES-256-GCM + HKDF-SHA256 — todas as mensagens após o KEX são binárias: `[12B nonce][16B tag][ciphertext]`
- **Auth**: senha de 6 chars (A-Z2-9), timeout 10s, máx 10 tentativas/30s por IP
- Constantes em `shared/protocol.js`

## Shared

| Arquivo | Responsabilidade |
|---|---|
| `protocol.js` | Constantes: MSG types, portas, limites, FPS, qualidade, `DISCOVERY_TOKEN` |
| `crypto.js` | ECDH P-256, AES-256-GCM, HKDF — funções: `createECDH`, `deriveKey`, `encrypt`, `decrypt`, `makeKexMessage`, `parseKexMessage` |
| `logger.js` | Logger JSON estruturado → `AppData/Local/RemoteAcesso/logs/` |

## App (`app/src/`)

| Arquivo | Responsabilidade |
|---|---|
| `main.js` | Processo principal — gerencia todas as janelas, server, discovery, IPC |
| `server.js` | WebSocket server do lado agent |
| `capture.js` | Captura de tela via `desktopCapturer` + `ImageCapture` |
| `input.js` | Injeção de input via PowerShell (processo PS persistente com stdin loop) |
| `input_helper.ps1` | Script PS1 embutido para `MapVirtualKey` e SendInput |
| `win-key-hook.js` | Hook WH_KEYBOARD_LL via PowerShell — suprime VK_LWIN/VK_RWIN no lado viewer |
| `firewall.js` | Garante regras de firewall (porta 8765/TCP e 5454/UDP) |
| `agent-discovery.js` | UDP broadcast — anuncia o agent na LAN com assinatura HMAC-SHA256 |
| `viewer-discovery.js` | UDP listener — descobre agents na LAN, verifica HMAC antes de aceitar |
| `updater.js` | Auto-update via GitHub Releases (`latest.yml`) |
| `launcher.html` | Tela inicial (escolher agent ou viewer) |
| `agent-ui.html` | UI do lado agent (senha, clipboard toggle, etc.) |
| `viewer.html` | UI do lado viewer (lista de agents, conexão, canvas) |
| `viewer-app.js` | Lógica do renderer do viewer (canvas RAF, cursor local, input, chat, file transfer) |
| `viewer-style.css` | Estilos do viewer |
| `capture.html` | Janela oculta de captura de tela |
| `chat-window.html` | UI do chat pop-out (janela flutuante independente, dark, scroll automático) |
| `preload-launcher.js` | Expõe `launcherAPI` → `launchAgent`, `launchViewer`, update |
| `preload-agent.js` | Expõe `agentAPI` → init, viewerCount, captureError, toggleClipboard |
| `preload-capture.js` | Expõe `electronAPI` → getSources, sendFrame, monitorList |
| `preload-viewer.js` | Expõe `electronAPI` → connect, frame, input, chat, file, fullscreen, openChatWindow |
| `preload-chat.js` | Expõe `chatAPI` → send, onMessage, onClose (para chat-window.html) |

## Build e publicação

```bash
# Dev mode:
cd app && npm start

# Build:
cd app && npm run build
# Output: app\dist\Remote Acesso Setup 1.1.1.exe

# Publicar (requer GH_TOKEN):
cd app && npm run publish
```

Auto-update via GitHub Releases (`silv4g4m3rs-wq/remote-acesso`), channel `latest` → `latest.yml`.

## Instalador NSIS

`setup-all.nsi` — instalador manual do app (alternativo ao electron-builder).
Instala em `%ProgramFiles%\Remote Acesso\`. Atalhos: desktop + menu iniciar.

## Git / GitHub

- Repo: `https://github.com/silv4g4m3rs-wq/remote-acesso`
- Branch principal: `master`

## Decisões de arquitetura / Problemas conhecidos

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

### Backpressure no servidor de frames
`broadcastFrame` checa `ws.bufferedAmount > 0` antes de enviar — dropa o frame se o cliente estiver atrasado. Garante que o viewer sempre recebe o frame mais recente, sem lag acumulado.

### Discovery autenticado
Pacotes UDP têm formato `{ b: bodyJson, s: hmacHex }`. O viewer verifica com `crypto.timingSafeEqual` e descarta pacotes sem assinatura válida.

### Renderização do viewer (RAF pipeline)
`onFrame` decodifica JPEG → `ImageBitmap` de forma assíncrona. `requestAnimationFrame` renderiza o bitmap mais recente na próxima vsync. Cursor local desenhado em canvas overlay (`alwaysOnTop`; sistema oculto via `cursor: none`).

### Chat pop-out
- Abre automaticamente na **primeira mensagem** enviada ou recebida (viewer e agent)
- Viewer: `chatWin` (`alwaysOnTop: true`, 340×500) — mensagens roteadas via IPC `chat-message`
- Agent: `agentChatWin` — abre ao receber MSG.CHAT de qualquer viewer
- Fecha com animação "Sessão encerrada" ao encerrar a sessão
- IPC `chat-send` diferencia viewer vs agent por `event.sender`

### Teclado
- Usar `e.code` → `CODE_VK` para lookup de Virtual Key (não `e.key`)
- Flag `ext: true` para teclas estendidas (Delete, Home, setas, AltGr, Win)
- `releaseModifiers()` no evento `blur` do viewer
- `win-key-hook.js` suprime VK_LWIN/VK_RWIN via `WH_KEYBOARD_LL`

### Clipboard
- Desativado por padrão (toggle `chk-clip` na UI do agent)

### Limites
- Arquivo máx: 500 MB (`MAX_FILE_SIZE`)
- Agents descobertos máx: 50 (`MAX_AGENTS`)
- FPS: 5–60 adaptativo, padrão 30 (`TARGET_FPS`)

## Pendências conhecidas

- Testes automatizados: não existem
- WAN/relay: não implementado (só funciona em LAN)
- File transfer ainda usa base64 dentro de JSON (candidato a binário puro)

## Padrões do projeto

- Sem comentários óbvios no código
- Sem pseudocódigo — implementação completa ou não faz
- Validar compilando e rodando antes de considerar concluído
- PT-BR nas mensagens de UI e nas conversas
- Prioridade em produção-ready: sem logs de debug, sem fallbacks desnecessários
