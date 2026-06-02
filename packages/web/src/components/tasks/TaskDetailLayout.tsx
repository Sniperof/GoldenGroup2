import { useState, useEffect, type ReactNode } from 'react';
import { useNavigate } from 'react-router-dom';
import type { LucideIcon } from 'lucide-react';
import { Loader2, AlertCircle, ChevronRight } from 'lucide-react';
import { api } from '../../lib/api';
import ClientCardPopup from '../ClientCardPopup';
import TaskHeader from './TaskHeader';
import TaskOverviewTab from './tabs/TaskOverviewTab';
import TaskClientTab from './tabs/TaskClientTab';
import TaskContractTab from './tabs/TaskContractTab';
import TaskCommunicationOnlyTab from './tabs/TaskCommunicationOnlyTab';
import TaskResultTab from './tabs/TaskResultTab';
import type { TaskTypeExtension, TaskDetailData } from './types';

const BASE_TABS = ['overview', 'client', 'contract', 'communication', 'result'] as const;
const BASE_TAB_LABELS: Record<string, string> = {
  overview: 'نظرة عامة',
  client: 'بيانات الزبون',
  contract: 'العقد والجهاز',
  communication: 'التواصل والمتابعة',
  result: 'النتيجة',
};

function TabButton({ active, label, onClick }: { active: boolean; label: string; onClick: () => void }) {
  return (
    <button
      type="button"
      onClick={onClick}
      className={`inline-flex items-center gap-2 px-4 py-2 rounded-xl text-sm font-bold border transition-colors ${active
        ? 'bg-indigo-600 text-white border-indigo-600 shadow-sm'
        : 'bg-white text-slate-600 border-slate-200 hover:bg-slate-50'
      }`}
    >
      <span>{label}</span>
    </button>
  );
}

export interface TaskDetailLayoutProps {
  taskId: number;
  /** Icon shown in the header for this task type */
  typeIcon: LucideIcon;
  /** Color hint for the type icon */
  typeIconColor?: string;
  /** Where the back arrow returns to */
  backLabel: string;
  backHref: string;
  /** Optional extension: extra cards in overview, extra tabs, custom result renderer */
  extension?: TaskTypeExtension;
  /** Extra rows appended inside the schedule card (e.g., visit date/time for device_demo) */
  scheduleExtraRows?: (data: TaskDetailData) => ReactNode;
  /** Issues calculator for overview tab (gets list of issues to flag) */
  overviewIssuesFor?: (data: TaskDetailData) => string[];
  /** Issues calculator for contract tab */
  contractIssuesFor?: (data: TaskDetailData) => string[];
  /** Whether the result is considered "filled in" — used for the result tab alert */
  hasResultFor?: (data: TaskDetailData) => boolean;
}

