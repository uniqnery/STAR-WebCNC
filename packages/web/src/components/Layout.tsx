// Layout Component with Sidebar - Mobile Responsive

import { ReactNode, useState } from 'react';
import { Link, useLocation, useNavigate } from 'react-router-dom';
import { useAuthStore } from '../stores/authStore';
import { authApi, machineApi } from '../lib/api';
import { useMachineStore } from '../stores/machineStore';

interface LayoutProps {
  children: ReactNode;
}

export function Layout({ children }: LayoutProps) {
  const [sidebarOpen, setSidebarOpen] = useState(false);
  const location = useLocation();
  const navigate = useNavigate();
  const { user, logout } = useAuthStore();
  const controlLockMap = useMachineStore((s) => s.controlLockMap);
  const releaseControlLock = useMachineStore((s) => s.releaseControlLock);

  const handleLogout = async () => {
    // 보유 중인 제어권 모두 해제
    const ownedMachines = Object.entries(controlLockMap)
      .filter(([, entry]) => entry.isOwner)
      .map(([machineId]) => machineId);
    await Promise.allSettled(
      ownedMachines.map((machineId) =>
        machineApi.releaseControl(machineId).then(() => releaseControlLock(machineId)).catch(() => null)
      )
    );
    await authApi.logout().catch(() => null);
    logout();
    navigate('/login');
  };

  const handleNavClick = () => {
    // 모바일에서 메뉴 클릭 시 사이드바 닫기
    setSidebarOpen(false);
  };

  const isHqEngineer = user?.role === 'HQ_ENGINEER';

  // 하위 메뉴 펼침 상태 (기본 접힘)
  const [expandedMenus, setExpandedMenus] = useState<Record<string, boolean>>({ machines: false, admin: false });

  const toggleMenu = (key: string) => {
    setExpandedMenus((prev) => ({ ...prev, [key]: !prev[key] }));
  };

  // 일반 메뉴 아이템
  const menuItems = [
    { path: '/', label: 'Dashboard', icon: DashboardIcon },
    { path: '/pop', label: 'POP', icon: POPIcon },
    { path: '/work-orders', label: 'Work Orders', icon: WorkOrderIcon },
    { path: '/alarms', label: 'Alarms', icon: AlarmIcon },
    { path: '/audit', label: 'Audit Log', icon: AuditIcon },
    { path: '/settings', label: 'Settings', icon: SettingsIcon },
  ];

  // Machines 하위 메뉴
  const machineSubMenus = [
    { path: '/remote', label: 'Remote Panel', icon: RemotePanelIcon },
    { path: '/scheduler', label: 'Scheduler', icon: SchedulerIcon },
    { path: '/transfer', label: 'File Transfer', icon: TransferIcon },
  ];

  return (
    <div className="flex h-screen bg-gray-100 dark:bg-gray-900">
      {/* Mobile Overlay */}
      {sidebarOpen && (
        <div
          className="fixed inset-0 bg-black/50 z-40 lg:hidden"
          onClick={() => setSidebarOpen(false)}
        />
      )}

      {/* Sidebar */}
      <aside
        className={`
          fixed lg:static inset-y-0 left-0 z-50
          w-64 bg-gray-800 text-white flex flex-col
          transform transition-transform duration-300 ease-in-out
          ${sidebarOpen ? 'translate-x-0' : '-translate-x-full lg:translate-x-0'}
        `}
      >
        {/* Logo */}
        <div className="p-4 border-b border-gray-700 flex items-center justify-between">
          <div className="flex items-center gap-3">
            <img src="https://sktasdb.web.app/star.png" alt="Star" className="h-12 w-auto object-contain brightness-0 invert cursor-pointer" onClick={() => window.location.reload()} />
            <div className="flex flex-col justify-center leading-none gap-[5px]">
              <p className="text-[14px] font-medium text-gray-300"><span className="text-white font-bold text-[16px]">S</span>mart</p>
              <p className="text-[14px] font-medium text-gray-300"><span className="text-white font-bold text-[16px]">T</span>hinking</p>
              <p className="text-[14px] font-medium text-gray-300"><span className="text-white font-bold text-[16px]">P</span>ro</p>
            </div>
          </div>
          {/* 모바일 닫기 버튼 */}
          <button
            onClick={() => setSidebarOpen(false)}
            className="lg:hidden p-2 text-gray-400 hover:text-white"
          >
            <CloseIcon className="w-5 h-5" />
          </button>
        </div>

        {/* Navigation */}
        <nav className="flex-1 p-4 overflow-y-auto">
          <ul className="space-y-1">
            {/* Dashboard */}
            <li>
              <Link
                to="/"
                onClick={handleNavClick}
                className={`flex items-center gap-3 px-3 py-2 rounded-lg transition-colors ${
                  location.pathname === '/'
                    ? 'bg-blue-600 text-white'
                    : 'text-gray-300 hover:bg-gray-700'
                }`}
              >
                <DashboardIcon className="w-5 h-5" />
                <span>Dashboard</span>
              </Link>
            </li>

            {/* Machines - 펼침 메뉴 */}
            <li>
              <button
                onClick={() => toggleMenu('machines')}
                className="w-full flex items-center justify-between px-3 py-2 rounded-lg text-gray-300 hover:bg-gray-700 transition-colors"
              >
                <div className="flex items-center gap-3">
                  <MachineIcon className="w-5 h-5" />
                  <span>Machines</span>
                </div>
                <ChevronIcon className={`w-4 h-4 transition-transform ${expandedMenus.machines ? 'rotate-90' : ''}`} />
              </button>

              {/* 하위 메뉴 */}
              {expandedMenus.machines && (
                <ul className="mt-1 ml-4 space-y-1 border-l border-gray-700 pl-3">
                  {machineSubMenus.map((item) => {
                    const isActive = location.pathname === item.path;
                    return (
                      <li key={item.path}>
                        <Link
                          to={item.path}
                          onClick={handleNavClick}
                          className={`flex items-center gap-3 px-3 py-2 rounded-lg transition-colors text-sm ${
                            isActive
                              ? 'bg-blue-600 text-white'
                              : 'text-gray-400 hover:bg-gray-700 hover:text-gray-200'
                          }`}
                        >
                          <item.icon className="w-4 h-4" />
                          <span>{item.label}</span>
                        </Link>
                      </li>
                    );
                  })}
                </ul>
              )}
            </li>

            {/* 나머지 메뉴 */}
            {menuItems.slice(1).map((item) => {
              const isActive = location.pathname === item.path;
              return (
                <li key={item.path}>
                  <Link
                    to={item.path}
                    onClick={handleNavClick}
                    className={`flex items-center gap-3 px-3 py-2 rounded-lg transition-colors ${
                      isActive
                        ? 'bg-blue-600 text-white'
                        : 'text-gray-300 hover:bg-gray-700'
                    }`}
                  >
                    <item.icon className="w-5 h-5" />
                    <span>{item.label}</span>
                  </Link>
                </li>
              );
            })}

            {/* HQ_ENGINEER 전용 관리자 메뉴 */}
            {isHqEngineer && (
              <>
                <li className="mt-4 mb-1">
                  <span className="px-3 text-xs font-semibold text-gray-500 uppercase tracking-wider">
                    관리자
                  </span>
                </li>
                <li>
                  <button
                    onClick={() => toggleMenu('admin')}
                    className="w-full flex items-center justify-between px-3 py-2 rounded-lg text-gray-300 hover:bg-gray-700 transition-colors"
                  >
                    <div className="flex items-center gap-3">
                      <AdminIcon className="w-5 h-5" />
                      <span>Admin</span>
                    </div>
                    <ChevronIcon className={`w-4 h-4 transition-transform ${expandedMenus.admin ? 'rotate-90' : ''}`} />
                  </button>
                  {expandedMenus.admin && (
                    <ul className="mt-1 ml-4 space-y-1 border-l border-gray-700 pl-3">
                      <li>
                        <Link
                          to="/admin/machines"
                          onClick={handleNavClick}
                          className={`flex items-center gap-3 px-3 py-2 rounded-lg transition-colors text-sm ${
                            location.pathname === '/admin/machines'
                              ? 'bg-blue-600 text-white'
                              : 'text-gray-400 hover:bg-gray-700 hover:text-gray-200'
                          }`}
                        >
                          <MachineAdminIcon className="w-4 h-4" />
                          <span>설비 관리</span>
                        </Link>
                      </li>
                      <li>
                        <Link
                          to="/admin/templates"
                          onClick={handleNavClick}
                          className={`flex items-center gap-3 px-3 py-2 rounded-lg transition-colors text-sm ${
                            location.pathname === '/admin/templates'
                              ? 'bg-blue-600 text-white'
                              : 'text-gray-400 hover:bg-gray-700 hover:text-gray-200'
                          }`}
                        >
                          <TemplateIcon className="w-4 h-4" />
                          <span>템플릿 편집</span>
                        </Link>
                      </li>
                      <li>
                        <Link
                          to="/admin/panel-editor"
                          onClick={handleNavClick}
                          className={`flex items-center gap-3 px-3 py-2 rounded-lg transition-colors text-sm ${
                            location.pathname === '/admin/panel-editor'
                              ? 'bg-blue-600 text-white'
                              : 'text-gray-400 hover:bg-gray-700 hover:text-gray-200'
                          }`}
                        >
                          <PanelEditorIcon className="w-4 h-4" />
                          <span>패널 디자인</span>
                        </Link>
                      </li>
                      <li>
                        <Link
                          to="/admin/interlocks"
                          onClick={handleNavClick}
                          className={`flex items-center gap-3 px-3 py-2 rounded-lg transition-colors text-sm ${
                            location.pathname === '/admin/interlocks'
                              ? 'bg-blue-600 text-white'
                              : 'text-gray-400 hover:bg-gray-700 hover:text-gray-200'
                          }`}
                        >
                          <InterlockIcon className="w-4 h-4" />
                          <span>인터록 편집</span>
                        </Link>
                      </li>
                    </ul>
                  )}
                </li>
              </>
            )}
          </ul>
        </nav>

        {/* User */}
        <div className="p-4 border-t border-gray-700">
          <div className="flex items-center gap-3">
            <div className="w-8 h-8 bg-blue-600 rounded-full flex items-center justify-center">
              {user?.username?.[0]?.toUpperCase() || 'U'}
            </div>
            <div className="flex-1 min-w-0">
              <p className="text-sm font-medium truncate">{user?.username}</p>
              <p className="text-xs text-gray-400">{user?.role}</p>
            </div>
            <button
              onClick={handleLogout}
              className="p-2 text-gray-400 hover:text-white hover:bg-gray-700 rounded"
              title="로그아웃"
            >
              <LogoutIcon className="w-5 h-5" />
            </button>
          </div>
        </div>
      </aside>

      {/* Main Content */}
      <div className="flex-1 flex flex-col min-w-0">
        {/* Mobile Header */}
        <header className="lg:hidden bg-gray-800 text-white p-4 flex items-center gap-4">
          <button
            onClick={() => setSidebarOpen(true)}
            className="p-2 hover:bg-gray-700 rounded"
          >
            <HamburgerIcon className="w-6 h-6" />
          </button>
          <h1 className="text-lg font-bold"><span className="text-blue-400">S</span>mart <span className="text-blue-400">T</span>hinking <span className="text-blue-400">P</span>ro</h1>
        </header>

        {/* Page Content */}
        <main className="flex-1 overflow-auto">
          {children}
        </main>
      </div>
    </div>
  );
}

