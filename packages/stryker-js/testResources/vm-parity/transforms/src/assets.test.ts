import { expect, test } from 'vitest'

import data from './data.json'
import greeting from './greeting.custom'
import { headline, words } from './headline'
import logo from './logo.svg'
import './style.css'

test('the custom plugin turns a .custom file into a module', () => {
  expect(greeting).toBe('Hello from the custom transform')
})

test('json imports arrive as objects', () => {
  expect(data).toEqual({ name: 'vm-parity', count: 3 })
})

test('svg imports arrive as strings', () => {
  expect(typeof logo).toBe('string')
  expect(logo.length).toBeGreaterThan(0)
  expect(logo).toContain('svg')
})

test('the side-effect css import resolves alongside the source', () => {
  expect(headline('  padded  ')).toBe('padded')
  expect(words('a b c')).toEqual(['a', 'b', 'c'])
})
