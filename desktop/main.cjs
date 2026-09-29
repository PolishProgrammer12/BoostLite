const { app, BrowserWindow, Menu, shell, ipcMain } = require('electron')
const si = require('systeminformation')
const path = require('node:path')
const os = require('node:os')
const fs = require('node:fs')
const { execFile } = require('node:child_process')
const { promisify } = require('node:util')
const execFileAsync = promisify(execFile)

app.disableHardwareAcceleration()
app.commandLine.appendSwitch('disable-gpu')
app.commandLine.appendSwitch('disable-gpu-compositing')
app.commandLine.appendSwitch('in-process-gpu')
app.commandLine.appendSwitch('use-gl', 'swiftshader')
app.commandLine.appendSwitch('use-angle', 'swiftshader')
app.setPath('userData', path.join(os.tmpdir(), 'BoostLite'))

const isDev = !app.isPackaged
let mainWindow
let previousProcesses = new Map()
let previousProcessSampleAt = Date.now()
let activitySampledAt = ''
const systemDrive = path.parse(os.homedir()).root || 'C:\\'

async function readWindowsCounters() {
  const script = String.raw`$disk=$null; $gpu=$null; try { $s=(Get-Counter -Counter '\PhysicalDisk(_Total)\% Disk Time' -ErrorAction Stop).CounterSamples; if($s.Count){$disk=[math]::Min(100,[math]::Max(0,[math]::Round(($s|Measure-Object -Property CookedValue -Maximum).Maximum)))}} catch {}; try { $s=(Get-Counter -Counter '\GPU Engine(*)\Utilization Percentage' -ErrorAction Stop).CounterSamples; if($s.Count){$g=$s|Group-Object { $_.InstanceName -replace '^pid_\d+_','' }|ForEach-Object { ($_.Group|Measure-Object -Property CookedValue -Sum).Sum }; $gpu=[math]::Min(100,[math]::Max(0,[math]::Round(($g|Measure-Object -Maximum).Maximum)))}} catch {}; [pscustomobject]@{disk=$disk;gpu=$gpu}|ConvertTo-Json -Compress`
  try {
    const { stdout } = await execFileAsync('powershell.exe', ['-NoProfile', '-NonInteractive', '-Command', script], { windowsHide: true, timeout: 8000, maxBuffer: 1024 * 1024 })
    const result = JSON.parse(stdout.trim())
    return { disk: result.disk !== null && Number.isFinite(Number(result.disk)) ? Number(result.disk) : null, gpu: result.gpu !== null && Number.isFinite(Number(result.gpu)) ? Number(result.gpu) : null }
  } catch { return { disk: null, gpu: null } }
}

ipcMain.handle('system:metrics', async () => {
  const [load, memory] = await Promise.all([si.currentLoad(), si.mem()])
  let diskCapacityPercent = null
  let diskFreeGb = null
  let diskTotalGb = null
  try {
    const stat = fs.statfsSync(systemDrive)
    const total = stat.blocks * stat.bsize
    const free = stat.bavail * stat.bsize
    if (total > 0) {
      diskTotalGb = +(total / 1024 ** 3).toFixed(1)
      diskFreeGb = +(free / 1024 ** 3).toFixed(1)
      diskCapacityPercent = Math.round(((total - free) / total) * 100)
    }
  } catch {}
  return {
    cpu: Math.round(load.currentLoad),
    ram: Math.round(((memory.total - memory.available) / memory.total) * 100),
    disk: null,
    gpu: null,
    diskCapacityPercent,
    diskFreeGb,
    diskTotalGb,
    activitySampledAt,
    totalMemoryGb: +(memory.total / 1024 ** 3).toFixed(1),
    availableMemoryGb: +(memory.available / 1024 ** 3).toFixed(1),
    cpuModel: os.cpus()[0]?.model || 'Processor',
    sampledAt: new Date().toISOString(),
  }
})

ipcMain.handle('system:activity', async () => {
  const counters = await readWindowsCounters()
  activitySampledAt = new Date().toISOString()
  return { ...counters, sampledAt: activitySampledAt }
})

ipcMain.handle('system:info', async () => {
  const [osInfo, graphics, battery] = await Promise.all([
    si.osInfo().catch(() => ({})),
    si.graphics().catch(() => ({ controllers: [] })),
    si.battery().catch(() => ({ hasBattery: false })),
  ])
  const cpuModel = os.cpus()[0]?.model || 'Unavailable'
  const gpu = graphics.controllers?.find(controller => controller.model)?.model || null
  return {
    hostname: os.hostname(),
    osName: osInfo.distro || osInfo.platform || process.platform,
    osVersion: osInfo.release || os.release(),
    architecture: os.arch(),
    cpuModel,
    cpuCores: os.cpus().length,
    gpuModel: gpu,
    gpuName: gpu,
    battery: {
      available: Boolean(battery.hasBattery),
      percent: battery.hasBattery && Number.isFinite(battery.percent) ? Math.round(battery.percent) : null,
      charging: battery.hasBattery ? Boolean(battery.isCharging) : null,
      timeRemainingMinutes: battery.hasBattery && Number.isFinite(battery.timeRemaining) ? battery.timeRemaining : null,
      healthPercent: battery.hasBattery && battery.designedCapacity > 0 ? Math.round(battery.maxCapacity / battery.designedCapacity * 100) : null,
    },
  }
})

