import * as S from 'effect/Schema'

export class ErrorText
  extends S.Class<ErrorText, { readonly brand: unique symbol }>('ErrorText')({ text: S.NonEmptyString })
{}
export type ErrorTextValue = ErrorText

export class CauseText
  extends S.Class<CauseText, { readonly brand: unique symbol }>('CauseText')({ text: S.NonEmptyString })
{}
export type CauseTextValue = CauseText

export interface ErrnoException extends Error {
  code?: string
  errno?: number
  path?: string
  syscall?: string
}
