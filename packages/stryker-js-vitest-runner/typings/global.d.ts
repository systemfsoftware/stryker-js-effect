// Use "var" instead of let, otherwise we are not expanding the `globalThis`
declare var __stryker__:
  | import('@systemfsoftware/stryker-js-instrumenter').InstrumenterContext
  | undefined
declare var __stryker2__:
  | import('@systemfsoftware/stryker-js-instrumenter').InstrumenterContext
  | undefined
declare var strykerGlobalNamespaceName: '__stryker__' | '__stryker2__'
declare var strykerDryRun: boolean
