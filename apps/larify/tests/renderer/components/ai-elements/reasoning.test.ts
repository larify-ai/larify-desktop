import { createElement } from 'react'
import { renderToStaticMarkup } from 'react-dom/server'
import { describe, expect, it } from 'vitest'

import {
  Reasoning,
  ReasoningBody,
  ReasoningContent
} from '../../../../src/renderer/src/components/ai-elements/reasoning'

describe('ReasoningBody', () => {
  it('provides the shared reasoning panel style and forwards element properties', () => {
    const markup = renderToStaticMarkup(
      createElement(
        ReasoningBody,
        {
          className: 'custom-class',
          'data-reasoning-content': true
        },
        'thinking'
      )
    )

    expect(markup).toContain('rounded-md')
    expect(markup).toContain('border-border/70')
    expect(markup).toContain('bg-muted/20')
    expect(markup).toContain('custom-class')
    expect(markup).toContain('data-reasoning-content="true"')
    expect(markup).toContain('thinking')
  })

  it('wraps standard reasoning content with the shared panel', () => {
    const markup = renderToStaticMarkup(
      createElement(
        Reasoning,
        { defaultOpen: true },
        createElement(ReasoningContent, null, 'reasoning text')
      )
    )

    expect(markup).toContain('rounded-md')
    expect(markup).toContain('border-border/70')
    expect(markup).toContain('reasoning text')
  })
})
