import { cleanup, fireEvent, render } from '@testing-library/svelte'
import { afterEach, describe, expect, it } from 'vitest'

import Counter from './Counter.svelte'

afterEach(cleanup)
describe('Counter', () => {
  it('renders twice the starting count', () => {
    const { getByRole } = render(Counter, { props: { start: 2 } })

    expect(getByRole('button').textContent).toContain('4')
  })

  it('adds step two on click', async () => {
    const { getByRole } = render(Counter, { props: { start: 0 } })

    await fireEvent.click(getByRole('button'))

    expect(getByRole('button').textContent).toContain('4')
  })

  it('takes the positive branch above zero', () => {
    const { getByText } = render(Counter, { props: { start: 1 } })

    expect(getByText('positive')).toBeTruthy()
  })
})
