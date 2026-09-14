import { OxlintConfig } from 'oxlint'

declare const plugins: NonNullable<OxlintConfig['plugins']>
declare const rules: NonNullable<OxlintConfig['rules']>
declare const ignorePatterns: readonly string[]
declare const ignorerConfig: OxlintConfig

export { ignorePatterns, ignorerConfig as default, plugins, rules }
