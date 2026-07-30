// ============================================================
// AccountRequestsListPage — mobile-app account-creation requests
// Thin config over RequestsListView (request-section-contract.md §6 + §9):
// core columns + declared extra (governorate). DEC-013 §2.5.
// ============================================================
import { UserPlus } from 'lucide-react';
import { api } from '../../lib/api';
import RequestsListView, { type NormalizedRequestRow } from '../../components/requests/RequestsListView';

export default function AccountRequestsListPage() {
  return (
    <RequestsListView
      title="طلبات إنشاء الحساب"
      icon={UserPlus}
      permissionFamily="account_requests"
      requestTypeForLabels="account_creation"
      statusOptions={['received', 'in_review', 'completed', 'rejected', 'cancelled']}
      fetchRows={async (f) => {
        const res = await api.accountRequests.list({
          status: f.status,
          mine: f.mine || undefined,
          reviewRequired: f.reviewRequired || undefined,
          escalatedOnly: f.escalatedOnly || undefined,
          staleOnly: f.staleOnly || undefined,
          duplicate: f.duplicateOnly || undefined,
          archived: f.archived,
          search: f.search,
          limit: 200,
        });
        return res.items;
      }}
      normalize={(r): NormalizedRequestRow => ({
        id: r.id,
        ref: r.public_ref_number ?? '',
        requesterName: r.full_name ?? '',
        phone: r.primary_phone ?? '',
        status: r.status,
        requestType: 'account_creation',
        reviewerId: r.reviewed_by_user_id ?? null,
        reviewerName: r.reviewed_by_name ?? null,
        duplicateFlag: !!r.duplicate_flag,
        reviewRequiredFlag: !!r.review_required_flag,
        escalated: !!r.escalated_at,
        stale: !!r.stale_flag,
        archived: !!r.archived_at,
        createdAt: r.created_at ?? null,
        raw: r,
      })}
      extraColumns={[
        {
          key: 'governorate',
          label: 'المحافظة',
          getValue: (r) => r.raw.governorate ?? '',
          render: (r) => <span className="text-sm text-slate-600">{r.raw.governorate ?? '—'}</span>,
        },
      ]}
      detailPath={(r) => `/account-requests/${r.id}`}
      claim={(id) => api.accountRequests.claim(id)}
      emptyMessage="لا توجد طلبات إنشاء حساب مطابقة."
      tableMinWidth={1000}
    />
  );
}
