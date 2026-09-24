import { cleanup, fireEvent, render } from '@testing-library/svelte'
import { afterEach, describe, expect, it } from 'vitest'

import Toggle from './Toggle.svelte'

afterEach(cleanup)

describe('Toggle', () => {
  it('starts in the off branch', () => {
    const { getByText } = render(Toggle)

    expect(getByText('OFF')).toBeTruthy()
    expect(getByText('no')).toBeTruthy()
  })

  it('flips to the on branch when clicked', async () => {
    const { getByRole, getByText } = render(Toggle)

    await fireEvent.click(getByRole('button'))

    expect(getByText('ON')).toBeTruthy()
    expect(getByText('yes')).toBeTruthy()
  })

  it('honours an initial on value', () => {
    const { getByText } = render(Toggle, { props: { initial: true } })

    expect(getByText('ON')).toBeTruthy()
  })
})
