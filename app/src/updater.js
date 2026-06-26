const { autoUpdater } = require('electron-updater');

autoUpdater.autoDownload = true;
autoUpdater.autoInstallOnAppQuit = true;

function setupUpdater({ checking, available, notAvailable, progress, downloaded, error }) {
  autoUpdater.on('checking-for-update',  () => checking?.());
  autoUpdater.on('update-available',     () => available?.());
  autoUpdater.on('update-not-available', () => notAvailable?.());
  autoUpdater.on('download-progress',    p  => progress?.(p));
  autoUpdater.on('update-downloaded',    () => downloaded?.());
  autoUpdater.on('error', err => {
    console.error('[Updater]', err?.message);
    // Treat "no releases yet" / network failures as "up to date" so the UI
    // doesn't show a scary error to the user before any release is published.
    const msg = err?.message ?? '';
    const isNoRelease = msg.includes('No published versions') ||
                        msg.includes('latest.yml') ||
                        msg.includes('404') ||
                        msg.includes('net::');
    if (isNoRelease) notAvailable?.();
    else error?.(err);
  });
}

function checkForUpdates() {
  autoUpdater.checkForUpdates().catch(() => {});
}

function installUpdate() {
  autoUpdater.quitAndInstall();
}

module.exports = { setupUpdater, checkForUpdates, installUpdate };
