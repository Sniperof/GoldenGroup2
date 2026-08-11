import { useNavigate } from 'react-router-dom';
import { Package, Plus } from '../../components/ui/icons';
import { api } from '../../lib/api';
import RequestsListView, { type NormalizedRequestRow } from '../../components/requests/RequestsListView';
import { usePermissions } from '../../hooks/usePermissions';
import Button from '../../components/ui/Button';

export default function DeviceRequestsPage() {
  const navigate = useNavigate();
  const { hasPermission } = usePermissions();
  return (
    <RequestsListView
      title="طلبات الأجهزة"
      subtitle="متابعة الاستفسارات وطلبات العرض والشراء وتحويلها إلى مهام عرض جهاز"
      icon={Package}
      permissionFamily="service_requests"
      requestTypeForLabels="device_request"
      statusOptions={['received', 'in_review', 'resolved_at_intake', 'rejected', 'promoted', 'cancelled']}
      fetchRows={async (filters) => (await api.serviceRequests.list({
        requestType: 'device_request',
        status: filters.status,
        mine: filters.mine || undefined,
        reviewRequired: filters.reviewRequired || undefined,
        escalatedOnly: filters.escalatedOnly || undefined,
        staleOnly: filters.staleOnly || undefined,
        duplicateOnly: filters.duplicateOnly || undefined,
        archived: filters.archived,
        search: filters.search,
        limit: 1000,
      })).items}
      normalize={(row): NormalizedRequestRow => ({
        id: row.id,
        ref: row.publicRefNumber ?? '',
        requesterName: row.requesterClientName ?? row.requesterExternal?.name
          ?? row.beneficiaryClientName ?? row.beneficiaryExternal?.name ?? '',
        phone: row.requesterExternal?.primary_phone ?? row.beneficiaryExternal?.primary_phone ?? '',
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
          key: 'purpose',
          label: 'الغرض',
          sortable: true,
          getValue: (row) => row.raw.deviceRequestPurposeSnapshot?.label ?? '',
          render: (row) => <span className="text-sm text-slate-700">{row.raw.deviceRequestPurposeSnapshot?.label ?? '—'}</span>,
        },
        {
          key: 'devices',
          label: 'الأجهزة',
          minWidth: '220px',
          render: (row) => {
            const interests = Array.isArray(row.raw.deviceInterests) ? row.raw.deviceInterests : [];
            return <span className="block max-w-[300px] truncate text-sm text-slate-600">
              {interests.length ? interests.map((item: any) => item.snapshot?.name ?? `#${item.deviceModelId}`).join('، ') : 'بدون جهاز محدد'}
            </span>;
          },
        },
        {
          key: 'branch',
          label: 'الفرع',
          getValue: (row) => row.raw.branchName ?? '',
          render: (row) => <span className="text-sm text-slate-700">{row.raw.branchName ?? '—'}</span>,
        },
      ]}
      detailPath={(row) => `/service-requests/${row.id}`}
      claim={(id) => api.serviceRequests.claim(id)}
      headerActions={hasPermission('service_requests.create') ? (
        <Button size="sm" icon={Plus} onClick={() => navigate('/service-requests/new?type=device_request')}>طلب جديد</Button>
      ) : null}
      emptyMessage="لا توجد طلبات أجهزة مطابقة."
      tableMinWidth={1100}
    />
  );
}
