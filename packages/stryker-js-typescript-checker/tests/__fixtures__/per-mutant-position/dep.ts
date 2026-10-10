export function pad(a: number): void {
  let _b = a + 1
  _b = _b + 1
  _b = _b + 1
  _b = _b + 1
}

export function keep(): string {
  return 'kept'
}

export function also(): void {
  pad(2)
}

export const label = keep()

export const first = 1
export const second = 2
export const broken: number = 0
