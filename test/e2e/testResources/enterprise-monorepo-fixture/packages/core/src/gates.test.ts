import { describe, expect, test } from 'vitest'

import { gateFor, Gatekeeper, isLaunchable, regionLabel, shouldSample } from './gates.js'

describe.concurrent('Feature: Canary Gate & Feature Rollout Decisioning', () => {
  describe.concurrent('Rule: Only enabled features with positive canary traffic may launch', () => {
    test.each([
      { config: { enabled: true, canaryPercent: 5 }, expected: true, description: 'enabled with 5% canary traffic' },
      { config: { enabled: false, canaryPercent: 5 }, expected: false, description: 'disabled config' },
      {
        config: { enabled: true, canaryPercent: 0 },
        expected: false,
        description: 'enabled config with zero canary allocation',
      },
    ])(
      'Given $description, When evaluated for launch eligibility, Then isLaunchable returns $expected',
      ({ config, expected }) => {
        expect(isLaunchable(config)).toBe(expected)
      },
    )
  })

  describe.concurrent('Rule: Rollout tier determination maps strictly to allocation percentage', () => {
    test.each([
      { config: { enabled: false, canaryPercent: 100 }, expected: 'disabled', description: 'disabled config' },
      { config: { enabled: true, canaryPercent: 100 }, expected: 'full', description: '100% allocation' },
      { config: { enabled: true, canaryPercent: 25 }, expected: 'canary', description: '25% partial allocation' },
    ])('Given $description, When gate status is requested, Then it resolves to $expected', ({ config, expected }) => {
      expect(gateFor(config)).toBe(expected)
    })
  })

  describe.concurrent('Rule: Regional routing resolves explicit target or defaults to global', () => {
    test.each([
      {
        config: { enabled: true, canaryPercent: 1, region: 'eu-west' },
        expected: 'eu-west',
        description: 'explicit eu-west region',
      },
      {
        config: { enabled: true, canaryPercent: 1 },
        expected: 'global',
        description: 'omitted region defaulting to global',
      },
    ])(
      'Given a config with $description, When region label is resolved, Then it returns $expected',
      ({ config, expected }) => {
        expect(regionLabel(config)).toBe(expected)
      },
    )
  })

  describe.concurrent('Rule: Traffic sampling permits seeds below the canary threshold', () => {
    test.each([
      {
        config: { enabled: true, canaryPercent: 50 },
        seed: 48,
        expected: true,
        description: 'seed 48 below 50% threshold',
      },
      {
        config: { enabled: true, canaryPercent: 50 },
        seed: 50,
        expected: false,
        description: 'seed 50 equal to threshold',
      },
      {
        config: { enabled: true, canaryPercent: 50 },
        seed: 51,
        expected: false,
        description: 'seed 51 exceeding threshold',
      },
      {
        config: { enabled: false, canaryPercent: 100 },
        seed: 3,
        expected: false,
        description: 'seed 3 under disabled config',
      },
      {
        config: { enabled: false, canaryPercent: 100 },
        seed: 4,
        expected: false,
        description: 'seed 4 under disabled config',
      },
    ])(
      'Given $description, When evaluating traffic sampling, Then shouldSample returns $expected',
      ({ config, seed, expected }) => {
        expect(shouldSample(config, seed)).toBe(expected)
      },
    )
  })

  describe.concurrent('Rule: Gatekeeper authenticates with private field salt within max attempt bounds', () => {
    test('authenticates valid token within attempt limits', () => {
      const gate = new Gatekeeper('s3cr3t')
      expect(gate.authenticate('s3cr3t:authorized', 1)).toBe(true)
      expect(gate.authenticate('s3cr3t:authorized', 3)).toBe(true)
      expect(gate.authenticate('wrong:token', 1)).toBe(false)
      expect(gate.authenticate('s3cr3t:authorized', 4)).toBe(false)
    })
  })
})
