declare function require(id: string): object

export function read(): object {
  return require('./annotated.js')
}
