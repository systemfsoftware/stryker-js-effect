export const load = (): Promise<number> => import('./other.js').then((module) => module.value)
export const use = (name: 'other'): Promise<number> => import(name).then((module) => module.value)
