import { describe, expect, test } from 'vitest'

import { HANDLERS, isKnownSeverity, route } from './dispatch.js'

describe.concurrent('Feature: Cross-Package Incident Routing & Channel Resolution', () => {
  describe.concurrent('Rule: Handlers cover every declared severity in the core contract', () => {
    test('Given the dispatch registry, When inspected, Then it defines a handler for every contract severity', () => {
      expect(Object.keys(HANDLERS).sort()).toEqual(['critical', 'info', 'warning'])
    })
  })

  describe.concurrent('Rule: Routing resolves dedicated communication channels per severity', () => {
    test.each([
      { severity: 'info' as const, channel: 'log' },
      { severity: 'warning' as const, channel: 'email' },
      { severity: 'critical' as const, channel: 'pager' },
    ])('Given a $severity severity, When routed, Then it directs to the $channel channel', ({ severity, channel }) => {
      expect(route(severity).channel).toBe(channel)
    })
  })

  describe.concurrent('Rule: Type guards validate arbitrary strings against known severities', () => {
    test.each([
      { candidate: 'info', expected: true, description: 'standard info severity' },
      { candidate: 'critical', expected: true, description: 'standard critical severity' },
      { candidate: 'verbose', expected: false, description: 'unrecognized verbose candidate' },
      { candidate: '', expected: false, description: 'empty candidate string' },
    ])('Given $description, When validated, Then isKnownSeverity returns $expected', ({ candidate, expected }) => {
      expect(isKnownSeverity(candidate)).toBe(expected)
    })
  })
})
