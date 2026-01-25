import { Routes, Route, Navigate } from 'react-router-dom';
import { useAuthStore } from './stores/authStore';
import { Login } from './components/Login';
import { Layout } from './components/Layout';
import { Dashboard } from './components/Dashboard';
import { RemoteControl } from './pages/RemoteControl';
import { Scheduler } from './pages/Scheduler';
import { Alarms } from './pages/Alarms';

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
        path="/machines"
        element={
          <ProtectedRoute>
            <PlaceholderPage title="Machines" />
          </ProtectedRoute>
        }
      />

      <Route
        path="/remote/:machineId"
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
            <PlaceholderPage title="Transfer" />
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

      {/* Fallback */}
      <Route path="*" element={<Navigate to="/" replace />} />
    </Routes>
  );
}

// Placeholder for unimplemented pages
function PlaceholderPage({ title }: { title: string }) {
  return (
    <div className="p-6">
      <h1 className="text-2xl font-bold text-gray-900 dark:text-white mb-4">
        {title}
      </h1>
      <div className="bg-white dark:bg-gray-800 rounded-lg shadow p-8 text-center">
        <p className="text-gray-500">
          이 페이지는 Phase 3에서 구현됩니다.
        </p>
      </div>
    </div>
  );
}

export default App;
