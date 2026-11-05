import { describe, it, expect, vi } from 'vitest';
import { render, screen, fireEvent, act } from '@testing-library/react';
import { useEffect } from 'react';
import { StoreProvider, useStore } from '../src/store';
import { ParentGate, HOLD_MS } from '../src/screens/Gate';
import { LocalApi } from '../src/data/local';

function Harness({ onPass }: { onPass: () => void }) { const s = useStore(); useEffect(() => { s.askGate('test', onPass); }, []); return <ParentGate />; }
describe('parent gate', () => {
  it('needs press-and-hold of the three numbers in order; a wrong number resets', () => {
    vi.useFakeTimers(); const pass = vi.fn();
    render(<StoreProvider api={new LocalApi()}><Harness onPass={pass} /></StoreProvider>);
    const code = screen.getByTestId('gate-words').getAttribute('data-code')!;
    const hold = (d: string) => { const k = screen.getByLabelText(`Number ${d}`); fireEvent.pointerDown(k); act(() => { vi.advanceTimersByTime(HOLD_MS + 10); }); fireEvent.pointerUp(k); };
    const wrong = '123456789'.split('').find(d => d !== code[0])!;
    hold(wrong); expect(pass).not.toHaveBeenCalled();
    // a quick tap is not a hold
    fireEvent.pointerDown(screen.getByLabelText(`Number ${code[0]}`)); act(() => { vi.advanceTimersByTime(100); }); fireEvent.pointerUp(screen.getByLabelText(`Number ${code[0]}`));
    for (const d of code) hold(d);
    expect(pass).toHaveBeenCalledTimes(1);
    vi.useRealTimers();
  });
});
