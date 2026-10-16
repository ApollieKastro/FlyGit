import { Routes, Route, Navigate } from 'react-router-dom';
import { AppLayout } from './components/layout/AppLayout';
import { HomePage } from './pages/HomePage';
import { LoginPage } from './pages/LoginPage';
import { RegisterPage } from './pages/RegisterPage';

/**
 * Application shell and route table.
 *
 * Route shape follows the spec: repositories live under
 * `/repositories/:owner/:repo` (two path params, not a single slug).
 */
export function App() {
  return (
    <Routes>
      <Route element={<AppLayout />}>
        <Route index element={<HomePage />} />
        <Route path="repositories" element={<HomePage />} />
        {/* Detail routes are added as pages land; keep a placeholder for now. */}
        <Route path="repositories/:owner/:repo" element={<Placeholder name="repository" />} />
        <Route path="login" element={<LoginPage />} />
        <Route path="register" element={<RegisterPage />} />
        <Route path="*" element={<Navigate to="/" replace />} />
      </Route>
    </Routes>
  );
}

function Placeholder({ name }: { name: string }) {
  return (
    <div className="mx-auto max-w-3xl px-4 py-16 text-center">
      <p className="text-text-muted text-sm">Страница «{name}» будет добавлена на следующем этапе.</p>
    </div>
  );
}
