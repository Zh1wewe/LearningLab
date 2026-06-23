import { useEffect, useState, useRef } from 'react';
import {
  Library, Upload, FileText, Trash2, Clock, CheckCircle, AlertCircle,
} from 'lucide-react';
import { getDocuments, uploadKnowledgeFile, deleteDocumentRecord } from '../api/client';

interface DocRecord {
  id: number;
  title: string;
  source: string;
  file_path: string;
  chunk_count: number;
  created_at: string | null;
}

export default function DocumentLibrary() {
  const [docs, setDocs] = useState<DocRecord[]>([]);
  const [isLoading, setIsLoading] = useState(true);
  const [isUploading, setIsUploading] = useState(false);
  const [toast, setToast] = useState<{ msg: string; type: 'success' | 'error' } | null>(null);
  const fileInputRef = useRef<HTMLInputElement>(null);

  const showToast = (msg: string, type: 'success' | 'error') => {
    setToast({ msg, type });
    setTimeout(() => setToast(null), 3000);
  };

  const fetchDocs = async () => {
    try {
      const data = await getDocuments();
      setDocs(data || []);
    } catch (err) {
      console.error('Failed to load documents:', err);
    } finally {
      setIsLoading(false);
    }
  };

  useEffect(() => { fetchDocs(); }, []);

  const handleFileUpload = async (e: React.ChangeEvent<HTMLInputElement>) => {
    const file = e.target.files?.[0];
    if (!file) return;
    setIsUploading(true);
    try {
      const result = await uploadKnowledgeFile(file);
      showToast(`导入成功: ${result.file_name} (${result.chunks_added} 片段)`, 'success');
      fetchDocs();
    } catch (err: any) {
      const msg = err?.response?.data?.detail || err?.message || '上传失败';
      showToast(msg, 'error');
    } finally {
      setIsUploading(false);
      if (fileInputRef.current) fileInputRef.current.value = '';
    }
  };

  const handleDelete = async (doc: DocRecord) => {
    try {
      await deleteDocumentRecord(doc.id);
      showToast('删除成功', 'success');
      setDocs(prev => prev.filter(d => d.id !== doc.id));
    } catch (err) {
      showToast('删除失败', 'error');
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
        <div className="max-w-5xl mx-auto flex items-center justify-between gap-4">
          <div className="space-y-1">
            <h1 className="text-3xl font-bold text-slate-100 tracking-tight flex items-center gap-3">
              <Library className="w-8 h-8 text-purple-400" />
              书库
            </h1>
            <p className="text-slate-400">管理已入库的文档资料</p>
          </div>
          <label className="flex items-center gap-2 px-5 py-2.5 bg-purple-600 text-white font-medium rounded-xl hover:bg-purple-500 disabled:opacity-50 transition-all shrink-0 shadow-sm cursor-pointer">
            {isUploading ? (
              <span className="inline-block w-4 h-4 border-2 border-white/50 border-t-white rounded-full animate-spin" />
            ) : (
              <Upload className="w-4 h-4" />
            )}
            {isUploading ? '导入中...' : '上传文档'}
            <input
              ref={fileInputRef}
              type="file"
              accept=".txt,.md,.pdf"
              onChange={handleFileUpload}
              disabled={isUploading}
              className="hidden"
            />
          </label>
        </div>
      </div>

      {/* Document List */}
      <div className="flex-1 overflow-y-auto px-8 py-8">
        <div className="max-w-5xl mx-auto">
          {isLoading ? (
            <div className="space-y-4">
              {[1,2,3].map(i => (
                <div key={i} className="animate-pulse glass-card rounded-2xl h-24" />
              ))}
            </div>
          ) : docs.length === 0 ? (
            <div className="flex flex-col items-center justify-center py-20 glass-card border-dashed rounded-3xl animate-fade-in">
              <Library className="w-16 h-16 text-slate-700 mb-6" />
              <h3 className="text-xl font-bold text-slate-300">书库为空</h3>
              <p className="mt-2 text-slate-500 max-w-sm text-center">
                点击"上传文档"导入 .txt / .md / .pdf 文件
              </p>
            </div>
          ) : (
            <div className="space-y-4 animate-fade-in">
              {docs.map(doc => (
                <div
                  key={doc.id}
                  onClick={() => {
                    if (doc.file_path) {
                      window.open(`/api/knowledge/file/${encodeURIComponent(doc.file_path)}`, '_blank');
                    }
                  }}
                  className="relative group glass-card rounded-2xl p-5 flex items-center gap-4 hover:border-blue-500/50 transition-colors shadow-sm cursor-pointer"
                >
                  {/* Icon */}
                  <div className="w-12 h-12 rounded-xl bg-purple-500/10 border border-purple-500/20 flex items-center justify-center shrink-0">
                    <FileText className="w-6 h-6 text-purple-400" />
                  </div>

                  {/* Info */}
                  <div className="flex-1 min-w-0">
                    <h3 className="text-base font-bold text-slate-200 truncate">{doc.title}</h3>
                    <div className="flex items-center gap-3 mt-1.5 text-xs text-slate-500">
                      <span>来源: {doc.source || '未知'}</span>
                      <span>·</span>
                      <span>{doc.chunk_count} 个片段</span>
                      {doc.created_at && (
                        <>
                          <span>·</span>
                          <span className="flex items-center gap-1"><Clock className="w-3 h-3" />{new Date(doc.created_at).toLocaleDateString()}</span>
                        </>
                      )}
                    </div>
                  </div>

                  {/* Hover delete button */}
                  <div
                    className="flex gap-1 opacity-0 group-hover:opacity-100 transition-opacity duration-150 shrink-0"
                    onClick={e => e.stopPropagation()}
                  >
                    <button
                      onClick={() => handleDelete(doc)}
                      className="btn-delete"
                      title="删除文档"
                    >
                      <Trash2 className="w-4 h-4" />
                    </button>
                  </div>
                </div>
              ))}
            </div>
          )}
        </div>
      </div>
    </div>
  );
}