import * as Exit from 'effect/Exit'
import { dual } from 'effect/Function'

export const RUN_EVENTS_QUEUE_BOUND = 256

export const shouldKeepTempDir = dual<
  <A = unknown, E = unknown>(cleanTempDir: 'always' | boolean) => (exit: Exit.Exit<A, E>) => boolean,
  <A = unknown, E = unknown>(exit: Exit.Exit<A, E>, cleanTempDir: 'always' | boolean) => boolean
>(2, (exit, cleanTempDir) => Exit.isFailure(exit) && cleanTempDir !== 'always')
