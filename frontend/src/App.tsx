import React, { useState, useEffect, Suspense, lazy, useCallback, useMemo, createContext, useContext } from 'react';
import { BrowserRouter, Routes, Route, Navigate } from 'react-router-dom';
import { ErrorBoundary } from 'react-error-boundary';
import Layout from './components/common/Layout';
import Header from './components/common/Header';
import LoadingSpinner from './components/common/LoadingSpinner';
import { setupAPI, checkAPIConnectivity } from './services/api';
import './App.css';

// Lazy load page components for code splitting
const HomePage = lazy(() => import('./pages/HomePage'));
const FeedbackPage = lazy(() => import('./pages/FeedbackPage'));
const MembersPage = lazy(() => import('./pages/MembersPage'));

// Environment configuration
const API_GATEWAY_URL = process.env.REACT_APP_API_GATEWAY_URL || 'http://localhost:8000';
const APP_TITLE = process.env.REACT_APP_TITLE || 'Talent Management Platform';
const AUTH_TOKEN_KEY = process.env.REACT_APP_AUTH_TOKEN_KEY || 'auth_token';
const API_TIMEOUT = parseInt(process.env.REACT_APP_API_TIMEOUT || '30000', 10);
const ERROR_REPORTING_URL = process.env.REACT_APP_ERROR_REPORTING_URL;
const DEFAULT_THEME = process.env.REACT_APP_DEFAULT_THEME || 'light';

// Feature flags
const ENABLE_PWA = process.env.REACT_APP_ENABLE_PWA === 'true';
const ENABLE_ANALYTICS = process.env.REACT_APP_ENABLE_ANALYTICS === 'true';
const ENABLE_I18N = process.env.REACT_APP_ENABLE_I18N === 'true';
const ENABLE_TOUR = process.env.REACT_APP_ENABLE_TOUR === 'true';

// Authentication Context
interface AuthContextType {
  isAuthenticated: boolean;
  user: any | null;
  login: (token: string, user: any) => void;
  logout: () => void;
  refreshToken: () => Promise<void>;
}

const AuthContext = createContext<AuthContextType | undefined>(undefined);

export const useAuth = () => {
  const context = useContext(AuthContext);
  if (!context) {
    throw new Error('useAuth must be used within AuthProvider');
  }
  return context;
};

// Theme Context
interface ThemeContextType {
  theme: 'light' | 'dark';
  toggleTheme: () => void;
}

const ThemeContext = createContext<ThemeContextType | undefined>(undefined);

export const useTheme = () => {
  const context = useContext(ThemeContext);
  if (!context) {
    throw new Error('useTheme must be used within ThemeProvider');
  }
  return context;
};

// Notification Context
interface NotificationContextType {
  showNotification: (message: string, type: 'success' | 'error' | 'info' | 'warning') => void;
  clearNotifications: () => void;
}

const NotificationContext = createContext<NotificationContextType | undefined>(undefined);

export const useNotification = () => {
  const context = useContext(NotificationContext);
  if (!context) {
    throw new Error('useNotification must be used within NotificationProvider');
  }
  return context;
};

// Global Search Context
interface GlobalSearchContextType {
  searchQuery: string;
  setSearchQuery: (query: string) => void;
  searchResults: any[];
  isSearching: boolean;
}

const GlobalSearchContext = createContext<GlobalSearchContextType | undefined>(undefined);

export const useGlobalSearch = () => {
  const context = useContext(GlobalSearchContext);
  if (!context) {
    throw new Error('useGlobalSearch must be used within GlobalSearchProvider');
  }
  return context;
};

// Error Fallback Component
const ErrorFallback: React.FC<{ error: Error; resetErrorBoundary: () => void }> = ({ error, resetErrorBoundary }) => {
  useEffect(() => {
    // Log error to external service
    if (ERROR_REPORTING_URL) {
      fetch(ERROR_REPORTING_URL, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          error: error.message,
          stack: error.stack,
          userAgent: navigator.userAgent,
          timestamp: new Date().toISOString(),
          url: window.location.href,
        }),
      }).catch(console.error);
    }
  }, [error]);

  return (
    <div className="error-fallback">
      <h1>Something went wrong</h1>
      <p>{error.message}</p>
      <button onClick={resetErrorBoundary}>Try again</button>
    </div>
  );
};

