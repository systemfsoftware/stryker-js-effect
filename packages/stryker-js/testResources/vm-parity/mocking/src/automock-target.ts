export const add = (left: number, right: number): number => left + right

export const helpers = {
  shout: (value: string): string => `${value}!`,
}

export class Counter {
  count = 0

  increment(): number {
    this.count += 1
    return this.count
  }
}
