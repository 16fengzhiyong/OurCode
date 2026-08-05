/**
 * Global e2e teardown: kill any Electron processes left behind when a test
 * failed before app.close() (Playwright does not force-kill the Electron app
 * the way it does browser contexts). Blunt but effective — the suite's own
 * apps exit cleanly via app.close(), so only strays are affected.
 */
export default function globalTeardown(): void {
  if (process.platform !== 'win32') return
  try {
    require('child_process').execSync('taskkill /F /IM electron.exe /T', { stdio: 'ignore' })
  } catch {
    /* no electron processes — nothing to clean */
  }
}
