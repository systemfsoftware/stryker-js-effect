import { Schema as S } from 'effect'
import * as Effect from 'effect/Effect'

import pkgJson from '../package.json' with { type: 'json' }

import { PackageJsonSchema } from './stryker-package.schema.js'

const rawPackageJson: unknown = pkgJson
const pkg = Effect.runSync(S.decodeUnknownEffect(PackageJsonSchema)(rawPackageJson))

export const strykerVersion = pkg.version
