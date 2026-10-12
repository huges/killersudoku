import { beforeEach, describe, expect, it, vi } from 'vitest'

const { render } = vi.hoisted(() => ({
  render: vi.fn(),
}))

vi.mock('react-dom/client', () => ({
  createRoot: vi.fn(() => ({ render })),
}))

describe('application entry point', () => {
  beforeEach(() => {
    render.mockClear()
    document.body.innerHTML = '<div id="root"></div>'
  })

  it('mounts the application into the root element', async () => {
    await import('../src/main')

    expect(render).toHaveBeenCalledTimes(1)
  })
})