ipcMain.handle('system:startup', async () => {
  const script = String.raw`$items=@(); $keys=@('HKCU:\Software\Microsoft\Windows\CurrentVersion\Run','HKLM:\Software\Microsoft\Windows\CurrentVersion\Run','HKLM:\Software\WOW6432Node\Microsoft\Windows\CurrentVersion\Run'); foreach($key in $keys){if(Test-Path -LiteralPath $key){$props=Get-ItemProperty -LiteralPath $key; foreach($prop in $props.PSObject.Properties){if($prop.Name -notmatch '^PS'){$items+=@{name=$prop.Name;command=[string]$prop.Value;path=$key}}}}}; $folders=@((Join-Path $env:APPDATA 'Microsoft\Windows\Start Menu\Programs\Startup'),(Join-Path $env:ProgramData 'Microsoft\Windows\Start Menu\Programs\Startup')); foreach($folder in $folders){if(Test-Path -LiteralPath $folder){Get-ChildItem -LiteralPath $folder -Force -ErrorAction SilentlyContinue|ForEach-Object {$items+=@{name=$_.BaseName;command=$_.FullName;path=$folder}}}}; ConvertTo-Json -InputObject @($items) -Compress`
  const { stdout } = await execFileAsync('powershell.exe', ['-NoProfile', '-NonInteractive', '-Command', script], { windowsHide: true, timeout: 6000, maxBuffer: 2 * 1024 * 1024 })
  const rows = JSON.parse(stdout.trim() || '[]')
  return (Array.isArray(rows) ? rows : [rows]).map((item, index) => ({
    id: `${item.path}:${item.name}:${index}`,
    name: item.name || 'Unknown startup entry',
    publisher: 'Windows startup entry',
    path: item.path || 'Startup folder',
    impactLevel: 'unknown',
    isEnabled: true,
    isCritical: true,
  }))
})

ipcMain.handle('system:processes', async () => {
  const command = 'Get-Process | Select-Object ProcessName,Id,CPU,WorkingSet64 | ConvertTo-Json -Compress'
  const { stdout } = await execFileAsync('powershell.exe', ['-NoProfile', '-NonInteractive', '-Command', command], { windowsHide: true, maxBuffer: 8 * 1024 * 1024 })
  const result = stdout.trim()
  const rows = result ? JSON.parse(result) : []
  const list = Array.isArray(rows) ? rows : [rows]
  const now = Date.now()
  const elapsedSeconds = Math.max((now - previousProcessSampleAt) / 1000, 0.25)
  const cores = Math.max(os.cpus().length, 1)
  const nextProcesses = new Map()
  const mapped = list.map(process => {
    const id = String(process.Id)
    const cpuSeconds = Number(process.CPU) || 0
    const prior = previousProcesses.get(id)
    const cpu = prior === undefined ? 0 : Math.max(0, cpuSeconds - prior) / elapsedSeconds / cores * 100
    nextProcesses.set(id, cpuSeconds)
    return { id, name: process.ProcessName || 'Process', cpu: +cpu.toFixed(1), ram: `${(Number(process.WorkingSet64 || 0) / 1024 ** 2).toFixed(0)} MB`, publisher: 'Windows' }
  })
  previousProcesses = nextProcesses
  previousProcessSampleAt = now
  return mapped.sort((a, b) => b.cpu - a.cpu).slice(0, 100)
})

function createWindow() {
  mainWindow = new BrowserWindow({
    width: 1440,
    height: 900,
    minWidth: 960,
    minHeight: 640,
    show: true,
    backgroundColor: '#111412',
    title: 'BoostLite',
    autoHideMenuBar: true,
    webPreferences: {
      preload: path.join(__dirname, 'preload.cjs'),
      contextIsolation: true,
      nodeIntegration: false,
      sandbox: true,
    },
  })
  mainWindow.webContents.setWindowOpenHandler(({ url }) => {
    if (url.startsWith('https://')) void shell.openExternal(url)
    return { action: 'deny' }
  })
  mainWindow.webContents.on('will-navigate', event => event.preventDefault())
  if (isDev) void mainWindow.loadURL('http://127.0.0.1:5173')
  else void mainWindow.loadFile(path.join(__dirname, '..', 'dist', 'index.html'))
}

app.whenReady().then(() => {
  Menu.setApplicationMenu(null)
  createWindow()
  app.on('activate', () => {
    if (BrowserWindow.getAllWindows().length === 0) createWindow()
  })
})
app.on('window-all-closed', () => {
  if (process.platform !== 'darwin') app.quit()
})
