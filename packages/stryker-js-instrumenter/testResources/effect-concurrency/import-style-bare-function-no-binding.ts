import { type Ref, update } from 'effect/Ref'

export const bareFunctionUpdateWithoutRefBinding = (ref: Ref<number>) => update(ref, (n) => n + 1)
