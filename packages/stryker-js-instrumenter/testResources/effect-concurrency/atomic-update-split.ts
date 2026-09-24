import { Effect, pipe, Ref, SynchronizedRef } from 'effect'
import type { Option } from 'effect'

export const refModifyDataFirst = (ref: Ref.Ref<number>) => Ref.modify(ref, (n) => [n, n + 1])

export const refModifyPipeArg = (ref: Ref.Ref<number>) => pipe(ref, Ref.modify((n: number) => [n, n + 1]))

export const refModifyPipeMethod = (ref: Ref.Ref<number>) => ref.pipe(Ref.modify((n: number) => [n, n + 1]))

export const refModifySomeDataFirst = (
  ref: Ref.Ref<number>,
  pf: (n: number) => readonly [string, Option.Option<number>],
) => Ref.modifySome(ref, pf)

export const refModifySomePipeArg = (
  ref: Ref.Ref<number>,
  pf: (n: number) => readonly [string, Option.Option<number>],
) => pipe(ref, Ref.modifySome(pf))

export const refModifySomePipeMethod = (
  ref: Ref.Ref<number>,
  pf: (n: number) => readonly [string, Option.Option<number>],
) => ref.pipe(Ref.modifySome(pf))

export const refUpdateDataFirst = (ref: Ref.Ref<number>): Effect.Effect<void> => Ref.update(ref, (n) => n + 1)

export const refUpdatePipeArg = (ref: Ref.Ref<number>) => pipe(ref, Ref.update((n: number) => n + 1))

export const refUpdatePipeMethod = (ref: Ref.Ref<number>) => ref.pipe(Ref.update((n: number) => n + 1))

export const refUpdateImmediate = (ref: Ref.Ref<number>) => Ref.update((n: number) => n + 1)(ref)

export const refUpdateSomeDataFirst = (ref: Ref.Ref<number>, pf: (n: number) => Option.Option<number>) =>
  Ref.updateSome(ref, pf)

export const refUpdateSomePipeArg = (ref: Ref.Ref<number>, pf: (n: number) => Option.Option<number>) =>
  pipe(ref, Ref.updateSome(pf))

export const refUpdateSomePipeMethod = (ref: Ref.Ref<number>, pf: (n: number) => Option.Option<number>) =>
  ref.pipe(Ref.updateSome(pf))

export const refUpdateAndGetDataFirst = (ref: Ref.Ref<number>) => Ref.updateAndGet(ref, (n) => n * 2)

export const refUpdateAndGetPipeArg = (ref: Ref.Ref<number>) => pipe(ref, Ref.updateAndGet((n: number) => n * 2))

export const refUpdateAndGetPipeMethod = (ref: Ref.Ref<number>) => ref.pipe(Ref.updateAndGet((n: number) => n * 2))

export const refGetAndUpdateDataFirst = (ref: Ref.Ref<number>) => Ref.getAndUpdate(ref, (n) => n + 10)

export const refGetAndUpdatePipeArg = (ref: Ref.Ref<number>) => pipe(ref, Ref.getAndUpdate((n: number) => n + 10))

export const refGetAndUpdatePipeMethod = (ref: Ref.Ref<number>) => ref.pipe(Ref.getAndUpdate((n: number) => n + 10))

export const syncModifyDataFirst = (ref: SynchronizedRef.SynchronizedRef<number>) =>
  SynchronizedRef.modify(ref, (n) => [n, n + 1])

export const syncModifyPipeArg = (ref: SynchronizedRef.SynchronizedRef<number>) =>
  pipe(ref, SynchronizedRef.modify((n: number) => [n, n + 1]))

export const syncModifyPipeMethod = (ref: SynchronizedRef.SynchronizedRef<number>) =>
  ref.pipe(SynchronizedRef.modify((n: number) => [n, n + 1]))

export const syncModifySomeDataFirst = (
  ref: SynchronizedRef.SynchronizedRef<number>,
  pf: (n: number) => readonly [string, Option.Option<number>],
) => SynchronizedRef.modifySome(ref, pf)

export const syncModifySomePipeArg = (
  ref: SynchronizedRef.SynchronizedRef<number>,
  pf: (n: number) => readonly [string, Option.Option<number>],
) => pipe(ref, SynchronizedRef.modifySome(pf))

export const syncModifySomePipeMethod = (
  ref: SynchronizedRef.SynchronizedRef<number>,
  pf: (n: number) => readonly [string, Option.Option<number>],
) => ref.pipe(SynchronizedRef.modifySome(pf))

export const syncUpdateDataFirst = (ref: SynchronizedRef.SynchronizedRef<number>) =>
  SynchronizedRef.update(ref, (n) => n + 1)

export const syncUpdatePipeArg = (ref: SynchronizedRef.SynchronizedRef<number>) =>
  pipe(ref, SynchronizedRef.update((n: number) => n + 1))

export const syncUpdatePipeMethod = (ref: SynchronizedRef.SynchronizedRef<number>) =>
  ref.pipe(SynchronizedRef.update((n: number) => n + 1))

export const syncUpdateSomeDataFirst = (
  ref: SynchronizedRef.SynchronizedRef<number>,
  pf: (n: number) => Option.Option<number>,
) => SynchronizedRef.updateSome(ref, pf)

export const syncUpdateSomePipeArg = (
  ref: SynchronizedRef.SynchronizedRef<number>,
  pf: (n: number) => Option.Option<number>,
) => pipe(ref, SynchronizedRef.updateSome(pf))

export const syncUpdateSomePipeMethod = (
  ref: SynchronizedRef.SynchronizedRef<number>,
  pf: (n: number) => Option.Option<number>,
) => ref.pipe(SynchronizedRef.updateSome(pf))

export const syncUpdateAndGetDataFirst = (ref: SynchronizedRef.SynchronizedRef<number>) =>
  SynchronizedRef.updateAndGet(ref, (n) => n * 2)

export const syncUpdateAndGetPipeArg = (ref: SynchronizedRef.SynchronizedRef<number>) =>
  pipe(ref, SynchronizedRef.updateAndGet((n: number) => n * 2))

export const syncUpdateAndGetPipeMethod = (ref: SynchronizedRef.SynchronizedRef<number>) =>
  ref.pipe(SynchronizedRef.updateAndGet((n: number) => n * 2))

export const syncGetAndUpdateDataFirst = (ref: SynchronizedRef.SynchronizedRef<number>) =>
  SynchronizedRef.getAndUpdate(ref, (n) => n + 10)

export const syncGetAndUpdatePipeArg = (ref: SynchronizedRef.SynchronizedRef<number>) =>
  pipe(ref, SynchronizedRef.getAndUpdate((n: number) => n + 10))

export const syncGetAndUpdatePipeMethod = (ref: SynchronizedRef.SynchronizedRef<number>) =>
  ref.pipe(SynchronizedRef.getAndUpdate((n: number) => n + 10))
