export interface ProcessPerformance {
  cpu: number
  memory: number
  processes: number
}

export interface RendererPerformance {
  domNodes: number
  eventLoopLag: number
  fps: number
  heap: number
  longestTask: number
  timestamp: number
}

export interface PerformanceSnapshot extends ProcessPerformance, RendererPerformance {}

export interface PerformanceMeasureRecord {
  duration: number
  name: string
  timestamp: number
}

export interface PerformanceHistory {
  measures: PerformanceMeasureRecord[]
  samples: PerformanceSnapshot[]
}
