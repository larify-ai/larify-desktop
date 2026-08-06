import { ThemeProvider } from './theme/theme'
import { Layout } from './layout/layout'

export function App(): React.JSX.Element {
  return (
    <ThemeProvider>
      <Layout />
    </ThemeProvider>
  )
}
