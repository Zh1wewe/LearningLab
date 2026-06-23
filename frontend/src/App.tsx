import { BrowserRouter, Routes, Route, Navigate } from 'react-router-dom';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import Layout from './components/Layout';
import Chat from './pages/Chat';
import KnowledgeBase from './pages/KnowledgeBase';
import LearningPlans from './pages/LearningPlans';
import PlanDetail from './pages/PlanDetail';
import DocumentLibrary from './pages/DocumentLibrary';

const queryClient = new QueryClient();

function App() {
  return (
    <QueryClientProvider client={queryClient}>
      <BrowserRouter>
        <Routes>
          <Route path="/" element={<Layout />}>
            <Route index element={<Navigate to="/chat" replace />} />
            <Route path="chat" element={<Chat />} />
            <Route path="knowledge" element={<KnowledgeBase />} />
            <Route path="library" element={<DocumentLibrary />} />
            <Route path="plans" element={<LearningPlans />} />
            <Route path="plans/:id" element={<PlanDetail />} />
          </Route>
        </Routes>
      </BrowserRouter>
    </QueryClientProvider>
  );
}

export default App;
