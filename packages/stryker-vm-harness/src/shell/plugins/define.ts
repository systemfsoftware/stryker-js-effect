import * as Match from 'effect/Match'
import * as Option from 'effect/Option'
import * as Result from 'effect/Result'

import { projectForFile } from '../environments/file-config.js'
import { defineGlobalValue, restoreDescriptors, walkDefinePath } from '../environments/global-descriptors.js'
import { hostEnvironmentOf } from '../environments/host-environment.js'
import {
  type DefineInjectionPlan,
  type DefineInjections,
  planDefine,
  PlanDefineCommand,
} from '../environments/plan-define.workflow.js'
import type { GlobalValue, VmJson } from '../environments/vm-json.js'
import type { VmGraphContext, VmPluginHost, VmSessionPlugin } from '../session-plugin.js'

const PLUGIN_NAME = 'define'
interface DefineRecord {
  readonly globals: Record<string, PropertyDescriptor | undefined>
  readonly processEnvironment: Record<string, string | undefined>
}

const records = new WeakMap<VmPluginHost, DefineRecord>()

const recordFor = (host: VmPluginHost): DefineRecord => {
  const existing = records.get(host)
  if (existing !== undefined) return existing
  const created: DefineRecord = { globals: {}, processEnvironment: {} }
  records.set(host, created)
  return created
}
const parsedJson = (raw: string): Option.Option<GlobalValue> => {
  try {
    return Option.some(JSON.parse(raw) as GlobalValue)
  } catch {
    return Option.none()
  }
}

const defineValueOf = (value: VmJson): GlobalValue => {
  if (typeof value !== 'string') return value
  const text = value
  return Option.match(parsedJson(text), {
    onSome: (parsed) => parsed,
    onNone: () => text,
  })
}

const environmentValueOf = (value: GlobalValue): string => {
  if (typeof value === 'string') return value
  return JSON.stringify(value)
}

const applyPlan = (host: VmPluginHost, plan: DefineInjections): void => {
  const record = recordFor(host)
  const environment = hostEnvironmentOf()
  for (const assignment of plan.globals) {
    const rootKey = assignment.path[0]
    if (rootKey !== undefined && record.globals[rootKey] === undefined && !(rootKey in record.globals)) {
      record.globals[rootKey] = Object.getOwnPropertyDescriptor(globalThis, rootKey)
    }
    const value = defineValueOf(assignment.value)
    walkDefinePath(globalThis, assignment.path, (parent, key) => defineGlobalValue(parent, key, value))
  }
  for (const entry of plan.processEnvironment) {
    const value = environmentValueOf(defineValueOf(entry.value))
    if (record.processEnvironment[entry.name] === undefined && !(entry.name in record.processEnvironment)) {
      record.processEnvironment[entry.name] = environment.read(entry.name)
    }
    environment.write(entry.name, value)
  }
}

const applyPlanned = (host: VmPluginHost, plan: DefineInjectionPlan): void =>
  Match.value(plan).pipe(
    Match.tag('NoDefineInjections', () => undefined),
    Match.tag('DefineInjections', (injections) => applyPlan(host, injections)),
    Match.exhaustive,
  )

export const definePlugin: VmSessionPlugin = {
  name: PLUGIN_NAME,
  beforeFileImport: (file, host) => {
    const project = projectForFile(host, file.file)
    const plan = Result.getOrThrow(
      planDefine(PlanDefineCommand.make({ define: project.define, env: project.env })),
    )
    applyPlanned(host, plan)
  },
  disposeGraph: (_graph: VmGraphContext, host: VmPluginHost) => {
    const record = records.get(host)
    if (record === undefined) return
    records.delete(host)
    restoreDescriptors(globalThis, new Map(Object.entries(record.globals)))
    const environment = hostEnvironmentOf()
    for (const name of Object.keys(record.processEnvironment)) {
      const original = record.processEnvironment[name]
      if (original === undefined) environment.remove(name)
      else environment.write(name, original)
    }
  },
}
