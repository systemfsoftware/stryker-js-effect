import { Payload } from './barrel.js'

export const read = (payload: Payload): string => payload.pattern.a