export default function TaskDetailLayout({
  taskId,
  typeIcon,
  typeIconColor,
  backLabel,
  backHref,
  extension,
  scheduleExtraRows,
  overviewIssuesFor,
  hasResultFor,
}: TaskDetailLayoutProps) {
  const navigate = useNavigate();
  const [task, setTask] = useState<any>(null);
  const [activity, setActivity] = useState<any[]>([]);
  const [devices, setDevices] = useState<any[]>([]);
  const [calls, setCalls] = useState<any[]>([]);
  const [attempts, setAttempts] = useState<any[]>([]);
  const [preOffers, setPreOffers] = useState<any[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [clientPopupId, setClientPopupId] = useState<number | null>(null);

  const [activeTab, setActiveTab] = useState<string>('overview');

  const [priorityDraft, setPriorityDraft] = useState<'' | 'high' | 'medium' | 'low'>('');
  const [prioritySaving, setPrioritySaving] = useState(false);
  const [priorityError, setPriorityError] = useState('');

  const [expectedDateDraft, setExpectedDateDraft] = useState('');
  const [expectedDateSaving, setExpectedDateSaving] = useState(false);
  const [expectedDateError, setExpectedDateError] = useState('');

  useEffect(() => {
    let active = true;
    setLoading(true);
    setError(null);

    (async () => {
      try {
        const [taskData, activityData, devicesData, callsData, attemptsData] = await Promise.all([
          api.openTasks.get(taskId),
          api.openTasks.getActivity(taskId).catch(() => [] as any[]),
          api.openTasks.getDevices(taskId).catch(() => [] as any[]),
          api.openTasks.getCalls(taskId).catch(() => [] as any[]),
          api.openTasks.getAttempts(taskId).catch(() => ({ taskStatus: '', attempts: [] })),
        ]);
        if (!active) return;
        const taskPreOffers = taskData?.preOffers || taskData?.pre_offers || [];
        setTask(taskData);
        setActivity(activityData);
        setDevices(devicesData);
        setCalls(callsData);
        setAttempts(attemptsData?.attempts ?? []);
        setPreOffers(taskPreOffers);
        setPriorityDraft(taskData?.priority ?? '');
        setExpectedDateDraft(taskData?.expectedDate ? taskData.expectedDate.slice(0, 10) : '');
      } catch (err: any) {
        if (!active) return;
        setError(err.message || 'فشل في تحميل بيانات المهمة');
      } finally {
        if (active) setLoading(false);
      }
    })();

    return () => { active = false; };
  }, [taskId]);

  const handlePriorityChange = async (next: '' | 'high' | 'medium' | 'low') => {
    if (!task?.id) return;
    const previous = priorityDraft;
    setPriorityDraft(next);
    setPrioritySaving(true);
    setPriorityError('');
    try {
      const updated = await api.openTasks.update(task.id, { priority: next || null });
      setTask(updated);
      setPriorityDraft(updated?.priority ?? next);
    } catch (err: any) {
      setPriorityDraft(previous);
      setPriorityError(err.message || 'فشل في تحديث الأولوية');
    } finally {
      setPrioritySaving(false);
    }
  };

  const handleExpectedDateBlur = async (newDate: string) => {
    if (!task?.id) return;
    const prev = expectedDateDraft;
    setExpectedDateDraft(newDate);
    setExpectedDateSaving(true);
    setExpectedDateError('');
    try {
      const updated = await api.openTasks.update(task.id, { expectedDate: newDate || null });
      setTask(updated);
      setExpectedDateDraft(updated?.expectedDate ? updated.expectedDate.slice(0, 10) : '');
    } catch (err: any) {
      setExpectedDateDraft(prev);
      setExpectedDateError(err.message || 'فشل في تحديث الموعد المتوقع');
    } finally {
      setExpectedDateSaving(false);
    }
  };

  const handleSubmitNote = async (text: string) => {
    const newEntry = await api.openTasks.addActivity(taskId, { eventType: 'note_added', newValue: text });
    setActivity(prev => [newEntry, ...prev]);
  };

  if (loading) {
    return (
      <div className="h-full flex flex-col items-center justify-center text-slate-500" dir="rtl">
        <Loader2 className="w-8 h-8 animate-spin text-indigo-500 mb-3" />
        <p className="text-sm font-medium">جارٍ تحميل بيانات المهمة...</p>
      </div>
    );
  }

  if (error || !task) {
    return (
      <div className="h-full flex flex-col items-center justify-center text-slate-500" dir="rtl">
        <AlertCircle className="w-10 h-10 text-rose-400 mb-3" />
        <p className="text-sm font-medium">{error || 'المهمة غير موجودة'}</p>
        <button
          onClick={() => navigate(backHref)}
          className="mt-4 text-sky-600 font-bold text-sm flex items-center gap-2 hover:underline"
        >
          <ChevronRight className="w-4 h-4" />
          العودة
        </button>
      </div>
    );
  }

  const data: TaskDetailData = { task, activity, devices, calls, preOffers };
  const extraTabs = extension?.extraTabs ?? [];
  const allTabIds = [...BASE_TABS.slice(0, 4), ...extraTabs.map(t => t.id), 'result'];

  const hasResult = hasResultFor ? hasResultFor(data) : Boolean(task.outcome || task.result);
  const issues = overviewIssuesFor ? overviewIssuesFor(data) : [];

  return (
    <div className="h-full flex flex-col bg-slate-50/50 overflow-hidden" dir="rtl">
      <TaskHeader
        task={task}
        typeIcon={typeIcon}
        typeIconColor={typeIconColor}
        backLabel={backLabel}
        backHref={backHref}
        onBack={() => navigate(backHref)}
      />

      {/* Tabs */}
      <div className="bg-slate-50 border-b border-slate-200 px-6 py-4 shrink-0">
        <div className="max-w-5xl mx-auto flex flex-wrap items-center gap-2">
          {allTabIds.map(tabId => {
            const label = BASE_TAB_LABELS[tabId] ?? extraTabs.find(t => t.id === tabId)?.label ?? tabId;
            return (
              <TabButton
                key={tabId}
                active={activeTab === tabId}
                label={label}
                onClick={() => setActiveTab(tabId)}
              />
            );
          })}
          {hasResult && extension?.tabBarActions && (
            <div className="mr-auto">{extension.tabBarActions(data)}</div>
          )}
        </div>
      </div>

      {/* Content */}
      <div className="flex-1 overflow-y-auto">
        <div className="max-w-5xl mx-auto px-6 py-6 space-y-6">
          {activeTab === 'overview' && (
            <TaskOverviewTab
              task={task}
              deviceCount={devices.length}
              callCount={calls.length}
              activityCount={activity.length}
              noteCount={activity.filter((a) => a.eventType === 'note_added').length}
              priorityDraft={priorityDraft}
              prioritySaving={prioritySaving}
              priorityError={priorityError}
              onPriorityChange={handlePriorityChange}
              expectedDateDraft={expectedDateDraft}
              expectedDateSaving={expectedDateSaving}
              expectedDateError={expectedDateError}
              onExpectedDateDraftChange={setExpectedDateDraft}
              onExpectedDateBlur={handleExpectedDateBlur}
              scheduleExtraRows={scheduleExtraRows ? scheduleExtraRows(data) : undefined}
              issues={issues}
              extraCards={extension?.overviewExtraCards ? extension.overviewExtraCards(data) : null}
            />
          )}

          {activeTab === 'client' && (
            <TaskClientTab task={task} onClientClick={setClientPopupId} />
          )}

          {activeTab === 'contract' && (
            <TaskContractTab task={task} />
          )}

          {activeTab === 'communication' && (
            <TaskCommunicationOnlyTab
              calls={calls}
              activity={activity}
              onSubmitNote={handleSubmitNote}
            />
          )}

          {extraTabs.map(t => activeTab === t.id && <div key={t.id}>{t.render(data)}</div>)}

          {activeTab === 'result' && (
            <TaskResultTab
              task={task}
              hasResult={hasResult}
              ResultRenderer={extension?.ResultRenderer}
              attempts={attempts}
              rendererProps={{ preOffers }}
            />
          )}
        </div>
      </div>

      {clientPopupId !== null && (
        <ClientCardPopup
          clientId={clientPopupId}
          onClose={() => setClientPopupId(null)}
        />
      )}
    </div>
  );
}
