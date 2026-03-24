import { useEffect, Component, ReactNode, useState } from 'react';
import { Routes, Route, Navigate } from 'react-router-dom';
import { useAuthStore } from './stores/authStore';
import { useMachineStore } from './stores/machineStore';
import { Login } from './components/Login';
import { Register } from './components/Register';
import { Layout } from './components/Layout';
import { Dashboard } from './components/Dashboard';
import { RemoteControl } from './pages/RemoteControl';
import { Scheduler } from './pages/Scheduler';
import { Alarms } from './pages/Alarms';
import { Transfer } from './pages/Transfer';
import { POP } from './pages/POP';
import { WorkOrder } from './pages/WorkOrder';
import { AuditLog } from './pages/AuditLog';
import { Settings } from './pages/Settings';
import { TemplateEditor } from './pages/TemplateEditor';
import { PanelEditor } from './pages/PanelEditor';
import { MachineAdmin } from './pages/MachineAdmin';
import { InterlockEditor } from './pages/InterlockEditor';
import { SchedulerConfig } from './pages/SchedulerConfig';

// ── Copy Button ───────────────────────────────────────────
function CopyButton({ text }: { text: string }) {
  const [copied, setCopied] = useState(false);
  const handleCopy = () => {
    void navigator.clipboard.writeText(text).then(() => {
      setCopied(true);
      setTimeout(() => setCopied(false), 2000);
    });
  };
  return (
    <button
      onClick={handleCopy}
      className="absolute top-2 right-2 px-2 py-1 text-xs bg-gray-200 dark:bg-gray-600 hover:bg-gray-300 dark:hover:bg-gray-500 text-gray-700 dark:text-gray-200 rounded transition-colors"
    >
      {copied ? '복사됨 ✓' : '복사'}
    </button>
  );
}

// ── Error Boundary ────────────────────────────────────────
class ErrorBoundary extends Component<
  { children: ReactNode },
  { error: Error | null }
> {
  constructor(props: { children: ReactNode }) {
    super(props);
    this.state = { error: null };
  }

  static getDerivedStateFromError(error: Error) {
    return { error };
  }

  componentDidCatch(error: Error, info: { componentStack: string }) {
    console.error('[ErrorBoundary]', error, info.componentStack);
  }

  render() {
    if (this.state.error) {
      return (
        <div className="min-h-screen flex items-center justify-center bg-gray-100 dark:bg-gray-900 p-8">
          <div className="max-w-2xl w-full bg-white dark:bg-gray-800 rounded-lg shadow-lg p-6">
            <h2 className="text-xl font-bold text-red-600 mb-3">렌더링 오류</h2>
            <p className="text-sm text-gray-600 dark:text-gray-400 mb-4">
              페이지를 표시하는 중 오류가 발생했습니다. 아래 메시지를 개발자에게 전달해 주세요.
            </p>
            <div className="relative">
              <pre className="bg-gray-100 dark:bg-gray-700 rounded p-3 text-xs text-red-600 dark:text-red-400 overflow-auto whitespace-pre-wrap max-h-60">
                {this.state.error.message}
                {'\n\n'}
                {this.state.error.stack}
              </pre>
              <CopyButton text={`${this.state.error.message}\n\n${this.state.error.stack ?? ''}`} />
            </div>
            <button
              onClick={() => this.setState({ error: null })}
              className="mt-4 px-4 py-2 bg-blue-600 text-white rounded hover:bg-blue-700 text-sm"
            >
              다시 시도
            </button>
          </div>
        </div>
      );
    }
    return this.props.children;
  }
}

// ── 구버전 Mock 캐시 초기화 ───────────────────────────────
// v1.1.0 이전 버전의 localStorage에 저장된 mock 데이터를 자동 삭제
const CACHE_VERSION_KEY = 'star-webcnc-cache-version';
const CURRENT_CACHE_VERSION = '2';

function clearStaleMockCache() {
  const stored = localStorage.getItem(CACHE_VERSION_KEY);
  if (stored !== CURRENT_CACHE_VERSION) {
    const keysToRemove = [
      'star-webcnc-machines',
      'star-webcnc-scheduler-jobs',
      'star-webcnc-dnc-config',
      'star-webcnc-templates',
    ];
    keysToRemove.forEach((k) => localStorage.removeItem(k));
    localStorage.setItem(CACHE_VERSION_KEY, CURRENT_CACHE_VERSION);
    console.info('[Star-WebCNC] localStorage cache cleared (v' + CURRENT_CACHE_VERSION + ')');
  }
}

// 앱 로드 시 즉시 실행 (렌더링 전)
clearStaleMockCache();

