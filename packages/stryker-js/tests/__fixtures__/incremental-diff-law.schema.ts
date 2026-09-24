import * as S from 'effect/Schema'

export const RememberedStatusSchema = S.Literals(['Killed', 'Survived', 'Timeout', 'NoCoverage', 'Ignored'])

export const EphemeralStatusSchema = S.Literals(['CompileError', 'RuntimeError', 'Pending'])
