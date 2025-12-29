import { describe, it, expect, vi } from 'vitest';
import { renderHook, act } from '@testing-library/react';
import { usePullToRefresh } from '../hooks/usePullToRefresh';

describe('usePullToRefresh', () => {
  it('should initialize with default state', () => {
    const onRefresh = vi.fn().mockResolvedValue(undefined);
    const { result } = renderHook(() => usePullToRefresh({ onRefresh }));

    expect(result.current.isPulling).toBe(false);
    expect(result.current.isRefreshing).toBe(false);
    expect(result.current.pullDistance).toBe(0);
  });

  it('should trigger refresh when pull exceeds threshold', async () => {
    const onRefresh = vi.fn().mockResolvedValue(undefined);
    const { result } = renderHook(() => usePullToRefresh({ onRefresh, threshold: 80 }));

    // Simulate touch start at top of container
    act(() => {
      result.current.handlers.onTouchStart({
        touches: [{ clientY: 0 }],
      } as unknown as React.TouchEvent);
    });

    // Simulate pulling down beyond threshold
    act(() => {
      result.current.handlers.onTouchMove({
        touches: [{ clientY: 250 }],
      } as unknown as React.TouchEvent);
    });

    // Release
    await act(async () => {
      await result.current.handlers.onTouchEnd();
    });

    expect(onRefresh).toHaveBeenCalled();
  });

  it('should not trigger refresh when pull is below threshold', async () => {
    const onRefresh = vi.fn().mockResolvedValue(undefined);
    const { result } = renderHook(() => usePullToRefresh({ onRefresh, threshold: 80 }));

    act(() => {
      result.current.handlers.onTouchStart({
        touches: [{ clientY: 0 }],
      } as unknown as React.TouchEvent);
    });

    act(() => {
      result.current.handlers.onTouchMove({
        touches: [{ clientY: 50 }],
      } as unknown as React.TouchEvent);
    });

    await act(async () => {
      await result.current.handlers.onTouchEnd();
    });

    expect(onRefresh).not.toHaveBeenCalled();
  });
});
