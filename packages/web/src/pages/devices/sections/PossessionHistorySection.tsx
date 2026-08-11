import { DevicePossessionTimeline } from '../../../components/devices/DevicePossessionTimeline';
import { SectionShell } from './SectionShell';
import type { DevicePossessionEntry } from '@golden-crm/shared';

interface Props {
  entries: DevicePossessionEntry[];
}

export function PossessionHistorySection({ entries }: Props) {
  return (
    <SectionShell
      id="possession-history"
      title="سجل الحيازة"
      subtitle="السجل التاريخي لكل من حاز الجهاز ومتى ولأي سبب"
    >
      <DevicePossessionTimeline entries={entries} />
    </SectionShell>
  );
}

export default PossessionHistorySection;
