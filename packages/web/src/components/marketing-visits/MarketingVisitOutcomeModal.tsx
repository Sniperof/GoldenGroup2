import { useEffect, useMemo, useRef, useState } from 'react';
import IconButton from '../ui/IconButton';
import {
  Clock3,
  Loader2,
  Package2,
  Pencil,
  Plus,
  RotateCcw,
  ShoppingCart,
  Trash2,
  X,
  XCircle,
  type LucideIcon,
} from 'lucide-react';
import type {
  DeviceModel,
  Employee,
  MarketingVisit,
  MarketingVisitTask,
  MarketingVisitTaskOutcome,
  MarketingVisitTaskOutcomeRequest,
  SystemList,
} from '@golden-crm/shared';
import { api } from '../../lib/api';
import Select from '../ui/Select';
import Button from '../ui/Button';

interface MarketingVisitOutcomeModalProps {
  isOpen: boolean;
  task: MarketingVisitTask | null;
  visit: MarketingVisit | null;
  employees: Employee[];
  deviceModels?: DeviceModel[];
  saving: boolean;
  error: string;
  onClose: () => void;
  onSubmit: (payload: MarketingVisitTaskOutcomeRequest) => Promise<void>;
}

type WizardStep = 0 | 1 | 2 | 3 | 4;
type OfferType = 'cash' | 'installment';
type CustomerResponse = 'accepted' | 'rejected' | 'extension_requested' | null;
type OverallOutcome = 'device_sold' | 'offer_presented' | 'needs_reschedule' | 'cancelled';

interface DeviceOffer {
  id: string;
  // `openTaskPreOfferId` survives the trip from API → wizard → submit so the
  // backend can update the existing open_task_pre_offers row by primary key
  // instead of creating a duplicate when `source_customer_pre_offer_id` is NULL.
  openTaskPreOfferId?: number | null;
  offerType: OfferType;
  quantity: number;
  totalAmount: number;
  firstPaymentAmount: number | null;
  installmentMonths: number | null;
  discountPercentage: number | null;
  appliedDeviceDiscountId: number | null;
  closedByEmployeeId: number | null;
  noClosingReason: string | null;
  customerResponse: CustomerResponse;
  rejectionReasonId: number | null;
  extensionReasonId: number | null;
  extensionDueDate: string | null;
  saleReferenceNumber: string | null;
  sourceCustomerPreOfferId?: number | null;
}

interface DeviceOfferGroup {
  deviceModelId: number;
  deviceModelName: string;
  offers: DeviceOffer[];
}

interface WizardState {
  step: WizardStep;
  overallOutcome: OverallOutcome | '';
  deviceOffers: DeviceOfferGroup[];
  notes: string;
}

interface OfferDraft {
  offerType: OfferType | '';
  quantity: string;
  totalAmount: string;
  firstPaymentAmount: string;
  installmentMonths: string;
  discountPercentage: string;
  appliedDeviceDiscountId: string;
  closedByEmployeeId: string;
  noClosingReason: string;
}

interface OfferEditorState {
  deviceModelId: number;
  offerId: string | null;
  draft: OfferDraft;
}

interface VisitDeviceLike {
  deviceModelId?: number | null;
  deviceModelName?: string | null;
  requestedDeviceModelId?: number | null;
  requestedDeviceName?: string | null;
  name?: string | null;
}

interface PreOfferLike {
  openTaskPreOfferId?: number | null;
  deviceModelId: number;
  offerType: OfferType;
  quantity?: number | null;
  totalAmount: number;
  firstPaymentAmount?: number | null;
  installmentMonths?: number | null;
  discountPercentage?: number | null;
  appliedDeviceDiscountId?: number | null;
  closedByEmployeeId?: number | null;
  noClosingReason?: string | null;
  customerResponse?: CustomerResponse;
  saleReferenceNumber?: string | null;
  sourceCustomerPreOfferId?: number | null;
}

const OUTCOME_OPTIONS: Array<{
  value: OverallOutcome;
  label: string;
  description: string;
  icon: LucideIcon;
  color: string;
}> = [
  {
    value: 'offer_presented',
    label: 'تقديم عرض',
    description: 'تسجيل عدة عروض وربط رد الزبون بكل عرض',
    icon: ShoppingCart,
    color: 'border-sky-200 bg-sky-50 text-sky-700 hover:bg-sky-100',
  },
  {
    value: 'needs_reschedule',
    label: 'إعادة جدولة',
    description: 'تحتاج الزيارة إلى متابعة لاحقة',
    icon: RotateCcw,
    color: 'border-blue-200 bg-blue-50 text-blue-700 hover:bg-blue-100',
  },
  {
    value: 'cancelled',
    label: 'إلغاء',
    description: 'إلغاء الزيارة أو إقفالها بدون متابعة',
    icon: XCircle,
    color: 'border-slate-300 bg-slate-50 text-slate-600 hover:bg-slate-100',
  },
];

const STEP_TITLES: Record<WizardStep, string> = {
  0: 'نتيجة المهمة',
  1: 'أجهزة الزيارة — العروض',
  2: 'ملخص العروض المقدمة',
  3: 'ردود الزبون',
  4: 'الملخص',
};

function parsePositiveNumber(value: string): number | null {
  if (!value.trim()) return null;
  const parsed = Number(value);
  return Number.isFinite(parsed) && parsed > 0 ? parsed : null;
}

function parsePositiveInteger(value: string): number | null {
  if (!value.trim()) return null;
  const parsed = Number(value);
  return Number.isInteger(parsed) && parsed > 0 ? parsed : null;
}

function buildDeviceOfferGroups(
  visit: MarketingVisit,
  deviceModels: DeviceModel[],
): DeviceOfferGroup[] {
  const rawDevices = (visit as MarketingVisit & { devices?: VisitDeviceLike[] }).devices;
  if (Array.isArray(rawDevices) && rawDevices.length > 0) {
    const groups = rawDevices.map<DeviceOfferGroup | null>((device) => {
        const id = device.deviceModelId ?? device.requestedDeviceModelId ?? null;
        if (id == null) return null;
        const model = deviceModels.find((item) => item.id === id);
        return {
          deviceModelId: id,
          deviceModelName:
            device.deviceModelName
            || device.requestedDeviceName
            || device.name
            || model?.nameAr
            || model?.name
            || `جهاز #${id}`,
          offers: [],
        };
      });
    return groups.filter((group): group is DeviceOfferGroup => group !== null);
  }

  if (visit.requestedDeviceModelId != null) {
    const model = deviceModels.find((item) => item.id === visit.requestedDeviceModelId);
    return [
      {
        deviceModelId: visit.requestedDeviceModelId,
        deviceModelName:
          visit.requestedDeviceName || model?.nameAr || model?.name || `جهاز #${visit.requestedDeviceModelId}`,
        offers: [],
      },
    ];
  }

  return [];
}

