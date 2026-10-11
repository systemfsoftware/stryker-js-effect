import { Effect } from 'effect'

type Missing = { readonly _tag: 'NotFound' } | { readonly _tag: 'Gone' }

export const pipedFenced = (program: Effect.Effect<number, Missing>): Effect.Effect<number, { readonly _tag: 'Gone' }> =>
  program.pipe(Effect.catchTag('NotFound', () => Effect.succeed(0)))

export const pipedOpen = (program: Effect.Effect<number, Missing>) =>
  program.pipe(Effect.catchTag('NotFound', () => Effect.succeed(0)))

export const dataFirstFenced = (program: Effect.Effect<number, Missing>): Effect.Effect<number, { readonly _tag: 'Gone' }> =>
  Effect.catchTag(program, 'NotFound', () => Effect.succeed(0))

export const dataFirstOpen = (program: Effect.Effect<number, Missing>) =>
  Effect.catchTag(program, 'NotFound', () => Effect.succeed(0))

export const recordFenced = (program: Effect.Effect<number, Missing>): Effect.Effect<number> =>
  Effect.catchTags(program, { NotFound: () => Effect.succeed(0), Gone: () => Effect.succeed(1) })

export const recordOpen = (program: Effect.Effect<number, Missing>) =>
  Effect.catchTags(program, { NotFound: () => Effect.succeed(0), Gone: () => Effect.succeed(1) })
