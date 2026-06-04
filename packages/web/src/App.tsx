import { BrowserRouter, Routes, Route } from 'react-router-dom';
import { Layout } from './components/Layout';
import { HomePage } from './pages/HomePage';
import { SendPage } from './pages/SendPage';
import { ReceivePage } from './pages/ReceivePage';
import { LoginPage } from './pages/LoginPage';

import { ErrorBoundary } from './components/ErrorBoundary';

function App() {
  return (
    <BrowserRouter>
      <ErrorBoundary>
        <Layout>
          <Routes>
            <Route path="/" element={<HomePage />} />
            <Route path="/send" element={<SendPage />} />
            <Route path="/receive" element={<ReceivePage />} />
            <Route path="/login" element={<LoginPage />} />
          </Routes>
        </Layout>
      </ErrorBoundary>
    </BrowserRouter>
  );
}

export default App;