// Icons
function HamburgerIcon({ className }: { className?: string }) {
  return (
    <svg className={className} fill="none" viewBox="0 0 24 24" stroke="currentColor">
      <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M4 6h16M4 12h16M4 18h16" />
    </svg>
  );
}

function CloseIcon({ className }: { className?: string }) {
  return (
    <svg className={className} fill="none" viewBox="0 0 24 24" stroke="currentColor">
      <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M6 18L18 6M6 6l12 12" />
    </svg>
  );
}

function DashboardIcon({ className }: { className?: string }) {
  return (
    <svg className={className} fill="none" viewBox="0 0 24 24" stroke="currentColor">
      <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M4 6a2 2 0 012-2h2a2 2 0 012 2v2a2 2 0 01-2 2H6a2 2 0 01-2-2V6zM14 6a2 2 0 012-2h2a2 2 0 012 2v2a2 2 0 01-2 2h-2a2 2 0 01-2-2V6zM4 16a2 2 0 012-2h2a2 2 0 012 2v2a2 2 0 01-2 2H6a2 2 0 01-2-2v-2zM14 16a2 2 0 012-2h2a2 2 0 012 2v2a2 2 0 01-2 2h-2a2 2 0 01-2-2v-2z" />
    </svg>
  );
}

function MachineIcon({ className }: { className?: string }) {
  return (
    <svg className={className} fill="none" viewBox="0 0 24 24" stroke="currentColor">
      <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M9 3v2m6-2v2M9 19v2m6-2v2M5 9H3m2 6H3m18-6h-2m2 6h-2M7 19h10a2 2 0 002-2V7a2 2 0 00-2-2H7a2 2 0 00-2 2v10a2 2 0 002 2zM9 9h6v6H9V9z" />
    </svg>
  );
}

