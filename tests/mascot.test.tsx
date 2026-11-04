import { describe, it, expect, vi } from 'vitest';
import { render, act } from '@testing-library/react';
import { Nibbs, avatarSvg } from '../src/mascot';
describe('Nibbs + avatar', () => {
  it('one-shot wave returns to the mood', () => {
    vi.useFakeTimers();
    const { container } = render(<Nibbs mood="thinking" trigger="wave" />);
    expect(container.firstElementChild!.className).toContain('st-wave');
    act(() => { vi.advanceTimersByTime(2500); });
    expect(container.firstElementChild!.className).toContain('st-thinking');
    vi.useRealTimers();
  });
  it('avatar reflects traits', () => {
    const s = avatarSvg({ skin: '#5E3A24', glasses: true, hair: 'buzz' });
    expect(s).toContain('#5E3A24'); expect(s).toContain('stroke="#3B3A9E"');
    expect(avatarSvg({ glasses: false })).not.toContain('stroke="#3B3A9E"');
  });
});
