import { Schema as S } from 'effect'

export class TraversalStopped extends S.TaggedError<TraversalStopped>()('TraversalStopped', {}) {}
