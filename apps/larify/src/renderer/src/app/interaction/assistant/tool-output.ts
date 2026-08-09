import { createContext, useContext } from 'react'

type ToolOutput = (tool: string, toolCallId: string, output: unknown) => void

export const ToolOutputContext = createContext<ToolOutput | undefined>(undefined)

export function useToolOutput(): ToolOutput | undefined {
  return useContext(ToolOutputContext)
}
