import { app, shell, BrowserWindow } from 'electron'
import { join } from 'node:path'
import { pathToFileURL } from 'node:url'
import { registerIpc } from './ipc'
import { keepAwake } from './keep-awake'
import { openCodeService } from './opencode/service'
import { eventBus } from './opencode/bus'
import { chatManager } from './opencode/chats'
import { inboxManager } from './opencode/inbox'
import { githubManager } from './github'
import { workManager } from './pipeline/works'
import { reviewManager } from './review'
import { scriptManager } from './scripts'
import { jiraAuth } from './jira/auth'
import { jiraMcp } from './jira/mcp'
import { jiraBridge } from './jira/bridge'
import { commentWatcher } from './jira/watch'
import { sessionIndex } from './opencode/session-index'
import { agentSessions } from './opencode/agent-sessions'
import { agentActivityMeter } from './opencode/agent-activity'
import { coordinator } from './opencode/coordinator'
import { throughputMeter } from './opencode/throughput'
import { wireSessionMetrics } from './opencode/session-metrics'
import { handleTranscriptImages, registerImageScheme } from './opencode/transcript-images'

registerImageScheme()

/** The local service origin, for the embedded OpenCode UI's navigation guard. */
function sameOriginAsService(url: string): boolean {
  const service = openCodeService.getStatus().url
  if (!service) return false
  try {
    return new URL(url).origin === new URL(service).origin
  } catch {
    return false
  }
}

function createWindow(): void {
  const win = new BrowserWindow({
    width: 1280,
    height: 820,
    minWidth: 960,
    minHeight: 600,
    titleBarStyle: 'hiddenInset',
    show: false,
    autoHideMenuBar: true,
    webPreferences: {
      preload: join(__dirname, '../preload/index.cjs'),
      contextIsolation: true,
      nodeIntegration: false,
      sandbox: false,
      // The chat header can swap Revva's transcript for OpenCode's own web
      // interface; that view is a <webview> on an isolated, in-memory session.
      webviewTag: true
    }
  })

  win.on('ready-to-show', () => win.show())
  win.webContents.setWindowOpenHandler(({ url }) => {
    void shell.openExternal(url)
    return { action: 'deny' }
  })

  // The chat header can embed OpenCode's own web interface. The guest page runs
  // in its own process with no Node access, and it may only ever talk to the
  // paired local service: a doc link or a search result opens in the user's
  // browser instead of navigating inside Revva.
  win.webContents.on('will-attach-webview', (event, webPreferences, params) => {
    delete webPreferences.preload
    webPreferences.nodeIntegration = false
    webPreferences.contextIsolation = true
    if (!params.src || !sameOriginAsService(params.src)) event.preventDefault()
  })
  win.webContents.on('did-attach-webview', (_event, guest) => {
    guest.setWindowOpenHandler(({ url }) => {
      void shell.openExternal(url)
      return { action: 'deny' }
    })
    guest.on('will-navigate', (event, url) => {
      if (!sameOriginAsService(url)) {
        event.preventDefault()
        void shell.openExternal(url)
      }
    })
  })

  const devUrl = process.env['ELECTRON_RENDERER_URL']
  if (devUrl) {
    void win.loadURL(devUrl)
  } else {
    void win.loadFile(join(__dirname, '../renderer/index.html'))
  }
}

app.whenReady().then(() => {
  app.setAboutPanelOptions({ applicationName: 'Revva' })
  // Windows routes OS notifications by AppUserModelID; without this they are
  // silently dropped in dev, and a dev machine disagrees with the installer
  // (electron-builder stamps the shortcut's AUMID with the same appId).
  if (process.platform === 'win32') app.setAppUserModelId('dev.revva.app')
  // Electron's development executable otherwise shows its default Dock icon.
  if (process.platform === 'darwin' && !app.isPackaged) {
    app.dock?.setIcon(join(app.getAppPath(), 'build/icon.png'))
  }
  registerIpc()
  handleTranscriptImages()
  keepAwake.restore()
  createWindow()

  eventBus.start()
  agentSessions.wire()
  agentActivityMeter.wire()
  coordinator.wire()
  jiraBridge.wire()
  chatManager.wire()
  throughputMeter.wire()
  wireSessionMetrics()
  workManager.wire()
  inboxManager.wire()
  reviewManager.wire()
  scriptManager.wire()
  commentWatcher.wire()
  sessionIndex.rebuild()
  githubManager.startPolling()
  void jiraAuth.load().then(() => {
    if (jiraAuth.status().connected) void jiraMcp.connect().catch(() => undefined)
  })
  void openCodeService.ensure().then((status) => {
    if (status.state === 'connected') void chatManager.reconcile()
  })

  app.on('activate', () => {
    if (BrowserWindow.getAllWindows().length === 0) createWindow()
  })
})

app.on('window-all-closed', () => {
  if (process.platform !== 'darwin') app.quit()
})

let quitting = false
app.on('before-quit', (event) => {
  if (quitting) return
  quitting = true
  event.preventDefault()
  eventBus.stop()
  openCodeService.dispose()
  // Running scripts (e.g. a user's proxy) are intentionally left alive.
  // By design nothing ever calls mcp.remove, so the harness keeps the user's own config;
  // the bridge's mounts die with the collaboration transport inside coordinator.dispose().
  void jiraBridge.dispose().finally(() => coordinator.dispose()).finally(() => app.quit())
})
