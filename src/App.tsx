import { Suspense, lazy } from 'react'
import { Navigate, Route, Routes } from 'react-router-dom'
import MainLayout from './components/layout/MainLayout'

const LandingPage = lazy(() => import('./pages/LandingPage.tsx'))
const AnalyzerPage = lazy(() => import('./pages/AnalyzerPage.tsx'))
const HowToUsePage = lazy(() => import('./pages/demo.tsx'))
const CoveragePage = lazy(() => import('./pages/CoveragePage.tsx'))

function App() {
  return (
    <MainLayout>
      <Suspense fallback={<div className="p-6 text-sm text-[color:rgb(var(--color-muted))]">Loading…</div>}>
        <Routes>
          <Route path="/" element={<LandingPage />} />
          <Route path="/analyze" element={<AnalyzerPage />} />
          <Route path="/demo" element={<HowToUsePage />} />
          <Route path="/coverage" element={<CoveragePage />} />
          <Route path="*" element={<Navigate to="/" replace />} />
        </Routes>
      </Suspense>
    </MainLayout>
  )
}

export default App
