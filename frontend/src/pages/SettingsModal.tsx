import { useState, useRef, useEffect } from 'react';
import { X, Sun, Moon, Upload, Eye, EyeOff, Loader2, CheckCircle, AlertCircle, Trash2 } from 'lucide-react';
import { getModels, createModel, updateModel, deleteModel, testModelConnection } from '../api/client';

interface Props {
  theme: 'light' | 'dark';
  onToggleTheme: () => void;
  onClose: () => void;
}

type TabKey = 'theme' | 'glass' | 'background' | 'models';

export default function SettingsModal({ theme, onToggleTheme, onClose }: Props) {
  const modalRef = useRef<HTMLDivElement>(null);
  const [activeTab, setActiveTab] = useState<TabKey>('theme');

  const [bgImage, setBgImage] = useState<string | null>(() => localStorage.getItem('bgImage') || null);
  const [bgMode, setBgMode] = useState<string>(() => localStorage.getItem('bgMode') || 'fill');
  const [glassBlur, setGlassBlur] = useState<number>(() => {
    const saved = localStorage.getItem('glassBlur');
    return saved ? parseInt(saved) : 16;
  });

  interface ModelRecord { id: number; name: string; model_id: string; base_url: string; api_key: string; is_default: boolean; }
  const [models, setModels] = useState<ModelRecord[]>([]);
  const [editingModel, setEditingModel] = useState<ModelRecord | null>(null);
  const [showKey, setShowKey] = useState(false);
  const [testResult, setTestResult] = useState<{ passed: boolean; message: string } | null>(null);
  const [testing, setTesting] = useState(false);
  const [formName, setFormName] = useState('');
  const [formModelId, setFormModelId] = useState('');
  const [formBaseUrl, setFormBaseUrl] = useState('');
  const [formApiKey, setFormApiKey] = useState('');
  const [formIsDefault, setFormIsDefault] = useState(false);

  const fetchModels = async () => { try { setModels(await getModels()); } catch {} };

  useEffect(() => {
    const handler = (e: MouseEvent) => { if (modalRef.current && !modalRef.current.contains(e.target as Node)) onClose(); };
    document.addEventListener('mousedown', handler);
    return () => document.removeEventListener('mousedown', handler);
  }, [onClose]);

  useEffect(() => { applyGlass(glassBlur); }, []);
  const applyGlass = (blur: number) => {
    document.documentElement.style.setProperty('--glass-blur', `${blur}px`);
    if (blur > 0) document.body.classList.add('glass-active'); else document.body.classList.remove('glass-active');
    localStorage.setItem('glassBlur', String(blur));
  };

  const applyBg = (url: string | null, mode: string) => {
    const el = document.body;
    if (!url) { el.style.backgroundImage = ''; el.style.backgroundSize = ''; el.style.backgroundRepeat = ''; el.style.backgroundPosition = ''; return; }
    el.style.backgroundImage = `url(${url})`; el.style.backgroundPosition = 'center';
    switch (mode) {
      case 'fill': el.style.backgroundSize = 'cover'; el.style.backgroundRepeat = 'no-repeat'; break;
      case 'fit': el.style.backgroundSize = 'contain'; el.style.backgroundRepeat = 'no-repeat'; break;
      case 'stretch': el.style.backgroundSize = '100% 100%'; el.style.backgroundRepeat = 'no-repeat'; break;
      case 'tile': el.style.backgroundSize = 'auto'; el.style.backgroundRepeat = 'repeat'; break;
    }
  };
  const handleBgUpload = (e: React.ChangeEvent<HTMLInputElement>) => {
    const file = e.target.files?.[0]; if (!file) return;
    const reader = new FileReader();
    reader.onload = () => { const u = reader.result as string; setBgImage(u); localStorage.setItem('bgImage', u); applyBg(u, bgMode); };
    reader.readAsDataURL(file);
  };
  const handleBgModeChange = (mode: string) => { setBgMode(mode); localStorage.setItem('bgMode', mode); applyBg(bgImage, mode); };
  const handleClearBg = () => { setBgImage(null); localStorage.removeItem('bgImage'); applyBg(null, bgMode); };

  const resetForm = (m?: ModelRecord) => {
    setFormName(m?.name || ''); setFormModelId(m?.model_id || ''); setFormBaseUrl(m?.base_url || '');
    setFormApiKey(m?.api_key || ''); setFormIsDefault(m?.is_default || false);
    setEditingModel(m || null); setShowKey(false); setTestResult(null);
  };

  const handleSaveModel = async () => {
    if (!formName || !formModelId || !formBaseUrl || !formApiKey) return;
    try {
      if (editingModel) await updateModel(editingModel.id, { name: formName, model_id: formModelId, base_url: formBaseUrl, api_key: formApiKey, is_default: formIsDefault });
      else await createModel({ name: formName, model_id: formModelId, base_url: formBaseUrl, api_key: formApiKey, is_default: formIsDefault });
      resetForm(); fetchModels();
    } catch {}
  };

  const handleDeleteModel = async (id: number) => { try { await deleteModel(id); fetchModels(); if (editingModel?.id === id) resetForm(); } catch {} };

  const handleTestConnection = async () => {
    setTesting(true); setTestResult(null);
    try {
      const res = await testModelConnection({ base_url: formBaseUrl, api_key: formApiKey, model_id: formModelId });
      setTestResult({ passed: res.status === 'ok', message: res.status === 'ok' ? `连接成功 (${res.latency_ms}ms)` : res.message || '连接失败' });
    } catch (e: any) { setTestResult({ passed: false, message: e?.message || '连接失败' }); }
    finally { setTesting(false); }
  };

  const tabs: { key: TabKey; label: string }[] = [
    { key: 'theme', label: '主题' }, { key: 'glass', label: '毛玻璃' }, { key: 'background', label: '背景' }, { key: 'models', label: '模型' },
  ];

  return (
    <div className="fixed inset-0 z-[100] flex items-center justify-center bg-black/60 backdrop-blur-sm animate-fade-in">
      <div ref={modalRef} className="w-full max-w-lg mx-4 rounded-3xl shadow-2xl overflow-hidden flex flex-col" style={{background:'var(--bg-card)', border:'1px solid var(--border-color)', maxHeight:'85vh'}}>
        <div className="flex items-center justify-between px-6 py-4 border-b border-[var(--border-color)] shrink-0">
          <h3 className="text-lg font-bold" style={{color:'var(--text-heading)'}}>设置</h3>
          <button onClick={onClose} className="p-2 rounded-xl hover:bg-white/5 transition-colors" style={{color:'var(--text-secondary)'}}><X className="w-5 h-5" /></button>
        </div>

        <div className="flex border-b border-[var(--border-color)] px-4 shrink-0" style={{background:'var(--bg-input)'}}>
          {tabs.map(t => (
            <button key={t.key} onClick={() => { setActiveTab(t.key); if (t.key === 'models') fetchModels(); }}
              className={`px-4 py-2.5 text-sm font-medium transition-colors border-b-2 ${activeTab===t.key?'border-blue-500 text-blue-400':'border-transparent'}`}
              style={{color:activeTab===t.key?undefined:'var(--text-secondary)'}}>{t.label}</button>
          ))}
        </div>

        <div className="px-6 py-5 space-y-6 overflow-y-auto flex-1">
          {activeTab === 'theme' && (
            <div>
              <h4 className="text-sm font-bold uppercase tracking-wider mb-3" style={{color:'var(--text-secondary)'}}>主题</h4>
              <button onClick={onToggleTheme} className="w-full flex items-center justify-between p-3 rounded-xl border border-[var(--border-color)] hover:bg-white/5 transition-colors text-sm" style={{color:'var(--text-primary)'}}>
                {theme==='dark'?'深色模式':'浅色模式'}
                {theme==='dark'?<Moon className="w-4 h-4 text-blue-400"/>:<Sun className="w-4 h-4 text-amber-400"/>}
              </button>
            </div>
          )}

          {activeTab === 'glass' && (
            <div>
              <h4 className="text-sm font-bold uppercase tracking-wider mb-3" style={{color:'var(--text-secondary)'}}>毛玻璃效果</h4>
              <div className="space-y-3 rounded-xl p-4 border border-[var(--border-color)]" style={{background:'var(--bg-input)'}}>
                <div>
                  <div className="flex justify-between text-xs mb-1.5" style={{color:'var(--text-secondary)'}}><span>模糊度</span><span>{glassBlur}px</span></div>
                  <input type="range" min="0" max="24" value={glassBlur} onChange={e=>{const v=parseInt(e.target.value);setGlassBlur(v);applyGlass(v);}}
                    className="w-full h-1.5 rounded-full appearance-none cursor-pointer" style={{accentColor:'#60a5fa',background:`linear-gradient(to right,#60a5fa ${(glassBlur/24)*100}%,rgba(71,85,105,0.3) ${(glassBlur/24)*100}%)`}}/>
                </div>
              </div>
            </div>
          )}

          {activeTab === 'background' && (
            <div>
              <h4 className="text-sm font-bold uppercase tracking-wider mb-3" style={{color:'var(--text-secondary)'}}>背景图片</h4>
              <div className="space-y-3">
                <label className="flex items-center gap-2 px-4 py-3 rounded-xl border border-[var(--border-color)] hover:bg-white/5 cursor-pointer transition-colors text-sm" style={{background:'var(--bg-input)',color:'var(--text-primary)'}}>
                  <Upload className="w-4 h-4 text-purple-400"/>导入图片<input type="file" accept="image/*" onChange={handleBgUpload} className="hidden"/>
                </label>
                {bgImage&&(<><img src={bgImage} alt="preview" className="w-full h-20 object-cover rounded-xl border border-[var(--border-color)]"/>
                  <div className="grid grid-cols-4 gap-2">{['fill','fit','stretch','tile'].map(m=>
                    <button key={m} onClick={()=>handleBgModeChange(m)} className={`px-2 py-1.5 rounded-lg text-xs font-medium transition-colors ${bgMode===m?'bg-blue-600 text-white':''}`}
                      style={bgMode!==m?{background:'var(--bg-input)',color:'var(--text-secondary)',border:'1px solid var(--border-color)'}:{}}>{m==='fill'?'填充':m==='fit'?'适应':m==='stretch'?'拉升':'平铺'}</button>)}
                  </div>
                  <button onClick={handleClearBg} className="w-full px-3 py-2 rounded-lg bg-red-500/10 border border-red-500/20 text-sm text-red-400 hover:bg-red-500/20 transition-colors">清除背景图片</button></>)}
              </div>
            </div>
          )}

          {activeTab === 'models' && (
            <div>
              <h4 className="text-sm font-bold uppercase tracking-wider mb-3" style={{color:'var(--text-secondary)'}}>模型管理</h4>
              {models.length>0&&(<div className="space-y-2 mb-4">{models.map(m=>
                <div key={m.id} className="flex items-center justify-between rounded-xl p-3 border border-[var(--border-color)]" style={{background:'var(--bg-input)'}}>
                  <div className="flex-1 min-w-0"><div className="flex items-center gap-2"><span className="text-sm font-medium" style={{color:'var(--text-primary)'}}>{m.name}</span>{m.is_default&&<span className="text-[10px] px-1.5 py-0.5 rounded bg-blue-600/20 text-blue-400">默认</span>}</div><div className="text-xs mt-0.5 truncate" style={{color:'var(--text-secondary)'}}>{m.model_id} · {m.base_url}</div></div>
                  <button onClick={()=>handleDeleteModel(m.id)} className="p-1.5 rounded-lg text-red-400 hover:bg-red-500/10 transition-colors ml-2 shrink-0"><Trash2 className="w-3.5 h-3.5"/></button>
                </div>)}</div>)}
              <div className="space-y-3 rounded-xl p-4 border border-[var(--border-color)]" style={{background:'var(--bg-input)'}}>
                <h5 className="text-sm font-medium" style={{color:'var(--text-primary)'}}>{editingModel?'编辑模型':'添加模型'}</h5>
                <input value={formName} onChange={e=>setFormName(e.target.value)} placeholder="显示名称 (如 DeepSeek Chat)" className="w-full px-3 py-2 rounded-lg border border-[var(--border-color)] text-sm" style={{background:'var(--bg-root)',color:'var(--text-primary)'}}/>
                <input value={formModelId} onChange={e=>setFormModelId(e.target.value)} placeholder="模型 ID (如 deepseek-chat)" className="w-full px-3 py-2 rounded-lg border border-[var(--border-color)] text-sm" style={{background:'var(--bg-root)',color:'var(--text-primary)'}}/>
                <input value={formBaseUrl} onChange={e=>setFormBaseUrl(e.target.value)} placeholder="Base URL (如 https://api.deepseek.com)" className="w-full px-3 py-2 rounded-lg border border-[var(--border-color)] text-sm" style={{background:'var(--bg-root)',color:'var(--text-primary)'}}/>
                <div className="relative">
                  <input type={showKey?'text':'password'} value={formApiKey} onChange={e=>setFormApiKey(e.target.value)} placeholder="API Key" className="w-full px-3 py-2 pr-10 rounded-lg border border-[var(--border-color)] text-sm" style={{background:'var(--bg-root)',color:'var(--text-primary)'}}/>
                  <button onClick={()=>setShowKey(!showKey)} className="absolute right-2 top-1/2 -translate-y-1/2 p-1 rounded text-slate-400 hover:text-slate-200" title={showKey?'隐藏密钥':'显示密钥'}>{showKey?<EyeOff className="w-4 h-4"/>:<Eye className="w-4 h-4"/>}</button>
                </div>
                <label className="flex items-center gap-2 text-xs cursor-pointer" style={{color:'var(--text-secondary)'}}><input type="checkbox" checked={formIsDefault} onChange={e=>setFormIsDefault(e.target.checked)}/>设为默认模型</label>
                <button onClick={handleTestConnection} disabled={testing||!formBaseUrl||!formApiKey||!formModelId} className="flex items-center gap-2 px-4 py-2 rounded-lg text-sm font-medium bg-blue-600/20 text-blue-400 hover:bg-blue-600/30 disabled:opacity-40 transition-colors">{testing&&<Loader2 className="w-4 h-4 animate-spin"/>}测试连接</button>
                {testResult&&<div className={`flex items-center gap-1.5 text-xs ${testResult.passed?'text-emerald-400':'text-red-400'}`}>{testResult.passed?<CheckCircle className="w-3.5 h-3.5"/>:<AlertCircle className="w-3.5 h-3.5"/>}{testResult.message}</div>}
                <div className="flex gap-2 justify-end">{editingModel&&<button onClick={()=>resetForm()} className="px-4 py-2 rounded-lg text-sm border border-[var(--border-color)] hover:bg-white/5 transition-colors" style={{color:'var(--text-secondary)'}}>取消</button>}<button onClick={handleSaveModel} disabled={!formName||!formModelId||!formBaseUrl||!formApiKey} className="px-4 py-2 rounded-lg text-sm font-medium bg-blue-600 text-white hover:bg-blue-500 disabled:opacity-40 transition-colors">{editingModel?'保存修改':'添加'}</button></div>
              </div>
            </div>
          )}
        </div>
      </div>
    </div>
  );
}