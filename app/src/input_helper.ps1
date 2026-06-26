Add-Type @"
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
