import { Ref as R } from 'effect'

export const aliasedImportUpdate = (ref: R.Ref<number>) => R.update(ref, (n) => n + 1)
