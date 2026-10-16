import { Routes, Route, Navigate } from 'react-router-dom';
import { AppLayout } from './components/layout/AppLayout';
import { HomePage } from './pages/HomePage';
import { LoginPage } from './pages/LoginPage';
import { RegisterPage } from './pages/RegisterPage';
import { RepositoriesPage } from './pages/RepositoriesPage';
import { RepositoryPage } from './pages/RepositoryPage';
import { CreateRepositoryPage } from './pages/CreateRepositoryPage';
import { UserProfilePage } from './pages/UserProfilePage';
import { SettingsPage } from './pages/SettingsPage';
import { OrganizationsPage } from './pages/OrganizationsPage';
import { OrganizationDetailPage } from './pages/OrganizationDetailPage';

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
        <Route path="repositories" element={<RepositoriesPage />} />
        <Route path="repositories/new" element={<CreateRepositoryPage />} />
        <Route path="repositories/:owner/:repo/*" element={<RepositoryPage />} />
        <Route path="users/:username" element={<UserProfilePage />} />
        <Route path="organizations" element={<OrganizationsPage />} />
        <Route path="organizations/:slug" element={<OrganizationDetailPage />} />
        <Route path="settings" element={<SettingsPage />} />
        <Route path="login" element={<LoginPage />} />
        <Route path="register" element={<RegisterPage />} />
        <Route path="*" element={<Navigate to="/" replace />} />
      </Route>
    </Routes>
  );
}