function SchedulerIcon({ className }: { className?: string }) {
  return (
    <svg className={className} fill="none" viewBox="0 0 24 24" stroke="currentColor">
      <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M9 5H7a2 2 0 00-2 2v12a2 2 0 002 2h10a2 2 0 002-2V7a2 2 0 00-2-2h-2M9 5a2 2 0 002 2h2a2 2 0 002-2M9 5a2 2 0 012-2h2a2 2 0 012 2m-3 7h3m-3 4h3m-6-4h.01M9 16h.01" />
    </svg>
  );
}

function TransferIcon({ className }: { className?: string }) {
  return (
    <svg className={className} fill="none" viewBox="0 0 24 24" stroke="currentColor">
      <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M7 16a4 4 0 01-.88-7.903A5 5 0 1115.9 6L16 6a5 5 0 011 9.9M15 13l-3-3m0 0l-3 3m3-3v12" />
    </svg>
  );
}

function AlarmIcon({ className }: { className?: string }) {
  return (
    <svg className={className} fill="none" viewBox="0 0 24 24" stroke="currentColor">
      <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M12 9v2m0 4h.01m-6.938 4h13.856c1.54 0 2.502-1.667 1.732-3L13.732 4c-.77-1.333-2.694-1.333-3.464 0L3.34 16c-.77 1.333.192 3 1.732 3z" />
    </svg>
  );
}

