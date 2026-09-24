export const accumulate = (limit: number): number => {
  let total = 0
  let step = 0
  while (step < limit) {
    total = total + step
    step = step + 1
  }
  return total
}
