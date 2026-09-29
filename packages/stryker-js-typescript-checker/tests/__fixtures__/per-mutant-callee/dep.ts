export const identity = (): (inner: () => number) => () => number => (inner) => inner
export const run = (): () => number => identity()(() => 3)
