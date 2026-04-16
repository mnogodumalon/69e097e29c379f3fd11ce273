import { HashRouter, Routes, Route } from 'react-router-dom';
import { lazy, Suspense } from 'react';
import { ActionsProvider } from '@/context/ActionsContext';
import { ErrorBoundary } from '@/components/ErrorBoundary';
import { Layout } from '@/components/Layout';
import DashboardOverview from '@/pages/DashboardOverview';
import AdminPage from '@/pages/AdminPage';
import MitarbeiterPage from '@/pages/MitarbeiterPage';
import SchichttypenPage from '@/pages/SchichttypenPage';
import SchichtplanungPage from '@/pages/SchichtplanungPage';
// <custom:imports>
// </custom:imports>

const SchichtplanungErstellenPage = lazy(() => import('@/pages/intents/SchichtplanungErstellenPage'));
const WochenplanungPage = lazy(() => import('@/pages/intents/WochenplanungPage'));

export default function App() {
  return (
    <ErrorBoundary>
      <HashRouter>
        <ActionsProvider>
          <Routes>
            <Route element={<Layout />}>
              <Route index element={<DashboardOverview />} />
              <Route path="mitarbeiter" element={<MitarbeiterPage />} />
              <Route path="schichttypen" element={<SchichttypenPage />} />
              <Route path="schichtplanung" element={<SchichtplanungPage />} />
              <Route path="admin" element={<AdminPage />} />
              {/* <custom:routes> */}
              {/* </custom:routes> */}
              <Route path="intents/schichtplanung-erstellen" element={<Suspense fallback={null}><SchichtplanungErstellenPage /></Suspense>} />
              <Route path="intents/wochenplanung" element={<Suspense fallback={null}><WochenplanungPage /></Suspense>} />
            </Route>
          </Routes>
        </ActionsProvider>
      </HashRouter>
    </ErrorBoundary>
  );
}
