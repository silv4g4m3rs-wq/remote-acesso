'use strict';
const { spawn } = require('child_process');
const path = require('path');
const fs   = require('fs');
const os   = require('os');

// WH_KEYBOARD_LL hook — bloqueia Win (0x5B/0x5C) e Alt+Tab localmente.
// Win key é forwarded via stdout para o processo pai poder enviá-la ao remoto.
// Alt+Tab: WM_SYSKEYDOWN (wParam=0x104) com vk=Tab (0x09) — bloqueado sem forward
// (Alt já viaja pelo renderer normalmente; só o Tab do Alt+Tab é interceptado).
// PS1 receives parent PID as first arg and self-exits when that process dies
const PS1 = `param([int]$parentPid)
Add-Type @"
using System;
using System.Threading;
using System.Diagnostics;
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
    [DllImport("user32.dll")] static extern bool PostThreadMessage(uint tid, uint msg, IntPtr w, IntPtr l);
    [DllImport("kernel32.dll")] static extern uint GetCurrentThreadId();

    [StructLayout(LayoutKind.Sequential)]
    struct MSG { public IntPtr hwnd; public uint msg; public IntPtr wParam; public IntPtr lParam; public int t, x, y; }

    static IntPtr HookCallback(int nCode, IntPtr wParam, IntPtr lParam) {
        if (nCode >= 0) {
            int vk   = Marshal.ReadInt32(lParam);
            int msg  = (int)wParam;
            bool down = (msg == 0x0100 || msg == 0x0104);

            if (vk == 0x5B || vk == 0x5C) {
                string c = (vk == 0x5B) ? "MetaLeft" : "MetaRight";
                Console.WriteLine("{\\"vk\\":" + vk.ToString() + ",\\"code\\":\\"" + c + "\\",\\"key\\":\\"Meta\\",\\"down\\":" + (down ? "true" : "false") + "}");
                return (IntPtr)1;
            }
            if (vk == 0x09 && (msg == 0x0104 || msg == 0x0105)) {
                Console.WriteLine("{\\"vk\\":9,\\"code\\":\\"Tab\\",\\"key\\":\\"Tab\\",\\"down\\":" + (down ? "true" : "false") + "}");
                return (IntPtr)1;
            }
        }
        return CallNextHookEx(_hook, nCode, wParam, lParam);
    }

    public static void Start(int parentPid) {
        Console.SetOut(new System.IO.StreamWriter(Console.OpenStandardOutput()) { AutoFlush = true });
        uint mainTid = GetCurrentThreadId();
        // Watch parent process — exit if it dies
        new Thread(() => {
            try {
                var p = Process.GetProcessById(parentPid);
                p.WaitForExit();
            } catch {}
            PostThreadMessage(mainTid, 0x0012, IntPtr.Zero, IntPtr.Zero); // WM_QUIT
        }) { IsBackground = true }.Start();

        using (var p = Process.GetCurrentProcess())
        using (var m = p.MainModule)
            _hook = SetWindowsHookEx(13, _proc, GetModuleHandle(m.ModuleName), 0);
        MSG msg;
        while (GetMessage(out msg, IntPtr.Zero, 0, 0) > 0) {}
        UnhookWindowsHookEx(_hook);
    }
}
"@
[WinKeyBlocker]::Start($parentPid)
`;

let _proc    = null;
let _tmpPath = null;
let _onKey   = null;

function _script() {
  if (!_tmpPath) {
    _tmpPath = path.join(os.tmpdir(), 'ra-winkey-hook-v6.ps1');
    fs.writeFileSync(_tmpPath, PS1, 'utf8');
  }
  return _tmpPath;
}

function startHook(onKey) {
  _onKey = onKey || null;
  if (_proc) return;

  _proc = spawn('powershell.exe',
    ['-NonInteractive', '-ExecutionPolicy', 'Bypass', '-WindowStyle', 'Hidden', '-File', _script(), process.pid.toString()],
    { stdio: ['ignore', 'pipe', 'ignore'], windowsHide: true });

  let buf = '';
  _proc.stdout.on('data', d => {
    buf += d.toString();
    let nl;
    while ((nl = buf.indexOf('\n')) !== -1) {
      const line = buf.slice(0, nl).trim();
      buf = buf.slice(nl + 1);
      if (!line || !_onKey) continue;
      try { _onKey(JSON.parse(line)); } catch {}
    }
  });

  _proc.on('exit', () => { _proc = null; });
}

function stopHook() {
  _onKey = null;
  if (!_proc) return;
  try { _proc.kill(); } catch {}
  _proc = null;
}

module.exports = { startHook, stopHook };
