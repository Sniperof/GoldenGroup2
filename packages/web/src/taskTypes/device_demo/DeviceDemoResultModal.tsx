import { useEffect, useMemo, useState } from 'react';
import type {
  DeviceModel,
  Employee,
  MarketingVisit,
  MarketingVisitTask,
  MarketingVisitTaskOutcomeRequest,
} from '@golden-crm/shared';
import { api } from '../../lib/api';
import MarketingVisitOutcomeModal from '../../components/marketing-visits/MarketingVisitOutcomeModal';

interface Props {
  visitId: number;
  taskId: number;
  visit?: any | null;
  task?: any | null;
  preOffers?: any[];
  onClose: () => void;
  onSaved: () => void;
}

function toNumber(value: any): number | null {
  const parsed = Number(value);
  return Number.isFinite(parsed) && parsed > 0 ? parsed : null;
}

function normalizePreOffer(offer: any) {
  // `openTaskPreOfferId` carries the existing open_task_pre_offers.id when the
  // offer was loaded from the task (vs. authored fresh in the wizard). The
  // backend uses it as the primary UPDATE key so result recording mutates the
  // existing row even when `source_customer_pre_offer_id` is NULL (which is
  // the common case for offers authored manually in DeviceOfferModal).
  return {
    openTaskPreOfferId: offer.openTaskPreOfferId ?? offer.open_task_pre_offer_id ?? offer.id ?? null,
    deviceModelId: Number(offer.deviceModelId ?? offer.device_model_id),
    offerType: offer.offerType ?? offer.offer_type,
    quantity: Number(offer.quantity ?? 1),
    totalAmount: Number(offer.totalAmount ?? offer.total_amount),
    firstPaymentAmount: offer.firstPaymentAmount ?? offer.first_payment_amount ?? null,
    installmentMonths: offer.installmentMonths ?? offer.installment_months ?? null,
    discountPercentage: offer.discountPercentage ?? offer.discount_percentage ?? null,
    closedByEmployeeId: offer.closedByEmployeeId ?? offer.closed_by_employee_id ?? null,
    noClosingReason: offer.noClosingReason ?? offer.no_closing_reason ?? null,
    customerResponse: offer.customerResponse ?? offer.customer_response ?? null,
    saleReferenceNumber: offer.saleReferenceNumber ?? offer.sale_reference_number ?? null,
    sourceCustomerPreOfferId: offer.sourceCustomerPreOfferId ?? offer.source_customer_pre_offer_id ?? null,
  };
}

function buildWizardTask(taskId: number, task: any | null | undefined, preOffers: any[]): MarketingVisitTask {
  const normalizedPreOffers = preOffers.map(normalizePreOffer).filter((offer) =>
    Number.isFinite(offer.deviceModelId) &&
    offer.deviceModelId > 0 &&
    ['cash', 'installment'].includes(offer.offerType) &&
    Number.isFinite(offer.totalAmount) &&
    offer.totalAmount > 0
  );
  // When activeVisit exists, the modal opens to record a NEW result for the
  // currently-live booking. Any latestFinalDecision/outcome on the task
  // reflects a PRIOR attempt's result and must not be treated as "already
  // saved" for the active attempt — otherwise the wizard would prefill with
  // a past decision (e.g. 'rescheduled') and surface stale offers as
  // "savedOffers". The diagnostic fix: only treat the task as having a
  // saved outcome when there is no active booking.
  const isRecordingNewAttempt = task?.activeVisit != null;
  const hasSavedOutcome = !isRecordingNewAttempt && (
    task?.outcome != null ||
    task?.latestFinalDecision != null ||
    task?.final_decision != null ||
    task?.result != null ||
    task?.result_id != null
  );
  const rawSavedOffers = Array.isArray(task?.offers) && task.offers.length > 0
    ? task.offers
    : normalizedPreOffers;
  const savedOffers = hasSavedOutcome
    ? rawSavedOffers.map(normalizePreOffer).filter((offer: ReturnType<typeof normalizePreOffer>) =>
        Number.isFinite(offer.deviceModelId) &&
        offer.deviceModelId > 0 &&
        ['cash', 'installment'].includes(offer.offerType) &&
        Number.isFinite(offer.totalAmount) &&
        offer.totalAmount > 0
      )
    : [];

  return {
    id: String(taskId),
    visitId: String(task?.marketingVisitId ?? task?.visitId ?? ''),
    taskType: 'device_demo',
    status: task?.status === 'completed' ? 'completed' : 'pending',
    result: task?.result ?? null,
    offers: savedOffers,
    createdAt: task?.createdAt ?? new Date().toISOString(),
    updatedAt: task?.updatedAt ?? new Date().toISOString(),
    // Outcome/notes/closer fields only carry meaning when we're reading back a
    // saved attempt. For a new attempt against an active booking these MUST
    // start blank — leaking from lastAttempt would prefill the wizard with
    // the previous attempt's data.
    outcome: isRecordingNewAttempt
      ? null
      : (task?.outcome ?? task?.latestFinalDecision ?? task?.final_decision ?? null),
    resultNotes: isRecordingNewAttempt ? null : (task?.resultNotes ?? task?.closingNotes ?? null),
    soldDeviceModelId: isRecordingNewAttempt
      ? null
      : (task?.soldDeviceModelId ?? task?.sold_device_model_id ?? null),
    closedByEmployeeId: isRecordingNewAttempt
      ? null
      : (task?.closedByEmployeeId ?? task?.closed_by_employee_id ?? null),
    cancellationReasonId: task?.cancellationReasonId ?? null,
    rescheduleReasonId: task?.rescheduleReasonId ?? null,
    followUpDueDate: task?.followUpDueDate ?? task?.expectedDate ?? null,
    sourceOpenTaskId: task?.sourceOpenTaskId ?? task?.source_open_task_id ?? task?.id ?? null,
    preOffers: normalizedPreOffers,
  } as MarketingVisitTask;
}

