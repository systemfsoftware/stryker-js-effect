export declare const SOURCE_CONDITION: '@systemfsoftware/source'
export declare const typesPathFor: (dtsExt: string, mjsPath: string) => string
export type ExportEntry = string | { [key: string]: string | undefined; default: string }
export declare const withTypesFirst: (entry: ExportEntry, dtsExt: string) => ExportEntry
export declare const sourceExports: (options?: { dtsExt?: string }) => {
  devExports: string
  customExports: (exports: Record<string, any>) => Record<string, any>
}
