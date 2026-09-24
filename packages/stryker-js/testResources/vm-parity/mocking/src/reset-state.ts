let state = 0

export const bump = (): number => {
  state += 1
  return state
}

export const current = (): number => state
