import { Ref } from 'effect'
import { update } from 'effect/Ref'

export const bareFunctionUpdate = (ref: Ref.Ref<number>) => update(ref, (n) => n + 1)
