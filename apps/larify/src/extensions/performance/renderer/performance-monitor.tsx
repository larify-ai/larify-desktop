import { useEffect, useMemo, useState } from 'react'
import type {
  PerformanceHistory,
  PerformanceMeasureRecord,
  PerformanceSnapshot
} from '../shared/types'

type Range = '5m' | '15m' | '1h' | 'session'

const ranges: { id: Range; label: string; duration: number }[] = [
  { id: '5m', label: '5 分钟', duration: 5 * 60_000 },
  { id: '15m', label: '15 分钟', duration: 15 * 60_000 },
  { id: '1h', label: '1 小时', duration: 60 * 60_000 },
  { id: 'session', label: '当前会话', duration: Infinity }
]

const bytes = (value: number): string => (value ? `${(value / 1024 / 1024).toFixed(1)} MB` : '—')

function Sparkline({ values }: { values: number[] }): React.JSX.Element {
  const max = Math.max(...values, 1)
  const points = values
    .map((value, index) => {
      const x = values.length === 1 ? 100 : (index / (values.length - 1)) * 100
      return `${x},${30 - (value / max) * 28}`
    })
    .join(' ')
  return (
    <svg aria-hidden="true" className="h-10 w-full overflow-visible" viewBox="0 0 100 30">
      <polyline
        fill="none"
        points={points}
        stroke="currentColor"
        strokeWidth="1.5"
        vectorEffect="non-scaling-stroke"
      />
    </svg>
  )
}

export function PerformanceMonitor(): React.JSX.Element {
  const [history, setHistory] = useState<PerformanceSnapshot[]>([])
  const [measures, setMeasures] = useState<PerformanceMeasureRecord[]>([])
  const [range, setRange] = useState<Range>('15m')
  useEffect(() => {
    let mounted = true
    const refresh = (): void => {
      const duration = ranges.find((item) => item.id === range)!.duration
      const since = Number.isFinite(duration) ? Date.now() - duration : 0
      void window.bridge
        .invoke('performance:history', since)
        .then((value) => {
          if (!mounted) return
          const result = value as PerformanceHistory
          setHistory(result.samples)
          setMeasures(result.measures)
        })
        .catch(() => {})
    }
    refresh()
    const timer = window.setInterval(refresh, 2000)
    return () => {
      mounted = false
      clearInterval(timer)
    }
  }, [range])
  const samples = useMemo(() => {
    const duration = ranges.find((item) => item.id === range)!.duration
    const start = (history.at(-1)?.timestamp ?? 0) - duration
    return history.filter((sample) => sample.timestamp >= start)
  }, [history, range])
  const snapshot = samples.at(-1)

  const metrics = [
    ['FPS', snapshot?.fps.toFixed(1) ?? '—'],
    ['Long Task', snapshot ? `${snapshot.longestTask.toFixed(1)} ms` : '—'],
    ['事件循环延迟', snapshot ? `${snapshot.eventLoopLag.toFixed(1)} ms` : '—'],
    ['进程 CPU', snapshot ? `${snapshot.cpu.toFixed(1)}%` : '—'],
    ['应用内存', bytes(snapshot?.memory ?? 0)],
    ['Renderer Heap', bytes(snapshot?.heap ?? 0)],
    ['DOM 节点', snapshot?.domNodes.toLocaleString() ?? '—'],
    ['Electron 进程', snapshot?.processes.toString() ?? '—']
  ]
  const charts: [string, (sample: PerformanceSnapshot) => number, string][] = [
    ['CPU', (sample) => sample.cpu, '%'],
    ['内存', (sample) => sample.memory / 1024 / 1024, ' MB'],
    ['FPS', (sample) => sample.fps, ''],
    ['事件循环延迟', (sample) => sample.eventLoopLag, ' ms']
  ]

  return (
    <div className="flex h-full min-h-0 flex-col bg-background text-foreground">
      <header className="flex h-12 shrink-0 items-center justify-between border-b border-border-strong px-4">
        <span className="text-sm font-medium">性能监控</span>
        <div className="flex rounded-md bg-muted p-0.5 text-xs">
          {ranges.map((item) => (
            <button
              key={item.id}
              className={`rounded px-2 py-1 ${range === item.id ? 'bg-background text-foreground shadow-sm' : 'text-muted-foreground'}`}
              onClick={() => setRange(item.id)}
              type="button"
            >
              {item.label}
            </button>
          ))}
        </div>
      </header>
      <div className="min-h-0 flex-1 overflow-y-auto p-4">
        <div className="grid grid-cols-2 gap-2">
          {metrics.map(([label, value]) => (
            <div key={label} className="rounded-lg border border-border bg-card p-3">
              <div className="text-xs text-muted-foreground">{label}</div>
              <div className="mt-1 font-mono text-lg tabular-nums">{value}</div>
            </div>
          ))}
        </div>
        <section className="mt-4 grid grid-cols-2 gap-2">
          {charts.map(([label, read, suffix]) => {
            const values = samples.map(read)
            const average = values.length
              ? values.reduce((sum, value) => sum + value, 0) / values.length
              : 0
            const maximum = Math.max(...values, 0)
            const peak = samples[values.indexOf(maximum)]
            return (
              <div key={label} className="rounded-lg border border-border bg-card p-3">
                <div className="flex items-start justify-between gap-2 text-xs">
                  <span>{label}</span>
                  <span className="text-right font-mono text-muted-foreground">
                    平均 {average.toFixed(1)}
                    {suffix} · 峰值 {maximum.toFixed(1)}
                    {suffix}
                    {peak && (
                      <span className="block">{new Date(peak.timestamp).toLocaleTimeString()}</span>
                    )}
                  </span>
                </div>
                <div className="mt-2 text-primary">
                  <Sparkline values={values} />
                </div>
              </div>
            )
          })}
        </section>
        <section className="mt-4">
          <h2 className="mb-2 text-xs font-medium text-muted-foreground">最近操作</h2>
          <div className="divide-y divide-border rounded-lg border border-border">
            {measures.length ? (
              measures
                .slice(-20)
                .reverse()
                .map((measure, index) => (
                  <div
                    key={`${measure.name}-${measure.timestamp}-${index}`}
                    className="flex items-center justify-between gap-3 px-3 py-2 text-xs"
                  >
                    <span>{measure.name}</span>
                    <span className="font-mono text-muted-foreground">
                      {measure.duration.toFixed(1)} ms ·{' '}
                      {new Date(measure.timestamp).toLocaleTimeString()}
                    </span>
                  </div>
                ))
            ) : (
              <div className="px-3 py-6 text-center text-xs text-muted-foreground">
                暂无操作记录
              </div>
            )}
          </div>
        </section>
      </div>
    </div>
  )
}
