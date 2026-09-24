let attempts = 0

export const flaky = (): string => {
  attempts += 1
  if (attempts === 1) {
    throw new Error('first attempt fails')
  }
  return 'recovered'
}

export const attemptsSoFar = (): number => attempts