// ── WebSocket lifecycle + machines loading on login ───────
function WsConnector() {
  const isAuthenticated = useAuthStore((s) => s.isAuthenticated);
  const accessToken = useAuthStore((s) => s.accessToken);
  const setAccessToken = useAuthStore((s) => s.setAccessToken);
  const logout = useAuthStore((s) => s.logout);
  const initWebSocket = useMachineStore((s) => s.initWebSocket);
  const destroyWebSocket = useMachineStore((s) => s.destroyWebSocket);
  const fetchMachines = useMachineStore((s) => s.fetchMachines);

  // 페이지 새로고침 시 accessToken이 없으면 refresh token 쿠키로 재발급
  useEffect(() => {
    if (isAuthenticated && !accessToken) {
      fetch('/api/auth/refresh', { method: 'POST', credentials: 'include' })
        .then((r) => r.json())
        .then((data: { success: boolean; data?: { accessToken: string } }) => {
          if (data.success && data.data?.accessToken) {
            setAccessToken(data.data.accessToken);
          } else {
            logout();
          }
        })
        .catch(() => logout());
    }
  // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [isAuthenticated]);

  useEffect(() => {
    if (isAuthenticated && accessToken) {
      initWebSocket(accessToken);
      void fetchMachines();
    } else {
      destroyWebSocket();
    }
    return () => {
      destroyWebSocket();
    };
  }, [isAuthenticated, accessToken, initWebSocket, destroyWebSocket, fetchMachines]);

  return null;
}

// Protected Route wrapper
function ProtectedRoute({ children }: { children: React.ReactNode }) {
  const isAuthenticated = useAuthStore((state) => state.isAuthenticated);

  if (!isAuthenticated) {
    return <Navigate to="/login" replace />;
  }

  return <Layout>{children}</Layout>;
}

// Public Route wrapper (redirect if authenticated)
function PublicRoute({ children }: { children: React.ReactNode }) {
  const isAuthenticated = useAuthStore((state) => state.isAuthenticated);

  if (isAuthenticated) {
    return <Navigate to="/" replace />;
  }

  return <>{children}</>;
}

function App() {
  return (
    <ErrorBoundary>
      <WsConnector />
      <Routes>
      {/* Public Routes */}
      <Route
        path="/login"
        element={
          <PublicRoute>
            <Login />
          </PublicRoute>
        }
      />
      <Route
        path="/register"
        element={
          <PublicRoute>
            <Register />
          </PublicRoute>
        }
      />

      {/* Protected Routes */}
      <Route
        path="/"
        element={
          <ProtectedRoute>
            <Dashboard />
          </ProtectedRoute>
        }
      />

      <Route
        path="/remote"
        element={
          <ProtectedRoute>
            <RemoteControl />
          </ProtectedRoute>
        }
      />

      <Route
        path="/scheduler"
        element={
          <ProtectedRoute>
            <Scheduler />
          </ProtectedRoute>
        }
      />

      <Route
        path="/transfer"
        element={
          <ProtectedRoute>
            <Transfer />
          </ProtectedRoute>
        }
      />

      <Route
        path="/alarms"
        element={
          <ProtectedRoute>
            <Alarms />
          </ProtectedRoute>
        }
      />

      <Route
        path="/pop"
        element={
          <ProtectedRoute>
            <POP />
          </ProtectedRoute>
        }
      />

      <Route
        path="/work-orders"
        element={
          <ProtectedRoute>
            <WorkOrder />
          </ProtectedRoute>
        }
      />

      <Route
        path="/audit"
        element={
          <ProtectedRoute>
            <AuditLog />
          </ProtectedRoute>
        }
      />

      <Route
        path="/settings"
        element={
          <ProtectedRoute>
            <Settings />
          </ProtectedRoute>
        }
      />

      {/* Hidden admin routes (URL access only, not in sidebar) */}
      <Route
        path="/admin/templates"
        element={
          <ProtectedRoute>
            <TemplateEditor />
          </ProtectedRoute>
        }
      />

      <Route
        path="/admin/panel-editor"
        element={
          <ProtectedRoute>
            <PanelEditor />
          </ProtectedRoute>
        }
      />

      <Route
        path="/admin/machines"
        element={
          <ProtectedRoute>
            <MachineAdmin />
          </ProtectedRoute>
        }
      />

      <Route
        path="/admin/interlocks"
        element={
          <ProtectedRoute>
            <InterlockEditor />
          </ProtectedRoute>
        }
      />

      <Route
        path="/admin/scheduler-config"
        element={
          <ProtectedRoute>
            <SchedulerConfig />
          </ProtectedRoute>
        }
      />

      {/* Fallback */}
      <Route path="*" element={<Navigate to="/" replace />} />
    </Routes>
    </ErrorBoundary>
  );
}

export default App;