function createEmptyDraft(): OfferDraft {
  return {
    offerType: '',
    quantity: '1',
    totalAmount: '',
    firstPaymentAmount: '',
    installmentMonths: '',
    discountPercentage: '',
    appliedDeviceDiscountId: '',
    closedByEmployeeId: '',
    noClosingReason: '',
  };
}

function getOfferLabel(offerType: OfferType): string {
  return offerType === 'cash' ? 'كاش' : 'تقسيط';
}

function getResponseLabel(response: CustomerResponse): string {
  if (response === 'accepted') return '✅ تم البيع';
  if (response === 'rejected') return '❌ رفض';
  if (response === 'extension_requested') return '⏳ مهلة';
  return '⚠️ بانتظار الرد';
}

function formatOfferAmountDetails(offer: DeviceOffer): string {
  const fmt = (amount: number) => new Intl.NumberFormat('en-US').format(amount);
  const quantity = offer.quantity > 0 ? offer.quantity : 1;
  const discountLabel =
    offer.discountPercentage != null && offer.discountPercentage > 0
      ? ` (بعد حسم ${offer.discountPercentage}%)`
      : '';
  const unitAmountLabel = `${fmt(offer.totalAmount)}${discountLabel}`;
  const totalAmountLabel =
    quantity > 1
      ? `${unitAmountLabel} × ${quantity} أجهزة = ${fmt(offer.totalAmount * quantity)}${discountLabel}`
      : unitAmountLabel;
  if (offer.offerType === 'cash') return totalAmountLabel;

  const firstPaymentLabel = offer.firstPaymentAmount == null ? '—' : fmt(offer.firstPaymentAmount);
  const monthsLabel = offer.installmentMonths == null ? '—' : `${offer.installmentMonths} شهر`;
  return `${totalAmountLabel} (تقسيط) - الدفعة الأولى: ${firstPaymentLabel} - ${monthsLabel}`;
}

function computeFinalOutcome(deviceOffers: DeviceOfferGroup[]): {
  acceptedCount: number;
  rejectedCount: number;
  extensionCount: number;
  totalOffers: number;
  outcome: 'device_sold' | 'offer_presented' | 'needs_reschedule';
} {
  const allOffers = deviceOffers.flatMap((group) => group.offers);
  const acceptedCount = allOffers.filter((offer) => offer.customerResponse === 'accepted').length;
  const rejectedCount = allOffers.filter((offer) => offer.customerResponse === 'rejected').length;
  const extensionCount = allOffers.filter((offer) => offer.customerResponse === 'extension_requested').length;
  return {
    acceptedCount,
    rejectedCount,
    extensionCount,
    totalOffers: allOffers.length,
    outcome: acceptedCount > 0 ? 'device_sold' : extensionCount > 0 ? 'needs_reschedule' : 'offer_presented',
  };
}

