import * as Schedule from 'effect/Schedule'

export const connectRetry = Schedule.max([Schedule.spaced(50), Schedule.recurs(100)])