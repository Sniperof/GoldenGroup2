import { ClipboardCheck } from '../../components/ui/icons';
import { api } from '../../lib/api';
import RequestsListView, { type NormalizedRequestRow } from '../../components/requests/RequestsListView';

export default function AgentLicenseRequestsPage() {
  return <RequestsListView
    title="طلبات ترخيص الوكلاء"
    subtitle="مراجعة مركزية لطلبات ترخيص الوكلاء الواردة من تطبيق الموبايل"
    icon={ClipboardCheck}
    permissionFamily="agent_license"
    requestTypeForLabels="agent_license"
    statusOptions={['received','in_review','completed','rejected','cancelled']}
    fetchRows={async (filters) => (await api.serviceRequests.list({ requestType:'agent_license',status:filters.status,
      mine:filters.mine||undefined,reviewRequired:filters.reviewRequired||undefined,
      escalatedOnly:filters.escalatedOnly||undefined,staleOnly:filters.staleOnly||undefined,
      duplicateOnly:filters.duplicateOnly||undefined,archived:filters.archived,search:filters.search,limit:1000 })).items}
    normalize={(row): NormalizedRequestRow => ({ id:row.id,ref:row.publicRefNumber??'',
      requesterName:row.requesterExternal?.name??'',phone:row.requesterExternal?.primary_phone??'',
      status:row.status,requestType:row.requestType,reviewerId:row.reviewedByUserId??null,
      reviewerName:row.reviewedByUserName??null,duplicateFlag:!!row.duplicateFlag,
      reviewRequiredFlag:!!row.reviewRequiredFlag,escalated:!!row.escalatedAt,stale:!!row.staleFlag,
      archived:!!row.archivedAt,createdAt:row.createdAt??null,raw:row })}
    extraColumns={[{ key:'activity',label:'النشاط التجاري',render:(row)=><span>{row.raw.submittedPayload?.data?.businessActivityType??'—'}</span> },
      { key:'experience',label:'سنوات الخبرة',render:(row)=><span>{row.raw.submittedPayload?.data?.yearsOfExperience??'—'}</span> }]}
    detailPath={(row)=>`/service-requests/${row.id}`}
    claim={(id)=>api.serviceRequests.claim(id)}
    emptyMessage="لا توجد طلبات ترخيص وكيل مطابقة."
  />;
}
