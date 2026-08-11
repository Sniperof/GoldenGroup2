import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import test from 'node:test';

const read = (relativeUrl: string) => readFileSync(new URL(relativeUrl, import.meta.url), 'utf8');

const migration = read('../../../migrations/402_field_visit_booking_contact_context.sql');
const reconciliation = read('../../../migrations/403_reconcile_visit_booking_contact_context.sql');
const bookingService = read('./visitBooking.ts');
const telemarketingRoute = read('../routes/telemarketing.ts');
const fieldVisitsRoute = read('../routes/fieldVisits.ts');
const telemarketingStore = read('../../web/src/hooks/useTelemarketingStore.ts');
const workspace = read('../../web/src/pages/TelemarketerWorkspace.tsx');
const visitDetail = read('../../web/src/pages/visits/VisitDetailPage.tsx');

test('migration separates field instructions and links the booking call log', () => {
  assert.match(migration, /ADD COLUMN IF NOT EXISTS field_instructions TEXT/);
  assert.match(migration, /ADD COLUMN IF NOT EXISTS booking_call_log_id VARCHAR\(100\)/);
  assert.match(migration, /REFERENCES public\.telemarketing_call_logs\(id\)/);
  assert.match(migration, /answered_by IN \('customer', 'spouse', 'child', 'other'\)/);
});

test('historical reconciliation only accepts a same-subject booking call within two minutes', () => {
  assert.match(reconciliation, /ccl\.customer_id = fv\.client_id/);
  assert.match(reconciliation, /ccl\.caller_id IS NOT DISTINCT FROM fv\.booked_by_telemarketer_id/);
  assert.match(reconciliation, /<= 120/);
  assert.match(reconciliation, /field_instructions = COALESCE/);
  assert.match(reconciliation, /telemarketer_notes = NULLIF\(BTRIM\(matched\.notes\), ''\)/);
  assert.match(reconciliation, /booking_call_log_id = matched\.call_log_id/);
});

test('canonical visit booking persists the complete contact context', () => {
  assert.match(
    bookingService,
    /telemarketer_notes,\s*answered_by,\s*field_instructions,\s*booking_call_log_id,\s*created_by/,
  );
  assert.match(bookingService, /input\.telemarketerNotes \?\? null/);
  assert.match(bookingService, /input\.answeredBy \?\? null/);
  assert.match(bookingService, /input\.fieldInstructions \?\? null/);
  assert.match(bookingService, /input\.bookingCallLogId \?\? null/);
});

test('telemarketing booking authorizes the call-log subject and forwards all fields', () => {
  assert.match(telemarketingRoute, /entity_id = \$2[\s\S]*called_by IS NOT DISTINCT FROM \$3/);
  assert.match(telemarketingRoute, /telemarketerNotes: body\.telemarketerNotes \?\? body\.notes \?\? null/);
  assert.match(telemarketingRoute, /answeredBy: answeredBy as/);
  assert.match(telemarketingRoute, /fieldInstructions: body\.fieldInstructions \?\? null/);
  assert.match(telemarketingRoute, /bookingCallLogId,/);
});

test('workspace carries call result data into the visit booking request', () => {
  assert.match(workspace, /const savedCallLog = await addCallLog/);
  assert.match(workspace, /callLogId: bookingCallLogId/);
  assert.match(workspace, /telemarketerNotes: notes \|\| null/);
  assert.match(workspace, /answeredBy: extras\?\.answeredBy \?\? null/);
  assert.match(workspace, /fieldInstructions: extras\?\.technicianNotes \?\? null/);
  assert.match(telemarketingStore, /return saved;/);
  assert.match(telemarketingStore, /fieldInstructions: contactContext\?\.fieldInstructions/);
});

test('visit detail keeps pre-visit instructions distinct from field notes', () => {
  assert.match(visitDetail, /value=\{visit\.telemarketer_notes\}/);
  assert.match(visitDetail, /value=\{visit\.field_instructions\}/);
  assert.match(visitDetail, /value=\{visit\.field_notes\}/);
});

test('visit detail reads the booked water source before the live customer fallback', () => {
  assert.match(
    fieldVisitsRoute,
    /COALESCE\(\s*NULLIF\(fv\.customer_snapshot->>'waterSource', ''\),\s*NULLIF\(fv\.customer_snapshot->>'water_source', ''\),\s*c\.water_source\s*\) AS client_water_source/,
  );
});
