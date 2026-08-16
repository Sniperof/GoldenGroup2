// ============================================================
// WaterCheckRequestsPage — water-check requests list
// Thin config over RequestsListView (request-section-contract.md §6):
// core columns + declared extras (submission mode, branch, address).
// ============================================================
import { useNavigate } from 'react-router-dom';
import { Beaker, Send } from 'lucide-react';
import { api } from '../../lib/api';
import RequestsListView, { type NormalizedRequestRow } from '../../components/requests/RequestsListView';
import { usePermissions } from '../../hooks/usePermissions';
import Button from '../../components/ui/Button';
import { deepestAdministrativeArea } from '../../lib/serviceRequestDisplay';

// Kept only as a tooltip explanation for the "—" (unlinked) branch case.
const BRANCH_RESOLUTION_LABELS: Record<string, string> = {
  resolved: 'تم ربط الفرع',
  ambiguous: 'أكثر من فرع',
  no_coverage: 'خارج التغطية',
  missing_geo: 'موقع ناقص',
  not_applicable: 'غير مطبق',
};

export default function WaterCheckRequestsPage() {
  const navigate = useNavigate();
  const { hasPermission } = usePermissions();
  const canSimulate = hasPermission('water_check.create');

  return (
    <RequestsListView
      title="طلبات فحص المياه"
      subtitle="استقبال طلبات فحص المياه ومتابعة ربطها بالفروع وتحويلها إلى مهام"
      icon={Beaker}
      permissionFamily="water_check"
      requestTypeForLabels="water_check"
      statusOptions={['received', 'in_review', 'resolved_at_intake', 'rejected', 'promoted', 'cancelled']}
      fetchRows={async (f) => {
        const res = await api.serviceRequests.list({
          requestType: 'water_check',
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
        requesterName: r.requesterExternal?.name ?? r.beneficiaryExternal?.name ?? '',
        phone: r.requesterExternal?.primary_phone ?? r.beneficiaryExternal?.primary_phone ?? '',
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
          key: 'submissionMode',
          label: 'نمط التقديم',
          sortable: true,
          getValue: (r) => (r.raw.submissionType === 'refer_a_candidate' ? 'لعنوان شخص آخر' : 'لعنواني'),
          render: (r) => {
            const forAnother = r.raw.submissionType === 'refer_a_candidate';
            return (
              <span className={`rounded px-2 py-0.5 text-xs font-medium ${forAnother ? 'bg-amber-100 text-amber-700' : 'bg-slate-100 text-slate-600'}`}>
                {forAnother ? 'لعنوان شخص آخر' : 'لعنواني'}
              </span>
            );
          },
        },
        {
          key: 'branch',
          label: 'الفرع',
          sortable: true,
          getValue: (r) => r.raw.branchName ?? '',
          render: (r) =>
            r.raw.branchName ? (
              <span className="text-sm text-slate-700">{r.raw.branchName}</span>
            ) : (
              <span
                className="text-xs text-slate-400"
                title={BRANCH_RESOLUTION_LABELS[r.raw.branchResolutionStatus ?? ''] ?? undefined}
              >
                —
              </span>
            ),
        },
        {
          key: 'address',
          label: 'العنوان',
          minWidth: '220px',
          getValue: (r) => deepestAdministrativeArea(r.raw),
          render: (r) => (
            <span className="block max-w-[300px] truncate text-sm text-slate-600">{deepestAdministrativeArea(r.raw)}</span>
          ),
        },
      ]}
      detailPath={(r) => `/service-requests/${r.id}`}
      claim={(id) => api.serviceRequests.claim(id)}
      headerActions={
        canSimulate ? (
          <Button
            type="button"
            onClick={() => navigate('/service-requests/water-check/simulator')}
            size="sm"
            icon={Send}
          >
            محاكاة إرسال
          </Button>
        ) : null
      }
      emptyMessage="لا توجد طلبات فحص مياه مطابقة."
      tableMinWidth={1150}
    />
  );
}
