import { join } from 'node:path'

export const joined = (left: string, right: string): string => join(left, right)
