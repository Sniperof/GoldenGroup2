import fs from 'node:fs';
import { Router } from 'express';
import { requirePermission } from '../middleware/permission.js';
import pool from '../db.js';
import { canAccessComplaint } from '../policies/complaintPolicy.js';
import { absolutePathFor } from '../services/media/mediaStorage.js';
import {
  addComplaintText, assignComplaintBranch, assignComplaintHandler, changeComplaintPriority,
  createInternalComplaint, getComplaint, listComplaints, transitionComplaint,
  getInternalComplaintContext,
  getComplaintReport, getComplaintSettings, reviewComplaintDuplicate, updateComplaintSettings,
  changeComplaintType, linkComplaintEntity,
  getComplaintClientOption, listComplaintClientDevices, listComplaintClientOptions,
  listComplaintClientVisits, listComplaintCreateBranches,
} from '../services/complaints/complaintService.js';

const router = Router();

function id(value: unknown): number {
  const parsed = Number(value);
  if (!Number.isInteger(parsed) || parsed <= 0) throw Object.assign(new Error('invalid_complaint_id'), { status: 400 });
  return parsed;
}

function sendError(res: any, error: any) {
  const status = Number(error?.status) || 500;
  if (status >= 500) console.error('Complaint route error:', error);
  return res.status(status).json({ error: error?.message ?? 'complaint_operation_failed', ...(error?.details ? { details: error.details } : {}) });
}

router.get('/', requirePermission('complaints.view_list'), async (req, res) => {
  try { res.json(await listComplaints(req.authContext!, req.query as Record<string, unknown>)); }
  catch (error) { sendError(res, error); }
});

router.post('/', requirePermission('complaints.create_internal'), async (req, res) => {
  try { res.status(201).json(await createInternalComplaint(req.authContext!, req.body ?? {})); }
  catch (error) { sendError(res, error); }
});

router.get('/context/:kind/:recordId', requirePermission('complaints.create_internal'), async (req,res)=>{
  try{const kind=req.params.kind;if(kind!=='visit'&&kind!=='device')return res.status(400).json({error:'invalid_complaint_context'});res.json(await getInternalComplaintContext(req.authContext!,kind,id(req.params.recordId)));}
  catch(error){sendError(res,error);}
});

router.get('/lookups/branches',requirePermission('complaints.create_internal'),async(req,res)=>{
  try{res.json(await listComplaintCreateBranches(req.authContext!));}catch(error){sendError(res,error);}
});

router.get('/lookups/clients',requirePermission('complaints.create_internal'),async(req,res)=>{
  try{res.json(await listComplaintClientOptions(req.authContext!,req.query.branchId,req.query.search));}catch(error){sendError(res,error);}
});

router.get('/lookups/clients/:clientId',requirePermission('complaints.create_internal'),async(req,res)=>{
  try{res.json(await getComplaintClientOption(req.authContext!,req.params.clientId,req.query.branchId));}catch(error){sendError(res,error);}
});

router.get('/lookups/clients/:clientId/devices',requirePermission('complaints.create_internal'),async(req,res)=>{
  try{res.json(await listComplaintClientDevices(req.authContext!,req.params.clientId,req.query.branchId));}catch(error){sendError(res,error);}
});

router.get('/lookups/clients/:clientId/visits',requirePermission('complaints.create_internal'),async(req,res)=>{
  try{res.json(await listComplaintClientVisits(req.authContext!,req.params.clientId,req.query.branchId));}catch(error){sendError(res,error);}
});

router.get('/reports/summary', requirePermission('complaints.view_reports'), async(req,res)=>{
  try{res.json(await getComplaintReport(req.authContext!));}catch(error){sendError(res,error);}
});

router.get('/settings/:kind', requirePermission('complaints.manage_duplicate_settings','complaints.manage_abuse_settings'), async(req,res)=>{
  try{const kind=req.params.kind;if(kind!=='duplicates'&&kind!=='abuse')return res.status(400).json({error:'invalid_complaint_settings_kind'});res.json(await getComplaintSettings(req.authContext!,kind));}catch(error){sendError(res,error);}
});

router.put('/settings/:kind', requirePermission('complaints.manage_duplicate_settings','complaints.manage_abuse_settings'), async(req,res)=>{
  try{const kind=req.params.kind;if(kind!=='duplicates'&&kind!=='abuse')return res.status(400).json({error:'invalid_complaint_settings_kind'});res.json(await updateComplaintSettings(req.authContext!,kind,req.body??{}));}catch(error){sendError(res,error);}
});

