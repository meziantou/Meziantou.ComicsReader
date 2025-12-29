import { useEffect, useRef, useState } from 'react';
import { useLocation } from 'react-router-dom';
import { usePWAUpdate, saveStateBeforeUpdate } from '../hooks/usePWAUpdate';
import './UpdateNotification.css';

export function UpdateNotification() {
  const { needRefresh, offlineReady, updateAndReload } = usePWAUpdate();
  const location = useLocation();
  const [isUpdating, setIsUpdating] = useState(false);
  const updateTimeoutRef = useRef<ReturnType<typeof setTimeout> | null>(null);

  useEffect(() => {
    if (needRefresh && !isUpdating) {
      // Auto-update after 2 seconds, giving time to save state
      updateTimeoutRef.current = setTimeout(() => {
        handleUpdate();
      }, 2000);
    }

    return () => {
      if (updateTimeoutRef.current) {
        clearTimeout(updateTimeoutRef.current);
      }
    };
  }, [needRefresh, isUpdating]);

  const handleUpdate = () => {
    setIsUpdating(true);
    
    // Save current state
    const isFullscreen = !!document.fullscreenElement;
    saveStateBeforeUpdate({
      isFullscreen,
      currentPath: location.pathname,
    });

    // Trigger update and reload
    updateAndReload();
  };

  if (!needRefresh && !offlineReady) {
    return null;
  }

  return (
    <div className="update-notification">
      <div className="update-notification-content">
        {offlineReady && !needRefresh && (
          <span>✓ App ready to work offline</span>
        )}
        {needRefresh && (
          <>
            <span className="updating-spinner">↻</span>
            <span>{isUpdating ? 'Updating app...' : 'Update available - updating soon...'}</span>
          </>
        )}
      </div>
    </div>
  );
}
