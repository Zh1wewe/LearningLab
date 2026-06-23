import { useState, useRef, useEffect, KeyboardEvent, DragEvent, ClipboardEvent, memo } from 'react';
import ReactMarkdown from 'react-markdown';
import remarkMath from 'remark-math';
import rehypeKatex from 'rehype-katex';
import remarkGfm from 'remark-gfm';
import {
  Send, Bot, GraduationCap, MessageSquare, Plus, Trash2, Menu, X,
  Globe, Paperclip, FileText,
} from 'lucide-react';
import {
  streamChat, Message, getConversations, getConversation, deleteConversation,
  uploadKnowledgeFile, getModels,
} from '../api/client';

const ALLOWED_FILE_TYPES = ['.txt', '.md', '.pdf'];
const ALLOWED_IMAGE_TYPES = ['.jpg', '.jpeg', '.png', '.gif', '.bmp', '.webp'];
const INPUT_MAX_HEIGHT = 200;

const MessageBubble = memo(({ msg, isStreaming, isLast }: { msg: Message; isStreaming: boolean; isLast: boolean }) => (
  <div className={`flex gap-4 ${msg.role === 'user' ? 'flex-row-reverse' : 'flex-row'}`}>
    <div className={`w-10 h-10 rounded-full flex flex-shrink-0 items-center justify-center shadow-sm ${
      msg.role === 'user' ? 'bg-slate-200 dark:bg-slate-700 text-slate-700 dark:text-slate-300 font-bold' : 'bg-white dark:bg-slate-800 border border-slate-200 dark:border-slate-700 text-blue-600 dark:text-blue-400'
    }`}>
      {msg.role === 'user' ? 'U' : <Bot className="w-5 h-5" />}
    </div>
    <div className={`max-w-[85%] rounded-2xl px-5 py-3.5 shadow-sm text-[15px] leading-relaxed ${
      msg.role === 'user' ? 'bg-blue-600 text-white font-medium rounded-tr-sm' : 'bg-white dark:bg-slate-800 border border-slate-200 dark:border-slate-700 text-slate-800 dark:text-slate-200 rounded-tl-sm'
    }`}>
      {msg.role === 'assistant' ? (
        <div className="prose prose-slate dark:prose-invert prose-blue max-w-none prose-p:leading-relaxed prose-pre:bg-slate-50 dark:prose-pre:bg-slate-900 prose-pre:border prose-pre:border-slate-200 dark:prose-pre:border-slate-700">
          <ReactMarkdown remarkPlugins={[remarkMath, remarkGfm]} rehypePlugins={[rehypeKatex]}>{msg.content}</ReactMarkdown>
          {isStreaming && isLast && <span className="inline-block w-1.5 h-4 ml-1 bg-slate-400 animate-pulse align-middle" />}
        </div>
      ) : (
        <div className="whitespace-pre-wrap leading-relaxed">{msg.content}</div>
      )}
    </div>
  </div>
));
MessageBubble.displayName = 'MessageBubble';

