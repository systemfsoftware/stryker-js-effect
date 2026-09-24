describe('globals mode', () => {
  test('works without importing vitest', () => {
    expect(typeof test).toBe('function')
    expect(typeof expect).toBe('function')
  })
})