function buildWizardVisit(visitId: number, visit: any | null | undefined, task: any | null | undefined): MarketingVisit {
  const clientId = toNumber(visit?.client_id ?? visit?.clientId ?? task?.clientId) ?? 0;
  const requestedDeviceModelId = toNumber(
    visit?.requestedDeviceModelId ??
    visit?.requested_device_model_id ??
    task?.requestedDeviceModelId ??
    task?.offeredDeviceModelId,
  );

  return {
    id: String(visitId),
    branchId: toNumber(visit?.branch_id ?? visit?.branchId ?? task?.branchId) ?? 0,
    clientId,
    visitType: 'marketing' as any,
    status: visit?.status ?? 'ended',
    scheduledDate: visit?.scheduled_date ?? visit?.scheduledDate ?? task?.scheduledDate ?? '',
    scheduledTime: visit?.scheduled_time ?? visit?.scheduledTime ?? task?.scheduledTime ?? '',
    sourceType: 'telemarketing_appointment',
    sourceId: String(visit?.origin_id ?? visit?.sourceId ?? ''),
    contactTargetId: visit?.contact_target_id ?? visit?.contactTargetId ?? task?.contactTargetId ?? null,
    teamKey: visit?.team_snapshot?.teamKey ?? visit?.teamKey ?? task?.assignedTeamKey ?? null,
    requestedDeviceModelId,
    requestedDeviceName:
      visit?.requestedDeviceName ??
      visit?.requested_device_name ??
      task?.requestedDeviceName ??
      task?.offeredDeviceModelName ??
      null,
    waterSource: visit?.water_source ?? visit?.waterSource ?? task?.waterSource ?? null,
    technicianNotes: visit?.telemarketer_notes ?? visit?.technicianNotes ?? task?.notes ?? null,
    customerName: visit?.customer_snapshot?.name ?? visit?.client_name ?? visit?.customerName ?? task?.clientName ?? null,
    customerAddress: visit?.customer_snapshot?.addressText ?? visit?.customerAddress ?? task?.addressText ?? null,
    customerMobile: visit?.customer_snapshot?.mobile ?? visit?.customerMobile ?? task?.primaryPhone ?? null,
    teamSnapshot: visit?.team_snapshot ?? visit?.teamSnapshot ?? task?.teamSnapshot ?? null,
    task: null,
    tasks: [],
    createdAt: visit?.created_at ?? visit?.createdAt ?? new Date().toISOString(),
    updatedAt: visit?.updated_at ?? visit?.updatedAt ?? new Date().toISOString(),
  };
}

