import { Liquid } from "liquidjs"

const liquid = new Liquid()

export function renderPrompt(
  template: string,
  variables: Record<string, unknown>,
): string {
  return liquid.parseAndRenderSync(template, variables)
}
