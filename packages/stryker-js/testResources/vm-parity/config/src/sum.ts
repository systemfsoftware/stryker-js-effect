export const sum = (left: number, right: number): number => left + right

if (import.meta.vitest) {
  const { expect, test } = import.meta.vitest
  test('sums inside the source module', () => {
    expect(sum(2, 3)).toBe(5)
  })
}
