import './PullToRefresh.css';

interface PullToRefreshProps {
  pullDistance: number;
  isRefreshing: boolean;
  threshold?: number;
}

export function PullToRefreshIndicator({
  pullDistance,
  isRefreshing,
  threshold = 80,
}: PullToRefreshProps) {
  const progress = Math.min(pullDistance / threshold, 1);
  const shouldShow = pullDistance > 10 || isRefreshing;

  if (!shouldShow) {
    return null;
  }

  return (
    <div
      className="pull-to-refresh-indicator"
      style={{
        transform: `translateY(${Math.min(pullDistance, threshold)}px)`,
        opacity: progress,
      }}
    >
      {isRefreshing ? (
        <div className="spinner" />
      ) : (
        <div
          className="arrow"
          style={{
            transform: `rotate(${progress * 180}deg)`,
          }}
        >
          ↓
        </div>
      )}
    </div>
  );
}
