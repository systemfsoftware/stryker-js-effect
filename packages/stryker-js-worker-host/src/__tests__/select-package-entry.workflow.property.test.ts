import { describe, it } from '@systemfsoftware/vitest'
import * as Result from 'effect/Result'
import * as S from 'effect/Schema'

import { ConditionCase, FallbackCase, KeyCase } from '../../tests/__fixtures__/select-package-entry.schema.js'
import { type PackageManifestFields } from '../run/package-manifest.schema.js'
import {
  PackageEntrySelected,
  PackageEntryUnresolved,
  selectPackageEntry,
  SelectPackageEntryCommand,
} from '../run/select-package-entry.workflow.js'

describe('selectPackageEntry', () => {
  it.prop('∀k_ExportKey_=Literal', { of: [KeyCase], subject: selectPackageEntry }, (subject, [input]) => {
    const exportsValue = {
      ...(input.root === undefined ? {} : { '.': input.root }),
      ...(input.feature === undefined ? {} : { './feature': input.feature }),
    }
    const result = subject(
      SelectPackageEntryCommand.make({ specifier: input.specifier, manifest: { exports: exportsValue } }),
    )
    if (Result.isFailure(result)) {
      return false
    }
    const key = input.specifier === 'pkg/feature' || input.specifier === '@scope/pkg/feature'
      ? './feature'
      : '.'
    const target = key === '.' ? input.root : input.feature
    if (target === undefined) {
      if (input.root === undefined && input.feature === undefined) {
        return (
          S.is(PackageEntryUnresolved)(result.success) &&
          result.success.reason === 'the matching package export resolves to null' &&
          result.success.specifier === input.specifier
        )
      }
      return (
        S.is(PackageEntryUnresolved)(result.success) &&
        result.success.reason === `the package does not export "${key}"` &&
        result.success.specifier === input.specifier
      )
    }
    return (
      S.is(PackageEntrySelected)(result.success) &&
      result.success.entry === target &&
      result.success.specifier === input.specifier
    )
  })

  it.prop('∀c_Condition_≡Order', { of: [ConditionCase], subject: selectPackageEntry }, (subject, [input]) => {
    const exportsValue = {
      ...(input.node === undefined ? {} : { node: input.node }),
      ...(input.import === undefined ? {} : { import: input.import }),
      ...(input.default === undefined ? {} : { default: input.default }),
    }
    const result = subject(
      SelectPackageEntryCommand.make({ specifier: 'pkg', manifest: { exports: exportsValue } }),
    )
    if (Result.isFailure(result)) {
      return false
    }
    if (input.node !== undefined) {
      const expected = typeof input.node === 'string'
        ? './from-node.mjs'
        : 'node' in input.node
        ? './deep-node.mjs'
        : './deep-default.mjs'
      return (
        S.is(PackageEntrySelected)(result.success) &&
        result.success.entry === expected &&
        result.success.specifier === 'pkg'
      )
    }
    if (input.import !== undefined) {
      return (
        S.is(PackageEntrySelected)(result.success) &&
        result.success.entry === './from-import.mjs' &&
        result.success.specifier === 'pkg'
      )
    }
    if (input.default !== undefined) {
      return (
        S.is(PackageEntrySelected)(result.success) &&
        result.success.entry === './from-default.mjs' &&
        result.success.specifier === 'pkg'
      )
    }
    return (
      S.is(PackageEntryUnresolved)(result.success) &&
      result.success.reason === 'the matching package export resolves to null' &&
      result.success.specifier === 'pkg'
    )
  })

  it.prop('∀m_Fallback_=Entry', { of: [FallbackCase], subject: selectPackageEntry }, (subject, [input]) => {
    const manifest: PackageManifestFields = {
      ...(input.exports === undefined ? {} : { exports: input.exports }),
      ...(input.module === undefined ? {} : { module: input.module }),
      ...(input.main === undefined ? {} : { main: input.main }),
    }
    const result = subject(SelectPackageEntryCommand.make({ specifier: input.specifier, manifest }))
    if (Result.isFailure(result)) {
      return false
    }
    const selected = (entry: string): boolean =>
      S.is(PackageEntrySelected)(result.success) &&
      result.success.entry === entry &&
      result.success.specifier === input.specifier
    const unresolved = (reason: string): boolean =>
      S.is(PackageEntryUnresolved)(result.success) &&
      result.success.reason === reason &&
      result.success.specifier === input.specifier
    if (input.exports !== undefined) {
      if (typeof input.exports === 'string') {
        if (input.specifier === 'pkg') {
          return selected('./exported.mjs')
        }
        return unresolved('the package does not export "./feature"')
      }
      if (input.specifier === 'pkg') {
        return unresolved('the package does not export "."')
      }
      return selected('./exported.mjs')
    }
    if (input.module !== undefined) {
      if (input.module === './lib/*.mjs') {
        return unresolved('the package declares a wildcard export, which this host does not resolve')
      }
      return selected('./from-module.mjs')
    }
    if (input.main !== undefined) {
      return selected('from-main.js')
    }
    return unresolved('the package declares no "exports", "module", or "main" entry')
  })
})
