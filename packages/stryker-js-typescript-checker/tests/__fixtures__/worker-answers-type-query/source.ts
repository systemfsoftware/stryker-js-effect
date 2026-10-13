export function declared(): 'a' | 'b' {
  return 'a'
}

export const flag: boolean = true

function make(options: { capture: string }): void {
  void options
}

make({ capture: 'x' })
