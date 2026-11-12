export function sizeOf(): number {
  const boxes: Array<typeof import('./box.js')> = []
  return boxes.length
}
