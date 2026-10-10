import * as S from 'effect/Schema'

export const Corruption = S.Literals(['none', 'lowercaseMutator', 'reasonWithoutStatus', 'zeroLine'])
export type Corruption = typeof Corruption.Type
