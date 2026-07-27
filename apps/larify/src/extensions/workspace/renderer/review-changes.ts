export interface ReviewChange {
  additions: number
  deletions: number
  patch: string
  path: string
}

export interface ReviewRoundRequest {
  files: ReviewChange[]
  selectedPath: string
}

export const REVIEW_ROUND_EVENT = 'larify:review-round'

let currentRound: ReviewRoundRequest | null = null

export function resolveReviewPath(root: string, file: string): string {
  if (/^(?:[A-Za-z]:[\\/]|\/)/.test(file)) return file
  const separator = root.includes('\\') ? '\\' : '/'
  return `${root.replace(/[\\/]+$/, '')}${separator}${file.replace(/^[\\/]+/, '')}`
}

export function takeReviewRound(): ReviewRoundRequest | null {
  const request = currentRound
  currentRound = null
  return request
}

export function setReviewRound(request: ReviewRoundRequest): void {
  currentRound = request
  window.dispatchEvent(
    new CustomEvent<ReviewRoundRequest>(REVIEW_ROUND_EVENT, {
      detail: request
    })
  )
}
