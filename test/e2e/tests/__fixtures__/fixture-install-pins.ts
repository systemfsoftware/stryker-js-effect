export type FixtureManifest = {
  readonly name: string
  readonly devDependencies?: Readonly<Record<string, string>> | undefined
}

export type InstalledManifest = {
  readonly version: string
  readonly peerDependencies?: Readonly<Record<string, string>> | undefined
}

export type InstalledManifests = Readonly<Record<string, InstalledManifest>>

export const EFFECT_PACKAGE = 'effect'

export const EFFECT_CELL_TYPES_PACKAGE = '@systemfsoftware/effect-cell-types'

const EFFECT_TRACKING_DEPENDENCY = /^(?:effect$|effect\/|@systemfsoftware\/)/

const EXACT_VERSION = /^\d+\.\d+\.\d+(?:-[0-9A-Za-z.-]+)?$/

export const fixturePinViolations = (
  fixtures: ReadonlyArray<FixtureManifest>,
  installed: InstalledManifests,
): ReadonlyArray<string> => {
  const violations: string[] = []
  for (const fixture of fixtures) {
    for (const [packageName, pin] of Object.entries(fixture.devDependencies ?? {})) {
      if (!EFFECT_TRACKING_DEPENDENCY.test(packageName)) {
        continue
      }
      if (!EXACT_VERSION.test(pin)) {
        violations.push(
          `${fixture.name} pins ${packageName}@${pin}: a package that tracks the effect release must be pinned exactly, since a later release of it may demand an effect release the container cannot install`,
        )
        continue
      }
      const resolved = installed[packageName]
      if (resolved !== undefined && pin !== resolved.version) {
        violations.push(
          `${fixture.name} pins ${packageName}@${pin} while the workspace resolved ${resolved.version}: the container would install a different ${packageName} than the packed closure runs against`,
        )
      }
    }
  }
  return violations
}

export const effectCouplingViolations = (installed: InstalledManifests): ReadonlyArray<string> => {
  const effect = installed[EFFECT_PACKAGE]
  const cellTypes = installed[EFFECT_CELL_TYPES_PACKAGE]
  if (effect === undefined || cellTypes === undefined) {
    return [`the workspace resolved no manifest for ${EFFECT_PACKAGE} and ${EFFECT_CELL_TYPES_PACKAGE}`]
  }
  const peer = cellTypes.peerDependencies?.[EFFECT_PACKAGE]
  if (peer === effect.version) {
    return []
  }
  const cellTypesBuild = `${EFFECT_CELL_TYPES_PACKAGE}@${cellTypes.version}`
  const effectBuild = `${EFFECT_PACKAGE}@${effect.version}`
  return [`${cellTypesBuild} peers ${EFFECT_PACKAGE}@${peer ?? 'nothing'} while the workspace resolved ${effectBuild}`]
}
