import { Result, Schema as S } from 'effect'

import pkgJson from '../package.json' with { type: 'json' }

import { PackageJsonSchema } from './stryker-package.schema.js'

const rawPackageJson: unknown = pkgJson
const pkg = S.decodeUnknownResult(PackageJsonSchema)(rawPackageJson)

export const strykerVersion = Result.getOrThrow(pkg).version
