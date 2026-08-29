import { Registry } from '@shared/infra/registry'
import { ThemeProvider } from './theme/theme'
import { Layout } from './layout/layout'
import { TooltipProvider } from '../components/ui/tooltip'
import { registerBuiltinRenderers } from './registry/register-builtins'
import { RendererRegistryProvider } from './registry/renderer-registry-provider'
import { AuthGate } from './auth/auth-gate'

const registry = new Registry()
registerBuiltinRenderers(registry)

export function App(): React.JSX.Element {
  return (
    <RendererRegistryProvider registry={registry}>
      <ThemeProvider>
        <TooltipProvider>
          <AuthGate>
            <Layout />
          </AuthGate>
        </TooltipProvider>
      </ThemeProvider>
    </RendererRegistryProvider>
  )
}