function LogoutIcon({ className }: { className?: string }) {
  return (
    <svg className={className} fill="none" viewBox="0 0 24 24" stroke="currentColor">
      <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M17 16l4-4m0 0l-4-4m4 4H7m6 4v1a3 3 0 01-3 3H6a3 3 0 01-3-3V7a3 3 0 013-3h4a3 3 0 013 3v1" />
    </svg>
  );
}

function POPIcon({ className }: { className?: string }) {
  return (
    <svg className={className} fill="none" viewBox="0 0 24 24" stroke="currentColor">
      <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M9 19v-6a2 2 0 00-2-2H5a2 2 0 00-2 2v6a2 2 0 002 2h2a2 2 0 002-2zm0 0V9a2 2 0 012-2h2a2 2 0 012 2v10m-6 0a2 2 0 002 2h2a2 2 0 002-2m0 0V5a2 2 0 012-2h2a2 2 0 012 2v14a2 2 0 01-2 2h-2a2 2 0 01-2-2z" />
    </svg>
  );
}

function WorkOrderIcon({ className }: { className?: string }) {
  return (
    <svg className={className} fill="none" viewBox="0 0 24 24" stroke="currentColor">
      <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M9 12h6m-6 4h6m2 5H7a2 2 0 01-2-2V5a2 2 0 012-2h5.586a1 1 0 01.707.293l5.414 5.414a1 1 0 01.293.707V19a2 2 0 01-2 2z" />
    </svg>
  );
}

function AuditIcon({ className }: { className?: string }) {
  return (
    <svg className={className} fill="none" viewBox="0 0 24 24" stroke="currentColor">
      <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M9 5H7a2 2 0 00-2 2v12a2 2 0 002 2h10a2 2 0 002-2V7a2 2 0 00-2-2h-2M9 5a2 2 0 002 2h2a2 2 0 002-2M9 5a2 2 0 012-2h2a2 2 0 012 2m-6 9l2 2 4-4" />
    </svg>
  );
}

