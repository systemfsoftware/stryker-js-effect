export class Box {
  readonly items: number[] = []

  get size() {
    return this.items.length
  }
}
