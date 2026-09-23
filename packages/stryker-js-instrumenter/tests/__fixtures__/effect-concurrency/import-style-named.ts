import { Ref } from 'effect'

export const namedImportUpdate = (ref: Ref.Ref<number>) => Ref.update(ref, (n) => n + 1)
