import { BrowserRouter, Routes, Route, Link } from 'react-router-dom';
import { useState, useEffect } from 'react';
import { AppProvider, useApp } from './context';
import { HomePage, ReaderPage, SettingsPage } from './pages';
import { isOnMeteredConnection } from './services/offlineService';
import { UpdateNotification } from './components/UpdateNotification';
import './App.css';

function Navigation() {
  const { online } = useApp();
  const [isMetered, setIsMetered] = useState(false);

  useEffect(() => {
    const checkMetered = () => {
      setIsMetered(isOnMeteredConnection());
    };

    // Check initially
    checkMetered();

    // Listen for connection changes
    const connection = (navigator as any).connection;
    if (connection) {
      connection.addEventListener('change', checkMetered);
      return () => connection.removeEventListener('change', checkMetered);
    }
  }, []);

  return (
    <nav className="app-nav">
      <Link to="/" className="nav-brand">
        📚 Comics Reader
      </Link>
      <div className="nav-links">
        {!online && <span className="offline-indicator">Offline</span>}
        {isMetered && <span className="metered-indicator" title="Data Saver mode enabled">💾</span>}
        <Link to="/settings" className="nav-link">
          ⚙️
        </Link>
      </div>
    </nav>
  );
}

function AppContent() {
  return (
    <div className="app">
      <Navigation />
      <main className="app-main">
        <Routes>
          <Route path="/" element={<HomePage />} />
          <Route path="/reader/:path" element={<ReaderPage />} />
          <Route path="/settings" element={<SettingsPage />} />
        </Routes>
      </main>
      <UpdateNotification />
    </div>
  );
}

function App() {
  return (
    <BrowserRouter>
      <AppProvider>
        <AppContent />
      </AppProvider>
    </BrowserRouter>
  );
}

export default App;
