export interface ModelApiCredentials {
  baseUrl: string
  apiKey: string
}

export interface SubscriptionBalance {
  id: number
  planId: number
  planTitle: string
  total: number
  used: number
  startTime: number
  endTime: number
  status: string
  allowWalletOverflow: boolean
}

export interface ModelApiBalance {
  wallet: {
    quota: number
    usedQuota: number
  }
  subscriptions: SubscriptionBalance[]
}
