import React, { useState } from 'react';
import { NavLink, Outlet } from 'react-router-dom';
import { MessageCircle, Database, ClipboardList, GraduationCap, Sun, Moon, Library, Settings } from 'lucide-react';
import { useTheme } from '../hooks/useTheme';
import SettingsModal from '../pages/SettingsModal';

const Layout: React.FC = () => {
  const { theme, toggleTheme } = useTheme();
  const [showSettings, setShowSettings] = useState(false);

  return (
    <div className="flex h-screen transition-colors duration-200 relative">
      {/* Settings Modal */}
      {showSettings && (
        <SettingsModal theme={theme} onToggleTheme={toggleTheme} onClose={() => setShowSettings(false)} />
      )}

      {/* Sidebar — 毛玻璃浮动 */}
      <aside className="w-60 glass-sidebar border-r border-[var(--border-color)] flex flex-col shrink-0 overflow-y-auto z-10 transition-colors duration-200">
        <div className="p-6 flex items-center gap-3">
          <div className="w-8 h-8 flex items-center justify-center bg-blue-600 rounded-xl shadow-sm">
            <GraduationCap className="w-5 h-5 text-white" />
          </div>
          <h1 className="text-xl font-bold tracking-wide" style={{color:'var(--text-heading)'}}>LearningLab</h1>
        </div>
        
        <nav className="flex-1 px-4 space-y-2 mt-4">
          <NavLink to="/chat" className={({ isActive }) =>
            `flex items-center gap-3 px-3 py-2.5 rounded-xl transition-all duration-200 ${
              isActive ? 'bg-blue-600/10 text-blue-500 font-medium' : 'opacity-70 hover:opacity-100 hover:bg-white/5'
            }`}>
            <MessageCircle className="w-5 h-5" /> 对话
          </NavLink>
          <NavLink to="/knowledge" className={({ isActive }) =>
            `flex items-center gap-3 px-3 py-2.5 rounded-xl transition-all duration-200 ${
              isActive ? 'bg-blue-600/10 text-blue-500 font-medium' : 'opacity-70 hover:opacity-100 hover:bg-white/5'
            }`}>
            <Database className="w-5 h-5" /> 知识库
          </NavLink>
          <NavLink to="/library" className={({ isActive }) =>
            `flex items-center gap-3 px-3 py-2.5 rounded-xl transition-all duration-200 ${
              isActive ? 'bg-purple-600/10 text-purple-400 font-medium' : 'opacity-70 hover:opacity-100 hover:bg-white/5'
            }`}>
            <Library className="w-5 h-5" /> 书库
          </NavLink>
          <NavLink to="/plans" className={({ isActive }) =>
            `flex items-center gap-3 px-3 py-2.5 rounded-xl transition-all duration-200 ${
              isActive ? 'bg-blue-600/10 text-blue-500 font-medium' : 'opacity-70 hover:opacity-100 hover:bg-white/5'
            }`}>
            <ClipboardList className="w-5 h-5" /> 学习计划
          </NavLink>
        </nav>

        <div className="p-4 mt-auto space-y-2">
          <button onClick={toggleTheme}
            className="w-full flex items-center justify-center gap-2 p-2.5 rounded-xl border border-[var(--border-color)] hover:bg-white/5 transition-colors text-sm"
            style={{color:'var(--text-secondary)'}}>
            {theme === 'dark' ? <Sun className="w-4 h-4" /> : <Moon className="w-4 h-4" />}
            {theme === 'dark' ? '浅色模式' : '深色模式'}
          </button>
          <button onClick={() => setShowSettings(true)}
            className="w-full flex items-center justify-center gap-2 p-2.5 rounded-xl border border-[var(--border-color)] hover:bg-white/5 transition-colors text-sm"
            style={{color:'var(--text-secondary)'}}>
            <Settings className="w-4 h-4" /> 设置
          </button>
        </div>
      </aside>

      {/* Main Content — 毛玻璃卡片容器 */}
      <main className="flex-1 flex flex-col min-w-0 p-4 sm:p-6 overflow-hidden">
        <div className="flex-1 glass-card rounded-3xl overflow-hidden flex flex-col">
          <Outlet />
        </div>
      </main>
    </div>
  );
};

export default Layout;