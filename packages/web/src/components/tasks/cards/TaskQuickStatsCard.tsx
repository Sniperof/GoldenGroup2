import { Clock } from 'lucide-react';
import { Card, InfoLine } from '../shared';

export interface TaskQuickStatsCardProps {
  deviceCount: number;
  callCount: number;
  activityCount: number;
  noteCount: number;
}

export default function TaskQuickStatsCard(props: TaskQuickStatsCardProps) {
  return (
    <Card title="سجل سريع" icon={Clock}>
      <div className="space-y-1.5">
        <InfoLine label="الأجهزة المرتبطة" value={props.deviceCount} />
        <InfoLine label="المكالمات" value={props.callCount} />
        <InfoLine label="الأنشطة" value={props.activityCount} />
        <InfoLine label="الملاحظات" value={props.noteCount} />
      </div>
    </Card>
  );
}
