import * as Match from 'effect/Match'
import * as Option from 'effect/Option'
import * as Result from 'effect/Result'
import * as S from 'effect/Schema'

import { projectForFile } from '../environments/file-config.js'
import { defineGlobalValue, restoreDescriptors, walkDefinePath } from '../environments/global-descriptors.js'
import { type HostEnvironment, hostEnvironmentOf } from '../environments/host-environment.js'
import {
  type DefineInjectionPlan,
  type DefineInjections,
  type GlobalDefineAssignment,
  planDefine,
  PlanDefineCommand,
  type ProcessEnvironmentEntry,
} from '../environments/plan-define.workflow.js'
import type { GlobalValue, VmJson } from '../environments/vm-json.js'
import type { VmGraphContext, VmPluginHost, VmSessionPlugin } from '../session-plugin.js'

const PLUGIN_NAME = 'define'

type AnyDecoded<A = unknown> = A

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
    const value: AnyDecoded = JSON.parse(raw)
    return S.decodeUnknownOption(S.Json)(value)
  } catch {
    return Option.none()
  }
}

const defineValueOf = (value: VmJson): GlobalValue => {
  if (typeof value !== 'string') return value
  return Option.getOrElse(parsedJson(value), () => value)
}

const environmentValueOf = (value: GlobalValue): string => typeof value === 'string' ? value : JSON.stringify(value)

const isUnrecorded = (table: Readonly<Record<string, AnyDecoded>>, key: string): boolean =>
  table[key] === undefined && !(key in table)

const rememberUnrecordedGlobal = (record: DefineRecord, rootKey: string): void => {
  if (isUnrecorded(record.globals, rootKey)) {
    record.globals[rootKey] = Object.getOwnPropertyDescriptor(globalThis, rootKey)
  }
}

const rememberGlobal = (record: DefineRecord, path: ReadonlyArray<string>): void => {
  const rootKey = path[0]
  if (rootKey !== undefined) rememberUnrecordedGlobal(record, rootKey)
}

const rememberEnvironment = (record: DefineRecord, environment: HostEnvironment, name: string): void => {
  if (isUnrecorded(record.processEnvironment, name)) {
    record.processEnvironment[name] = environment.read(name)
  }
}

const applyGlobalAssignment = (record: DefineRecord, assignment: GlobalDefineAssignment): void => {
  rememberGlobal(record, assignment.path)
  const value = defineValueOf(assignment.value)
  walkDefinePath(globalThis, assignment.path, (parent, key) => defineGlobalValue(parent, key, value))
}

const applyEnvironmentEntry = (
  record: DefineRecord,
  environment: HostEnvironment,
  entry: ProcessEnvironmentEntry,
): void => {
  rememberEnvironment(record, environment, entry.name)
  environment.write(entry.name, environmentValueOf(defineValueOf(entry.value)))
}

const applyPlan = (host: VmPluginHost, plan: DefineInjections): void => {
  const record = recordFor(host)
  const environment = hostEnvironmentOf()
  plan.globals.forEach((assignment) => applyGlobalAssignment(record, assignment))
  plan.processEnvironment.forEach((entry) => applyEnvironmentEntry(record, environment, entry))
}

const applyPlanned = (host: VmPluginHost, plan: DefineInjectionPlan): void =>
  Match.value(plan).pipe(
    Match.tag('NoDefineInjections', () => undefined),
    Match.tag('DefineInjections', (injections) => applyPlan(host, injections)),
    Match.exhaustive,
  )

const restoreEnvironmentEntry = (
  environment: HostEnvironment,
  name: string,
  original: string | undefined,
): void => {
  if (original === undefined) environment.remove(name)
  else environment.write(name, original)
}

const restoreEnvironment = (record: DefineRecord): void => {
  const environment = hostEnvironmentOf()
  Object.keys(record.processEnvironment).forEach((name) =>
    restoreEnvironmentEntry(environment, name, record.processEnvironment[name])
  )
}

const disposeRecord = (record: DefineRecord): void => {
  restoreDescriptors(globalThis, new Map(Object.entries(record.globals)))
  restoreEnvironment(record)
}

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
    disposeRecord(record)
  },
}
