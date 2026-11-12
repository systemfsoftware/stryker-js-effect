export const loose = 1
export const n: number = 1
// @ts-expect-error the unresolved annotation is the site under test
export const broken: Missing = 1
export function hold<T>(value: T): T {
  const kept: T = value
  return kept
}
