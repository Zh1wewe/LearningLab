import { useEffect, useState } from 'react';
import { useNavigate } from 'react-router-dom';
import { CalendarDays, ArrowRight, ClipboardList, Trash2 } from 'lucide-react';
import { getPlanList, deletePlan } from '../api/client';

export default function LearningPlans() {
  const [plans, setPlans] = useState<any[]>([]);
  const [isLoading, setIsLoading] = useState(true);
  const navigate = useNavigate();

  const fetchPlans = async () => {
    try {
      const data = await getPlanList();
      setPlans(data);
    } catch (error) {
      console.error('Failed to fetch plans:', error);
    } finally {
      setIsLoading(false);
    }
  };

  useEffect(() => {
    fetchPlans();
  }, []);

  const handleDelete = async (planId: number, e: React.MouseEvent) => {
    e.stopPropagation();
    try {
      await deletePlan(planId);
      setPlans(prev => prev.filter(p => p.id !== planId));
    } catch (error) {
      console.error('Failed to delete plan:', error);
    }
  };

  return (
    <div className="flex flex-col h-full" style={{color: 'var(--text-primary)'}}>
      <div className="px-8 py-8 border-b border-[var(--border-color)] glass-header">
        <h1 className="text-3xl font-bold text-slate-100 tracking-tight">学习计划</h1>
        <p className="mt-2 text-slate-400">查看通过 AI 为你生成的结构化学习路线</p>
      </div>

      <div className="flex-1 overflow-y-auto px-8 py-8">
        <div className="max-w-6xl mx-auto">
          {isLoading ? (
            <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-3 gap-6">
              {[1, 2, 3, 4, 5, 6].map(i => (
                <div key={i} className="animate-pulse glass-card rounded-2xl h-48"></div>
              ))}
            </div>
          ) : plans.length === 0 ? (
            <div className="flex flex-col items-center justify-center py-20 glass-card border-dashed rounded-3xl animate-fade-in">
              <ClipboardList className="w-16 h-16 text-slate-700 mb-6" />
              <h3 className="text-xl font-bold text-slate-300">暂无学习计划</h3>
              <p className="mt-2 text-slate-500 max-w-sm text-center">
                你还未生成任何学习计划，去对话页让 AI 为你规划新的学习路线吧
              </p>
            </div>
          ) : (
            <div className="grid grid-cols-1 md:grid-cols-2 2xl:grid-cols-3 gap-6 animate-fade-in">
              {plans.map((plan: any) => (
                <div 
                  key={plan.id}
                  onClick={() => navigate(`/plans/${plan.id}`)}
                  className="relative group glass-card rounded-2xl p-6 shadow-sm hover:border-blue-500/50 transition-all cursor-pointer flex flex-col h-full overflow-hidden"
                >
                  <div className="absolute top-0 right-0 w-24 h-24 bg-blue-500/5 rounded-bl-full -mr-4 -mt-4 transition-transform group-hover:scale-110"></div>
                  
                  {/* Hover delete button — top-right corner */}
                  <div
                    className="absolute top-2 right-2 flex gap-1 opacity-0 group-hover:opacity-100 transition-opacity duration-150 z-10"
                    onClick={e => e.stopPropagation()}
                  >
                    <button
                      onClick={e => handleDelete(plan.id, e)}
                      className="btn-delete"
                      title="删除计划"
                    >
                      <Trash2 className="w-3.5 h-3.5" />
                    </button>
                  </div>
                  
                  <div className="flex items-center space-x-3 mb-4 shrink-0">
                    <div className="w-10 h-10 rounded-xl bg-blue-600/10 flex items-center justify-center text-blue-400 border border-blue-500/20 shadow-sm">
                      <CalendarDays className="w-5 h-5" />
                    </div>
                  </div>
                  
                  <h3 className="text-[17px] font-bold text-slate-200 mb-2 line-clamp-2 leading-relaxed">
                    {plan.title.replace(/"/g, '')}
                  </h3>
                  
                  {plan.content && (
                    <p className="text-sm text-slate-400 line-clamp-2 mb-4 leading-relaxed group-hover:text-slate-300 transition-colors">
                      {(() => {
                        try {
                          const parsed = JSON.parse(plan.content);
                          return parsed.overview || "包含多个学习模块和实践任务的完整体系...";
                        } catch(e) {
                          return plan.content.substring(0, 100) + '...';
                        }
                      })()}
                    </p>
                  )}
                  
                  <div className="mt-auto pt-4 flex items-center justify-between border-t border-slate-800/60">
                    <span className="text-xs font-semibold text-slate-500 flex items-center">
                      {new Date(plan.created_at).toLocaleDateString()}
                    </span>
                    <span className="text-sm font-medium text-blue-500 flex items-center opacity-80 group-hover:opacity-100 transition-opacity">
                      进入详情 <ArrowRight className="w-4 h-4 ml-1.5 transition-transform group-hover:translate-x-1" />
                    </span>
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