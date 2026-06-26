'use strict';
const { spawn } = require('child_process');
const path = require('path');
const fs   = require('fs');
const os   = require('os');
const { MSG } = require('../../shared/protocol');
const { createLogger } = require('../../shared/logger');

const log = createLogger('input');

// e.code (physical key, layout-independent) → [vk, extended?]
const CODE_VK = {
  // Letters
  KeyA:[0x41],KeyB:[0x42],KeyC:[0x43],KeyD:[0x44],KeyE:[0x45],KeyF:[0x46],
  KeyG:[0x47],KeyH:[0x48],KeyI:[0x49],KeyJ:[0x4A],KeyK:[0x4B],KeyL:[0x4C],
  KeyM:[0x4D],KeyN:[0x4E],KeyO:[0x4F],KeyP:[0x50],KeyQ:[0x51],KeyR:[0x52],
  KeyS:[0x53],KeyT:[0x54],KeyU:[0x55],KeyV:[0x56],KeyW:[0x57],KeyX:[0x58],
  KeyY:[0x59],KeyZ:[0x5A],
  // Digits
  Digit1:[0x31],Digit2:[0x32],Digit3:[0x33],Digit4:[0x34],Digit5:[0x35],
  Digit6:[0x36],Digit7:[0x37],Digit8:[0x38],Digit9:[0x39],Digit0:[0x30],
  // Function keys
  F1:[0x70],F2:[0x71],F3:[0x72],F4:[0x73],F5:[0x74],F6:[0x75],
  F7:[0x76],F8:[0x77],F9:[0x78],F10:[0x79],F11:[0x7A],F12:[0x7B],
  // Modifiers
  ShiftLeft:[0xA0],ShiftRight:[0xA1],
  ControlLeft:[0xA2],ControlRight:[0xA3,true],
  AltLeft:[0xA4],AltRight:[0xA5,true],
  MetaLeft:[0x5B,true],MetaRight:[0x5C,true],
  // Navigation
  Backspace:[0x08],Tab:[0x09],Enter:[0x0D],Escape:[0x1B],Space:[0x20],
  CapsLock:[0x14],NumLock:[0x90,true],ScrollLock:[0x91],Pause:[0x13],
  PrintScreen:[0x2C,true],
  Insert:[0x2D,true],Delete:[0x2E,true],
  Home:[0x24,true],End:[0x23,true],
  PageUp:[0x21,true],PageDown:[0x22,true],
  ArrowLeft:[0x25,true],ArrowUp:[0x26,true],
  ArrowRight:[0x27,true],ArrowDown:[0x28,true],
  ContextMenu:[0x5D,true],
  // Numpad
  Numpad0:[0x60],Numpad1:[0x61],Numpad2:[0x62],Numpad3:[0x63],Numpad4:[0x64],
  Numpad5:[0x65],Numpad6:[0x66],Numpad7:[0x67],Numpad8:[0x68],Numpad9:[0x69],
  NumpadMultiply:[0x6A],NumpadAdd:[0x6B],NumpadSubtract:[0x6D],
  NumpadDecimal:[0x6E],NumpadDivide:[0x6F,true],NumpadEnter:[0x0D,true],
  NumpadComma:[0x6C],
  // Punctuation (OEM)
  Semicolon:[0xBA],Equal:[0xBB],Comma:[0xBC],Minus:[0xBD],Period:[0xBE],
  Slash:[0xBF],Backquote:[0xC0],BracketLeft:[0xDB],Backslash:[0xDC],
  BracketRight:[0xDD],Quote:[0xDE],
  // ABNT2
  IntlBackslash:[0xE2],IntlRo:[0xC1],
};

