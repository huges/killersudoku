import { render, screen } from '@testing-library/react'
import { describe, expect, it } from 'vitest'
import App from '../src/App'

describe('initial baseline', () => {
  it('renders the Killer Sudoku baseline without game controls', () => {
    render(<App />)

    expect(screen.getByRole('heading', { name: 'Killer Sudoku' })).toBeInTheDocument()
    expect(screen.getByText('Baseline iniziale')).toBeInTheDocument()
    expect(screen.queryByRole('textbox')).not.toBeInTheDocument()
    expect(screen.queryByRole('button')).not.toBeInTheDocument()
    expect(screen.queryByText(/griglia 9×9/i)).not.toBeInTheDocument()
  })
})
