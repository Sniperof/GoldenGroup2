import { useState } from 'react';
import { ArrowLeftRight } from '../../../components/ui/icons';
import Button from '../../../components/ui/Button';
import { DevicePossessionTimeline } from '../../../components/devices/DevicePossessionTimeline';
import { PossessionTransferModal } from '../../../components/devices/PossessionTransferModal';
import { SectionShell } from './SectionShell';
import type { DevicePossessionEntry } from '@golden-crm/shared';

interface Props {
  entries: DevicePossessionEntry[];
  device?: { id: number; customerId?: number | null; customerName?: string | null; branchId?: number | null };
  /** installed_devices.possession.manage */
  canManage?: boolean;
  onChanged?: () => void;
}

export function PossessionHistorySection({ entries, device, canManage = false, onChanged }: Props) {
  const [transferring, setTransferring] = useState(false);
  return (
    <SectionShell
      id="possession-history"
      title="سجل الحيازة"
      subtitle="السجل التاريخي لكل من حاز الجهاز ومتى ولأي سبب"
      actions={canManage && device ? (
        <Button size="sm" variant="secondary" icon={ArrowLeftRight} onClick={() => setTransferring(true)}>
          نقل الحيازة إلى زبون آخر
        </Button>
      ) : undefined}
    >
      <DevicePossessionTimeline entries={entries} />
      {transferring && device && (
        <PossessionTransferModal
          device={device}
          onClose={() => setTransferring(false)}
          onDone={() => { setTransferring(false); onChanged?.(); }}
        />
      )}
    </SectionShell>
  );
}

export default PossessionHistorySection;