// PS1 embedded — no debug logging, no file writes
const PS1_CONTENT = `Add-Type @"
using System;
using System.Runtime.InteropServices;

public static class InputHelper {
    [DllImport("user32.dll")] public static extern bool SetCursorPos(int x, int y);
    [DllImport("user32.dll")] public static extern uint MapVirtualKey(uint uCode, uint uMapType);

    [StructLayout(LayoutKind.Sequential)] public struct MOUSEINPUT {
        public int dx, dy;
        public uint mouseData, dwFlags, time;
        public IntPtr dwExtraInfo;
    }
    [StructLayout(LayoutKind.Sequential)] public struct KEYBDINPUT {
        public ushort wVk, wScan;
        public uint dwFlags, time;
        public IntPtr dwExtraInfo;
    }
    [StructLayout(LayoutKind.Sequential)] public struct HARDWAREINPUT {
        public uint uMsg; public ushort wParamL, wParamH;
    }
    [StructLayout(LayoutKind.Explicit)] public struct INPUTUNION {
        [FieldOffset(0)] public MOUSEINPUT mi;
        [FieldOffset(0)] public KEYBDINPUT ki;
        [FieldOffset(0)] public HARDWAREINPUT hi;
    }
    [StructLayout(LayoutKind.Sequential)] public struct INPUT {
        public uint type;
        public INPUTUNION u;
    }

    [DllImport("user32.dll", SetLastError = true)]
    public static extern uint SendInput(uint n, INPUT[] p, int cb);

    public const uint INPUT_MOUSE    = 0;
    public const uint INPUT_KEYBOARD = 1;
    public const uint MOUSEEVENTF_LEFTDOWN   = 0x0002;
    public const uint MOUSEEVENTF_LEFTUP     = 0x0004;
    public const uint MOUSEEVENTF_RIGHTDOWN  = 0x0008;
    public const uint MOUSEEVENTF_RIGHTUP    = 0x0010;
    public const uint MOUSEEVENTF_MIDDLEDOWN = 0x0020;
    public const uint MOUSEEVENTF_MIDDLEUP   = 0x0040;
    public const uint MOUSEEVENTF_WHEEL      = 0x0800;
    public const uint KEYEVENTF_EXTENDEDKEY  = 0x0001;
    public const uint KEYEVENTF_KEYUP        = 0x0002;

    public static void Mouse(uint flags, uint data = 0) {
        var inp = new INPUT { type = INPUT_MOUSE,
            u = new INPUTUNION { mi = new MOUSEINPUT { dwFlags = flags, mouseData = data } } };
        SendInput(1, new[] { inp }, Marshal.SizeOf(typeof(INPUT)));
    }

    public static void Key(ushort vk, bool ext, bool down) {
        ushort scan = (ushort)MapVirtualKey(vk, 0);
        uint flags = down ? 0u : KEYEVENTF_KEYUP;
        if (ext) flags |= KEYEVENTF_EXTENDEDKEY;
        var inp = new INPUT { type = INPUT_KEYBOARD,
            u = new INPUTUNION { ki = new KEYBDINPUT { wVk = vk, wScan = scan, dwFlags = flags } } };
        SendInput(1, new[] { inp }, Marshal.SizeOf(typeof(INPUT)));
    }
}
"@

$reader = [Console]::In
while ($true) {
    $line = $reader.ReadLine()
    if ($null -eq $line) { break }
    if ($line -eq '') { continue }
    try {
        $m = $line | ConvertFrom-Json
        switch ($m.type) {
            'move'   { [InputHelper]::SetCursorPos([int]$m.x, [int]$m.y) }
            'mdown'  {
                [InputHelper]::SetCursorPos([int]$m.x, [int]$m.y)
                $f = if ($m.b -eq 2) { [InputHelper]::MOUSEEVENTF_RIGHTDOWN }
                     elseif ($m.b -eq 1) { [InputHelper]::MOUSEEVENTF_MIDDLEDOWN }
                     else { [InputHelper]::MOUSEEVENTF_LEFTDOWN }
                [InputHelper]::Mouse($f)
            }
            'mup'    {
                $f = if ($m.b -eq 2) { [InputHelper]::MOUSEEVENTF_RIGHTUP }
                     elseif ($m.b -eq 1) { [InputHelper]::MOUSEEVENTF_MIDDLEUP }
                     else { [InputHelper]::MOUSEEVENTF_LEFTUP }
                [InputHelper]::Mouse($f)
            }
            'scroll' { [InputHelper]::Mouse([InputHelper]::MOUSEEVENTF_WHEEL, [uint]([int]$m.d * 120)) }
            'kdown'  { [InputHelper]::Key([uint16]$m.vk, [bool]$m.ext, $true) }
            'kup'    { [InputHelper]::Key([uint16]$m.vk, [bool]$m.ext, $false) }
        }
    } catch {}
}
`;

