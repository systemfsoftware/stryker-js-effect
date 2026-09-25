export const nativeImport = <A = unknown>(url: string): Promise<A> => import(url)
