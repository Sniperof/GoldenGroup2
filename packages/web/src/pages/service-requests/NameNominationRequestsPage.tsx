import RequestsListView, { type NormalizedRequestRow } from '../../components/requests/RequestsListView';
import { UserCheck } from '../../components/ui/icons';
import { api } from '../../lib/api';

export default function NameNominationRequestsPage(){return <RequestsListView
  title="طلبات ترشيح الأسماء" subtitle="مراجعة مركزية وتحويل الأسماء المختارة إلى أسماء مقترحة بملكية فروعها"
  icon={UserCheck} permissionFamily="name_nomination" requestTypeForLabels="name_nomination"
  statusOptions={['received','in_review','resolved_at_intake','rejected','promoted','cancelled']}
  fetchRows={async(filters)=>(await api.serviceRequests.list({requestType:'name_nomination',status:filters.status,
    mine:filters.mine||undefined,reviewRequired:filters.reviewRequired||undefined,escalatedOnly:filters.escalatedOnly||undefined,
    staleOnly:filters.staleOnly||undefined,archived:filters.archived,search:filters.search,limit:1000})).items}
  normalize={(row):NormalizedRequestRow=>({id:row.id,ref:row.publicRefNumber??'',requesterName:row.requesterExternal?.name??row.requesterClientName??'',
    phone:row.requesterExternal?.primary_phone??'',status:row.status,requestType:row.requestType,reviewerId:row.reviewedByUserId??null,
    reviewerName:row.reviewedByUserName??null,duplicateFlag:false,reviewRequiredFlag:!!row.reviewRequiredFlag,escalated:!!row.escalatedAt,
    stale:!!row.staleFlag,archived:!!row.archivedAt,createdAt:row.createdAt??null,raw:row})}
  extraColumns={[{key:'names',label:'عدد الأسماء',render:(row)=><span>{row.raw.nameNominationItems?.length??0}</span>}]}
  detailPath={(row)=>`/service-requests/${row.id}`} claim={(id)=>api.serviceRequests.claim(id)} emptyMessage="لا توجد طلبات ترشيح أسماء مطابقة."
/>}
