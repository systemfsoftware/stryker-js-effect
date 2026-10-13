type Step = (x: number) => number

export const step: Step = (x) => {
  const next = x + 1
  return next
}
