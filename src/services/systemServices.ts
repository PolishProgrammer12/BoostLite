import type { Metric, OptimizationAction, StartupApp, SystemInfo } from '../types'

type LiveProcess = { id: string; name: string; cpu: number; ram: string; publisher: string }

function desktop() {
  if (!window.boostLiteDesktop) throw new Error('Live Windows readings are available in the BoostLite desktop app.')
  return window.boostLiteDesktop
}

export const performanceService = {
  getCurrentMetrics(): Promise<Metric> { return desktop().getMetrics() },
  runScan(): Promise<Metric> { return desktop().getMetrics() },
  getActivity(): Promise<{disk:number|null;gpu:number|null;sampledAt:string}> { return desktop().getActivity() },
}

export const systemService = {
  getInfo(): Promise<SystemInfo> { return desktop().getSystemInfo() },
}

export const startupService = {
  getApps(): Promise<StartupApp[]> { return desktop().getStartupApps() },
}

export const processService = {
  getProcesses(): Promise<LiveProcess[]> { return desktop().getProcesses() },
}

let actions: OptimizationAction[] = []
export const optimizationService = {
  async undo(_id: string) { return false },
  async getHistory() { return [...actions] },
  async record(action: OptimizationAction) { actions = [action, ...actions] },
}