export default function MarketingVisitOutcomeModal({
  isOpen,
  task,
  visit,
  employees,
  deviceModels = [],
  saving,
  error,
  onClose,
  onSubmit,
}: MarketingVisitOutcomeModalProps) {
  const [wizardState, setWizardState] = useState<WizardState>({
    step: 0,
    overallOutcome: '',
    deviceOffers: [],
    notes: '',
  });
  const [offerEditor, setOfferEditor] = useState<OfferEditorState | null>(null);
  const [offerEditorError, setOfferEditorError] = useState('');
  const [soldDeviceModelId, setSoldDeviceModelId] = useState('');
  const [closedByEmployeeId, setClosedByEmployeeId] = useState('');
  const [cancellationReasonId, setCancellationReasonId] = useState('');
  const [rescheduleReasonId, setRescheduleReasonId] = useState('');
  const [followUpDueDate, setFollowUpDueDate] = useState('');
  const [notes, setNotes] = useState('');
  const [validationError, setValidationError] = useState('');
  const [cancellationReasons, setCancellationReasons] = useState<SystemList[]>([]);
  const [rescheduleReasons, setRescheduleReasons] = useState<SystemList[]>([]);
  const [rejectionReasons, setRejectionReasons] = useState<SystemList[]>([]);
  const [closers, setClosers] = useState<Employee[]>([]);
  const [noClosingReasons, setNoClosingReasons] = useState<SystemList[]>([]);
  const [deviceDiscounts, setDeviceDiscounts] = useState<Array<{ id: number; label: string; percentage: number }>>([]);

  const fetchedRef = useRef(false);

  const activeEmployees = useMemo(
    () => employees.filter((employee) => employee.status === 'active'),
    [employees],
  );

  useEffect(() => {
    if (!isOpen || !visit) return;

    const rawDevices = (visit as MarketingVisit & { devices?: VisitDeviceLike[] }).devices;
    const hasSavedOutcome = task?.outcome != null || task?.result != null;
    const savedOffers = (task as MarketingVisitTask & { offers?: any[] | null })?.offers ?? [];
    const hasOfferResponses = savedOffers.some((offer) => offer.customerResponse != null);
    const isEditMode = hasSavedOutcome || hasOfferResponses;

    const baseGroups = buildDeviceOfferGroups(visit, deviceModels);
    const groupMap = new Map<number, DeviceOfferGroup>(
      baseGroups.map((group) => [group.deviceModelId, { ...group, offers: [...group.offers] }]),
    );

    const mapOutcomeToWizardValue = (
      outcome: MarketingVisitTaskOutcome | null | undefined,
      hasOffers: boolean
    ): OverallOutcome | '' => {
      if (hasOffers) return 'offer_presented';
      if (!outcome) return '';
      if (outcome === 'rescheduled') return 'needs_reschedule';
      if (outcome === 'device_sold') return 'offer_presented';
      if (outcome === 'offer_presented') return 'offer_presented';
      if (outcome === 'cancelled') return 'cancelled';
      return '';
    };

    if (isEditMode) {
      savedOffers.forEach((offer) => {
        const existingGroup = groupMap.get(offer.deviceModelId);
        const model = deviceModels.find((item) => item.id === offer.deviceModelId);
        const group: DeviceOfferGroup = existingGroup ?? {
          deviceModelId: offer.deviceModelId,
          deviceModelName: model?.nameAr || model?.name || `جهاز #${offer.deviceModelId}`,
          offers: [],
        };

        group.offers.push({
          id: crypto.randomUUID(),
          openTaskPreOfferId: (offer as any).openTaskPreOfferId ?? null,
          offerType: offer.offerType,
          quantity: offer.quantity ?? 1,
          totalAmount: offer.totalAmount,
          firstPaymentAmount: offer.firstPaymentAmount ?? null,
          installmentMonths: offer.installmentMonths ?? null,
          discountPercentage: offer.discountPercentage ?? null,
          appliedDeviceDiscountId: offer.appliedDeviceDiscountId ?? null,
          closedByEmployeeId: offer.closedByEmployeeId ?? null,
          noClosingReason: offer.noClosingReason ?? null,
          customerResponse: offer.customerResponse ?? null,
          rejectionReasonId: offer.rejectionReasonId ?? null,
          extensionReasonId: offer.extensionReasonId ?? null,
          extensionDueDate: offer.extensionDueDate ?? null,
          saleReferenceNumber: offer.saleReferenceNumber ?? null,
          sourceCustomerPreOfferId: offer.sourceCustomerPreOfferId ?? null,
        });

        if (!existingGroup) {
          groupMap.set(offer.deviceModelId, group);
        }
      });
    } else {
      const preOffersFromTask = (task as MarketingVisitTask & { preOffers?: PreOfferLike[] | null } | null | undefined)?.preOffers ?? null;
      const preOffersFromVisitTask = (visit.task as MarketingVisitTask & { preOffers?: PreOfferLike[] | null } | null | undefined)?.preOffers ?? null;
      const preOffersFromVisitTasks = Array.isArray(visit.tasks)
        ? visit.tasks.flatMap((item) => (item as MarketingVisitTask & { preOffers?: PreOfferLike[] | null }).preOffers ?? [])
        : [];
      const preOffers = [
        ...(preOffersFromTask ?? []),
        ...(preOffersFromVisitTask ?? []),
        ...preOffersFromVisitTasks,
      ];
      const dedupedPreOffers = preOffers.filter((offer, index, array) => {
        const key = [
          offer.deviceModelId,
          offer.offerType,
          offer.quantity ?? 1,
          offer.totalAmount,
          offer.firstPaymentAmount ?? '',
          offer.installmentMonths ?? '',
          offer.discountPercentage ?? '',
          offer.closedByEmployeeId ?? '',
          offer.noClosingReason ?? '',
        ].join('|');
        return array.findIndex((item) => {
          const itemKey = [
            item.deviceModelId,
            item.offerType,
            item.quantity ?? 1,
            item.totalAmount,
            item.firstPaymentAmount ?? '',
            item.installmentMonths ?? '',
            item.discountPercentage ?? '',
            item.closedByEmployeeId ?? '',
            item.noClosingReason ?? '',
          ].join('|');
          return itemKey === key;
        }) === index;
      });

      dedupedPreOffers.forEach((offer) => {
        const existingGroup = groupMap.get(offer.deviceModelId);
        const model = deviceModels.find((item) => item.id === offer.deviceModelId);
        const group: DeviceOfferGroup = existingGroup ?? {
          deviceModelId: offer.deviceModelId,
          deviceModelName: model?.nameAr || model?.name || `جهاز #${offer.deviceModelId}`,
          offers: [],
        };

        group.offers.push({
          id: crypto.randomUUID(),
          openTaskPreOfferId: offer.openTaskPreOfferId ?? null,
          offerType: offer.offerType,
          quantity: offer.quantity ?? 1,
          totalAmount: offer.totalAmount,
          firstPaymentAmount: offer.firstPaymentAmount ?? null,
          installmentMonths: offer.installmentMonths ?? null,
          discountPercentage: offer.discountPercentage ?? null,
          appliedDeviceDiscountId: offer.appliedDeviceDiscountId ?? null,
          closedByEmployeeId: offer.closedByEmployeeId ?? null,
          noClosingReason: offer.noClosingReason ?? null,
          customerResponse: null,
          rejectionReasonId: null,
          extensionReasonId: null,
          extensionDueDate: null,
          saleReferenceNumber: offer.saleReferenceNumber ?? null,
          sourceCustomerPreOfferId: offer.sourceCustomerPreOfferId ?? null,
        });

        if (!existingGroup) {
          groupMap.set(offer.deviceModelId, group);
        }
      });
    }

    const initialDeviceOffers = Array.from(groupMap.values());

    if (isEditMode && task) {
      const overallOutcome = mapOutcomeToWizardValue(task.outcome, hasOfferResponses);
      const shouldStartAtSummary = hasOfferResponses && overallOutcome === 'offer_presented';
      setWizardState({
        step: shouldStartAtSummary ? 4 : 0,
        overallOutcome,
        deviceOffers: initialDeviceOffers,
        notes: task.resultNotes ?? '',
      });
      setSoldDeviceModelId(task.soldDeviceModelId?.toString() ?? '');
      setClosedByEmployeeId(task.closedByEmployeeId?.toString() ?? '');
      setCancellationReasonId(task.cancellationReasonId?.toString() ?? '');
      setRescheduleReasonId(task.rescheduleReasonId?.toString() ?? '');
      setFollowUpDueDate(task.followUpDueDate ?? '');
      setNotes(task.resultNotes ?? '');
    } else {
      // Always start at step 0 (outcome selection) for new recordings.
      // Devices/pre-offers are loaded into state but the user must explicitly
      // confirm the outcome type before proceeding to step 1.
      setWizardState({
        step: 0,
        overallOutcome: '',
        deviceOffers: initialDeviceOffers,
        notes: '',
      });
      setSoldDeviceModelId('');
      setClosedByEmployeeId('');
      setCancellationReasonId('');
      setRescheduleReasonId('');
      setFollowUpDueDate('');
      setNotes('');
    }
    setOfferEditor(null);
    setOfferEditorError('');
    setValidationError('');

    if (!fetchedRef.current) {
      fetchedRef.current = true;
      Promise.all([
        api.systemLists.getItemsByCode('visit_cancellation_reasons'),
        api.systemLists.getItemsByCode('customer_followup_reasons'),
        api.systemLists.getItemsByCode('offer_refusal_reasons'),
        api.systemLists.getItemsByCode('no_closing_reasons'),
      ])
        .then(([cancellation, reschedule, rejection, noClosing]) => {
          setCancellationReasons(cancellation);
          setRescheduleReasons(reschedule);
          setRejectionReasons(rejection);
          setNoClosingReasons(noClosing);
        })
        .catch(() => {});
      api.employees.employeeClosers()
        .then(setClosers)
        .catch(() => setClosers([]));
    }
  }, [isOpen, visit, task, deviceModels]);

  useEffect(() => {
    if (!offerEditor) return;
    setDeviceDiscounts([]);
    if (!offerEditor.deviceModelId) return;
    api.deviceModels.getDiscounts(offerEditor.deviceModelId)
      .then((discounts) => setDeviceDiscounts(discounts.map((d: any) => ({ id: d.id, label: d.label, percentage: d.percentage }))))
      .catch(() => setDeviceDiscounts([]));
  }, [offerEditor?.deviceModelId]);

  if (!isOpen || !visit || !task) return null;

  const isOfferFlow = wizardState.overallOutcome === 'offer_presented';
  const flatOffers = wizardState.deviceOffers.flatMap((group) =>
    group.offers.map((offer) => ({
      deviceModelId: group.deviceModelId,
      deviceModelName: group.deviceModelName,
      offer,
    })),
  );
  const isOfferResponsePending = (offer: DeviceOffer) => {
    if (offer.customerResponse == null) return true;
    if (offer.customerResponse === 'rejected' && offer.rejectionReasonId == null) return true;
    if (
      offer.customerResponse === 'extension_requested' &&
      (offer.extensionReasonId == null || offer.extensionDueDate == null)
    )
      return true;
    return false;
  };
  const pendingOffers = flatOffers.filter(({ offer }) => isOfferResponsePending(offer));
  const summary = computeFinalOutcome(wizardState.deviceOffers);
  const rejectionReasonOptions = rejectionReasons.length > 0 ? rejectionReasons : noClosingReasons;

  // device_sold uses the same multi-device UI as offer_presented but skips the response step
  const isDeviceSoldFlow = wizardState.overallOutcome === 'device_sold';
  // useOfferUI: any outcome that uses the device-offer list (steps 1+)
  const useOfferUI = isOfferFlow || isDeviceSoldFlow;

  // Rule 1: lock outcome once responses are recorded OR once a legacy device_sold flow has offers
  const isOutcomeLocked =
    flatOffers.some(({ offer }) => offer.customerResponse != null) ||
    (isDeviceSoldFlow && flatOffers.length > 0);

  const handleSelectOutcome = (value: OverallOutcome) => {
    if (isOutcomeLocked) return;
    setValidationError('');
    setWizardState((current) => ({
      ...current,
      overallOutcome: value,
      step: 0,
    }));
  };

  const openCreateOffer = (deviceModelId?: number) => {
    const targetId = deviceModelId
      ?? wizardState.deviceOffers[0]?.deviceModelId
      ?? deviceModels[0]?.id;
    if (!targetId) return;
    const model = deviceModels.find((m) => m.id === targetId);
    const basePrice = model?.basePrice ?? 0;
    setOfferEditor({
      deviceModelId: targetId,
      offerId: null,
      draft: {
        ...createEmptyDraft(),
        totalAmount: basePrice > 0 ? String(basePrice) : '',
      },
    });
    setOfferEditorError('');
  };

  const openEditOffer = (deviceModelId: number, offer: DeviceOffer) => {
    setOfferEditor({
      deviceModelId,
      offerId: offer.id,
      draft: {
        offerType: offer.offerType,
        quantity: String(offer.quantity ?? 1),
        totalAmount: String(offer.totalAmount),
        firstPaymentAmount: offer.firstPaymentAmount == null ? '' : String(offer.firstPaymentAmount),
        installmentMonths: offer.installmentMonths == null ? '' : String(offer.installmentMonths),
        discountPercentage: offer.discountPercentage == null ? '' : String(offer.discountPercentage),
        appliedDeviceDiscountId: offer.appliedDeviceDiscountId == null ? '' : String(offer.appliedDeviceDiscountId),
        closedByEmployeeId: offer.closedByEmployeeId == null ? '' : String(offer.closedByEmployeeId),
        noClosingReason: offer.noClosingReason ?? '',
      },
    });
    setOfferEditorError('');
  };

  const handleSaveOffer = () => {
    if (!offerEditor) return;

    if (!offerEditor.draft.offerType) {
      setOfferEditorError('يرجى اختيار نوع العرض');
      return;
    }
    const quantityInput = offerEditor.draft.quantity.trim();
    const quantity = parsePositiveInteger(quantityInput) ?? 1;
    if (!quantityInput || !Number.isInteger(Number(quantityInput)) || quantity < 1) {
      setOfferEditorError('يجب إدخال كمية صحيحة');
      return;
    }
    const totalAmount = parsePositiveNumber(offerEditor.draft.totalAmount);
    if (totalAmount == null) {
      setOfferEditorError('يرجى إدخال السعر الإفرادي');
      return;
    }

    let firstPaymentAmount: number | null = null;
    let installmentMonths: number | null = null;
    if (offerEditor.draft.offerType === 'installment') {
      firstPaymentAmount = parsePositiveNumber(offerEditor.draft.firstPaymentAmount);
      if (firstPaymentAmount == null) {
        setOfferEditorError('يرجى إدخال قيمة الدفعة الأولى');
        return;
      }

      installmentMonths = parsePositiveInteger(offerEditor.draft.installmentMonths);
      if (installmentMonths == null) {
        setOfferEditorError('يرجى إدخال عدد الأشهر');
        return;
      }
    }

    if (offerEditor.draft.offerType === 'cash') {
      firstPaymentAmount = null;
      installmentMonths = null;
    }

    if (
      firstPaymentAmount != null
      && totalAmount != null
      && firstPaymentAmount > totalAmount
    ) {
      setOfferEditorError('قيمة الدفعة الأولى يجب أن تكون أقل من أو تساوي المبلغ الكامل');
      return;
    }
    const discount = offerEditor.draft.discountPercentage.trim()
      ? Number(offerEditor.draft.discountPercentage)
      : null;
    if (discount != null && (Number.isNaN(discount) || discount < 0 || discount > 100)) {
      setOfferEditorError('نسبة الحسم يجب أن تكون بين 0 و 100');
      return;
    }
    const selectedEmployeeId = parsePositiveInteger(offerEditor.draft.closedByEmployeeId);
    if (selectedEmployeeId == null && !offerEditor.draft.noClosingReason.trim()) {
      setOfferEditorError('يرجى اختيار موظف التسكير أو سبب عدم التسكير');
      return;
    }
    const appliedDeviceDiscountId = parsePositiveInteger(offerEditor.draft.appliedDeviceDiscountId);

    const nextOffer: DeviceOffer = {
      id: offerEditor.offerId ?? crypto.randomUUID(),
      offerType: offerEditor.draft.offerType,
      quantity,
      totalAmount,
      firstPaymentAmount,
      installmentMonths,
      discountPercentage: discount,
      appliedDeviceDiscountId: appliedDeviceDiscountId ?? null,
      closedByEmployeeId: selectedEmployeeId,
      noClosingReason: selectedEmployeeId == null ? offerEditor.draft.noClosingReason.trim() || null : null,
      customerResponse: null,
      rejectionReasonId: null,
      extensionReasonId: null,
      extensionDueDate: null,
      saleReferenceNumber: null,
    };

    setWizardState((current) => ({
      ...current,
      deviceOffers: (() => {
        const existing =
          offerEditor.offerId == null
            ? null
            : current.deviceOffers
                .flatMap((group) => group.offers)
                .find((item) => item.id === offerEditor.offerId) ?? null;

        const offerToSave =
          existing == null
            ? nextOffer
            : {
                ...nextOffer,
                customerResponse: existing.customerResponse,
                rejectionReasonId: existing.rejectionReasonId,
                extensionReasonId: existing.extensionReasonId,
                extensionDueDate: existing.extensionDueDate,
                saleReferenceNumber: existing.saleReferenceNumber,
                sourceCustomerPreOfferId: existing.sourceCustomerPreOfferId ?? null,
                openTaskPreOfferId: existing.openTaskPreOfferId ?? null,
              };

        // device_sold: if the device group doesn't exist yet, create it
        const groupExists = current.deviceOffers.some((g) => g.deviceModelId === offerEditor.deviceModelId);
        if (!groupExists) {
          const model = deviceModels.find((m) => m.id === offerEditor.deviceModelId);
          const newGroup: DeviceOfferGroup = {
            deviceModelId: offerEditor.deviceModelId,
            deviceModelName: model?.nameAr || model?.name || `جهاز #${offerEditor.deviceModelId}`,
            offers: [offerToSave],
          };
          return [...current.deviceOffers, newGroup];
        }

        return current.deviceOffers.map((group) => {
          const offersWithoutEdited =
            offerEditor.offerId == null
              ? group.offers
              : group.offers.filter((item) => item.id !== offerEditor.offerId);

          if (group.deviceModelId !== offerEditor.deviceModelId) {
            return { ...group, offers: offersWithoutEdited };
          }

          return { ...group, offers: [...offersWithoutEdited, offerToSave] };
        });
      })(),
    }));
    setOfferEditor(null);
    setOfferEditorError('');
  };

  const handleDeleteOffer = (deviceModelId: number, offerId: string) => {
    setValidationError('');
    setWizardState((current) => ({
      ...current,
      deviceOffers: current.deviceOffers.map((group) =>
        group.deviceModelId === deviceModelId
          ? { ...group, offers: group.offers.filter((offer) => offer.id !== offerId) }
          : group,
      ),
    }));
  };

  const updateOffer = (
    deviceModelId: number,
    offerId: string,
    updater: (offer: DeviceOffer) => DeviceOffer,
  ) => {
    setWizardState((current) => ({
      ...current,
      deviceOffers: current.deviceOffers.map((group) =>
        group.deviceModelId === deviceModelId
          ? {
              ...group,
              offers: group.offers.map((offer) => (offer.id === offerId ? updater(offer) : offer)),
            }
          : group,
      ),
    }));
  };

  const validateOfferFlowStep = (step: WizardStep): string | null => {
    if (step === 0) {
      if (!wizardState.overallOutcome) return 'يرجى اختيار نتيجة المهمة';
      return null;
    }

    if (step === 1) {
      if (!isDeviceSoldFlow && wizardState.deviceOffers.length === 0) {
        return 'لا يوجد أجهزة محددة لهذه الزيارة';
      }
      const totalOffers = wizardState.deviceOffers.reduce((sum, group) => sum + group.offers.length, 0);
      if (flatOffers.some(({ offer }) => offer.closedByEmployeeId == null && !offer.noClosingReason)) {
        return 'يجب اختيار موظف التسكير أو سبب عدم التسكير لكل عرض قبل المتابعة';
      }
      if (totalOffers === 0) {
        return isDeviceSoldFlow ? 'أضف جهازاً مباعاً واحداً على الأقل للمتابعة' : 'أضف عرضاً واحداً على الأقل للمتابعة';
      }
      return null;
    }

    if (step === 3) {
      const hasPendingResponse = flatOffers.some(({ offer }) => isOfferResponsePending(offer));
      if (hasPendingResponse) {
        return 'يجب تحديد رد الزبون على كل العروض قبل الانتقال للملخص';
      }
      const acceptedWithoutCloser = flatOffers.some(({ offer }) =>
        offer.customerResponse === 'accepted' && offer.closedByEmployeeId == null && !offer.noClosingReason
      );
      if (acceptedWithoutCloser) {
        return 'العرض المقبول يحتاج موظف تسكير أو سبب عدم التسكير قبل حفظ النتيجة';
      }
      return null;
    }

    return null;
  };

  const handleNext = () => {
    if (!useOfferUI) return;
    const errorMessage = validateOfferFlowStep(wizardState.step);
    if (errorMessage) {
      setValidationError(errorMessage);
      return;
    }
    setValidationError('');
    // device_sold skips the response steps (2 & 3) — go 1 → 4
    const nextStep = isDeviceSoldFlow && wizardState.step === 1 ? 4 : Math.min(4, wizardState.step + 1) as WizardStep;
    setWizardState((current) => ({ ...current, step: nextStep }));
  };

  const handleBack = () => {
    setValidationError('');
    // device_sold skips steps 2-3 when going back — go 4 → 1
    const prevStep = isDeviceSoldFlow && wizardState.step === 4 ? 1 : Math.max(0, wizardState.step - 1) as WizardStep;
    setWizardState((current) => ({ ...current, step: prevStep }));
  };

  const handleSimpleSubmit = async () => {
    setValidationError('');

    if (!wizardState.overallOutcome) {
      setValidationError('يرجى اختيار نتيجة المهمة');
      return;
    }

    if (wizardState.overallOutcome === 'device_sold' && !soldDeviceModelId) {
      setValidationError('يرجى اختيار الجهاز المباع');
      return;
    }

    if (wizardState.overallOutcome === 'needs_reschedule' && !rescheduleReasonId) {
      setValidationError('يرجى اختيار سبب إعادة الجدولة');
      return;
    }

    if (wizardState.overallOutcome === 'needs_reschedule' && !followUpDueDate) {
      setValidationError('يرجى تحديد التاريخ المتوقع');
      return;
    }

    if (wizardState.overallOutcome === 'cancelled' && !cancellationReasonId) {
      setValidationError('يرجى اختيار سبب الإلغاء');
      return;
    }

    await onSubmit({
      outcome: wizardState.overallOutcome === 'needs_reschedule' ? 'rescheduled' : wizardState.overallOutcome,
      offerType: null,
      cashOfferAmount: null,
      installmentAmount: null,
      installmentMonths: null,
      currency: null,
      discountPercentage: null,
      closedByEmployeeId: closedByEmployeeId ? Number(closedByEmployeeId) : null,
      soldDeviceModelId: wizardState.overallOutcome === 'device_sold' ? Number(soldDeviceModelId) : null,
      offeredDeviceModelId: null,
      noClosingReason: null,
      cancellationReasonId: wizardState.overallOutcome === 'cancelled' ? Number(cancellationReasonId) : null,
      rescheduleReasonId: wizardState.overallOutcome === 'needs_reschedule' ? Number(rescheduleReasonId) : null,
      followUpDueDate: wizardState.overallOutcome === 'needs_reschedule' ? followUpDueDate : null,
      notes: notes.trim() || null,
    });
  };

  const handleOfferFlowSubmit = async () => {
    const errorMessage = validateOfferFlowStep(3);
    if (errorMessage) {
      setValidationError(errorMessage);
      setWizardState((current) => ({ ...current, step: 3 }));
      return;
    }

    const acceptedOffer = wizardState.deviceOffers
      .flatMap((group) => group.offers.map((offer) => ({ ...offer, deviceModelId: group.deviceModelId })))
      .find((offer) => offer.customerResponse === 'accepted');
    const soldDeviceModelId =
      summary.outcome === 'device_sold' && acceptedOffer
        ? acceptedOffer.deviceModelId
        : null;

    await onSubmit({
      outcome: 'offer_presented',
      offers: wizardState.deviceOffers.flatMap((group) =>
        group.offers.map((offer) => ({
          deviceModelId: group.deviceModelId,
          offerType: offer.offerType,
          quantity: offer.quantity,
          totalAmount: offer.totalAmount,
          firstPaymentAmount: offer.firstPaymentAmount,
          installmentMonths: offer.installmentMonths,
          currency: 'SYP',
          discountPercentage: offer.discountPercentage,
          appliedDeviceDiscountId: offer.appliedDeviceDiscountId,
          closedByEmployeeId: offer.closedByEmployeeId,
          noClosingReason: offer.noClosingReason,
          customerResponse: offer.customerResponse,
          rejectionReasonId: offer.rejectionReasonId,
          extensionReasonId: offer.extensionReasonId,
          extensionDueDate: offer.extensionDueDate,
          saleReferenceNumber: offer.saleReferenceNumber,
          sourceCustomerPreOfferId: offer.sourceCustomerPreOfferId ?? null,
          openTaskPreOfferId: offer.openTaskPreOfferId ?? null,
        })),
      ),
      offerType: null,
      cashOfferAmount: null,
      installmentAmount: null,
      installmentMonths: null,
      currency: null,
      discountPercentage: null,
      closedByEmployeeId: null,
      soldDeviceModelId,
      offeredDeviceModelId: null,
      noClosingReason: null,
      cancellationReasonId: null,
      rescheduleReasonId: null,
      notes: wizardState.notes.trim() || null,
    });
  };

  // Submit handler for device_sold multi-device flow
  const handleDeviceSoldSubmit = async () => {
    const totalDevices = wizardState.deviceOffers.reduce((s, g) => s + g.offers.length, 0);
    if (totalDevices === 0) {
      setValidationError('أضف جهازاً مباعاً واحداً على الأقل');
      return;
    }
    await onSubmit({
      outcome: 'device_sold',
      offers: wizardState.deviceOffers.flatMap((group) =>
        group.offers.map((offer) => ({
          deviceModelId: group.deviceModelId,
          offerType: offer.offerType,
          quantity: offer.quantity,
          totalAmount: offer.totalAmount,
          firstPaymentAmount: offer.firstPaymentAmount,
          installmentMonths: offer.installmentMonths,
          currency: 'SYP',
          discountPercentage: offer.discountPercentage,
          appliedDeviceDiscountId: offer.appliedDeviceDiscountId,
          closedByEmployeeId: offer.closedByEmployeeId,
          noClosingReason: offer.noClosingReason,
          customerResponse: 'accepted' as const,
          rejectionReasonId: null,
          extensionReasonId: null,
          extensionDueDate: null,
          saleReferenceNumber: offer.saleReferenceNumber,
          sourceCustomerPreOfferId: offer.sourceCustomerPreOfferId ?? null,
          openTaskPreOfferId: offer.openTaskPreOfferId ?? null,
        })),
      ),
      offerType: null, cashOfferAmount: null, installmentAmount: null,
      installmentMonths: null, currency: null, discountPercentage: null,
      closedByEmployeeId: null, soldDeviceModelId: null, offeredDeviceModelId: null,
      noClosingReason: null, cancellationReasonId: null, rescheduleReasonId: null,
      notes: wizardState.notes.trim() || null,
    });
  };

  const renderOfferStatus = (offer: DeviceOffer): { label: string; className: string } => {
    if (offer.customerResponse === 'accepted') {
      return { label: '✅ تم البيع', className: 'text-emerald-600' };
    }
    if (offer.customerResponse === 'rejected') {
      return { label: '❌ رفض', className: 'text-red-600' };
    }
    if (offer.customerResponse === 'extension_requested') {
      return { label: '⏳ مهلة', className: 'text-amber-600' };
    }
    return wizardState.step >= 3
      ? { label: '⚠️ بانتظار الرد', className: 'text-amber-600' }
      : { label: '🔵 مسجل', className: 'text-sky-600' };
  };

  const getOfferCloserLabel = (offer: DeviceOffer): string =>
    offer.closedByEmployeeId == null
      ? offer.noClosingReason || 'لم يتم'
      : closers.find((employee) => employee.id === offer.closedByEmployeeId)?.name
        ?? `#${offer.closedByEmployeeId}`;

  const progressIndex = isOfferFlow ? wizardState.step : 0;

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center bg-slate-900/50 p-4 backdrop-blur-sm" dir="rtl">
      <div className="flex max-h-[94vh] w-full max-w-5xl flex-col overflow-hidden rounded-2xl bg-white shadow-2xl">
        <div className="flex items-center justify-between border-b border-slate-100 bg-slate-50 px-6 py-4">
          <div>
            <h2 className="text-lg font-bold text-slate-800">سجّل نتيجة المهمة</h2>
            <p className="mt-1 text-xs text-slate-500">
              {visit.customerName || '—'} · {visit.scheduledDate || '—'}
            </p>
          </div>
          <IconButton icon={X} label="إغلاق" onClick={onClose} disabled={saving} />
        </div>

        <div className="border-b border-slate-100 bg-white px-6 py-4">
          <div className="flex items-center justify-between gap-4">
            <div className="flex items-center gap-2 text-sm font-semibold text-slate-600">
              {[0, 1, 2, 3, 4].map((step) => (
                <span
                  key={step}
                  className={step === progressIndex ? 'text-sky-600' : step < progressIndex ? 'text-slate-700' : 'text-slate-300'}
                >
                  {step === progressIndex ? '●' : '○'}
                </span>
              ))}
            </div>
            <div className="text-sm font-semibold text-slate-700">
              الخطوة {progressIndex + 1}/5: {STEP_TITLES[progressIndex as WizardStep]}
            </div>
          </div>
        </div>

        <div className="flex-1 overflow-y-auto bg-slate-50/50 p-6">
          <div className="space-y-6">
            {/* Step 0: outcome selector — hidden once user enters a multi-step flow */}
            {wizardState.step === 0 && (
              <section className="space-y-3 rounded-2xl border border-slate-200 bg-white p-5">
                <div className="space-y-1">
                  <h3 className="text-sm font-bold text-slate-800">نتيجة المهمة</h3>
                  <p className="text-xs text-slate-500">اختر المسار المناسب قبل متابعة تفاصيل النتيجة.</p>
                </div>
                <div className="grid grid-cols-2 gap-3">
                  {OUTCOME_OPTIONS.map((option) => {
                    const Icon = option.icon;
                    const isSelected = wizardState.overallOutcome === option.value;
                    const isDisabled = isOutcomeLocked && !isSelected;
                    return (
                      <IconButton icon={X} label="إغلاق" size="sm" onClick={() => handleSelectOutcome(option.value)} disabled={isDisabled} />
            </div>

            <div className="space-y-4 px-5 py-5">
              {deviceModels.length === 0 ? (
                <div className="rounded-xl border border-amber-100 bg-amber-50 px-4 py-6 text-center text-sm text-amber-700">
                  لا توجد أجهزة متاحة لإضافة عرض
                </div>
              ) : (
                <>
              <div className="space-y-2">
                <label className="text-sm font-bold text-slate-700">
                  الجهاز <span className="text-red-500">*</span>
                </label>
                <Select
                  value={String(offerEditor.deviceModelId)}
                  onChange={v => {
                    const newDeviceModelId = Number(v);
                    const model = deviceModels.find((m) => m.id === newDeviceModelId);
                    const basePrice = model?.basePrice ?? 0;
                    setOfferEditor((current) => {
                      if (!current) return current;
                      return {
                        ...current,
                        deviceModelId: newDeviceModelId,
                        draft: {
                          ...current.draft,
                          totalAmount: basePrice > 0 ? String(basePrice) : current.draft.totalAmount,
                          appliedDeviceDiscountId: '',
                          discountPercentage: '',
                        },
                      };
                    });
                  }}
                  ariaLabel="الجهاز"
                  className="w-full"
                  options={deviceModels.map(model => ({ value: String(model.id), label: model.nameAr || model.name }))}
                />
              </div>

              <div className="space-y-2">
                <label className="text-sm font-bold text-slate-700">
                  نوع العرض <span className="text-red-500">*</span>
                </label>
                <div className="grid grid-cols-2 gap-2">
                  {(['cash', 'installment'] as const).map((type) => (
                    <button
                      key={type}
                      type="button"
                      onClick={() =>
                        setOfferEditor((current) => (
                          current == null
                            ? null
                            : { ...current, draft: { ...current.draft, offerType: type } }
                        ))
                      }
                      className={`rounded-xl border px-4 py-2 text-sm font-bold transition-colors ${
                        offerEditor.draft.offerType === type
                          ? 'border-sky-300 bg-sky-50 text-sky-700'
                          : 'border-slate-200 bg-white text-slate-600 hover:bg-slate-50'
                      }`}
                    >
                      {type === 'cash' ? 'كاش' : 'تقسيط'}
                    </button>
                  ))}
                </div>
              </div>

              <div className="space-y-2">
                <label className="text-sm font-bold text-slate-700">
                  الكمية (عدد الأجهزة) <span className="text-red-500">*</span>
                </label>
                <input
                  type="number"
                  min="1"
                  step="1"
                  value={offerEditor.draft.quantity}
                  onChange={(event) =>
                    setOfferEditor((current) => (
                      current == null
                        ? null
                        : { ...current, draft: { ...current.draft, quantity: event.target.value } }
                    ))
                  }
                  className="w-full rounded-xl border border-slate-200 bg-white px-4 py-2.5 text-sm focus:border-sky-500 focus:outline-none focus:ring-2 focus:ring-sky-100"
                />
              </div>

              {offerEditor.draft.offerType && (
                <>
                  {offerEditor.draft.offerType === 'cash' && (
                    <>
                      <div className="space-y-2">
                        <label className="text-sm font-bold text-slate-700">
                          السعر الإفرادي <span className="text-red-500">*</span>
                        </label>
                        <input
                          type="number"
                          min="0"
                          step="0.01"
                          value={offerEditor.draft.totalAmount}
                          onChange={(event) =>
                            setOfferEditor((current) => (
                              current == null
                                ? null
                                : { ...current, draft: { ...current.draft, totalAmount: event.target.value } }
                            ))
                          }
                          className="w-full rounded-xl border border-slate-200 bg-white px-4 py-2.5 text-sm focus:border-sky-500 focus:outline-none focus:ring-2 focus:ring-sky-100"
                          placeholder="أدخل القيمة"
                        />
                      </div>

                      {deviceDiscounts.length > 0 && (
                        <div className="space-y-2">
                          <label className="text-sm font-bold text-slate-700">
                            نسبة الحسم % <span className="text-xs font-normal text-slate-400">(اختياري)</span>
                          </label>
                          <Select
                            value={offerEditor.draft.appliedDeviceDiscountId}
                            onChange={v => {
                              const selectedDiscount = deviceDiscounts.find((d) => String(d.id) === v);
                              setOfferEditor((current) => (
                                current == null
                                  ? null
                                  : {
                                      ...current,
                                      draft: {
                                        ...current.draft,
                                        appliedDeviceDiscountId: v,
                                        discountPercentage: selectedDiscount ? String(selectedDiscount.percentage) : '',
                                      },
                                    }
                              ));
                            }}
                            placeholder="بدون حسم"
                            ariaLabel="نسبة الحسم"
                            className="w-full"
                            options={deviceDiscounts.map(d => ({ value: String(d.id), label: `${d.label} (${d.percentage}%)` }))}
                          />
                        </div>
                      )}
                    </>
                  )}

                  {offerEditor.draft.offerType === 'installment' && (
                    <>
                      <div className="grid gap-4 md:grid-cols-2">
                        <div className="space-y-2">
                          <label className="text-sm font-bold text-slate-700">
                            السعر الإفرادي <span className="text-red-500">*</span>
                          </label>
                          <input
                            type="number"
                            min="0"
                            step="0.01"
                            value={offerEditor.draft.totalAmount}
                            onChange={(event) =>
                              setOfferEditor((current) => (
                                current == null
                                  ? null
                                  : { ...current, draft: { ...current.draft, totalAmount: event.target.value } }
                              ))
                            }
                            className="w-full rounded-xl border border-slate-200 bg-white px-4 py-2.5 text-sm focus:border-sky-500 focus:outline-none focus:ring-2 focus:ring-sky-100"
                            placeholder="المبلغ الكامل"
                          />
                        </div>
                        <div className="space-y-2">
                          <label className="text-sm font-bold text-slate-700">
                            قيمة الدفعة الأولى <span className="text-red-500">*</span>
                          </label>
                          <input
                            type="number"
                            min="0"
                            step="0.01"
                            value={offerEditor.draft.firstPaymentAmount}
                            onChange={(event) =>
                              setOfferEditor((current) => (
                                current == null
                                  ? null
                                  : { ...current, draft: { ...current.draft, firstPaymentAmount: event.target.value } }
                              ))
                            }
                            className="w-full rounded-xl border border-slate-200 bg-white px-4 py-2.5 text-sm focus:border-sky-500 focus:outline-none focus:ring-2 focus:ring-sky-100"
                            placeholder="الدفعة الأولى"
                          />
                        </div>
                      </div>

                      <div className="grid gap-4 md:grid-cols-2">
                        <div className="space-y-2">
                          <label className="text-sm font-bold text-slate-700">
                            عدد الأشهر <span className="text-red-500">*</span>
                          </label>
                          <input
                            type="number"
                            min="1"
                            step="1"
                            value={offerEditor.draft.installmentMonths}
                            onChange={(event) =>
                              setOfferEditor((current) => (
                                current == null
                                  ? null
                                  : { ...current, draft: { ...current.draft, installmentMonths: event.target.value } }
                              ))
                            }
                            className="w-full rounded-xl border border-slate-200 bg-white px-4 py-2.5 text-sm focus:border-sky-500 focus:outline-none focus:ring-2 focus:ring-sky-100"
                            placeholder="مثال: 12"
                          />
                        </div>
                        {deviceDiscounts.length > 0 && (
                          <div className="space-y-2">
                            <label className="text-sm font-bold text-slate-700">
                              نسبة الحسم % <span className="text-xs font-normal text-slate-400">(اختياري)</span>
                            </label>
                            <Select
                              value={offerEditor.draft.appliedDeviceDiscountId}
                              onChange={v => {
                                const selectedDiscount = deviceDiscounts.find((d) => String(d.id) === v);
                                setOfferEditor((current) => (
                                  current == null
                                    ? null
                                    : {
                                        ...current,
                                        draft: {
                                          ...current.draft,
                                          appliedDeviceDiscountId: v,
                                          discountPercentage: selectedDiscount ? String(selectedDiscount.percentage) : '',
                                        },
                                      }
                                ));
                              }}
                              placeholder="بدون حسم"
                              ariaLabel="نسبة الحسم"
                              className="w-full"
                              options={deviceDiscounts.map(d => ({ value: String(d.id), label: `${d.label} (${d.percentage}%)` }))}
                            />
                          </div>
                        )}
                      </div>
                    </>
                  )}
                </>
              )}

              <div className="space-y-2">
                <label className="text-sm font-bold text-slate-700">تم التسكير مع</label>
                <Select
                  value={offerEditor.draft.closedByEmployeeId}
                  onChange={v =>
                    setOfferEditor((current) => (
                      current == null
                        ? null
                        : {
                            ...current,
                            draft: {
                              ...current.draft,
                              closedByEmployeeId: v,
                              noClosingReason: v ? '' : current.draft.noClosingReason,
                            },
                          }
                    ))
                  }
                  placeholder="لم يتم التسكير"
                  ariaLabel="موظف التسكير"
                  className="w-full"
                  options={closers.map(employee => ({ value: String(employee.id), label: employee.name }))}
                />
              </div>

              <div className="space-y-2">
                <label className="text-sm font-bold text-slate-700">سبب عدم التسكير</label>
                <Select
                  value={offerEditor.draft.noClosingReason}
                  onChange={v =>
                    setOfferEditor((current) => (
                      current == null
                        ? null
                        : {
                            ...current,
                            draft: {
                              ...current.draft,
                              noClosingReason: v,
                              closedByEmployeeId: v ? '' : current.draft.closedByEmployeeId,
                            },
                          }
                    ))
                  }
                  disabled={!!offerEditor.draft.closedByEmployeeId}
                  placeholder="بدون سبب"
                  ariaLabel="سبب عدم التسكير"
                  className="w-full"
                  options={noClosingReasons.map(reason => ({ value: reason.value, label: reason.value }))}
                />
              </div>

              {offerEditorError && (
                <div className="rounded-xl border border-red-200 bg-red-50 px-4 py-3 text-sm text-red-700">
                  {offerEditorError}
                </div>
              )}
                </>
              )}
            </div>

            <div className="flex items-center justify-end gap-3 border-t border-slate-100 px-5 py-4">
              <Button type="button" variant="secondary" onClick={() => setOfferEditor(null)}>
                إلغاء
              </Button>
              <Button type="button" onClick={handleSaveOffer} disabled={deviceModels.length === 0}>
                تثبيت العرض
              </Button>
            </div>
          </div>
        </div>
      )}
    </div>
  );
}
