import { useEffect, useState } from 'react';
import { useParams, useNavigate } from 'react-router-dom';
import {
  ArrowLeft, Target, Link as LinkIcon, BookOpen, AlertCircle,
  Search, ClipboardCopy, Check, ChevronDown, ChevronRight, FileText, Clock,
} from 'lucide-react';
import { getPlanDetail, searchKnowledge, searchDocs, rerankKnowledge } from '../api/client';

// ---------------------------------------------------------------------------
// Types
// ---------------------------------------------------------------------------
interface KnowledgeResult {
  id?: string;
  content: string;
  metadata?: Record<string, any>;
  score?: number;
}

interface DocResult {
  id: number;
  title: string;
  source: string;
  file_path: string;
  chunk_count: number;
  created_at: string | null;
}

interface ResourceState {
  query: string;
  loading: boolean;
  docResults: DocResult[] | null;      // 文档级结果
  snippetResults: KnowledgeResult[] | null;  // 片段级结果
  copied: boolean;
  expanded: boolean;
  error: string | null;
}

const DEFAULT_STATE: ResourceState = {
  query: '',
  loading: false,
  docResults: null,
  snippetResults: null,
  copied: false,
  expanded: false,
  error: null,
};

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------
function splitKeywords(query: string): string[] {
  // 按空格和常见中文/英文标点拆分
  return query
    .split(/[\s,，。；;、！!？?]+/)
    .map(k => k.trim().toLowerCase())
    .filter(k => k.length > 0);
}

function keywordFilter(docs: KnowledgeResult[], keywords: string[]): KnowledgeResult[] {
  if (keywords.length === 0) return docs;
  return docs.filter(d => {
    const content = (d.content || '').toLowerCase();
    return keywords.some(kw => content.includes(kw));
  });
}