let proc      = null;
let scriptPath = null;
let screenW   = 1920;
let screenH   = 1080;
let psKilled  = false;

function initScreen() {
  try {
    const { screen } = require('electron');
    const { width, height } = screen.getPrimaryDisplay().bounds;
    screenW = width;
    screenH = height;
  } catch (e) {
    log.warn('initScreen falhou', { error: e.message });
  }
}

// Called when agent receives monitor list (with per-display dimensions) or monitor switch
function setScreenBounds(w, h) {
  if (w > 0 && h > 0) { screenW = w; screenH = h; }
}

function getScriptPath() {
  if (scriptPath) return scriptPath;
  try {
    const { app } = require('electron');
    if (app.isPackaged) {
      const tmp = path.join(os.tmpdir(), 'ra-input-helper.ps1');
      fs.writeFileSync(tmp, PS1_CONTENT, 'utf8');
      scriptPath = tmp;
    } else {
      scriptPath = path.join(__dirname, 'input_helper.ps1');
    }
  } catch (e) {
    log.error('getScriptPath falhou', { error: e.message });
  }
  return scriptPath;
}

function spawnPS() {
  const script = getScriptPath();
  if (!script) { log.error('Nenhum script PS1 disponivel'); return null; }

  log.info('Iniciando processo PowerShell', { script });
  const p = spawn('powershell.exe', ['-NonInteractive', '-ExecutionPolicy', 'Bypass', '-File', script], {
    stdio: ['pipe', 'pipe', 'pipe'],
  });

  p.stderr.on('data', d => {
    const text = d.toString().trim();
    if (text) log.error('PS1 stderr', { message: text });
  });

  p.on('error', e => {
    log.error('PS1 spawn error', { error: e.message });
    proc = null;
    if (!psKilled) scheduleRestart();
  });

  p.on('exit', code => {
    if (code !== 0 && code !== null) log.warn('PS1 encerrou inesperadamente', { code });
    proc = null;
    if (!psKilled) scheduleRestart();
  });

  proc = p;
  return p;
}

function scheduleRestart() {
  setTimeout(() => {
    if (!psKilled && !proc) {
      log.info('Reiniciando PowerShell');
      spawnPS();
    }
  }, 1000);
}

function getProc() {
  if (proc && proc.exitCode === null) return proc;
  return spawnPS();
}

function send(obj) {
  const p = getProc();
  if (p?.stdin.writable) p.stdin.write(JSON.stringify(obj) + '\n');
}

initScreen();
getProc();

function handleInput(msg) {
  switch (msg.type) {
    case MSG.MOUSE_MOVE:
      send({ type: 'move', x: Math.round(msg.nx * screenW), y: Math.round(msg.ny * screenH) });
      break;
    case MSG.MOUSE_CLICK:
      send({ type: msg.down ? 'mdown' : 'mup', b: msg.button,
             x: Math.round(msg.nx * screenW), y: Math.round(msg.ny * screenH) });
      break;
    case MSG.MOUSE_SCROLL:
      if (msg.dy !== 0) send({ type: 'scroll', d: msg.dy });
      break;
    case MSG.KEY: {
      const entry = CODE_VK[msg.code];
      if (!entry) break;
      const [vk, ext = false] = entry;
      send({ type: msg.down ? 'kdown' : 'kup', vk, ext });
      break;
    }
  }
}

function shutdown() {
  psKilled = true;
  if (proc) { try { proc.stdin.end(); proc.kill(); } catch {} }
}

module.exports = { handleInput, setScreenBounds, shutdown };
