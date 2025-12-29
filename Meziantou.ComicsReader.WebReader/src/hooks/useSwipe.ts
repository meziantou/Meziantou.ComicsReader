import { useRef, useCallback, useEffect } from 'react';

interface SwipeHandlers {
  onSwipeLeft?: () => void;
  onSwipeRight?: () => void;
  onSwipeUp?: () => void;
  onSwipeDown?: () => void;
}

interface SwipeState {
  startX: number;
  startY: number;
  startTime: number;
}

const SWIPE_THRESHOLD = 50;
const SWIPE_TIME_THRESHOLD = 300;

export function useSwipe(handlers: SwipeHandlers) {
  const stateRef = useRef<SwipeState | null>(null);

  const handleTouchStart = useCallback((e: TouchEvent) => {
    if (e.touches.length !== 1) {
      stateRef.current = null;
      return;
    }

    stateRef.current = {
      startX: e.touches[0].clientX,
      startY: e.touches[0].clientY,
      startTime: Date.now(),
    };
  }, []);

  const handleTouchMove = useCallback((e: TouchEvent) => {
    // Cancel swipe if multiple touches detected
    if (e.touches.length > 1) {
      stateRef.current = null;
    }
  }, []);

  const handleTouchEnd = useCallback((e: TouchEvent) => {
    if (!stateRef.current) {
      return;
    }

    // Ignore if this was a multi-touch gesture
    if (e.changedTouches.length !== 1 || e.touches.length > 0) {
      stateRef.current = null;
      return;
    }

    const endX = e.changedTouches[0].clientX;
    const endY = e.changedTouches[0].clientY;
    const elapsed = Date.now() - stateRef.current.startTime;

    if (elapsed > SWIPE_TIME_THRESHOLD) {
      stateRef.current = null;
      return;
    }

    const deltaX = endX - stateRef.current.startX;
    const deltaY = endY - stateRef.current.startY;

    const absX = Math.abs(deltaX);
    const absY = Math.abs(deltaY);

    if (absX > absY && absX > SWIPE_THRESHOLD) {
      if (deltaX < 0) {
        handlers.onSwipeLeft?.();
      } else {
        handlers.onSwipeRight?.();
      }
    } else if (absY > absX && absY > SWIPE_THRESHOLD) {
      if (deltaY < 0) {
        handlers.onSwipeUp?.();
      } else {
        handlers.onSwipeDown?.();
      }
    }

    stateRef.current = null;
  }, [handlers]);

  return { handleTouchStart, handleTouchMove, handleTouchEnd };
}

export function useSwipeElement(
  elementRef: React.RefObject<HTMLElement | null>,
  handlers: SwipeHandlers
) {
  const { handleTouchStart, handleTouchMove, handleTouchEnd } = useSwipe(handlers);

  useEffect(() => {
    const element = elementRef.current;
    if (!element) return;

    element.addEventListener('touchstart', handleTouchStart, { passive: true });
    element.addEventListener('touchmove', handleTouchMove, { passive: true });
    element.addEventListener('touchend', handleTouchEnd, { passive: true });

    return () => {
      element.removeEventListener('touchstart', handleTouchStart);
      element.removeEventListener('touchmove', handleTouchMove);
      element.removeEventListener('touchend', handleTouchEnd);
    };
  }, [elementRef, handleTouchStart, handleTouchMove, handleTouchEnd]);
}