// ---------------------------------------------------------------------------
// Component
// ---------------------------------------------------------------------------
export default function PlanDetail() {
  const { id } = useParams<{ id: string }>();
  const navigate = useNavigate();
  const [plan, setPlan] = useState<any>(null);
  const [isLoading, setIsLoading] = useState(true);
  const [resourceStates, setResourceStates] = useState<Record<string, ResourceState>>({});

  useEffect(() => {
    (async () => {
      if (!id) return;
      try { const data = await getPlanDetail(Number(id)); setPlan(data); }
      catch { /* handled by !plan */ }
      finally { setIsLoading(false); }
    })();
  }, [id]);

  // ---- Multi-stage search ----
  const handleResourceClick = async (dayIndex: number, resIndex: number, dayTopic: string, resName: string) => {
    const key = `${dayIndex}-${resIndex}`;

    setResourceStates(prev => {
      const existing = prev[key];
      if (existing && (existing.docResults !== null || existing.snippetResults !== null)) {
        return { ...prev, [key]: { ...existing, expanded: !existing.expanded } };
      }
      return { ...prev, [key]: { ...DEFAULT_STATE, loading: true, expanded: true } };
    });

    const query = `${dayTopic} ${resName}`;
    const keywords = splitKeywords(query);

    // ---------- Stage 1: 文档级搜索 ----------
    let docResults: DocResult[] = [];
    try { docResults = await searchDocs(query); } catch { /* fall through */ }

    if (docResults.length > 0) {
      setResourceStates(prev => {
        const cur = prev[key] || DEFAULT_STATE;
        return { ...prev, [key]: { ...cur, query, loading: false, docResults, snippetResults: [], expanded: true, copied: false } };
      });
      return;
    }

    // ---------- Stage 2: 片段搜索 + 关键词过滤 ----------
    try {
      const rawSnippets: KnowledgeResult[] = await searchKnowledge(query, 10);
      let filtered = keywordFilter(rawSnippets, keywords);

      // ---------- Fallback: 元数据关键词检索 ----------
      if (filtered.length === 0 && keywords.length > 0) {
        // 再次搜索，这次依靠已注入的 keywords_cn metadata 匹配
        const fallbackResults: KnowledgeResult[] = rawSnippets.filter(s => {
          try {
            const kwJson = s.metadata?.keywords_cn;
            if (!kwJson || kwJson === '[]') return false;
            const cnKeys: string[] = JSON.parse(kwJson);
            return cnKeys.some(k => keywords.some(qk => k.includes(qk) || qk.includes(k)));
          } catch { return false; }
        });
        if (fallbackResults.length > 0) {
          filtered = fallbackResults;
        }
      }

      // ---------- Stage 3: LLM 重排序（仅当 > 3 条时）----------
      if (filtered.length > 3) {
        try {
          const rerankPayload = filtered.map(s => ({ id: s.id || '', content: s.content }));
          const { doc_ids } = await rerankKnowledge(query, rerankPayload);
          if (doc_ids && doc_ids.length > 0) {
            const idSet = new Set(doc_ids);
            filtered = filtered.filter(s => s.id && idSet.has(s.id));
          }
          // 取 top 3
          filtered = filtered.slice(0, 3);
        } catch { /* keep filtered as-is */ }
      }

      setResourceStates(prev => {
        const cur = prev[key] || DEFAULT_STATE;
        return { ...prev, [key]: { ...cur, query, loading: false, docResults: [], snippetResults: filtered, expanded: true, copied: false } };
      });
    } catch (err: any) {
      setResourceStates(prev => {
        const cur = prev[key] || DEFAULT_STATE;
        return { ...prev, [key]: { ...cur, query, loading: false, docResults: [], snippetResults: [], expanded: true, error: err?.message || '搜索失败' } };
      });
    }
  };

  // ---- Copy ----
  const handleCopy = async (key: string, text: string) => {
    try { await navigator.clipboard.writeText(text); } catch {
      try {
        const el = document.createElement('textarea'); el.value = text;
        el.style.position = 'fixed'; el.style.left = '-9999px';
        document.body.appendChild(el); el.select(); document.execCommand('copy'); document.body.removeChild(el);
      } catch { /* silent */ }
    }
    setResourceStates(prev => {
      const cur = prev[key] || DEFAULT_STATE;
      return { ...prev, [key]: { ...cur, copied: true } };
    });
    setTimeout(() => {
      setResourceStates(prev => {
        const cur = prev[key]; if (!cur) return prev;
        return { ...prev, [key]: { ...cur, copied: false } };
      });
    }, 2000);
  };

  const toggleExpanded = (key: string) => {
    setResourceStates(prev => {
      const existing = prev[key];
      if (!existing || (existing.docResults === null && existing.snippetResults === null)) return prev;
      return { ...prev, [key]: { ...existing, expanded: !existing.expanded } };
    });
  };

  const credColor = (cred?: string) => {
    switch (cred) {
      case 'verified': return 'bg-emerald-500';
      case 'user_submitted': return 'bg-blue-500';
      case 'ai_generated': return 'bg-orange-500';
      case 'unreliable': return 'bg-red-500';
      default: return 'bg-slate-500';
    }
  };

  // ---- Loading ----
  if (isLoading) {
    return (
      <div className="flex flex-col h-full p-8 space-y-6">
        <div className="h-8 glass-card rounded w-32 animate-pulse mb-8" />
        <div className="h-12 glass-card rounded w-3/4 animate-pulse" />
        <div className="h-6 glass-card rounded w-1/2 animate-pulse mb-10" />
        <div className="space-y-8">
          {[1,2,3].map(i => (
            <div key={i} className="flex gap-6">
              <div className="w-12 h-12 glass-card rounded-full animate-pulse shrink-0" />
              <div className="flex-1 glass-card rounded-2xl h-40 animate-pulse" />
            </div>
          ))}
        </div>
      </div>
    );
  }

  if (!plan) {
    return (
      <div className="flex h-full flex-col items-center justify-center">
        <AlertCircle className="w-12 h-12 text-slate-600 mb-4" />
        <h2 className="text-xl font-bold">学习计划未找到或加载失败</h2>
        <button onClick={() => navigate('/plans')} className="mt-6 px-6 py-2.5 bg-slate-800 hover:bg-slate-700 font-medium rounded-xl border border-slate-700 transition">返回列表</button>
      </div>
    );
  }

  let parsedContent: any = null;
  try { parsedContent = JSON.parse(plan.content); } catch {}

  const hasResults = (state: ResourceState) =>
    (state.docResults !== null && state.docResults.length > 0) ||
    (state.snippetResults !== null && state.snippetResults.length > 0);

  return (
    <div className="flex flex-col h-full" style={{color: 'var(--text-primary)'}}>
      {/* Header */}
      <div className="border-b border-[var(--border-color)] px-8 py-6 sticky top-0 z-20 shadow-sm glass-header">
        <button onClick={() => navigate('/plans')} className="flex items-center text-sm font-medium text-slate-400 hover:text-slate-200 transition-colors mb-4 group w-max">
          <ArrowLeft className="w-4 h-4 mr-2 transition-transform group-hover:-translate-x-1" /> 返回计划列表
        </button>
        <h1 className="text-3xl font-bold text-slate-100 leading-tight">{parsedContent?.title || plan.title}</h1>
        {parsedContent?.overview && <p className="mt-3 text-slate-400 max-w-4xl text-[15px] leading-relaxed">{parsedContent.overview}</p>}
      </div>

      {/* Timeline */}
      <div className="flex-1 overflow-y-auto px-8 py-10 relative">
        <div className="max-w-4xl mx-auto">
          {parsedContent?.days ? (
            <div className="relative border-l-2 border-slate-800/80 pl-8 ml-4 space-y-12">
              {parsedContent.days.map((dayPlan: any, dayIndex: number) => {
                const topic = dayPlan.theme || dayPlan.topic || '';
                return (
                  <div key={dayIndex} className="relative animate-fade-in group">
                    <div className="absolute -left-[45px] top-6 w-5 h-5 rounded-full border-[4px] border-slate-950 bg-blue-500 shadow-[0_0_10px_rgba(59,130,246,0.5)] z-10" />
                    <div className="glass-card rounded-3xl overflow-hidden shadow-sm transition-colors">
                      <div className="px-7 py-5 border-b border-[var(--border-color)] flex flex-col sm:flex-row sm:items-center sm:justify-between gap-3">
                        <div className="flex items-center space-x-4">
                          <span className="bg-blue-600/20 text-blue-400 border border-blue-500/20 text-sm font-bold px-3.5 py-1.5 rounded-xl">第 {dayPlan.day || dayIndex + 1} 天</span>
                          <h3 className="text-xl font-bold text-slate-200">{topic}</h3>
                        </div>
                      </div>
                      <div className="p-7 space-y-8">

                        {/* Concepts */}
                        {dayPlan.concepts && dayPlan.concepts.length > 0 && (
                          <div>
                            <h4 className="flex items-center text-sm font-bold text-slate-400 mb-4 tracking-widest uppercase"><BookOpen className="w-4 h-4 mr-2.5 text-blue-400" /> 核心概念</h4>
                            <div className="flex flex-wrap gap-2.5">
                              {dayPlan.concepts.map((c: string, i: number) => (
                                <span key={i} className="px-3.5 py-1.5 text-sm rounded-lg bg-slate-800/80 border border-slate-700 text-slate-300">{c}</span>
                              ))}
                            </div>
                          </div>
                        )}

                        {/* Tasks */}
                        {dayPlan.tasks && dayPlan.tasks.length > 0 && (
                          <div>
                            <h4 className="flex items-center text-sm font-bold text-slate-400 mb-4 tracking-widest uppercase"><Target className="w-4 h-4 mr-2.5 text-amber-500" /> 实践任务</h4>
                            <ul className="space-y-3">
                              {dayPlan.tasks.map((t: string, i: number) => (
                                <li key={i} className="flex items-start glass-overlay rounded-xl p-4 shadow-sm">
                                  <span className="flex items-center justify-center min-w-[24px] h-[24px] rounded-md bg-amber-500/10 text-amber-500 font-bold text-xs mr-4 mt-0.5 border border-amber-500/20">{i + 1}</span>
                                  <span className="text-slate-300 leading-relaxed">{t}</span>
                                </li>
                              ))}
                            </ul>
                          </div>
                        )}

                        {/* Resources — multi-stage search */}
                        {dayPlan.resources && dayPlan.resources.length > 0 && (
                          <div>
                            <h4 className="flex items-center text-sm font-bold text-slate-400 mb-4 tracking-widest uppercase"><LinkIcon className="w-4 h-4 mr-2.5 text-emerald-500" /> 推荐资源</h4>
                            <ul className="space-y-2">
                              {dayPlan.resources.map((res: string, resIndex: number) => {
                                const key = `${dayIndex}-${resIndex}`;
                                const state = resourceStates[key] || DEFAULT_STATE;
                                return (
                                  <li key={resIndex} className="flex flex-col">
                                    <div className="flex items-start group/item">
                                      <span className="mr-3 mt-1 text-emerald-500/50 group-hover/item:text-emerald-400 transition-colors">✦</span>
                                      <button
                                        onClick={() => handleResourceClick(dayIndex, resIndex, topic, res)}
                                        className="flex-1 flex items-center gap-2 text-left text-emerald-400 font-medium hover:text-emerald-200 hover:underline cursor-pointer transition-colors"
                                      >
                                        <Search className="w-3.5 h-3.5 shrink-0 opacity-50 group-hover/item:opacity-100 transition-opacity" />
                                        <span>{res}</span>
                                        {state.loading && <span className="inline-block w-3 h-3 border-2 border-emerald-400/50 border-t-emerald-400 rounded-full animate-spin ml-1" />}
                                      </button>
                                    </div>

                                    {/* Results */}
                                    {(state.docResults !== null || state.snippetResults !== null) && (
                                      <div className="ml-7 mt-2">
                                        <button onClick={() => toggleExpanded(key)} className="flex items-center gap-1 text-xs text-slate-500 hover:text-slate-300 transition-colors mb-2">
                                          {state.expanded ? <ChevronDown className="w-3 h-3" /> : <ChevronRight className="w-3 h-3" />}
                                          {hasResults(state)
                                            ? `搜索: ${(state.docResults?.length || 0) + (state.snippetResults?.length || 0)} 个结果`
                                            : '知识库搜索'}
                                        </button>

                                        {state.expanded && (
                                          <div className="space-y-2 transition-all duration-200">
                                            {/* --- Document cards --- */}
                                            {state.docResults && state.docResults.length > 0 && state.docResults.map(d => (
                                              <div key={d.id} className="bg-slate-800/50 border border-slate-700 rounded-xl p-4 flex gap-3 shadow-sm hover:border-slate-600 transition-colors">
                                                <div className="w-10 h-10 rounded-lg bg-purple-500/10 border border-purple-500/20 flex items-center justify-center shrink-0">
                                                  <FileText className="w-5 h-5 text-purple-400" />
                                                </div>
                                                <div className="flex-1 min-w-0">
                                                  <h5 className="text-sm font-semibold text-slate-200 truncate">{d.title}</h5>
                                                  <div className="flex items-center gap-3 mt-1.5 text-[11px] text-slate-500">
                                                    <span>来源: {d.source || '未知'}</span>
                                                    <span>·</span>
                                                    <span>{d.chunk_count} 个片段</span>
                                                    {d.created_at && <><span>·</span><span className="flex items-center gap-0.5"><Clock className="w-3 h-3" />{new Date(d.created_at).toLocaleDateString()}</span></>}
                                                  </div>
                                                </div>
                                              </div>
                                            ))}

                                            {/* --- Snippet cards --- */}
                                            {state.snippetResults && state.snippetResults.length > 0 && state.snippetResults.map((s, ridx) => (
                                              <div key={s.id || ridx} className="glass-overlay rounded-xl p-3 flex gap-3 shadow-sm">
                                                <div className="w-1 rounded-full bg-slate-800 overflow-hidden shrink-0 h-10 mt-0.5">
                                                  <div className={`w-full ${credColor(s.metadata?.credibility)}`} style={{ height: `${Math.max((s.score || 0) * 100, 15)}%` }} />
                                                </div>
                                                <div className="flex-1 min-w-0">
                                                  <div className="flex items-center justify-between mb-1">
                                                    <span className="text-[11px] text-slate-500">来源: {s.metadata?.source || s.metadata?.source_file || '未知'}</span>
                                                    {s.score != null && <span className="text-[10px] text-slate-600 font-mono ml-2">{(s.score * 100).toFixed(0)}%</span>}
                                                  </div>
                                                  <p className="text-xs text-slate-400 leading-relaxed line-clamp-3">{s.content}</p>
                                                </div>
                                              </div>
                                            ))}

                                            {/* --- No results --- */}
                                            {!hasResults(state) && (
                                              <div className="glass-overlay rounded-xl p-4 space-y-2">
                                                <p className="text-xs text-slate-500">知识库中未找到相关资源</p>
                                                <p className="text-[11px] text-slate-600 font-mono break-all">搜索词: {state.query}</p>
                                                <button onClick={() => handleCopy(key, state.query)} className="flex items-center gap-1.5 px-3 py-1.5 rounded-lg text-xs transition-colors glass-input">
                                                  {state.copied ? (
                                                    <><Check className="w-3 h-3 text-emerald-400" /><span className="text-emerald-400">已复制，可粘贴到搜索引擎</span></>
                                                  ) : (
                                                    <><ClipboardCopy className="w-3 h-3" /><span>复制搜索词到剪贴板</span></>
                                                  )}
                                                </button>
                                              </div>
                                            )}
                                          </div>
                                        )}
                                      </div>
                                    )}
                                  </li>
                                );
                              })}
                            </ul>
                          </div>
                        )}
                      </div>
                    </div>
                  </div>
                );
              })}
            </div>
          ) : (
            <div className="glass-card rounded-3xl p-8">
              <pre className="whitespace-pre-wrap text-[15px] leading-relaxed text-slate-400 font-mono">{plan.content}</pre>
            </div>
          )}
        </div>
      </div>
    </div>
  );
}