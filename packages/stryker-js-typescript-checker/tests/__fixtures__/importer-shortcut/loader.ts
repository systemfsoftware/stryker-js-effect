export function load(): Promise<object> {
  return import('./annotated.js')
}