router.get('/:id', requirePermission('complaints.view_details'), async (req, res) => {
  try { res.json(await getComplaint(req.authContext!, id(req.params.id))); }
  catch (error) { sendError(res, error); }
});

router.get('/:id/audit', requirePermission('complaints.view_audit'), async(req,res)=>{
  try{const complaintId=id(req.params.id);const subject=await pool.query(`SELECT handling_branch_id AS "handlingBranchId",assigned_user_id AS "assignedUserId" FROM complaints WHERE id=$1`,[complaintId]);if(!subject.rows[0])return res.status(404).json({error:'complaint_not_found'});if(!canAccessComplaint(req.authContext!,'complaints.view_audit',subject.rows[0]).allowed)return res.status(403).json({error:'complaint_scope_denied'});const {rows}=await pool.query(`SELECT id,event_type AS "eventType",actor_type AS "actorType",actor_user_id AS "actorUserId",actor_app_account_id AS "actorAppAccountId",metadata,created_at AS "createdAt" FROM complaint_audit_log WHERE complaint_id=$1 ORDER BY created_at,id`,[complaintId]);res.json({items:rows});}catch(error){sendError(res,error);}
});

router.get('/:id/attachments/:attachmentId', requirePermission('complaints.view_attachments'), async (req, res) => {
  try {
    const complaintId=id(req.params.id); const attachmentId=id(req.params.attachmentId);
    const {rows}=await pool.query(`SELECT c.handling_branch_id AS "handlingBranchId",c.assigned_user_id AS "assignedUserId",mf.public_id,mf.extension,mf.mime_type FROM complaints c JOIN complaint_attachments ca ON ca.complaint_id=c.id JOIN media_files mf ON mf.id=ca.media_file_id WHERE c.id=$1 AND ca.id=$2 AND mf.visibility='private'`,[complaintId,attachmentId]);
    if(!rows[0])return res.status(404).json({error:'attachment_not_found'});
    if(!canAccessComplaint(req.authContext!,'complaints.view_attachments',rows[0]).allowed)return res.status(403).json({error:'complaint_scope_denied'});
    res.setHeader('Cache-Control','private, no-store');res.type(rows[0].mime_type);
    return fs.createReadStream(absolutePathFor(rows[0].public_id,rows[0].extension)).pipe(res);
  } catch(error){sendError(res,error);}
});

router.get('/:id/attachments/:attachmentId/download', requirePermission('complaints.download_attachments'), async(req,res)=>{
  try{const complaintId=id(req.params.id);const attachmentId=id(req.params.attachmentId);const {rows}=await pool.query(`SELECT c.handling_branch_id AS "handlingBranchId",c.assigned_user_id AS "assignedUserId",mf.public_id,mf.extension,mf.mime_type FROM complaints c JOIN complaint_attachments ca ON ca.complaint_id=c.id JOIN media_files mf ON mf.id=ca.media_file_id WHERE c.id=$1 AND ca.id=$2 AND mf.visibility='private'`,[complaintId,attachmentId]);if(!rows[0])return res.status(404).json({error:'attachment_not_found'});if(!canAccessComplaint(req.authContext!,'complaints.download_attachments',rows[0]).allowed)return res.status(403).json({error:'complaint_scope_denied'});res.setHeader('Cache-Control','private, no-store');res.setHeader('Content-Disposition',`attachment; filename="complaint-${complaintId}-${attachmentId}.${rows[0].extension}"`);res.type(rows[0].mime_type);return fs.createReadStream(absolutePathFor(rows[0].public_id,rows[0].extension)).pipe(res);}catch(error){sendError(res,error);}
});

router.post('/:id/assign-branch', requirePermission('complaints.assign_branch'), async (req, res) => {
  try { res.json(await assignComplaintBranch(req.authContext!, id(req.params.id), id(req.body?.branchId), req.body?.reason, 'assign')); }
  catch (error) { sendError(res, error); }
});

router.post('/:id/transfer-branch', requirePermission('complaints.transfer_branch'), async (req, res) => {
  try { res.json(await assignComplaintBranch(req.authContext!, id(req.params.id), id(req.body?.branchId), req.body?.reason, 'transfer')); }
  catch (error) { sendError(res, error); }
});

