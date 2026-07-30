import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import test from 'node:test';

test('task details are read-only for execution results and link to the visit', () => {
  const resultTab = readFileSync(
    new URL('./tabs/TaskResultTab.tsx', import.meta.url),
    'utf8',
  );

  assert.match(resultTab, /تُسجّل نتيجة التنفيذ من داخل الزيارة المرتبطة فقط/);
  assert.match(resultTab, /to=\{`\/field-visits\/\$\{activeVisit\.id\}`\}/);
  assert.doesNotMatch(resultTab, /setShowResultModal|recordTaskResult|<ResultModal/);
});

test('task details expose pre-schedule cancellation instead of result entry', () => {
  const layout = readFileSync(
    new URL('./TaskDetailLayout.tsx', import.meta.url),
    'utf8',
  );

  assert.match(layout, /canCancelOpenTaskBeforeScheduling\(task\.status, Boolean\(task\.activeVisit\)\)/);
  assert.match(layout, /<CancelOpenTaskModal/);
  assert.match(layout, /إلغاء المهمة/);
});

test('visit details use the centralized result modal host', () => {
  const visitPage = readFileSync(
    new URL('../../pages/visits/VisitDetailPage.tsx', import.meta.url),
    'utf8',
  );

  assert.match(visitPage, /hasVisitTaskResultModal\(task\.task_type\)/);
  assert.match(visitPage, /<VisitTaskResultModalHost/);
  assert.doesNotMatch(visitPage, /RESULT_MODAL_TASK_TYPES/);
});

test('secondary task surfaces cannot open or submit operational result forms', () => {
  const evaluationLab = readFileSync(
    new URL('../../pages/tasks/TaskEvaluationLab.tsx', import.meta.url),
    'utf8',
  );
  const postSaleStepper = readFileSync(
    new URL('./PostSaleStepper.tsx', import.meta.url),
    'utf8',
  );
  const emergencyTaskDetail = readFileSync(
    new URL('../../pages/tasks/EmergencyTaskDetail.tsx', import.meta.url),
    'utf8',
  );

  assert.doesNotMatch(evaluationLab, /ResultModal from|<EmergencyResultModal|<ActiveResultModal/);
  assert.match(evaluationLab, /معاينة النتيجة/);
  assert.match(postSaleStepper, /navigate\(`\/field-visits\/\$\{visitId\}`\)/);
  assert.doesNotMatch(postSaleStepper, /handleSubmitDeliveryResult|تأكيد وحفظ النتيجة/);
  assert.doesNotMatch(emergencyTaskDetail, /EmergencyResultRenderer|ResultRenderer:/);
});
