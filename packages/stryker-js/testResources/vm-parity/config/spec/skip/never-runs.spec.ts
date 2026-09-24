test('this directory is excluded by config and must never run', () => {
  throw new Error('the excluded spec ran')
})
