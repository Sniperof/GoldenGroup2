import type { MarketingVisit, MarketingVisitRescheduleRequest } from '@golden-crm/shared';
import VisitLifecycleActionModal from './VisitLifecycleActionModal';

interface RescheduleVisitModalProps {
  isOpen: boolean;
  visit: MarketingVisit | null;
  saving: boolean;
  error: string;
  onClose: () => void;
  onSubmit: (payload: MarketingVisitRescheduleRequest) => Promise<void>;
}

export default function RescheduleVisitModal(props: RescheduleVisitModalProps) {
  return (
    <VisitLifecycleActionModal
      isOpen={props.isOpen}
      visit={props.visit}
      mode="reschedule"
      saving={props.saving}
      error={props.error}
      onClose={props.onClose}
      onSubmit={(payload) => props.onSubmit(payload as MarketingVisitRescheduleRequest)}
    />
  );
}