export default function Chat() {
  const [messages, setMessages] = useState<Message[]>([]);
  const [input, setInput] = useState('');
  const [isStreaming, setIsStreaming] = useState(false);
  const [conversations, setConversations] = useState<any[]>([]);
  const [currentConversationId, setCurrentConversationId] = useState<number | null>(null);
  const [isSidebarOpen, setIsSidebarOpen] = useState(true);
  const [isComposing, setIsComposing] = useState(false);
  const [forceSearch, setForceSearch] = useState(() => localStorage.getItem('forceSearch') === 'true');
  const [isDragOver, setIsDragOver] = useState(false);
  const [isUploading, setIsUploading] = useState(false);
  const [toast, setToast] = useState('');
  const [attachedImages, setAttachedImages] = useState<{ id: string; url: string }[]>([]);
  const [modelList, setModelList] = useState<{ id: number; name: string; model_id: string }[]>([]);
  const [currentModel, setCurrentModel] = useState(() => (import.meta as any).env.VITE_DEFAULT_MODEL || 'deepseek-chat');
  const [showPromptEditor, setShowPromptEditor] = useState(false);
  const [systemPrompt, setSystemPrompt] = useState('');
  const messagesEndRef = useRef<HTMLDivElement>(null);
  const textareaRef = useRef<HTMLTextAreaElement>(null);
  const fileInputRef = useRef<HTMLInputElement>(null);

  useEffect(() => { localStorage.setItem('forceSearch', String(forceSearch)); }, [forceSearch]);
  useEffect(() => { getModels().then(setModelList).catch(() => {}); }, []);

  const adjustHeight = () => {
    const el = textareaRef.current;
    if (!el) return;
    el.style.height = 'auto';
    el.style.height = Math.min(el.scrollHeight, INPUT_MAX_HEIGHT) + 'px';
  };
  useEffect(() => { adjustHeight(); }, [input]);

  useEffect(() => { loadConversations(); }, []);
  const loadConversations = async () => { try { setConversations(await getConversations() || []); } catch {} };
  const loadConversationMessages = async (id: number) => {
    try {
      const msgs = await getConversation(id);
      setMessages(msgs.map((m: any) => ({ ...m, id: m.id || crypto.randomUUID() })));
      setCurrentConversationId(id);
      requestAnimationFrame(() => scrollToBottom());
    } catch {}
  };
  const handleNewConversation = () => { setCurrentConversationId(null); setMessages([]); };
  const handleDeleteConversation = async (id: number, e: React.MouseEvent) => {
    e.stopPropagation();
    try { await deleteConversation(id); if (currentConversationId === id) handleNewConversation(); loadConversations(); } catch {}
  };

  const scrollToBottom = () => {
    const anchor = messagesEndRef.current;
    if (!anchor) return;
    const c = anchor.parentElement?.parentElement;
    if (c) c.scrollTop = c.scrollHeight;
  };
  useEffect(() => {
    if (isStreaming) { scrollToBottom(); }
    else { const raf = requestAnimationFrame(scrollToBottom); return () => cancelAnimationFrame(raf); }
  }, [messages, isStreaming]);

  const showToast = (msg: string) => { setToast(msg); setTimeout(() => setToast(''), 3000); };

  const handleFileUpload = async (file: File) => {
    const ext = '.' + file.name.split('.').pop()?.toLowerCase();
    if (!ALLOWED_FILE_TYPES.includes(ext) && !ALLOWED_IMAGE_TYPES.includes(ext)) { showToast(`不支持的类型: ${ext}`); return; }
    if (ALLOWED_IMAGE_TYPES.includes(ext)) {
      const reader = new FileReader();
      reader.onload = () => setAttachedImages(prev => [...prev, { id: crypto.randomUUID(), url: reader.result as string }]);
      reader.readAsDataURL(file);
      return;
    }
    setIsUploading(true);
    try { const r = await uploadKnowledgeFile(file); showToast(`已导入: ${r.file_name} (${r.chunks_added} 片段)`); }
    catch (err: any) { showToast('导入失败: ' + (err?.response?.data?.detail || err?.message || '')); }
    finally { setIsUploading(false); }
  };

  const removeImage = (id: string) => setAttachedImages(prev => prev.filter(img => img.id !== id));
  const handleFileSelect = (e: React.ChangeEvent<HTMLInputElement>) => {
    if (e.target.files?.[0]) handleFileUpload(e.target.files[0]);
    if (fileInputRef.current) fileInputRef.current.value = '';
  };

  const handleDragOver = (e: DragEvent) => { e.preventDefault(); setIsDragOver(true); };
  const handleDragLeave = () => setIsDragOver(false);
  const handleDrop = (e: DragEvent) => { e.preventDefault(); setIsDragOver(false); if (e.dataTransfer.files?.[0]) handleFileUpload(e.dataTransfer.files[0]); };

  const handlePaste = (e: ClipboardEvent<HTMLTextAreaElement>) => {
    const items = e.clipboardData?.items;
    if (!items) return;
    for (const item of Array.from(items)) {
      if (item.kind === 'file') { const f = item.getAsFile(); if (f) { e.preventDefault(); handleFileUpload(f); return; } }
    }
  };

  const handleSubmit = async (msg: string) => {
    if (!msg || isStreaming) return;
    setInput(''); setIsStreaming(true);
    const userMsg: Message = { id: crypto.randomUUID(), role: 'user', content: msg };
    const placeholder: Message = { id: crypto.randomUUID(), role: 'assistant', content: '' };
    const newMessages: Message[] = [...messages.map(m => ({ ...m })), userMsg];
    setMessages(newMessages);
    setMessages(prev => [...prev, placeholder]);
    let content = '', convId = currentConversationId;
    let refreshTimer: ReturnType<typeof setInterval> | null = null;
    try {
      refreshTimer = setInterval(() => setMessages(prev => [...prev]), 200);
      await streamChat(JSON.parse(JSON.stringify(newMessages)), currentModel, (chunk) => {
        let c = chunk;
        const m = c.match(/\[CONV_ID:(\d+)\]/);
        if (m) { if (!convId) { convId = parseInt(m[1], 10); setCurrentConversationId(convId); setTimeout(loadConversations, 1000); } c = c.replace(/\[CONV_ID:\d+\]/, ''); }
        content += c;
        setMessages(prev => { const u = [...prev]; u[u.length - 1] = { role: 'assistant', content }; return u; });
      }, convId?.toString(), forceSearch).finished;
      if (refreshTimer) clearInterval(refreshTimer);
    } catch {
      if (refreshTimer) clearInterval(refreshTimer);
      setMessages(prev => { const u = [...prev]; u[u.length - 1] = { role: 'assistant', content: content + '\n\n**[Error]**' }; return u; });
    } finally {
      setIsStreaming(false);
      setMessages(prev => [...prev]);
      setTimeout(() => scrollToBottom(), 50);
      loadConversations();
    }
  };

  const handleKeyDown = (e: KeyboardEvent<HTMLTextAreaElement>) => {
    if (e.key === 'Enter' && !e.shiftKey && !isComposing) {
      e.preventDefault();
      const v = textareaRef.current?.value.trim();
      if (v && !isStreaming) handleSubmit(v);
    }
  };
  const handleClickSend = () => { const v = textareaRef.current?.value.trim(); if (v && !isStreaming) handleSubmit(v); };

  return (
    <div className="flex flex-row h-full w-full text-slate-800 dark:text-slate-200 transition-colors duration-200 relative overflow-hidden">
      {toast && <div className="absolute top-4 left-1/2 -translate-x-1/2 z-50 px-4 py-2 rounded-xl glass text-sm text-slate-200 animate-fade-in">{toast}</div>}

      <div className={`shrink-0 flex flex-col glass-sidebar border-r border-[var(--border-color)] transition-all duration-300 ${isSidebarOpen ? 'w-64' : 'w-0 border-r-0'}`}>
        <div className="p-4 border-b border-slate-200 dark:border-slate-800 flex justify-between items-center whitespace-nowrap overflow-hidden">
          <span className="font-bold text-slate-700 dark:text-slate-200 truncate">对话历史</span>
          <button onClick={() => setIsSidebarOpen(false)} className="p-1 hover:bg-slate-100 dark:hover:bg-slate-800 rounded-md text-slate-500 hover:text-slate-700 dark:text-slate-400 dark:hover:text-slate-200"><X className="w-4 h-4" /></button>
        </div>
        <div className="p-3">
          <button onClick={handleNewConversation} className="w-full flex items-center justify-center gap-2 p-2 bg-blue-600 hover:bg-blue-700 text-white rounded-lg transition-colors shadow-sm text-sm font-medium"><Plus className="w-4 h-4" /> 新对话</button>
        </div>
        <div className="flex-1 overflow-y-auto p-3 space-y-2">
          {conversations.map(conv => (
            <div key={conv.id} onClick={() => loadConversationMessages(conv.id)} className={`group flex items-center justify-between p-3 rounded-lg cursor-pointer transition-all border ${currentConversationId === conv.id ? 'bg-blue-50 dark:bg-blue-900/20 border-blue-200 dark:border-blue-800/50' : 'bg-white dark:bg-slate-800/50 border-transparent hover:border-slate-200 dark:hover:border-slate-700 hover:bg-slate-50 dark:hover:bg-slate-800'}`}>
              <div className="flex items-start gap-3 overflow-hidden">
                <MessageSquare className={`w-4 h-4 shrink-0 mt-0.5 ${currentConversationId === conv.id ? 'text-blue-500' : 'text-slate-400'}`} />
                <div className="flex flex-col overflow-hidden">
                  <span className={`text-sm truncate font-medium ${currentConversationId === conv.id ? 'text-blue-700 dark:text-blue-300' : 'text-slate-700 dark:text-slate-300'}`}>{conv.title}</span>
                  <span className="text-[11px] text-slate-400 mt-1">{new Date(conv.created_at).toLocaleDateString()}</span>
                </div>
              </div>
              <button onClick={e => handleDeleteConversation(conv.id, e)} className="opacity-0 group-hover:opacity-100 btn-delete transition-all shrink-0" title="删除"><Trash2 className="w-3.5 h-3.5" /></button>
            </div>
          ))}
          {conversations.length === 0 && <div className="text-center p-4 text-sm text-slate-400">暂无对话记录</div>}
        </div>
      </div>

      <div className="flex-1 flex flex-col min-w-0 relative">
        <div className="glass-header px-4 sm:px-6 py-4 border-b border-[var(--border-color)] flex items-center shrink-0 z-10">
          <div className="flex items-center gap-3">
            {!isSidebarOpen && <button onClick={() => setIsSidebarOpen(true)} className="p-1.5 hover:bg-slate-100 dark:hover:bg-slate-800 rounded-lg text-slate-500 dark:text-slate-400 hover:text-slate-700 dark:hover:text-slate-200 transition-colors"><Menu className="w-5 h-5" /></button>}
            <span className="text-lg font-bold text-slate-800 dark:text-slate-100">AI 学习助手</span>
          </div>
          <div className="ml-auto flex items-center gap-2">
            <button onClick={() => setShowPromptEditor(!showPromptEditor)}
              className={`p-1.5 rounded-lg transition-colors ${showPromptEditor ? 'bg-blue-600/20 text-blue-400' : 'text-slate-400 hover:text-slate-200 hover:bg-white/5'}`}
              title="自定义提示词">
              <FileText className="w-4 h-4" />
            </button>
            <select value={currentModel} onChange={e => setCurrentModel(e.target.value)}
              className="text-xs rounded-full px-3 py-1.5"
              style={{background:'var(--bg-input)', borderColor:'var(--border-color)', color:'var(--text-primary)'}}>
              {modelList.length === 0 && <option value={currentModel}>{currentModel}</option>}
              {modelList.map(m => <option key={m.id} value={m.model_id}>{m.name}</option>)}
            </select>
          </div>
        </div>

        {showPromptEditor && (
          <div className="glass-overlay px-4 sm:px-6 py-4 border-b border-[var(--border-color)]">
            <div className="max-w-2xl">
              <label className="block text-xs font-medium mb-2" style={{color:'var(--text-secondary)'}}>自定义系统提示词</label>
              <textarea value={systemPrompt} onChange={e => setSystemPrompt(e.target.value)} rows={3}
                placeholder="输入自定义提示词，留空则使用默认"
                className="w-full px-4 py-2.5 rounded-xl border border-[var(--border-color)] text-sm resize-none focus:outline-none focus:ring-2 focus:ring-blue-500/50"
                style={{background:'var(--bg-input)', color:'var(--text-primary)'}} />
              <div className="flex justify-end gap-2 mt-2">
                <button onClick={() => { setSystemPrompt(''); setShowPromptEditor(false); }}
                  className="px-3 py-1.5 rounded-lg text-xs border border-[var(--border-color)] hover:bg-white/5 transition-colors"
                  style={{color:'var(--text-secondary)'}}>恢复默认</button>
              </div>
            </div>
          </div>
        )}

        <div className="flex-1 overflow-y-auto px-4 py-8">
          <div className="max-w-4xl mx-auto space-y-8">
            {messages.length === 0 ? (
              <div className="flex flex-col items-center justify-center min-h-[50vh] text-center space-y-6 animate-fade-in mt-10">
                <div className="w-16 h-16 bg-blue-600 rounded-2xl flex items-center justify-center shadow-lg shadow-blue-500/20"><GraduationCap className="w-10 h-10 text-white" /></div>
                <div className="space-y-2"><h2 className="text-3xl font-bold text-slate-800 dark:text-slate-100 tracking-tight">开始新的学习探索</h2><p className="text-slate-500 dark:text-slate-400 text-lg">在下方输入你想了解的主题</p></div>
              </div>
            ) : messages.map((msg, idx) => (
              <MessageBubble key={msg.id ?? idx} msg={msg} isStreaming={isStreaming} isLast={idx === messages.length - 1} />
            ))}
            <div ref={messagesEndRef} className="h-4" />
          </div>
        </div>

        {attachedImages.length > 0 && (
          <div className="px-4 pb-2">
            <div className="max-w-4xl mx-auto flex flex-wrap gap-2">
              {attachedImages.map(img => (
                <div key={img.id} className="relative group shrink-0">
                  <img src={img.url} alt="attached" className="w-16 h-16 object-cover rounded-2xl border-2 border-blue-500/30 shadow-sm" />
                  <button onClick={() => removeImage(img.id)} className="absolute -top-1.5 -right-1.5 w-5 h-5 rounded-full bg-red-500/90 text-white flex items-center justify-center opacity-0 group-hover:opacity-100 transition-opacity"><X className="w-3 h-3" /></button>
                </div>
              ))}
            </div>
          </div>
        )}

        <div className={`px-4 pb-4 pt-2 transition-colors ${isDragOver ? 'bg-blue-900/20' : ''}`} onDragOver={handleDragOver} onDragLeave={handleDragLeave} onDrop={handleDrop}>
          <div className="max-w-4xl mx-auto relative">
            <textarea ref={textareaRef} autoComplete="off" autoCorrect="off" spellCheck="false" data-gramm="false"
              value={input} onChange={e => { setInput(e.target.value); }}
              onKeyDown={handleKeyDown}
              onCompositionStart={() => setIsComposing(true)}
              onCompositionEnd={() => { setIsComposing(false); setTimeout(() => { if (textareaRef.current) setInput(textareaRef.current.value); }, 0); }}
              onPaste={handlePaste}
              placeholder={isStreaming ? '正在回复中...' : "在这里输入你想学习的内容... (Enter 发送，Shift+Enter 换行)"}
              disabled={isStreaming} rows={1}
              className="w-full px-5 sm:px-6 py-3 sm:py-4 pr-14 sm:pr-16 bg-white/80 dark:bg-slate-800/80 border border-slate-200 dark:border-slate-700 rounded-2xl resize-none focus:outline-none focus:ring-2 focus:ring-blue-500/50 focus:border-blue-500 transition-all text-slate-800 dark:text-slate-200 placeholder-slate-400 dark:placeholder-slate-500 shadow-sm backdrop-blur-sm dark:shadow-black/20 text-sm sm:text-base leading-relaxed"
              style={{ maxHeight: INPUT_MAX_HEIGHT + 'px' }} />
            <button onClick={handleClickSend} disabled={isStreaming || !input.trim()}
              className="absolute right-2 sm:right-3 bottom-2 sm:bottom-3 p-2 sm:p-2.5 bg-blue-600 text-white rounded-xl hover:bg-blue-500 disabled:opacity-50 disabled:bg-slate-300 dark:disabled:bg-slate-700 transition-colors shadow-sm">
              {isStreaming ? (
                <div className="w-4 h-4 sm:w-5 sm:h-5 flex items-center justify-center space-x-0.5">
                  <div className="w-1 h-1 sm:w-1.5 sm:h-1.5 bg-white rounded-full animate-bounce" style={{ animationDelay: '0ms' }} />
                  <div className="w-1 h-1 sm:w-1.5 sm:h-1.5 bg-white rounded-full animate-bounce" style={{ animationDelay: '150ms' }} />
                  <div className="w-1 h-1 sm:w-1.5 sm:h-1.5 bg-white rounded-full animate-bounce" style={{ animationDelay: '300ms' }} />
                </div>
              ) : <Send className="w-4 h-4 sm:w-5 sm:h-5" />}
            </button>
          </div>

          <div className="max-w-4xl mx-auto flex items-center gap-2 mt-2">
            <button onClick={() => fileInputRef.current?.click()} disabled={isUploading}
              className="flex items-center gap-1.5 px-3 py-1.5 rounded-full bg-slate-100 dark:bg-slate-800/80 border border-slate-200 dark:border-slate-700 text-xs text-slate-500 dark:text-slate-400 hover:text-blue-500 dark:hover:text-blue-400 hover:border-blue-500/50 dark:hover:border-blue-500/50 transition-colors">
              {isUploading ? <span className="inline-block w-3 h-3 border-2 border-blue-400/50 border-t-blue-400 rounded-full animate-spin" /> : <Paperclip className="w-3.5 h-3.5" />}
              <span>{isUploading ? '导入中...' : '文件'}</span>
            </button>
            <button onClick={() => setForceSearch(!forceSearch)}
              className={`flex items-center gap-1.5 px-3 py-1.5 rounded-full text-xs font-medium transition-colors ${forceSearch ? 'bg-blue-600 text-white border border-blue-500' : 'bg-slate-100 dark:bg-slate-800/80 border border-slate-200 dark:border-slate-700 text-slate-500 dark:text-slate-400 hover:text-blue-500 dark:hover:text-blue-400 hover:border-blue-500/50 dark:hover:border-blue-500/50'}`}>
              <Globe className="w-3.5 h-3.5" /><span>联网搜索</span>
            </button>
            <input ref={fileInputRef} type="file" accept=".txt,.md,.pdf,.jpg,.jpeg,.png,.gif,.bmp,.webp" onChange={handleFileSelect} className="hidden" />
            {isDragOver && <span className="text-xs text-blue-400 ml-2 animate-fade-in">释放以导入文件</span>}
          </div>
        </div>
      </div>
    </div>
  );
}