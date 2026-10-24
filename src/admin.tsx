import { StrictMode } from 'react';
import { createRoot } from 'react-dom/client';
import AdminDashboard from './pages/AdminDashboard';
import './index.css';

createRoot(document.getElementById('root')!).render(
  <StrictMode>
    <AdminDashboard />
  </StrictMode>
);
