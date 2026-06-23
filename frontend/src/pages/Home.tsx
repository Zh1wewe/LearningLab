import { useQuery } from '@tanstack/react-query';
import { Link } from 'react-router-dom';
import { checkHealth } from '../api/client';

export default function Home() {
  const { data, isLoading, isError, error } = useQuery({
    queryKey: ['health'],
    queryFn: checkHealth,
  });

  return (
    <div className="min-h-screen bg-gray-50 flex flex-col items-center justify-center p-4">
      <div className="bg-white p-8 rounded-xl shadow-lg text-center max-w-md w-full">
        <h1 className="text-3xl font-bold text-gray-800 mb-6">LearningLab</h1>
        
        <div className="p-4 rounded-lg bg-gray-50 border border-gray-100 mb-6">
          <h2 className="text-lg font-semibold text-gray-700 mb-2">Backend Status</h2>
          
          {isLoading && (
            <p className="text-blue-500 animate-pulse">Checking connection...</p>
          )}
          
          {isError && (
            <div className="text-red-500">
              <p className="font-medium">Connection failed</p>
              <p className="text-sm mt-1">{error instanceof Error ? error.message : 'Unknown error'}</p>
            </div>
          )}
          
          {data && (
            <div className="text-green-600">
              <p className="font-bold text-xl uppercase">{data.status}</p>
              <p className="text-sm mt-1 text-gray-500">Version: {data.version}</p>
            </div>
          )}
        </div>

        <Link
          to="/chat"
          className="inline-block w-full bg-indigo-600 text-white font-semibold py-3 px-4 rounded-lg hover:bg-indigo-700 transition duration-200"
        >
          Open Chat Playground
        </Link>
      </div>
    </div>
  );
}
