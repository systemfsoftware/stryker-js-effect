import type { HarnessModuleBuiltin } from '@systemfsoftware/stryker-vm-harness'
import * as Context from 'effect/Context'

export interface VmFileUrl {
  readonly href: string
}

export interface VmPlatform {
  readonly moduleBuiltin: HarnessModuleBuiltin
  readonly pathToFileURL: (path: string) => VmFileUrl
}

export class VmRunner
  extends Context.Service<VmRunner, VmPlatform>()('@systemfsoftware/stryker-js/VmRunner.service/VmRunner')
{}
