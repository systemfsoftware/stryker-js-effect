const hostPerformance = globalThis.performance
const hostSetImmediate = setImmediate

export const hostNowMillis = (): number => hostPerformance.now()

export const hostImmediate = (run: () => void): void => {
  hostSetImmediate(run)
}
