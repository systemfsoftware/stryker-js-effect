export const nativeImport = (url: string): Promise<unknown> => import(/* @vite-ignore */ url)
