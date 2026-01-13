import { useRef, useCallback, useEffect, useState } from 'react';
import { clamp } from '../utils';

interface PinchZoomState {
  scale: number;
  translateX: number;
  translateY: number;
}

interface UsePinchZoomOptions {
  minScale?: number;
  maxScale?: number;
  doubleTapScale?: number;
}

export function usePinchZoom(options: UsePinchZoomOptions = {}) {
  const { minScale = 1, maxScale = 4, doubleTapScale = 2.5 } = options;

  const [state, setState] = useState<PinchZoomState>({
    scale: 1,
    translateX: 0,
    translateY: 0,
  });

  const [element, setElement] = useState<HTMLDivElement | null>(null);
  const [isInteracting, setIsInteracting] = useState<boolean>(false);

  const initialDistance = useRef<number>(0);
  const initialScale = useRef<number>(1);
  const initialCenter = useRef<{ x: number; y: number }>({ x: 0, y: 0 });
  const lastTap = useRef<number>(0);
  const isPinching = useRef<boolean>(false);
  const isPanning = useRef<boolean>(false);
  const panStart = useRef<{ x: number; y: number; translateX: number; translateY: number }>({ x: 0, y: 0, translateX: 0, translateY: 0 });

  const containerRef = useCallback((node: HTMLDivElement | null) => {
    setElement(node);
  }, []);

  const resetZoom = useCallback(() => {
    setState({ scale: 1, translateX: 0, translateY: 0 });
  }, []);

  const handleTouchStart = useCallback((e: TouchEvent) => {
    if (e.touches.length === 2) {
      isPinching.current = true;
      setIsInteracting(true);
      const touch1 = e.touches[0];
      const touch2 = e.touches[1];

      initialDistance.current = Math.hypot(
        touch2.clientX - touch1.clientX,
        touch2.clientY - touch1.clientY
      );
      setState(current => {
        initialScale.current = current.scale;
        return current;
      });
      initialCenter.current = {
        x: (touch1.clientX + touch2.clientX) / 2,
        y: (touch1.clientY + touch2.clientY) / 2,
      };
    } else if (e.touches.length === 1) {
      isPinching.current = false;
      
      // Check if we should start panning (only when zoomed)
      setState(current => {
        if (current.scale > 1) {
          // Start panning
          isPanning.current = true;
          setIsInteracting(true);
          const touch = e.touches[0];
          panStart.current = {
            x: touch.clientX,
            y: touch.clientY,
            translateX: current.translateX,
            translateY: current.translateY,
          };
        }
        return current;
      });
      
      // Double tap detection
      const now = Date.now();
      const timeDiff = now - lastTap.current;

      if (timeDiff < 300 && timeDiff > 0) {
        // Double tap
        setState(current => {
          if (current.scale > 1) {
            return { scale: 1, translateX: 0, translateY: 0 };
          } else {
            const touch = e.touches[0];
            const rect = element?.getBoundingClientRect();
            if (rect) {
              const centerX = touch.clientX - rect.left - rect.width / 2;
              const centerY = touch.clientY - rect.top - rect.height / 2;
              return {
                scale: doubleTapScale,
                translateX: -centerX * (doubleTapScale - 1),
                translateY: -centerY * (doubleTapScale - 1),
              };
            } else {
              return { scale: doubleTapScale, translateX: 0, translateY: 0 };
            }
          }
        });
      }
      lastTap.current = now;
    }
  }, [doubleTapScale, element]);

  const handleTouchMove = useCallback((e: TouchEvent) => {
    if (e.touches.length === 2 && isPinching.current) {
      const touch1 = e.touches[0];
      const touch2 = e.touches[1];

      const currentDistance = Math.hypot(
        touch2.clientX - touch1.clientX,
        touch2.clientY - touch1.clientY
      );

      const scale = clamp(
        initialScale.current * (currentDistance / initialDistance.current),
        minScale,
        maxScale
      );

      setState(prev => ({
        ...prev,
        scale,
      }));
    } else if (e.touches.length === 1 && isPanning.current) {
      // Handle panning
      const touch = e.touches[0];
      const deltaX = touch.clientX - panStart.current.x;
      const deltaY = touch.clientY - panStart.current.y;

      setState(prev => ({
        ...prev,
        translateX: panStart.current.translateX + deltaX / prev.scale,
        translateY: panStart.current.translateY + deltaY / prev.scale,
      }));
    }
  }, [minScale, maxScale]);

  const handleTouchEnd = useCallback(() => {
    isPinching.current = false;
    isPanning.current = false;
    setIsInteracting(false);
    setState(current => {
      if (current.scale < 1.1) {
        return { scale: 1, translateX: 0, translateY: 0 };
      }
      return current;
    });
  }, []);

  useEffect(() => {
    if (!element) return;

    element.addEventListener('touchstart', handleTouchStart, { passive: true });
    element.addEventListener('touchmove', handleTouchMove, { passive: true });
    element.addEventListener('touchend', handleTouchEnd, { passive: true });

    return () => {
      element.removeEventListener('touchstart', handleTouchStart);
      element.removeEventListener('touchmove', handleTouchMove);
      element.removeEventListener('touchend', handleTouchEnd);
    };
  }, [element, handleTouchStart, handleTouchMove, handleTouchEnd]);

  return {
    containerRef,
    scale: state.scale,
    translateX: state.translateX,
    translateY: state.translateY,
    resetZoom,
    isZoomed: state.scale > 1,
    isInteracting,
  };
}
