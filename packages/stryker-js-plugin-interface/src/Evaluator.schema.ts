import * as S from 'effect/Schema'

export class EvaluatorFailed
  extends S.TaggedError<EvaluatorFailed, { readonly brand: unique symbol }>()('EvaluatorFailed', {
    cause: S.Unknown,
  })
{
  override get message(): string {
    return 'Evaluator failed'
  }
}