router.post('/:id/assign-handler', requirePermission('complaints.assign_handler'), async (req, res) => {
  try { res.json(await assignComplaintHandler(req.authContext!, id(req.params.id), id(req.body?.userId), req.body?.reason, 'assign')); }
  catch (error) { sendError(res, error); }
});

router.post('/:id/reassign-handler', requirePermission('complaints.reassign_handler'), async (req, res) => {
  try { res.json(await assignComplaintHandler(req.authContext!, id(req.params.id), id(req.body?.userId), req.body?.reason, 'reassign')); }
  catch (error) { sendError(res, error); }
});

router.patch('/:id/change-priority', requirePermission('complaints.change_priority'), async (req, res) => {
  try { res.json(await changeComplaintPriority(req.authContext!, id(req.params.id), req.body?.priority)); }
  catch (error) { sendError(res, error); }
});

router.post('/:id/change-type',requirePermission('complaints.change_type'),async(req,res)=>{try{res.json(await changeComplaintType(req.authContext!,id(req.params.id),req.body??{}));}catch(error){sendError(res,error);}});

router.post('/:id/link-requester',requirePermission('complaints.link_requester'),async(req,res)=>{try{res.json(await linkComplaintEntity(req.authContext!,id(req.params.id),'requester',req.body??{}));}catch(error){sendError(res,error);}});
router.post('/:id/link-visit',requirePermission('complaints.link_visit'),async(req,res)=>{try{res.json(await linkComplaintEntity(req.authContext!,id(req.params.id),'visit',req.body??{}));}catch(error){sendError(res,error);}});
router.post('/:id/link-device',requirePermission('complaints.link_device'),async(req,res)=>{try{res.json(await linkComplaintEntity(req.authContext!,id(req.params.id),'device',req.body??{}));}catch(error){sendError(res,error);}});
router.post('/:id/link-target',requirePermission('complaints.link_target'),async(req,res)=>{try{res.json(await linkComplaintEntity(req.authContext!,id(req.params.id),'target',req.body??{}));}catch(error){sendError(res,error);}});
router.post('/:id/link-operational-work',requirePermission('complaints.link_operational_work'),async(req,res)=>{try{res.json(await linkComplaintEntity(req.authContext!,id(req.params.id),'operational',req.body??{}));}catch(error){sendError(res,error);}});

router.post('/:id/internal-notes', requirePermission('complaints.add_internal_note'), async (req, res) => {
  try { res.status(201).json(await addComplaintText(req.authContext!, id(req.params.id), 'note', req.body?.note)); }
  catch (error) { sendError(res, error); }
});

router.post('/:id/public-updates', requirePermission('complaints.publish_update'), async (req, res) => {
  try { res.status(201).json(await addComplaintText(req.authContext!, id(req.params.id), 'update', req.body?.message)); }
  catch (error) { sendError(res, error); }
});

router.post('/:id/review-duplicate', requirePermission('complaints.review_duplicates'), async(req,res)=>{
  try{res.json(await reviewComplaintDuplicate(req.authContext!,id(req.params.id),req.body??{}));}catch(error){sendError(res,error);}
});

const actions = {
  triage: { to: 'triaged', permission: 'complaints.triage' },
  'start-processing': { to: 'in_progress', permission: 'complaints.start_processing' },
  'request-information': { to: 'awaiting_complainant', permission: 'complaints.request_information' },
  'resume-processing': { to: 'in_progress', permission: 'complaints.resume_processing' },
  resolve: { to: 'resolved', permission: 'complaints.resolve' },
  close: { to: 'closed', permission: 'complaints.close' },
  reject: { to: 'rejected', permission: 'complaints.reject' },
  withdraw: { to: 'withdrawn', permission: 'complaints.withdraw' },
  reopen: { to: 'in_progress', permission: 'complaints.reopen' },
} as const;

for (const [action, config] of Object.entries(actions)) {
  router.post(`/:id/${action}`, requirePermission(config.permission), async (req, res) => {
    try {
      res.json(await transitionComplaint(req.authContext!, id(req.params.id), {
        ...req.body,
        internalNotes: req.body?.internalNotes ?? req.body?.internalResolutionNotes,
        publicSummary: req.body?.publicSummary ?? req.body?.publicResolutionSummary,
        to: config.to, permission: config.permission,
      }));
    } catch (error) { sendError(res, error); }
  });
}

export default router;
