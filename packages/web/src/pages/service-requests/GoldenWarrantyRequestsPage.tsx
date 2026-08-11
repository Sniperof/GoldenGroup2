import { ShieldCheck } from '../../components/ui/icons';
import { api } from '../../lib/api';
import RequestsListView, { REQUEST_CHANNEL_LABELS, type NormalizedRequestRow } from '../../components/requests/RequestsListView';

export default function GoldenWarrantyRequestsPage() {
  return (
    <RequestsListView
      title="طلبات الكفالة الذهبية"
      subtitle="مراجعة المستفيد والجهاز والمدة المقفلة ثم إنشاء مهمة عرض الكفالة أو حل الطلب عند الاستلام"
      icon={ShieldCheck}
      permissionFamily="golden_warranty"
      requestTypeForLabels="golden_warranty"
      statusOptions={['received', 'in_review', 'resolved_at_intake', 'rejected', 'promoted', 'cancelled']}
      fetchRows={async (filters) => (await api.serviceRequests.list({
        requestType: 'golden_warranty', status: filters.status,
        mine: filters.mine || undefined, reviewRequired: filters.reviewRequired || undefined,
        escalatedOnly: filters.escalatedOnly || undefined, staleOnly: filters.staleOnly || undefined,
        duplicateOnly: filters.duplicateOnly || undefined, archived: filters.archived,
        search: filters.search, limit: 1000,
      })).items}
      normalize={(row): NormalizedRequestRow => ({
        id: row.id, ref: row.publicRefNumber ?? '',
        requesterName: row.requesterExternal?.name ?? row.requesterClientName ?? row.beneficiaryClientName ?? '',
        phone: row.requesterExternal?.primary_phone ?? '', status: row.status,
        requestType: row.requestType, reviewerId: row.reviewedByUserId ?? null,
        reviewerName: row.reviewedByUserName ?? null, duplicateFlag: !!row.duplicateFlag,
        reviewRequiredFlag: !!row.reviewRequiredFlag, escalated: !!row.escalatedAt,
        stale: !!row.staleFlag, archived: !!row.archivedAt, createdAt: row.createdAt ?? null, raw: row,
      })}
      extraColumns={[
        { key: 'device', label: 'الجهاز', render: (row) => <span>{row.raw.reportedDeviceSnapshot?.modelName ?? (row.raw.installedDeviceId ? `#${row.raw.installedDeviceId}` : '—')}</span> },
        { key: 'period', label: 'المدة المطلوبة', render: (row) => <span>{row.raw.requestedWarrantyPeriodSnapshot?.label ?? `${row.raw.requestedWarrantyMonths ?? '—'} شهر`}</span> },
        { key: 'channel', label: 'القناة', render: (row) => <span>{REQUEST_CHANNEL_LABELS[row.raw.channel] ?? row.raw.channel}</span> },
      ]}
      detailPath={(row) => `/service-requests/${row.id}`}
      claim={(id) => api.serviceRequests.claim(id)}
      emptyMessage="لا توجد طلبات كفالة ذهبية مطابقة."
    />
  );
}
