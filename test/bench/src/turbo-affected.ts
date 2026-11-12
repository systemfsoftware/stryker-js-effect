export interface AffectedRange {
  readonly base: string
  readonly head: string
}

export const turboAffectedArgs = (range: AffectedRange): ReadonlyArray<string> => [
  'query',
  'affected',
  '--packages',
  '--base',
  range.base,
  '--head',
  range.head,
]