const App: React.FC = () => {
  // State management
  const [isLoading, setIsLoading] = useState(true);
  const [isOnline, setIsOnline] = useState(navigator.onLine);
  const [apiConnected, setApiConnected] = useState(false);
  const [theme, setTheme] = useState<'light' | 'dark'>(
    (localStorage.getItem('theme') as 'light' | 'dark') || DEFAULT_THEME
  );
  const [isAuthenticated, setIsAuthenticated] = useState(false);
  const [user, setUser] = useState<any>(null);
  const [notifications, setNotifications] = useState<Array<{ id: string; message: string; type: string }>>([]);
  const [searchQuery, setSearchQuery] = useState('');
  const [searchResults, setSearchResults] = useState<any[]>([]);
  const [isSearching, setIsSearching] = useState(false);

  // Initialize API configuration
  useEffect(() => {
    setupAPI({
      baseURL: API_GATEWAY_URL,
      timeout: API_TIMEOUT,
      authTokenKey: AUTH_TOKEN_KEY,
    });
  }, []);

  // Check API connectivity
  useEffect(() => {
    const checkConnectivity = async () => {
      try {
        const isConnected = await checkAPIConnectivity();
        setApiConnected(isConnected);
      } catch (error) {
        console.error('API connectivity check failed:', error);
        setApiConnected(false);
      } finally {
        setIsLoading(false);
      }
    };

    checkConnectivity();
    const interval = setInterval(checkConnectivity, 60000); // Check every minute

    return () => clearInterval(interval);
  }, []);

  // Handle online/offline status
  useEffect(() => {
    const handleOnline = () => setIsOnline(true);
    const handleOffline = () => setIsOnline(false);

    window.addEventListener('online', handleOnline);
    window.addEventListener('offline', handleOffline);

    return () => {
      window.removeEventListener('online', handleOnline);
      window.removeEventListener('offline', handleOffline);
    };
  }, []);

  // Load authentication state from storage
  useEffect(() => {
    const token = localStorage.getItem(AUTH_TOKEN_KEY);
    const storedUser = localStorage.getItem('user');
    
    if (token && storedUser) {
      try {
        const parsedUser = JSON.parse(storedUser);
        setIsAuthenticated(true);
        setUser(parsedUser);
      } catch (error) {
        console.error('Failed to parse stored user:', error);
        localStorage.removeItem(AUTH_TOKEN_KEY);
        localStorage.removeItem('user');
      }
    }
  }, []);

  // Update document title
  useEffect(() => {
    document.title = APP_TITLE;
  }, []);

  // Apply theme
  useEffect(() => {
    document.documentElement.setAttribute('data-theme', theme);
    localStorage.setItem('theme', theme);
  }, [theme]);

  // Register service worker for PWA
  useEffect(() => {
    if (ENABLE_PWA && 'serviceWorker' in navigator) {
      navigator.serviceWorker
        .register('/service-worker.js')
        .then((registration) => {
          console.log('Service Worker registered:', registration);
        })
        .catch((error) => {
          console.error('Service Worker registration failed:', error);
        });
    }
  }, []);

  // Global keyboard shortcuts
  useEffect(() => {
    const handleKeyPress = (e: KeyboardEvent) => {
      // Ctrl/Cmd + K for global search
      if ((e.ctrlKey || e.metaKey) && e.key === 'k') {
        e.preventDefault();
        // TODO: Open global search modal
      }
      // Ctrl/Cmd + / for keyboard shortcuts help
      if ((e.ctrlKey || e.metaKey) && e.key === '/') {
        e.preventDefault();
        // TODO: Show keyboard shortcuts modal
      }
    };

    window.addEventListener('keydown', handleKeyPress);
    return () => window.removeEventListener('keydown', handleKeyPress);
  }, []);

  // Analytics initialization
  useEffect(() => {
    if (ENABLE_ANALYTICS) {
      // TODO: Initialize analytics service (e.g., Google Analytics, Mixpanel)
      console.log('Analytics enabled');
    }
  }, []);

  // i18n initialization
  useEffect(() => {
    if (ENABLE_I18N) {
      // TODO: Initialize i18n service
      console.log('i18n enabled');
    }
  }, []);

  // Application tour initialization
  useEffect(() => {
    if (ENABLE_TOUR && !localStorage.getItem('tourCompleted')) {
      // TODO: Initialize application tour
      console.log('Tour enabled');
    }
  }, []);

  // Auth context methods
  const login = useCallback((token: string, userData: any) => {
    localStorage.setItem(AUTH_TOKEN_KEY, token);
    localStorage.setItem('user', JSON.stringify(userData));
    setIsAuthenticated(true);
    setUser(userData);
  }, []);

  const logout = useCallback(() => {
    localStorage.removeItem(AUTH_TOKEN_KEY);
    localStorage.removeItem('user');
    setIsAuthenticated(false);
    setUser(null);
  }, []);

  const refreshToken = useCallback(async () => {
    // TODO: Implement token refresh logic
    console.log('Refreshing token...');
  }, []);

  // Theme context methods
  const toggleTheme = useCallback(() => {
    setTheme((prevTheme) => (prevTheme === 'light' ? 'dark' : 'light'));
  }, []);

  // Notification context methods
  const showNotification = useCallback((message: string, type: 'success' | 'error' | 'info' | 'warning') => {
    const id = Date.now().toString();
    setNotifications((prev) => [...prev, { id, message, type }]);
    
    // Auto-remove notification after 5 seconds
    setTimeout(() => {
      setNotifications((prev) => prev.filter((n) => n.id !== id));
    }, 5000);
  }, []);

  const clearNotifications = useCallback(() => {
    setNotifications([]);
  }, []);

  // Global search functionality
  useEffect(() => {
    if (searchQuery) {
      const searchTimeout = setTimeout(async () => {
        setIsSearching(true);
        try {
          // TODO: Implement global search API call
          console.log('Searching for:', searchQuery);
          setSearchResults([]);
        } catch (error) {
          console.error('Search failed:', error);
        } finally {
          setIsSearching(false);
        }
      }, 300);

      return () => clearTimeout(searchTimeout);
    } else {
      setSearchResults([]);
    }
  }, [searchQuery]);

  // Context values
  const authContextValue = useMemo(
    () => ({ isAuthenticated, user, login, logout, refreshToken }),
    [isAuthenticated, user, login, logout, refreshToken]
  );

  const themeContextValue = useMemo(
    () => ({ theme, toggleTheme }),
    [theme, toggleTheme]
  );

  const notificationContextValue = useMemo(
    () => ({ showNotification, clearNotifications }),
    [showNotification, clearNotifications]
  );

  const globalSearchContextValue = useMemo(
    () => ({ searchQuery, setSearchQuery, searchResults, isSearching }),
    [searchQuery, searchResults, isSearching]
  );

  // Loading state
  if (isLoading) {
    return (
      <div className="app-loading">
        <LoadingSpinner />
        <p>Initializing application...</p>
      </div>
    );
  }

  // Offline state
  if (!isOnline) {
    return (
      <div className="app-offline">
        <h1>You are offline</h1>
        <p>Please check your internet connection and try again.</p>
      </div>
    );
  }

  // API connection error
  if (!apiConnected) {
    return (
      <div className="app-error">
        <h1>Unable to connect to server</h1>
        <p>Please try again later or contact support if the problem persists.</p>
        <button onClick={() => window.location.reload()}>Retry</button>
      </div>
    );
  }

  return (
    <ErrorBoundary FallbackComponent={ErrorFallback} onReset={() => window.location.reload()}>
      <AuthContext.Provider value={authContextValue}>
        <ThemeContext.Provider value={themeContextValue}>
          <NotificationContext.Provider value={notificationContextValue}>
            <GlobalSearchContext.Provider value={globalSearchContextValue}>
              <BrowserRouter>
                <div className="app" data-theme={theme}>
                  <Header />
                  <Layout>
                    <Suspense fallback={<LoadingSpinner />}>
                      <Routes>
                        <Route path="/" element={<HomePage />} />
                        <Route path="/feedback" element={<FeedbackPage />} />
                        <Route path="/members" element={<MembersPage />} />
                        <Route path="*" element={<Navigate to="/" replace />} />
                      </Routes>
                    </Suspense>
                  </Layout>
                  
                  {/* Global notifications */}
                  <div className="notifications-container">
                    {notifications.map((notification) => (
                      <div
                        key={notification.id}
                        className={`notification notification-${notification.type}`}
                      >
                        {notification.message}
                      </div>
                    ))}
                  </div>
                </div>
              </BrowserRouter>
            </GlobalSearchContext.Provider>
          </NotificationContext.Provider>
        </ThemeContext.Provider>
      </AuthContext.Provider>
    </ErrorBoundary>
  );
};

export default App;