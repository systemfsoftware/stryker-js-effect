import * as S from 'effect/Schema'

export class CircularJson extends S.TaggedError<CircularJson>()('CircularJson', {}) {}
