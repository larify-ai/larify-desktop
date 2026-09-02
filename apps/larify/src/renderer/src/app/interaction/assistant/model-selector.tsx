import { CheckIcon, ChevronDownIcon } from 'lucide-react'
import {
  modelIds,
  modelLabels,
  reasoningEfforts,
  type ReasoningEffort
} from '../../../../../main/core/model/config'
import { useModelConfig } from './model-config'
import { Button } from '@renderer/components/ui/button'
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuSeparator,
  DropdownMenuTrigger
} from '@renderer/components/ui/dropdown-menu'

const effortLabels: Record<ReasoningEffort, string> = {
  off: '低',
  high: '中',
  max: '高'
}

export function ModelSelector({ disabled = false }: { disabled?: boolean }): React.JSX.Element {
  const { value, onChange } = useModelConfig()
  return (
    <DropdownMenu>
      <DropdownMenuTrigger asChild>
        <Button
          aria-label="配置模型和思考强度"
          className="min-w-0 max-w-64 gap-1 px-2 text-muted-foreground focus-visible:border-transparent focus-visible:ring-0"
          disabled={disabled}
          size="sm"
          variant="ghost"
        >
          <span className="truncate">{modelLabels[value.modelId]}</span>
          <span className="shrink-0 text-muted-foreground/70">
            {effortLabels[value.reasoningEffort]}
          </span>
          <ChevronDownIcon className="size-3.5 shrink-0" />
        </Button>
      </DropdownMenuTrigger>
      <DropdownMenuContent align="end" className="w-56" side="top">
        <div className="flex min-h-8 items-center justify-between gap-3 px-2 py-1">
          <span className="text-xs font-medium text-muted-foreground">思考强度</span>
          <div className="flex rounded-full bg-muted p-0.5 text-xs">
            {reasoningEfforts.map((reasoningEffort) => (
              <button
                aria-pressed={value.reasoningEffort === reasoningEffort}
                className={`rounded-full px-2 py-0.5 transition-colors ${
                  value.reasoningEffort === reasoningEffort
                    ? 'bg-background text-foreground shadow-sm'
                    : 'text-muted-foreground hover:text-foreground'
                }`}
                disabled={disabled}
                key={reasoningEffort}
                onClick={() => onChange({ ...value, reasoningEffort })}
                type="button"
              >
                {effortLabels[reasoningEffort]}
              </button>
            ))}
          </div>
        </div>
        <DropdownMenuSeparator />
        {modelIds.map((modelId) => (
          <DropdownMenuItem
            disabled={disabled}
            key={modelId}
            onSelect={() => onChange({ ...value, modelId })}
          >
            <span className="flex-1">{modelLabels[modelId]}</span>
            {value.modelId === modelId && <CheckIcon className="size-4" />}
          </DropdownMenuItem>
        ))}
      </DropdownMenuContent>
    </DropdownMenu>
  )
}
