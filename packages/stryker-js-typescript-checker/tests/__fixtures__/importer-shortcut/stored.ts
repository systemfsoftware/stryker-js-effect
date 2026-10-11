export class Store {
  #value = 0

  get value(): number {
    return this.#value
  }

  set value(next: number) {
    this.#value = next + 1
  }
}
