import { Routes, Route } from 'react-router-dom';

function App() {
  return (
    <div className="min-h-screen bg-gray-100">
      {/* Header */}
      <header className="bg-white shadow">
        <div className="max-w-7xl mx-auto px-4 py-4">
          <h1 className="text-2xl font-bold text-gray-900">
            Star-WebCNC
          </h1>
        </div>
      </header>

      {/* Main Content */}
      <main className="max-w-7xl mx-auto px-4 py-6">
        <Routes>
          <Route path="/" element={<Dashboard />} />
        </Routes>
      </main>
    </div>
  );
}

// Temporary Dashboard Component
function Dashboard() {
  return (
    <div className="bg-white rounded-lg shadow p-6">
      <h2 className="text-xl font-semibold mb-4">Dashboard</h2>
      <div className="grid grid-cols-1 md:grid-cols-3 gap-4">
        {/* Status Cards */}
        <StatusCard title="서버 상태" status="online" />
        <StatusCard title="연결된 장비" status="0" />
        <StatusCard title="알람" status="0" />
      </div>
      <div className="mt-6 p-4 bg-gray-50 rounded">
        <p className="text-gray-600">
          Phase 1 개발 중...
        </p>
        <p className="text-sm text-gray-500 mt-2">
          다음 단계: Docker Compose 환경 구성
        </p>
      </div>
    </div>
  );
}

function StatusCard({ title, status }: { title: string; status: string }) {
  const isOnline = status === 'online';
  return (
    <div className="bg-gray-50 rounded-lg p-4">
      <h3 className="text-sm font-medium text-gray-500">{title}</h3>
      <p className={`text-2xl font-bold mt-1 ${isOnline ? 'text-green-600' : 'text-gray-900'}`}>
        {isOnline ? '정상' : status}
      </p>
    </div>
  );
}

export default App;
