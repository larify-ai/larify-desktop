export interface Resource {
  id: number
  type: string
  sessionId: string
}

export type ResourceQuery = Partial<Pick<Resource, 'sessionId' | 'type'>>
