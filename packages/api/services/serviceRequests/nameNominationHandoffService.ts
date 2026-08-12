import type { PoolClient } from 'pg';
import pool from '../../db.js';
import { appendAudit } from './_shared.js';
import { resolveBranchForServiceGeoUnit } from './branchResolutionService.js';

function domainError(status: number, code: string, details?: Record<string, unknown>) {
  return Object.assign(new Error(code), { status, code, details });
}

export async function refreshNameNominationBranches(serviceRequestId: number, db?: PoolClient) {
  const client = db ?? await pool.connect();
  try {
    const { rows } = await client.query<{ id: number; branch_resolution_geo_unit_id: number }>(
      `SELECT id,branch_resolution_geo_unit_id FROM service_request_name_nomination_items
        WHERE service_request_id=$1 AND status='pending' ORDER BY item_order FOR UPDATE`, [serviceRequestId],
    );
    for (const row of rows) {
      const resolution = await resolveBranchForServiceGeoUnit(Number(row.branch_resolution_geo_unit_id), client);
      await client.query(
        `UPDATE service_request_name_nomination_items SET branch_resolution_status=$2,
          branch_resolution_reason=$3,branch_id=$4,updated_at=NOW() WHERE id=$1`,
        [row.id,resolution.status,resolution.reason,resolution.branchId],
      );
    }
    return rows.length;
  } finally { if (!db) client.release(); }
}

async function lockRequest(client: PoolClient, serviceRequestId: number, actorUserId: number, allowPromotedReplay = false) {
  const { rows } = await client.query<any>(
    `SELECT id,status,request_type,reviewed_by_user_id,submitted_payload,created_at
       FROM service_requests WHERE id=$1 FOR UPDATE`, [serviceRequestId],
  );
  const request = rows[0];
  if (!request) throw domainError(404, 'not_found');
  if (request.request_type !== 'name_nomination') throw domainError(400, 'wrong_request_type_for_name_nomination');
  if (request.status !== 'in_review' && !(allowPromotedReplay && request.status === 'promoted')) {
    throw domainError(409, 'name_nomination_request_not_in_review');
  }
  if (Number(request.reviewed_by_user_id) !== actorUserId) throw domainError(409, 'name_nomination_requires_actor_claim');
  return request;
}

async function finalizeIfComplete(client: PoolClient, serviceRequestId: number, actorUserId: number) {
  const { rows } = await client.query<{ pending: number; converted: number }>(
    `SELECT COUNT(*) FILTER (WHERE status='pending')::int AS pending,
            COUNT(*) FILTER (WHERE status='converted')::int AS converted
       FROM service_request_name_nomination_items WHERE service_request_id=$1`, [serviceRequestId],
  );
  if (Number(rows[0].pending) > 0) return null;
  const converted = Number(rows[0].converted);
  const status = converted > 0 ? 'promoted' : 'resolved_at_intake';
  const outcome = converted > 0 ? 'candidates_created' : 'all_names_skipped';
  await client.query(
    `UPDATE service_requests SET status=$2,triage_outcome=$3,closed_at=NOW(),updated_at=NOW()
      WHERE id=$1`, [serviceRequestId,status,outcome],
  );
  await appendAudit(client, {
    serviceRequestId, eventType: 'name_nomination_completed', actorUserId, actorRole: 'operator',
    payload: { status, convertedCount: converted },
  });
  return status;
}

