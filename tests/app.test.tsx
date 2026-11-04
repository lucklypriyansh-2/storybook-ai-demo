import { describe, it, expect, vi } from 'vitest';
import { render, screen, fireEvent, act } from '@testing-library/react';
import App from '../src/App';
import { beforeEach } from 'vitest';
beforeEach(() => { history.replaceState(null, '', '/'); });
describe('app flow', () => {
  it('consent gates the upload step', () => {
    render(<App initial="consent" />);
    const btn = screen.getByRole('button', { name: /Verify/ });
    expect(btn).toBeDisabled();
    fireEvent.click(screen.getByLabelText(/parent or guardian/));
    expect(btn).not.toBeDisabled();
  });
  it('sample photos enable continue', () => {
    render(<App initial="upload" />);
    fireEvent.click(screen.getByText(/Use sample photos/));
    expect(screen.getByRole('button', { name: 'Continue (3/3)' })).not.toBeDisabled();
  });
  it('character name flows into the hero button', () => {
    render(<App initial="create" />);
    fireEvent.change(screen.getByLabelText("Child's name"), { target: { value: 'Zoya' } });
    expect(screen.getByRole('button', { name: /Looks like Zoya/ })).toBeInTheDocument();
  });
  it('checkout is labelled demo and totals correctly', () => {
    render(<App initial="checkout" />);
    expect(screen.getByText('DEMO · NO PAYMENT')).toBeInTheDocument();
    expect(screen.getByTestId('total')).toHaveTextContent('$46.98');
    fireEvent.click(screen.getByRole('button', { name: /Softcover/ }));
    expect(screen.getByTestId('total')).toHaveTextContent('$36.98');
  });
  it('generation finishes and opens the reader', async () => {
    vi.useFakeTimers();
    render(<App initial="loading" />);
    for (let k = 0; k < 40; k++) await act(async () => { vi.advanceTimersByTime(500); });
    vi.useRealTimers();
    expect(await screen.findByTestId('page-no')).toHaveTextContent('Page 1 / 8');
  });
});
