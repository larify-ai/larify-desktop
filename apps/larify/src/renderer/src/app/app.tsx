import { ThemeProvider } from './theme/theme'
import { Layout } from './layout/layout'
import { TooltipProvider } from '../components/ui/tooltip'

export function App(): React.JSX.Element {
  return (
    <ThemeProvider>
      <TooltipProvider>
        <Layout />
      </TooltipProvider>
    </ThemeProvider>
  )
}
