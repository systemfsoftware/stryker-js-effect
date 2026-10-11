import * as S from 'effect/Schema'

export class NotFound extends S.TaggedError<NotFound>()('NotFound', {}) {}
