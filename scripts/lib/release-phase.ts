export type ReleasePhase = 'publish' | 'version' | 'none'

export const decidePhase = (owed: number, pending: number): ReleasePhase =>
  pending > 0 ? 'version' : owed > 0 ? 'publish' : 'none'
