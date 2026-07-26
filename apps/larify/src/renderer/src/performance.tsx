import './assets/main.css'
import { createRoot } from 'react-dom/client'
import { PerformanceMonitor } from '../../extensions/performance/renderer/performance-monitor'

const colorScheme = window.matchMedia('(prefers-color-scheme: dark)')
const syncTheme = (): void => {
  document.documentElement.classList.toggle('dark', colorScheme.matches)
}
syncTheme()
colorScheme.addEventListener('change', syncTheme)

createRoot(document.getElementById('root')!).render(<PerformanceMonitor />)
