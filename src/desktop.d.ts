import type { Metric, StartupApp, SystemInfo } from './types'

declare global {
  interface Window {
    boostLiteDesktop?: {
      isDesktop: boolean
      appVersion: string
      platform: string
      getMetrics: () => Promise<Metric>
      getActivity: () => Promise<{disk:number|null;gpu:number|null;sampledAt:string}>
      getProcesses: () => Promise<Array<{id:string;name:string;cpu:number;ram:string;publisher:string}>>
      getSystemInfo: () => Promise<SystemInfo>
      getStartupApps: () => Promise<StartupApp[]>
    }
  }
}

export {}
