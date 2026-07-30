// ============================================================
// ServiceRequestsListPage — maintenance requests list
// Thin config over RequestsListView (request-section-contract.md §6):
// core columns + declared extra (channel), unified filters/lexicon/flags.
// ============================================================
import { useNavigate } from 'react-router-dom';
import { ClipboardList, Plus } from '../../components/ui/icons';
import { api } from '../../lib/api';
import RequestsListView, {
  REQUEST_CHANNEL_LABELS,
  type NormalizedRequestRow,
} from '../../components/requests/RequestsListView';
import { usePermissions } from '../../hooks/usePermissions';

export default function ServiceRequestsListPage() {
  const navigate = useNavigate();
  const { hasPermission } = usePermissions();
  const canCreate = hasPermission('service_requests.create');

  return (
    <RequestsListView
      title="طلبات الصيانة"
      icon={ClipboardList}
      permissionFamily="service_requests"
      requestTypeForLabels="emergency_maintenance"
      statusOptions={['received', 'in_review', 'resolved_at_intake', 'rejected', 'promoted', 'cancelled']}
      fetchRows={async (f) => {
        const res = await api.serviceRequests.list({
          requestType: 'emergency_maintenance',
          status: f.status,
          mine: f.mine || undefined,
          reviewRequired: f.reviewRequired || undefined,
          escalatedOnly: f.escalatedOnly || undefined,
          staleOnly: f.staleOnly || undefined,
          duplicateOnly: f.duplicateOnly || undefined,
          archived: f.archived,
          search: f.search,
          limit: 1000,
        });
        return res.items;
      }}
      normalize={(r): NormalizedRequestRow => ({
        id: r.id,
        ref: r.publicRefNumber ?? '',
        requesterName: r.requesterExternal?.name ?? (r.beneficiaryClientId ? `عميل #${r.beneficiaryClientId}` : ''),
        phone: r.requesterExternal?.primary_phone ?? '',
        status: r.status,
        requestType: r.requestType,
        reviewerId: r.reviewedByUserId ?? null,
        reviewerName: r.reviewedByUserName ?? null,
        duplicateFlag: !!r.duplicateFlag,
        reviewRequiredFlag: !!r.reviewRequiredFlag,
        escalated: !!r.escalatedAt,
        stale: !!r.staleFlag,
        archived: !!r.archivedAt,
        createdAt: r.createdAt ?? null,
        raw: r,
      })}
      extraColumns={[
        {
          key: 'channel',
          label: 'القناة',
          sortable: true,
          getValue: (r) => REQUEST_CHANNEL_LABELS[r.raw.channel] ?? r.raw.channel ?? '',
          render: (r) => (
            <span className="text-sm text-slate-700">{REQUEST_CHANNEL_LABELS[r.raw.channel] ?? r.raw.channel}</span>
          ),
        },
        {
          key: 'problemDescription',
          label: 'المشكلة',
          minWidth: '220px',
          render: (r) => (
            <span className="block max-w-[280px] truncate text-sm text-slate-600">{r.raw.problemDescription}</span>
          ),
        },
      ]}
      detailPath={(r) => `/service-requests/${r.id}`}
      claim={(id) => api.serviceRequests.claim(id)}
      headerActions={
        canCreate ? (
          <button
            onClick={() => navigate('/service-requests/new')}
            className="text-sm bg-blue-600 hover:bg-blue-700 text-white px-3 py-1.5 rounded flex items-center gap-1"
          >
            <Plus className="h-4 w-4" />
            طلب جديد
          </button>
        ) : null
      }
      emptyMessage="لا توجد طلبات صيانة مطابقة."
    />
  );
}
