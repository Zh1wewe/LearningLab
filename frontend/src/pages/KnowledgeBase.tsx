import { useState, useRef, useEffect } from 'react';
import {
  Search, DatabaseZap, SearchX, CheckCircle, AlertCircle,
  ShieldCheck, Loader2, Pencil, Trash2, X,
} from 'lucide-react';
import {
  searchKnowledge, addKnowledge, batchVerifyKnowledge,
  deleteKnowledgeChunk, updateKnowledgeChunk,
} from '../api/client';

interface KnowledgeItem {
  id?: string;
  content: string;
  metadata?: Record<string, any>;
  score?: number;
}

export default function KnowledgeBase() {
  const [searchQuery, setSearchQuery] = useState('');
  const [searchResults, setSearchResults] = useState<KnowledgeItem[]>([]);
  const [isSearching, setIsSearching] = useState(false);
  const [hasSearched, setHasSearched] = useState(false);

  const [addText, setAddText] = useState('');
  const [addSource, setAddSource] = useState('');
  const [isAdding, setIsAdding] = useState(false);
  const [isFormOpen, setIsFormOpen] = useState(false);

  const [toast, setToast] = useState<{ msg: string; type: 'success' | 'error' } | null>(null);
  const [isVerifying, setIsVerifying] = useState(false);

  // ---- Detail modal state ----
  const [selectedItem, setSelectedItem] = useState<KnowledgeItem | null>(null);
  const [editText, setEditText] = useState('');
  const [editSource, setEditSource] = useState('');
  const [isSaving, setIsSaving] = useState(false);
  const [isDeleting, setIsDeleting] = useState(false);
  const modalRef = useRef<HTMLDivElement>(null);

  const showToast = (msg: string, type: 'success' | 'error') => {
    setToast({ msg, type });
    setTimeout(() => setToast(null), 3000);
  };

  // ---- Batch verify ----
  const handleBatchVerify = async () => {
    setIsVerifying(true);
    try {
      const result = await batchVerifyKnowledge();
      const msg = `验证完成：共 ${result.total} 条，已验证 ${result.upgraded} 条，已证伪 ${result.downgraded} 条，保持 ${result.kept} 条`;
      showToast(msg, 'success');
    } catch (error) {
      console.error('Batch verify error:', error);
      showToast('批量验证失败，请重试', 'error');
    } finally {
      setIsVerifying(false);
    }
  };

  // ---- Search ----
  const handleSearch = async () => {
    if (!searchQuery.trim()) return;
    setIsSearching(true);
    setHasSearched(true);
    try {
      const results = await searchKnowledge(searchQuery, 10);
      setSearchResults(results);
    } catch (error) {
      console.error('Search error:', error);
      showToast('搜索失败，请重试', 'error');
    } finally {
      setIsSearching(false);
    }
  };

  // ---- Add ----
  const handleAdd = async () => {
    if (!addText.trim()) return;
    setIsAdding(true);
    try {
      const metadata = addSource.trim() ? { source: addSource } : {};
      const res = await addKnowledge(addText, metadata);
      showToast(`添加成功 (${res.chunks_added} 个文本块)`, 'success');
      setAddText('');
      setAddSource('');
      setIsFormOpen(false);
    } catch (error) {
      console.error('Add error:', error);
      showToast('添加失败，请重试', 'error');
    } finally {
      setIsAdding(false);
    }
  };

  // ---- Card click → open modal ----
  const openDetailModal = (item: KnowledgeItem) => {
    setSelectedItem(item);
    setEditText(item.content);
    setEditSource(item.metadata?.source || item.metadata?.source_file || '');
    setIsSaving(false);
    setIsDeleting(false);
  };

  const closeModal = () => {
    setSelectedItem(null);
  };

  // Click outside modal → close
  useEffect(() => {
    const handleClickOutside = (e: MouseEvent) => {
      if (modalRef.current && !modalRef.current.contains(e.target as Node)) {
        closeModal();
      }
    };
    if (selectedItem) {
      document.addEventListener('mousedown', handleClickOutside);
    }
    return () => document.removeEventListener('mousedown', handleClickOutside);
  }, [selectedItem]);

  // ---- Update (save from modal) ----
  const handleUpdate = async () => {
    if (!selectedItem?.id || !editText.trim()) return;
    setIsSaving(true);
    try {
      await updateKnowledgeChunk(
        selectedItem.id,
        editText,
        { source: editSource.trim() || (selectedItem.metadata?.source || '') },
      );
      showToast('更新成功', 'success');
      // Update local search results
      setSearchResults(prev =>
        prev.map(r =>
          r.id === selectedItem.id
            ? { ...r, content: editText, metadata: { ...r.metadata, source: editSource.trim() || r.metadata?.source } }
            : r
        )
      );
      closeModal();
    } catch (error) {
      console.error('Update error:', error);
      showToast('更新失败，请重试', 'error');
    } finally {
      setIsSaving(false);
    }
  };

  // ---- Delete (from modal or card) ----
  const handleDelete = async (item: KnowledgeItem) => {
    if (!item.id) return;
    setIsDeleting(true);
    try {
      await deleteKnowledgeChunk(item.id);
      showToast('删除成功', 'success');
      setSearchResults(prev => prev.filter(r => r.id !== item.id));
      closeModal();
    } catch (error) {
      console.error('Delete error:', error);
      showToast('删除失败，请重试', 'error');
    } finally {
      setIsDeleting(false);
    }
  };

  // ---- Credibility color ----
  const credColor = (cred?: string) => {
    switch (cred) {
      case 'verified':       return 'bg-emerald-500';
      case 'user_submitted': return 'bg-blue-500';
      case 'ai_generated':   return 'bg-orange-500';
      case 'unreliable':     return 'bg-red-500';
      default:               return 'bg-slate-500';
    }
  };

  return (
    <div className="flex flex-col h-full relative overflow-hidden" style={{color: 'var(--text-primary)'}}>

      {/* Toast */}
      {toast && (
        <div className="absolute top-6 left-1/2 -translate-x-1/2 z-50 flex items-center gap-2 px-4 py-3 rounded-xl bg-slate-800 border border-slate-700 shadow-2xl animate-fade-in">
          {toast.type === 'success' ? <CheckCircle className="w-5 h-5 text-emerald-500" /> : <AlertCircle className="w-5 h-5 text-red-500" />}
          <span className="text-sm font-medium text-slate-200">{toast.msg}</span>
        </div>
      )}

      {/* Header */}
      <div className="px-8 py-10 border-b border-[var(--border-color)] glass-header">
        <div className="max-w-3xl mx-auto space-y-6">
          <div className="flex items-center justify-between gap-4">
            <div className="text-left space-y-1">
              <h1 className="text-3xl font-bold text-slate-100 tracking-tight">知识库检索</h1>
              <p className="text-slate-400">检索本地存入的参考文档、学习资料</p>
            </div>
            <button
              onClick={handleBatchVerify}
              disabled={isVerifying}
              className="flex items-center gap-2 px-5 py-2.5 bg-emerald-600 text-white font-medium rounded-xl hover:bg-emerald-500 disabled:opacity-50 transition-all shrink-0 shadow-sm"
            >
              {isVerifying ? <Loader2 className="w-4 h-4 animate-spin" /> : <ShieldCheck className="w-4 h-4" />}
              {isVerifying ? '验证中...' : '批量验证'}
            </button>
          </div>
          <div className="relative group flex">
            <Search className="absolute left-5 top-1/2 -translate-y-1/2 w-5 h-5 text-slate-500 group-focus-within:text-blue-500 transition-colors" />
            <input
              type="text" value={searchQuery} onChange={e => setSearchQuery(e.target.value)}
              onKeyDown={e => e.key === 'Enter' && handleSearch()}
              placeholder="输入关键词进行搜索..."
              className="w-full pl-14 pr-32 py-4 rounded-2xl focus:outline-none focus:ring-2 focus:ring-blue-500/50 focus:border-blue-500 transition-all placeholder-slate-500 shadow-sm glass-input"
            />
            <button
              onClick={handleSearch} disabled={isSearching}
              className="absolute right-2 top-1/2 -translate-y-1/2 px-6 py-2 bg-blue-600 text-white font-medium rounded-xl hover:bg-blue-500 disabled:opacity-50 transition-all"
            >
              {isSearching ? '搜索中...' : '搜索'}
            </button>
          </div>
        </div>
      </div>

      {/* Content */}
      <div className="flex-1 overflow-y-auto px-8 py-8">
        <div className="max-w-5xl mx-auto space-y-8">

          {/* Add Document Panel */}
          <div className="glass-card rounded-2xl overflow-hidden shadow-sm">
            <button
              onClick={() => setIsFormOpen(!isFormOpen)}
              className="w-full flex items-center justify-between p-5 hover:bg-white/5 transition-colors text-left"
            >
              <div className="flex items-center gap-3">
                <DatabaseZap className="w-5 h-5 text-blue-500" />
                <span className="font-semibold text-slate-200">添加本地文档片段</span>
              </div>
              <span className="text-slate-500 text-sm">{isFormOpen ? '收起' : '展开表单'}</span>
            </button>
            {isFormOpen && (
              <div className="p-6 border-t border-slate-800 space-y-5 animate-fade-in bg-slate-900/30">
                <div className="space-y-1.5">
                  <label className="block text-sm font-medium text-slate-300">来源 / 标题</label>
                  <input
                    type="text" value={addSource} onChange={e => setAddSource(e.target.value)}
                    placeholder="输入材料来源 (例如: 高级编程卷1 / PPT笔记)"
                    className="w-full px-4 py-2.5 rounded-xl focus:outline-none focus:ring-2 focus:ring-blue-500/50 focus:border-blue-500 transition-all placeholder-slate-600 resize-y glass-input"
                  />
                </div>
                <div className="space-y-1.5">
                  <label className="block text-sm font-medium text-slate-300">内容</label>
                  <textarea
                    value={addText} onChange={e => setAddText(e.target.value)} rows={6}
                    placeholder="将正文粘贴至此..."
                    className="w-full px-4 py-3 rounded-xl focus:outline-none focus:ring-2 focus:ring-blue-500/50 placeholder-slate-600 resize-y glass-input"
                  />
                </div>
                <div className="flex justify-end">
                  <button
                    onClick={handleAdd} disabled={isAdding || !addText.trim()}
                    className="px-6 py-2.5 bg-slate-800 text-white font-medium rounded-xl hover:bg-slate-700 border border-slate-700 disabled:opacity-50 transition-colors"
                  >
                    {isAdding ? '正在入库...' : '提交入库'}
                  </button>
                </div>
              </div>
            )}
          </div>

          {/* Search Results */}
          <div className="space-y-4">
            {isSearching ? (
              <div className="space-y-4 py-4">
                {[1, 2, 3].map(i => (
                  <div key={i} className="animate-pulse glass-card p-5 rounded-2xl space-y-3">
                    <div className="flex items-center justify-between">
                      <div className="h-4 bg-slate-800 rounded w-1/4" />
                      <div className="h-4 bg-slate-800 rounded w-16" />
                    </div>
                    <div className="h-4 bg-slate-800 rounded w-3/4" />
                    <div className="h-4 bg-slate-800 rounded w-full" />
                    <div className="h-4 bg-slate-800 rounded w-5/6" />
                  </div>
                ))}
              </div>
            ) : hasSearched && searchResults.length === 0 ? (
              <div className="flex flex-col items-center justify-center py-20 text-center animate-fade-in">
                <div className="w-16 h-16 bg-slate-900 rounded-2xl flex items-center justify-center mb-6">
                  <SearchX className="w-8 h-8 text-slate-600" />
                </div>
                <h3 className="text-xl font-bold text-slate-300">暂无文档</h3>
                <p className="mt-2 text-slate-500 max-w-sm">知识库中没有包含这些关键词的文档。请尝试使用其他关键词，或添加入库后再查。</p>
              </div>
            ) : searchResults.length > 0 ? (
              <div className="space-y-5 animate-fade-in">
                {searchResults.map((result, idx) => (
                  <div
                    key={result.id || idx}
                    onClick={() => openDetailModal(result)}
                    className="relative group glass-card p-6 rounded-2xl flex gap-4 hover:border-slate-600 transition-colors shadow-sm cursor-pointer"
                  >
                    {/* Score bar */}
                    <div className="w-1.5 rounded-full bg-slate-800 overflow-hidden flex-shrink-0 h-16 mt-1">
                      <div
                        className={`w-full ${credColor(result.metadata?.credibility)}`}
                        style={{ height: `${Math.max((result.score || 0) * 100, 10)}%` }}
                      />
                    </div>

                    <div className="flex-1 space-y-2 overflow-hidden">
                      <div className="flex justify-between items-start mb-2">
                        <h4 className="text-base font-bold text-slate-200 truncate">
                          {result.metadata?.title || '相关片段'}
                        </h4>
                        <span className="text-xs text-slate-500 font-mono tracking-wider ml-4 shrink-0">
                          SCORE: {result.score?.toFixed(3)}
                        </span>
                      </div>
                      <div className="mb-2">
                        <span className="text-[13px] text-slate-400 px-2 py-1 bg-slate-800 rounded-md select-all">
                          来源: {result.metadata?.source || result.metadata?.source_file || '未知'}
                        </span>
                      </div>
                      <p className="text-slate-400 text-[15px] leading-relaxed line-clamp-4">
                        {result.content}
                      </p>
                    </div>

                    {/* Hover action buttons — top-right corner, hidden until hover */}
                    <div
                      className="absolute top-2 right-2 flex gap-1 opacity-0 group-hover:opacity-100 transition-opacity duration-150 z-10"
                      onClick={e => e.stopPropagation()}
                    >
                      <button
                        onClick={e => { e.stopPropagation(); openDetailModal(result); }}
                        className="p-1.5 rounded-lg bg-slate-800 border border-slate-700 text-slate-400 hover:text-blue-400 hover:border-blue-500/50 transition-colors"
                        title="编辑"
                      >
                        <Pencil className="w-3.5 h-3.5" />
                      </button>
                      <button
                        onClick={e => { e.stopPropagation(); handleDelete(result); }}
                        className="btn-delete"
                        title="删除"
                      >
                        <Trash2 className="w-3.5 h-3.5" />
                      </button>
                    </div>
                  </div>
                ))}
              </div>
            ) : (
              <div className="flex flex-col items-center justify-center py-24 text-center">
                <div className="w-20 h-20 border-2 border-dashed border-slate-800 rounded-3xl flex items-center justify-center mb-6">
                  <Search className="w-8 h-8 text-slate-600 opacity-50" />
                </div>
                <h3 className="text-lg font-medium text-slate-400">试试搜索相关知识</h3>
              </div>
            )}
          </div>
        </div>
      </div>

      {/* ================================================================== */}
      {/* Detail / Edit Modal                                                 */}
      {/* ================================================================== */}
      {selectedItem && (
        <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/60 backdrop-blur-sm animate-fade-in">
          <div
            ref={modalRef}
            className="glass-overlay rounded-3xl shadow-2xl w-full max-w-2xl max-h-[85vh] flex flex-col mx-4 overflow-hidden"
          >
            {/* Modal header */}
            <div className="flex items-center justify-between px-6 py-4 border-b border-[var(--border-color)] bg-[var(--bg-card)] shrink-0">
              <h3 className="text-lg font-bold text-slate-100">知识详情</h3>
              <div className="flex items-center gap-2">
                <button
                  onClick={() => handleDelete(selectedItem)}
                  disabled={isDeleting}
                  className="btn-delete disabled:opacity-50"
                  title="删除"
                >
                  <Trash2 className="w-4 h-4" />
                </button>
                <button
                  onClick={closeModal}
                  className="p-2 rounded-xl text-slate-400 hover:text-slate-200 hover:bg-slate-800 transition-colors"
                  title="关闭"
                >
                  <X className="w-5 h-5" />
                </button>
              </div>
            </div>

            {/* Modal body */}
            <div className="flex-1 overflow-y-auto px-6 py-5 space-y-5">
              {/* Credibility badge */}
              <div className="flex items-center gap-2">
                <span className="text-xs font-bold text-slate-400 uppercase tracking-wider">可信度</span>
                <span className={`px-2.5 py-0.5 rounded-full text-xs font-semibold ${
                  selectedItem.metadata?.credibility === 'verified'       ? 'bg-emerald-500/20 text-emerald-400' :
                  selectedItem.metadata?.credibility === 'user_submitted' ? 'bg-blue-500/20 text-blue-400' :
                  selectedItem.metadata?.credibility === 'ai_generated'   ? 'bg-orange-500/20 text-orange-400' :
                  selectedItem.metadata?.credibility === 'unreliable'     ? 'bg-red-500/20 text-red-400' :
                  'bg-slate-800 text-slate-400'
                }`}>
                  {selectedItem.metadata?.credibility || 'ai_generated'}
                </span>
                {selectedItem.score != null && (
                  <span className="text-xs text-slate-500 ml-auto font-mono">SCORE: {selectedItem.score.toFixed(3)}</span>
                )}
              </div>

              {/* Source */}
              <div className="space-y-1.5">
                <label className="block text-sm font-medium text-slate-400">来源</label>
                <input
                  type="text" value={editSource}
                  onChange={e => setEditSource(e.target.value)}
                  placeholder="输入来源..."
                  className="w-full px-4 py-2.5 rounded-xl focus:outline-none focus:ring-2 focus:ring-blue-500/50 placeholder-slate-600 glass-input"
                />
              </div>

              {/* Content */}
              <div className="space-y-1.5">
                <label className="block text-sm font-medium text-slate-400">内容</label>
                <textarea
                  value={editText} onChange={e => setEditText(e.target.value)}
                  rows={10}
                  className="w-full px-4 py-3 rounded-xl focus:outline-none focus:ring-2 focus:ring-blue-500/50 placeholder-slate-600 resize-y font-mono text-sm leading-relaxed glass-input"
                />
              </div>
            </div>

            {/* Modal footer */}
            <div className="flex justify-end gap-3 px-6 py-4 border-t border-[var(--border-color)] bg-[var(--bg-card)] shrink-0">
              <button
                onClick={closeModal}
                className="px-5 py-2.5 rounded-xl text-sm font-medium text-slate-300 hover:bg-slate-800 border border-slate-700 transition-colors"
              >
                取消
              </button>
              <button
                onClick={handleUpdate}
                disabled={isSaving || !editText.trim()}
                className="px-5 py-2.5 rounded-xl text-sm font-medium bg-blue-600 text-white hover:bg-blue-500 disabled:opacity-50 transition-colors shadow-sm"
              >
                {isSaving ? '保存中...' : '保存修改'}
              </button>
            </div>
          </div>
        </div>
      )}
    </div>
  );
}