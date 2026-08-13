// @vitest-environment happy-dom

import { cleanup, render } from '@testing-library/react'
import { afterEach, describe, expect, it } from 'vitest'
import { TooltipProvider } from '@/components/ui/tooltip'
import VerticalTabsSidebar from './index'

afterEach(cleanup)

describe('VerticalTabsSidebar', () => {
  it('renders the Phase 0 scaffold: header, empty list, and an inert new-tab button', () => {
    const view = render(
      <TooltipProvider>
        <VerticalTabsSidebar />
      </TooltipProvider>
    )

    expect(view.getByTestId('vertical-tabs-sidebar').textContent).toContain('Terminals')
    expect(view.getByTestId('vertical-tabs-list').textContent).toContain('No terminal tabs')

    const newTabButton = view.getByTestId('vertical-tabs-new-tab')
    expect(newTabButton.getAttribute('aria-label')).toBe('New terminal tab (under construction)')
    expect(newTabButton.hasAttribute('disabled')).toBe(true)
  })
})
