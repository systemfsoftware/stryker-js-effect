import * as E from 'effect'

export const effectNamespaceUpdate = (ref: E.Ref.Ref<number>) => E.Ref.update(ref, (n) => n + 1)