function mapOutcomePayload(payload: MarketingVisitTaskOutcomeRequest) {
  if (payload.outcome === 'device_sold' && payload.offers?.length) {
    const offers = payload.offers.map((offer) => ({
      open_task_pre_offer_id: (offer as any).openTaskPreOfferId ?? null,
      device_model_id: Number(offer.deviceModelId),
      offer_type: offer.offerType,
      quantity: Number(offer.quantity ?? 1),
      total_amount: Number(offer.totalAmount),
      currency: offer.currency ?? 'SYP',
      first_payment_amount: offer.firstPaymentAmount ?? null,
      installment_months: offer.installmentMonths ?? null,
      discount_percentage: offer.discountPercentage ?? null,
      applied_device_discount_id: offer.appliedDeviceDiscountId ?? null,
      closed_by_employee_id: offer.closedByEmployeeId ?? null,
      customer_response: 'accepted',
      no_closing_reason: offer.noClosingReason ?? null,
      sale_reference_number: offer.saleReferenceNumber ?? null,
      source_customer_pre_offer_id: offer.sourceCustomerPreOfferId ?? null,
    }));
    const firstOffer = payload.offers[0];
    return {
      final_decision: 'offer_presented',
      closed_by_employee_id:
        firstOffer.closedByEmployeeId ??
        payload.closedByEmployeeId ??
        null,
      closing_notes: payload.notes ?? null,
      offers,
      expected_date: null,
      expected_time: null,
    };
  }

  if (payload.offers?.length) {
    const offers = (payload.offers ?? []).map((offer) => ({
      open_task_pre_offer_id: (offer as any).openTaskPreOfferId ?? null,
      device_model_id: Number(offer.deviceModelId),
      offer_type: offer.offerType,
      quantity: Number(offer.quantity ?? 1),
      total_amount: Number(offer.totalAmount),
      currency: offer.currency ?? 'SYP',
      first_payment_amount: offer.firstPaymentAmount ?? null,
      installment_months: offer.installmentMonths ?? null,
      discount_percentage: offer.discountPercentage ?? null,
      applied_device_discount_id: offer.appliedDeviceDiscountId ?? null,
      closed_by_employee_id: offer.closedByEmployeeId ?? null,
      customer_response: offer.customerResponse ?? (payload.outcome === 'device_sold' ? 'accepted' : null),
      no_closing_reason: offer.noClosingReason ?? null,
      sale_reference_number: offer.saleReferenceNumber ?? null,
      source_customer_pre_offer_id: offer.sourceCustomerPreOfferId ?? null,
    }));
    const firstAccepted = payload.offers.find((offer) => offer.customerResponse === 'accepted');
    const firstOffer = payload.offers[0];
    return {
      final_decision: 'offer_presented',
      closed_by_employee_id:
        firstAccepted?.closedByEmployeeId ??
        firstOffer?.closedByEmployeeId ??
        payload.closedByEmployeeId ??
        null,
      closing_notes: payload.notes ?? null,
      offers,
      expected_date:
        offers.some((offer) => offer.customer_response === 'extension_requested')
          ? payload.followUpDueDate ?? null
          : null,
      expected_time: null,
    };
  }

  if (payload.outcome === 'device_sold') {
    return {
      final_decision: 'device_sold',
      sold_device_model_id: payload.soldDeviceModelId,
      offer_type: payload.offerType ?? 'cash',
      offer_amount: payload.cashOfferAmount ?? payload.installmentAmount,
      installment_months: payload.installmentMonths ?? null,
      discount_percentage: payload.discountPercentage ?? null,
      closed_by_employee_id: payload.closedByEmployeeId ?? null,
      closing_notes: payload.notes ?? null,
    };
  }

  if (payload.outcome === 'rescheduled') {
    return {
      final_decision: 'rescheduled',
      reason_code_id: payload.rescheduleReasonId,
      expected_date: payload.followUpDueDate,
      expected_time: null,
      closing_notes: payload.notes ?? null,
    };
  }

  if (payload.outcome === 'cancelled') {
    return {
      final_decision: 'cancelled',
      reason_code_id: payload.cancellationReasonId,
      closing_notes: payload.notes ?? null,
    };
  }

  return null;
}

export default function DeviceDemoResultModal({
  visitId,
  taskId,
  visit,
  task,
  preOffers = [],
  onClose,
  onSaved,
}: Props) {
  const [employees, setEmployees] = useState<Employee[]>([]);
  const [deviceModels, setDeviceModels] = useState<DeviceModel[]>([]);
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState('');

  useEffect(() => {
    let active = true;
    Promise.all([
      api.employees.list().catch(() => []),
      api.deviceModels.list?.({ activeOnly: true }).catch(() => []) ?? [],
    ]).then(([employeeRows, modelRows]) => {
      if (!active) return;
      setEmployees(Array.isArray(employeeRows) ? employeeRows : []);
      setDeviceModels(Array.isArray(modelRows) ? modelRows : []);
    });
    return () => { active = false; };
  }, []);

  const wizardTask = useMemo(
    () => buildWizardTask(taskId, task, preOffers),
    [taskId, task, preOffers],
  );
  const wizardVisit = useMemo(() => {
    const v = buildWizardVisit(visitId, visit, task);
    return { ...v, task: wizardTask, tasks: [wizardTask] };
  }, [visitId, visit, task, wizardTask]);

  const handleSubmit = async (payload: MarketingVisitTaskOutcomeRequest) => {
    const body = mapOutcomePayload(payload);
    if (!body) {
      setError('تعذر تحويل نتيجة المعالج إلى نموذج نتيجة عرض الجهاز الجديد.');
      return;
    }

    setSaving(true);
    setError('');
    try {
      await api.fieldVisits.recordTaskResult(visitId, taskId, body);
      onSaved();
    } catch (err: any) {
      setError(err?.message ?? 'فشل تسجيل النتيجة');
    } finally {
      setSaving(false);
    }
  };

  return (
    <MarketingVisitOutcomeModal
      isOpen
      task={wizardTask}
      visit={wizardVisit}
      employees={employees}
      deviceModels={deviceModels}
      saving={saving}
      error={error}
      onClose={onClose}
      onSubmit={handleSubmit}
    />
  );
}
