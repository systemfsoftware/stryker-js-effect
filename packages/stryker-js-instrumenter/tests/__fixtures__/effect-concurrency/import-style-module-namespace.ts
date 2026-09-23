import * as Ref from 'effect/Ref'

export const moduleNamespaceUpdate = (ref: Ref.Ref<number>) => Ref.update(ref, (n) => n + 1)
