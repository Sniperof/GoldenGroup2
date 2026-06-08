import type { MarketingVisit, MarketingVisitCancelRequest } from '@golden-crm/shared';
import VisitLifecycleActionModal from './VisitLifecycleActionModal';

interface CancelVisitModalProps {
  isOpen: boolean;
  visit: MarketingVisit | null;
  saving: boolean;
  error: string;
  onClose: () => void;
  onSubmit: (payload: MarketingVisitCancelRequest) => Promise<void>;
}

export default function CancelVisitModal(props: CancelVisitModalProps) {
  return (
    <VisitLifecycleActionModal
      isOpen={props.isOpen}
      visit={props.visit}
      mode="cancel"
      saving={props.saving}
      error={props.error}
      onClose={props.onClose}
      onSubmit={(payload) => props.onSubmit(payload as MarketingVisitCancelRequest)}
    />
  );
}