export async function convertNameNominationItems(input: {
  serviceRequestId: number; itemIds: number[]; actorUserId: number;
}) {
  const client = await pool.connect();
  try {
    await client.query('BEGIN');
    await refreshNameNominationBranches(input.serviceRequestId, client);
    await client.query('COMMIT');
    await client.query('BEGIN');
    const request = await lockRequest(client,input.serviceRequestId,input.actorUserId,true);
    const itemIds = [...new Set(input.itemIds.map(Number))];
    if (!itemIds.length || itemIds.some((id) => !Number.isInteger(id) || id <= 0)) throw domainError(400,'item_ids_required');
    const { rows: items } = await client.query<any>(
      `SELECT * FROM service_request_name_nomination_items
        WHERE service_request_id=$1 AND id=ANY($2::bigint[]) ORDER BY item_order FOR UPDATE`,
      [input.serviceRequestId,itemIds],
    );
    if (items.length !== itemIds.length) throw domainError(404,'name_nomination_item_not_found');
    if (request.status === 'promoted') {
      if (items.some((x:any)=>x.status!=='converted')) throw domainError(409,'name_nomination_request_already_closed');
      await client.query('COMMIT');
      return { created:items.map((item:any)=>({itemId:Number(item.id),candidateId:Number(item.candidate_id),idempotentReplay:true})),requestStatus:'promoted' };
    }
    if (items.some((x: any) => x.status === 'skipped')) throw domainError(409,'name_nomination_item_already_skipped');
    const pendingItems = items.filter((x: any) => x.status === 'pending');
    for (const item of pendingItems) {
      const branch = await resolveBranchForServiceGeoUnit(Number(item.branch_resolution_geo_unit_id),client);
      await client.query(
        `UPDATE service_request_name_nomination_items SET branch_resolution_status=$2,
          branch_resolution_reason=$3,branch_id=$4,updated_at=NOW() WHERE id=$1`,
        [item.id,branch.status,branch.reason,branch.branchId],
      );
      if (branch.status !== 'resolved' || !branch.branchId) {
        throw domainError(409,'name_nomination_item_branch_unresolved',{ itemId:Number(item.id),status:branch.status });
      }
      item.branch_id = branch.branchId;
    }
    const mediator = request.submitted_payload?.requester ?? {};
    const referralDate = new Date(request.created_at).toISOString().slice(0,10);
    const created: Array<{ itemId: number; candidateId: number; idempotentReplay?: boolean }> = items
      .filter((item: any) => item.status === 'converted')
      .map((item: any) => ({ itemId:Number(item.id),candidateId:Number(item.candidate_id),idempotentReplay:true }));
    for (const item of pendingItems) {
      const { rows: duplicateRows } = await client.query<{ id: number; type: 'Client'|'Candidate' }>(
        `SELECT id,type FROM (
           SELECT id,'Client'::text AS type,1 AS precedence FROM clients WHERE deleted_at IS NULL AND mobile=$1
           UNION ALL
           SELECT id,'Candidate'::text AS type,2 AS precedence FROM candidates WHERE mobile=$1
         ) duplicate ORDER BY precedence,id LIMIT 1`, [item.primary_phone],
      );
      const contacts = [
        { id:'primary',type:'mobile',number:item.primary_phone,label:'رئيسي',hasWhatsApp:item.primary_phone_has_whatsapp,isPrimary:true,status:'active' },
        ...(item.secondary_phone ? [{ id:'secondary',type:'mobile',number:item.secondary_phone,label:'ثانوي',hasWhatsApp:item.secondary_phone_has_whatsapp,isPrimary:false,status:'active' }] : []),
      ];
      const { rows } = await client.query<{ id: number }>(
        `INSERT INTO candidates
         (first_name,last_name,mobile,contacts,address_text,geo_unit_id,owner_user_id,status,
          referral_date,referral_reason,referral_type,referral_origin_channel,referral_name_snapshot,
          referral_entity_id,referral_confirmation_status,occupation,duplicate_flag,duplicate_type,
          duplicate_reference_id,created_by,branch_id)
         VALUES ($1,$2,$3,$4::jsonb,'',$5,NULL,'Suggested',$6,'طلب ترشيح أسماء',$7,'App',$8,$9,
                 'Pending',$10,$11,$12,$13,$14,$15) RETURNING id`,
        [item.first_name,item.last_name,item.primary_phone,JSON.stringify(contacts),item.branch_resolution_geo_unit_id,
         referralDate,mediator.mediatorType ?? 'Personal',mediator.name ?? null,mediator.entityId ?? null,item.occupation,
         duplicateRows.length > 0,duplicateRows[0]?.type ?? null,duplicateRows[0]?.id ?? null,input.actorUserId,item.branch_id],
      );
      const candidateId=Number(rows[0].id);
      await client.query(
        `UPDATE service_request_name_nomination_items SET status='converted',candidate_id=$2,
          decided_by_user_id=$3,decided_at=NOW(),updated_at=NOW() WHERE id=$1`,
        [item.id,candidateId,input.actorUserId],
      );
      await appendAudit(client, { serviceRequestId:input.serviceRequestId,eventType:'name_nomination_item_converted',
        actorUserId:input.actorUserId,actorRole:'operator',payload:{ itemId:Number(item.id),candidateId,branchId:Number(item.branch_id) } });
      created.push({itemId:Number(item.id),candidateId});
    }
    const requestStatus=await finalizeIfComplete(client,input.serviceRequestId,input.actorUserId);
    await client.query('COMMIT');
    return { created, requestStatus:requestStatus ?? 'in_review' };
  } catch (error) { await client.query('ROLLBACK'); throw error; } finally { client.release(); }
}

export async function skipNameNominationItems(input:{serviceRequestId:number;itemIds:number[];reasonId:number;actorUserId:number}) {
  const client=await pool.connect();
  try {
    await client.query('BEGIN');
    await lockRequest(client,input.serviceRequestId,input.actorUserId);
    const itemIds=[...new Set(input.itemIds.map(Number))];
    if (!itemIds.length) throw domainError(400,'item_ids_required');
    const {rows:reasonRows}=await client.query<any>(
      `SELECT id,value,metadata FROM system_lists WHERE id=$1 AND category='name_nomination_item_exclusion_reasons' AND is_active=TRUE`,[input.reasonId],
    );
    if (!reasonRows[0]) throw domainError(400,'invalid_name_nomination_exclusion_reason');
    const {rows:items}=await client.query<any>(
      `SELECT id,status FROM service_request_name_nomination_items WHERE service_request_id=$1 AND id=ANY($2::bigint[]) FOR UPDATE`,
      [input.serviceRequestId,itemIds],
    );
    if(items.length!==itemIds.length) throw domainError(404,'name_nomination_item_not_found');
    if(items.some((x:any)=>x.status!=='pending')) throw domainError(409,'name_nomination_item_already_decided');
    const snapshot={id:Number(reasonRows[0].id),code:String(reasonRows[0].metadata?.code ?? reasonRows[0].value),label:reasonRows[0].value};
    await client.query(
      `UPDATE service_request_name_nomination_items SET status='skipped',exclusion_reason_id=$3,
        exclusion_reason_snapshot=$4::jsonb,decided_by_user_id=$5,decided_at=NOW(),updated_at=NOW()
       WHERE service_request_id=$1 AND id=ANY($2::bigint[])`,
      [input.serviceRequestId,itemIds,input.reasonId,JSON.stringify(snapshot),input.actorUserId],
    );
    for(const itemId of itemIds) await appendAudit(client,{serviceRequestId:input.serviceRequestId,
      eventType:'name_nomination_item_skipped',actorUserId:input.actorUserId,actorRole:'operator',payload:{itemId,reason:snapshot}});
    const requestStatus=await finalizeIfComplete(client,input.serviceRequestId,input.actorUserId);
    await client.query('COMMIT');
    return {skippedItemIds:itemIds,requestStatus:requestStatus ?? 'in_review'};
  } catch(error){await client.query('ROLLBACK');throw error;} finally{client.release();}
}
