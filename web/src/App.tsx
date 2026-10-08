import type { ReactNode } from 'react';
import { BrowserRouter, Navigate, Route, Routes } from 'react-router';
import { AuthProvider, useAuth } from './auth/AuthContext';
import { AssistantWidget } from './components/assistant/AssistantWidget';
import { AuthPage } from './pages/AuthPage';
import { Dashboard } from './pages/Dashboard';
import { Landing } from './pages/Landing';
import { Simulator } from './pages/Simulator';

function Loading() {
  return (
    <div role="status" className="grid min-h-dvh place-items-center text-muted">
      Loading…
    </div>
  );
}

function RequireAuth({ children }: { children: ReactNode }) {
  const { user, signedOut } = useAuth();
  if (user === undefined) return <Loading />;
  return user ? children : <Navigate to={signedOut ? '/' : '/signin'} replace />;
}

function GuestOnly({ children }: { children: ReactNode }) {
  const { user } = useAuth();
  if (user === undefined) return <Loading />;
  return user ? <Navigate to="/dashboard" replace /> : children;
}

export function AppRoutes() {
  return (
    <Routes>
      <Route
        path="/"
        element={
          <GuestOnly>
            <Landing />
          </GuestOnly>
        }
      />
      <Route
        path="/signin"
        element={
          <GuestOnly>
            <AuthPage mode="signin" />
          </GuestOnly>
        }
      />
      <Route
        path="/signup"
        element={
          <GuestOnly>
            <AuthPage mode="signup" />
          </GuestOnly>
        }
      />
      <Route
        path="/dashboard"
        element={
          <RequireAuth>
            <Dashboard />
          </RequireAuth>
        }
      />
      <Route path="/simulator" element={<Simulator />} />
      <Route path="*" element={<Navigate to="/" replace />} />
    </Routes>
  );
}

export function App() {
  return (
    <BrowserRouter>
      <AuthProvider>
        <AppRoutes />
        <AssistantWidget />
      </AuthProvider>
    </BrowserRouter>
  );
}