function SettingsIcon({ className }: { className?: string }) {
  return (
    <svg className={className} fill="none" viewBox="0 0 24 24" stroke="currentColor">
      <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M10.325 4.317c.426-1.756 2.924-1.756 3.35 0a1.724 1.724 0 002.573 1.066c1.543-.94 3.31.826 2.37 2.37a1.724 1.724 0 001.066 2.573c1.756.426 1.756 2.924 0 3.35a1.724 1.724 0 00-1.066 2.573c.94 1.543-.826 3.31-2.37 2.37a1.724 1.724 0 00-2.573 1.066c-.426 1.756-2.924 1.756-3.35 0a1.724 1.724 0 00-2.573-1.066c-1.543.94-3.31-.826-2.37-2.37a1.724 1.724 0 00-1.066-2.573c-1.756-.426-1.756-2.924 0-3.35a1.724 1.724 0 001.066-2.573c-.94-1.543.826-3.31 2.37-2.37.996.608 2.296.07 2.572-1.065z" />
      <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M15 12a3 3 0 11-6 0 3 3 0 016 0z" />
    </svg>
  );
}

function ChevronIcon({ className }: { className?: string }) {
  return (
    <svg className={className} fill="none" viewBox="0 0 24 24" stroke="currentColor">
      <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M9 5l7 7-7 7" />
    </svg>
  );
}

function RemotePanelIcon({ className }: { className?: string }) {
  return (
    <svg className={className} fill="none" viewBox="0 0 24 24" stroke="currentColor">
      <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M15 15l-2 5L9 9l11 4-5 2zm0 0l5 5M7.188 2.239l.777 2.897M5.136 7.965l-2.898-.777M13.95 4.05l-2.122 2.122m-5.657 5.656l-2.12 2.122" />
    </svg>
  );
}

function AdminIcon({ className }: { className?: string }) {
  return (
    <svg className={className} fill="none" viewBox="0 0 24 24" stroke="currentColor">
      <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M9 12l2 2 4-4m5.618-4.016A11.955 11.955 0 0112 2.944a11.955 11.955 0 01-8.618 3.04A12.02 12.02 0 003 9c0 5.591 3.824 10.29 9 11.622 5.176-1.332 9-6.03 9-11.622 0-1.042-.133-2.052-.382-3.016z" />
    </svg>
  );
}

function MachineAdminIcon({ className }: { className?: string }) {
  return (
    <svg className={className} fill="none" viewBox="0 0 24 24" stroke="currentColor">
      <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M12 9v3m0 0v3m0-3h3m-3 0H9m12 0a9 9 0 11-18 0 9 9 0 0118 0z" />
    </svg>
  );
}

function TemplateIcon({ className }: { className?: string }) {
  return (
    <svg className={className} fill="none" viewBox="0 0 24 24" stroke="currentColor">
      <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M4 5a1 1 0 011-1h14a1 1 0 011 1v2a1 1 0 01-1 1H5a1 1 0 01-1-1V5zM4 13a1 1 0 011-1h6a1 1 0 011 1v6a1 1 0 01-1 1H5a1 1 0 01-1-1v-6zM16 13a1 1 0 011-1h2a1 1 0 011 1v6a1 1 0 01-1 1h-2a1 1 0 01-1-1v-6z" />
    </svg>
  );
}

function PanelEditorIcon({ className }: { className?: string }) {
  return (
    <svg className={className} fill="none" viewBox="0 0 24 24" stroke="currentColor">
      <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M11 5H6a2 2 0 00-2 2v11a2 2 0 002 2h11a2 2 0 002-2v-5m-1.414-9.414a2 2 0 112.828 2.828L11.828 15H9v-2.828l8.586-8.586z" />
    </svg>
  );
}

function InterlockIcon({ className }: { className?: string }) {
  return (
    <svg className={className} fill="none" viewBox="0 0 24 24" stroke="currentColor">
      <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M12 15v2m-6 4h12a2 2 0 002-2v-6a2 2 0 00-2-2H6a2 2 0 00-2 2v6a2 2 0 002 2zm10-10V7a4 4 0 00-8 0v4h8z" />
    </svg>
  );
}
