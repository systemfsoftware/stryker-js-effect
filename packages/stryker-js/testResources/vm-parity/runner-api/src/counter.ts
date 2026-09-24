export const double = (value: number): number => value * 2

export const addAll = (values: readonly number[]): number => values.reduce((total, value) => total + value, 0)
