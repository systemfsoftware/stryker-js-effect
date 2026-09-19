export type ReleasePhase = 'publish' | 'version' | 'none'

export const decidePhase = (owed: number, pending: number): ReleasePhase =>
  owed > 0 ? 'publish' : pending > 0 ? 'version' : 'none'

export const shouldOpenVersionPrAfterPublish = (phase: ReleasePhase, pending: number): boolean =>
  phase === 'publish' && pending > 0
