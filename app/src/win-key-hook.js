'use strict';
const { spawn } = require('child_process');
const path = require('path');
const fs   = require('fs');
const os   = require('os');

// Instala WH_KEYBOARD_LL para suprimir VK_LWIN (0x5B) e VK_RWIN (0x5C) localmente.
// Necessário porque o Windows intercepta a tecla Win no kernel, antes de qualquer
// evento chegar ao renderer — preventDefault() no browser não tem efeito aqui.
const PS1 = `Add-Type @"
using System;
using System.Runtime.InteropServices;

public class WinKeyBlocker {
    private delegate IntPtr LowLevelKeyboardProc(int nCode, IntPtr wParam, IntPtr lParam);
    private static readonly LowLevelKeyboardProc _proc = HookCallback;
    private static IntPtr _hook = IntPtr.Zero;

    [DllImport("user32.dll")] static extern IntPtr SetWindowsHookEx(int id, LowLevelKeyboardProc fn, IntPtr mod, uint tid);
    [DllImport("user32.dll")] static extern bool   UnhookWindowsHookEx(IntPtr h);
    [DllImport("user32.dll")] static extern IntPtr CallNextHookEx(IntPtr h, int n, IntPtr w, IntPtr l);
    [DllImport("kernel32.dll", CharSet=CharSet.Auto)] static extern IntPtr GetModuleHandle(string n);
    [DllImport("user32.dll")] static extern int GetMessage(out MSG m, IntPtr h, uint a, uint b);

    [StructLayout(LayoutKind.Sequential)]
    struct MSG { public IntPtr hwnd; public uint msg; public IntPtr wParam; public IntPtr lParam; public int t, x, y; }

    static IntPtr HookCallback(int nCode, IntPtr wParam, IntPtr lParam) {
        if (nCode >= 0) {
            int vk = Marshal.ReadInt32(lParam);
            if (vk == 0x5B || vk == 0x5C) return (IntPtr)1; // suprimir Win key
        }
        return CallNextHookEx(_hook, nCode, wParam, lParam);
    }

    public static void Start() {
        using (var p = System.Diagnostics.Process.GetCurrentProcess())
        using (var m = p.MainModule)
            _hook = SetWindowsHookEx(13, _proc, GetModuleHandle(m.ModuleName), 0);
        MSG msg;
        while (GetMessage(out msg, IntPtr.Zero, 0, 0) > 0) {}
        UnhookWindowsHookEx(_hook);
    }
}
"@
[WinKeyBlocker]::Start()
`;

let _proc    = null;
let _tmpPath = null;

function _script() {
  if (!_tmpPath) {
    _tmpPath = path.join(os.tmpdir(), 'ra-winkey-hook.ps1');
    fs.writeFileSync(_tmpPath, PS1, 'utf8');
  }
  return _tmpPath;
}

function startHook() {
  if (_proc) return;
  _proc = spawn('powershell.exe',
    ['-NonInteractive', '-ExecutionPolicy', 'Bypass', '-WindowStyle', 'Hidden', '-File', _script()],
    { stdio: 'ignore', windowsHide: true });
  _proc.on('exit', () => { _proc = null; });
}

function stopHook() {
  if (!_proc) return;
  try { _proc.kill(); } catch {}
  _proc = null;
}

module.exports = { startHook, stopHook };
