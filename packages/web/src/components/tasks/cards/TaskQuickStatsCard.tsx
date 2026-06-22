import { Activity, MessageCircle, Smartphone, StickyNote, Clock } from 'lucide-react';
import { Card } from '../shared';

export interface TaskQuickStatsCardProps {
  deviceCount: number;
  callCount: number;
  activityCount: number;
  noteCount: number;
}

interface StatTile {
  label: string;
  value: number;
  Icon: typeof Clock;
  iconBg: string;
  iconText: string;
}

export default function TaskQuickStatsCard(props: TaskQuickStatsCardProps) {
  const tiles: StatTile[] = [
    { label: 'الأجهزة',  value: props.deviceCount,   Icon: Smartphone,    iconBg: 'bg-indigo-50',  iconText: 'text-indigo-600' },
    { label: 'المكالمات', value: props.callCount,     Icon: MessageCircle, iconBg: 'bg-sky-50',     iconText: 'text-sky-600' },
    { label: 'الأنشطة',   value: props.activityCount, Icon: Activity,      iconBg: 'bg-emerald-50', iconText: 'text-emerald-600' },
    { label: 'الملاحظات', value: props.noteCount,     Icon: StickyNote,    iconBg: 'bg-amber-50',   iconText: 'text-amber-600' },
  ];
  return (
    <Card title="سجل سريع" icon={Clock} accent="violet">
      <div className="grid grid-cols-2 gap-2.5">
        {tiles.map((t) => {
          const Icon = t.Icon;
          const isZero = !t.value;
          return (
            <div
              key={t.label}
              className={`flex items-center gap-3 rounded-xl border border-slate-100 px-3 py-3 transition-colors hover:border-slate-200 ${isZero ? 'bg-slate-50/60' : 'bg-white'}`}
            >
              <div className={`w-9 h-9 rounded-lg ${t.iconBg} ${t.iconText} flex items-center justify-center shrink-0`}>
                <Icon className="w-4 h-4" />
              </div>
              <div className="flex-1 min-w-0">
                <p className="text-xs font-bold text-slate-400 tracking-wide">{t.label}</p>
                <p className={`text-lg font-black tabular-nums leading-tight ${isZero ? 'text-slate-300' : 'text-slate-800'}`}>
                  {t.value}
                </p>
              </div>
            </div>
          );
        })}
      </div>
    </Card>
  );
}
