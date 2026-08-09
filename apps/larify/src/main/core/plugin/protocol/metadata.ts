import type { JSONObject } from '@ai-sdk/provider'

export interface Metadata extends JSONObject {
  icon?: string
  eager?: boolean
}
