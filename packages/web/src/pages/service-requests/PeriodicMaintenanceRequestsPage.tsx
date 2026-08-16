import { Wrench } from '../../components/ui/icons';
import { api } from '../../lib/api';
import RequestsListView, {
  REQUEST_CHANNEL_LABELS,
  type NormalizedRequestRow,
} from '../../components/requests/RequestsListView';

export default function PeriodicMaintenanceRequestsPage() {
  return (
    <RequestsListView
      title="طلبات الصيانة الدورية"
      subtitle="مراجعة المستفيد والجهاز ثم إنشاء مهمة دورية جديدة أو حل الطلب عند وجود مهمة نشطة"
      icon={Wrench}
      permissionFamily="periodic_maintenance"
      requestTypeForLabels="periodic_maintenance"
      statusOptions={['received', 'in_review', 'resolved_at_intake', 'rejected', 'promoted']}
      fetchRows={async (filters) => {
        const response = await api.serviceRequests.list({
          requestType: 'periodic_maintenance',
          status: filters.status,
          mine: filters.mine || undefined,
          reviewRequired: filters.reviewRequired || undefined,
          escalatedOnly: filters.escalatedOnly || undefined,
          staleOnly: filters.staleOnly || undefined,
          duplicateOnly: filters.duplicateOnly || undefined,
          archived: filters.archived,
          search: filters.search,
          limit: 1000,
        });
        return response.items;
      }}
      normalize={(row): NormalizedRequestRow => ({
        id: row.id,
        ref: row.publicRefNumber ?? '',
        requesterName: row.requesterExternal?.name
          ?? row.requesterClientName
          ?? row.beneficiaryClientName
          ?? '',
        phone: row.requesterExternal?.primary_phone ?? '',
        status: row.status,
        requestType: row.requestType,
        reviewerId: row.reviewedByUserId ?? null,
        reviewerName: row.reviewedByUserName ?? null,
        duplicateFlag: !!row.duplicateFlag,
        reviewRequiredFlag: !!row.reviewRequiredFlag,
        escalated: !!row.escalatedAt,
        stale: !!row.staleFlag,
        archived: !!row.archivedAt,
        createdAt: row.createdAt ?? null,
        raw: row,
      })}
      extraColumns={[
        {
          key: 'device',
          label: 'الجهاز المبلّغ عنه',
          minWidth: '220px',
          render: (row) => (
            <span className="block max-w-[280px] truncate text-sm text-slate-700">
              {row.raw.reportedDeviceSnapshot?.deviceName
                ?? row.raw.reportedDeviceSnapshot?.modelName
                ?? (row.raw.installedDeviceId ? `جهاز #${row.raw.installedDeviceId}` : '—')}
            </span>
          ),
        },
        {
          key: 'reason',
          label: 'سبب الطلب',
          minWidth: '220px',
          render: (row) => (
            <span className="block max-w-[280px] truncate text-sm text-slate-600">
              {row.raw.periodicMaintenanceReasonSnapshot?.label ?? row.raw.problemDescription ?? '—'}
            </span>
          ),
        },
        {
          key: 'channel',
          label: 'القناة',
          getValue: (row) => REQUEST_CHANNEL_LABELS[row.raw.channel] ?? row.raw.channel ?? '',
          render: (row) => (
            <span className="text-sm text-slate-700">
              {REQUEST_CHANNEL_LABELS[row.raw.channel] ?? row.raw.channel}
            </span>
          ),
        },
      ]}
      detailPath={(row) => `/service-requests/${row.id}`}
      claim={(id) => api.serviceRequests.claim(id)}
      emptyMessage="لا توجد طلبات صيانة دورية مطابقة."
    />
  );
}
