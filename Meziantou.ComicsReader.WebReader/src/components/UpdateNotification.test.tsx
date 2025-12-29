import { describe, it, expect, vi, beforeEach } from 'vitest';
import { render, screen } from '@testing-library/react';
import { BrowserRouter } from 'react-router-dom';
import { UpdateNotification } from './UpdateNotification';

// Mock the usePWAUpdate hook module
let mockPWAState = {
  needRefresh: false,
  offlineReady: false,
  updateAndReload: vi.fn(),
};

vi.mock('../hooks/usePWAUpdate', () => ({
  usePWAUpdate: () => mockPWAState,
  saveStateBeforeUpdate: vi.fn(),
  restoreStateAfterUpdate: vi.fn(),
}));

const renderWithRouter = (component: React.ReactElement) => {
  return render(<BrowserRouter>{component}</BrowserRouter>);
};

describe('UpdateNotification', () => {
  beforeEach(() => {
    vi.clearAllTimers();
    mockPWAState = {
      needRefresh: false,
      offlineReady: false,
      updateAndReload: vi.fn(),
    };
  });

  it('should not render when no update is needed', () => {
    const { container } = renderWithRouter(<UpdateNotification />);
    expect(container.firstChild).toBeNull();
  });

  it('should render offline ready message', () => {
    mockPWAState.offlineReady = true;

    renderWithRouter(<UpdateNotification />);
    expect(screen.getByText('✓ App ready to work offline')).toBeInTheDocument();
  });

  it('should render update available message', () => {
    mockPWAState.needRefresh = true;

    renderWithRouter(<UpdateNotification />);
    expect(screen.getByText(/Update available/)).toBeInTheDocument();
  });
});
