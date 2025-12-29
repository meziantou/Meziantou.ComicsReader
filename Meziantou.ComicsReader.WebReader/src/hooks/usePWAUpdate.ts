import { useState, useEffect } from 'react';
import { useRegisterSW } from 'virtual:pwa-register/react';

const STATE_STORAGE_KEY = 'pwa_update_state';

export interface PWAUpdateState {
  needRefresh: boolean;
  offlineReady: boolean;
  updateAndReload: () => void;
}

export interface SavedAppState {
  isFullscreen: boolean;
  currentPath: string;
}

export function saveStateBeforeUpdate(state: SavedAppState): void {
  try {
    sessionStorage.setItem(STATE_STORAGE_KEY, JSON.stringify(state));
  } catch (error) {
    console.error('Failed to save state before update:', error);
  }
}

export function restoreStateAfterUpdate(): SavedAppState | null {
  try {
    const saved = sessionStorage.getItem(STATE_STORAGE_KEY);
    if (saved) {
      sessionStorage.removeItem(STATE_STORAGE_KEY);
      return JSON.parse(saved);
    }
  } catch (error) {
    console.error('Failed to restore state after update:', error);
  }
  return null;
}

export function usePWAUpdate(): PWAUpdateState {
  const [needRefresh, setNeedRefresh] = useState(false);
  const [offlineReady, setOfflineReady] = useState(false);

  const {
    needRefresh: [needRefreshState],
    offlineReady: [offlineReadyState],
    updateServiceWorker,
  } = useRegisterSW({
    onRegistered(registration: ServiceWorkerRegistration | undefined) {
      if (registration) {
        // Check for updates periodically (every hour)
        setInterval(() => {
          registration.update();
        }, 60 * 60 * 1000);
      }
    },
    onRegisterError(error: unknown) {
      console.error('SW registration error', error);
    },
  });

  useEffect(() => {
    setNeedRefresh(needRefreshState);
  }, [needRefreshState]);

  useEffect(() => {
    setOfflineReady(offlineReadyState);
  }, [offlineReadyState]);

  const updateAndReload = () => {
    // State saving happens in the component before calling this
    updateServiceWorker(true);
  };

  return {
    needRefresh,
    offlineReady,
    updateAndReload,
  };
}
