import { useState } from 'react'
import { Check } from 'lucide-react'
import { Button } from '@renderer/components/ui/button'
import { Textarea } from '@renderer/components/ui/textarea'
import { cn } from '@renderer/lib/utils'

interface AskUserInput {
  message: string
  options?: Array<{ label: string; description?: string }>
  multiple?: boolean
}

function isOther(label: string): boolean {
  return ['其他', '其它', 'other'].includes(label.trim().toLowerCase())
}

function isStringArray(value: unknown): value is string[] {
  return Array.isArray(value) && value.every((item) => typeof item === 'string')
}

function isAskUserInput(value: unknown): value is AskUserInput {
  if (!value || typeof value !== 'object') return false
  const input = value as Partial<AskUserInput>
  return (
    typeof input.message === 'string' &&
    (input.multiple === undefined || typeof input.multiple === 'boolean') &&
    (input.options === undefined ||
      (Array.isArray(input.options) &&
        input.options.every(
          (option) =>
            Boolean(option) &&
            typeof option === 'object' &&
            typeof option.label === 'string' &&
            (option.description === undefined || typeof option.description === 'string')
        )))
  )
}

export function AskUserPart({
  input,
  output,
  onSubmit
}: {
  input: unknown
  output?: unknown
  onSubmit: (answers: string[]) => void
}): React.JSX.Element | null {
  const [selected, setSelected] = useState<string[]>([])
  const [note, setNote] = useState('')

  if (!isAskUserInput(input)) return null

  const answers =
    output && typeof output === 'object' ? (output as { answers?: unknown }).answers : undefined

  if (isStringArray(answers)) {
    return (
      <div className="space-y-3">
        <p className="text-sm leading-5">{input.message}</p>
        <div className="flex flex-wrap gap-2">
          {answers.map((answer, index) => (
            <span key={index} className="rounded-md bg-primary/10 px-2.5 py-1.5 text-sm">
              {answer}
            </span>
          ))}
        </div>
      </div>
    )
  }

  const toggle = (label: string): void => {
    setSelected((current) =>
      input.multiple
        ? current.includes(label)
          ? current.filter((value) => value !== label)
          : [...current, label]
        : [label]
    )
  }
  const response = [...selected, ...(note.trim() ? [note.trim()] : [])]
  const options = input.options?.filter(({ label }) => !isOther(label))

  return (
    <div className="space-y-3">
      <p className="text-sm leading-5">{input.message}</p>
      {options?.length ? (
        <div className="grid gap-1.5">
          {options.map(({ label, description }) => {
            const active = selected.includes(label)
            return (
              <button
                key={label}
                type="button"
                aria-pressed={active}
                onClick={() => toggle(label)}
                className={cn(
                  'flex w-full items-start gap-2.5 rounded-md border px-3 py-2 text-left transition-colors',
                  active
                    ? 'border-primary bg-primary/10'
                    : 'border-border bg-background hover:bg-accent/50'
                )}
              >
                <span
                  className={cn(
                    'mt-0.5 flex size-4 shrink-0 items-center justify-center border',
                    input.multiple ? 'rounded-sm' : 'rounded-full',
                    active && 'border-primary bg-primary text-primary-foreground'
                  )}
                >
                  {active && <Check className="size-3" />}
                </span>
                <span className="min-w-0">
                  <span className="block text-sm font-medium">{label}</span>
                  {description && (
                    <span className="mt-0.5 block text-xs text-muted-foreground">
                      {description}
                    </span>
                  )}
                </span>
              </button>
            )
          })}
        </div>
      ) : null}
      <Textarea
        value={note}
        onChange={(event) => setNote(event.currentTarget.value)}
        placeholder={options?.length ? '其他或补充说明（可选）' : '请输入回答'}
        className="min-h-16 resize-none text-sm focus-visible:border-input focus-visible:ring-0"
      />
      <div className="flex justify-end">
        <Button
          type="button"
          size="sm"
          className="cursor-pointer disabled:pointer-events-auto disabled:cursor-not-allowed disabled:opacity-50"
          disabled={!response.length}
          onClick={() => onSubmit(response)}
        >
          提交回答
        </Button>
      </div>
    </div>
  )
}
