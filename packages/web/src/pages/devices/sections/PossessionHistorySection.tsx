import { DevicePossessionTimeline } from '../../../components/devices/DevicePossessionTimeline';
import { SectionShell } from './SectionShell';

interface Props {
  entries: any[];
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
