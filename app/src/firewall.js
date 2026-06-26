// Ensures Windows Firewall allows RemoteAcesso ports.
// Called once at startup; shows UAC prompt if rules are missing.
const { spawn } = require('child_process');
const { writeFileSync } = require('fs');
const { join } = require('path');
const { tmpdir } = require('os');

const RULES = `
New-NetFirewallRule -DisplayName 'RemoteAcesso WebSocket' -Direction Inbound -Protocol TCP -LocalPort 8765 -Action Allow -ErrorAction SilentlyContinue
New-NetFirewallRule -DisplayName 'RemoteAcesso Discovery' -Direction Inbound -Protocol UDP -LocalPort 5454 -Action Allow -ErrorAction SilentlyContinue
`.trim();

function rulesExist() {
  return new Promise(resolve => {
    const ps = spawn('powershell.exe', [
      '-NonInteractive', '-WindowStyle', 'Hidden', '-Command',
      `$null -ne (Get-NetFirewallRule -DisplayName 'RemoteAcesso WebSocket' -ErrorAction SilentlyContinue)`,
    ], { windowsHide: true });
    let out = '';
    ps.stdout.on('data', d => { out += d.toString(); });
    ps.on('close', () => resolve(out.trim().toLowerCase() === 'true'));
    ps.on('error',  () => resolve(true));
  });
}

function applyRules() {
  return new Promise(resolve => {
    const tmp = join(tmpdir(), 'ra-firewall-setup.ps1');
    writeFileSync(tmp, RULES, 'utf8');
    spawn('powershell.exe', [
      '-NonInteractive', '-WindowStyle', 'Hidden', '-Command',
      `Start-Process powershell -Verb RunAs -WindowStyle Hidden -ArgumentList '-NonInteractive -ExecutionPolicy Bypass -File "${tmp}"' -Wait`,
    ], { windowsHide: true })
      .on('close', resolve)
      .on('error', resolve);
  });
}

async function ensureFirewallRules() {
  if (process.platform !== 'win32') return;
  if (await rulesExist()) return;
  await applyRules();
}

module.exports = { ensureFirewallRules };
