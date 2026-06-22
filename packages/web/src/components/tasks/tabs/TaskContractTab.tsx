// ============================================================
// TaskContractTab — unified view for ContractSnapshot + DeviceSnapshot
// ============================================================
// Constitution:
//   docs/constitution/components/contract-snapshot.md
//   docs/constitution/components/device-snapshot.md
//
// Used by ALL task templates via TaskDetailLayout (device_demo,
// device_delivery, device_installation, post_sale, emergency_maintenance, ...).
// Renders the contract block and device block independently — either
// can be present without the other (e.g. demo has no contract, emergency
// may have a device but a missing contract on legacy rows).
// ============================================================
import { FileText, MapPin, Wrench, ShieldCheck, Hash, Calendar, Package, ExternalLink } from 'lucide-react';
import { Card, InfoLine, EmptyState, formatDate, formatMoney } from '../shared';

const CONTRACT_STATUS_LABELS: Record<string, string> = {
  draft: 'مسودة',
  active: 'نشِط',
  pending: 'قيد المراجعة',
  completed: 'مكتمل',
  cancelled: 'ملغى',
  suspended: 'موقوف',
  closed: 'مُقفَل',
  discarded: 'مُهمَل',
};

const SALE_SUBTYPE_LABELS: Record<string, { label: string; cls: string }> = {
  definitive: { label: 'بيع قطعي', cls: 'bg-emerald-50 text-emerald-700 border-emerald-200' },
  temporary: { label: 'بيع مؤقت', cls: 'bg-amber-50 text-amber-700 border-amber-200' },
  free: { label: 'مجاني / هبة', cls: 'bg-violet-50 text-violet-700 border-violet-200' },
};

const DEVICE_STATUS_LABELS: Record<string, { label: string; cls: string }> = {
  pending_delivery: { label: 'بانتظار التسليم', cls: 'bg-amber-50 text-amber-700 border-amber-200' },
  delivered: { label: 'مُسلَّم', cls: 'bg-sky-50 text-sky-700 border-sky-200' },
  installed: { label: 'مُركَّب', cls: 'bg-emerald-50 text-emerald-700 border-emerald-200' },
  active: { label: 'نَشِط', cls: 'bg-emerald-50 text-emerald-700 border-emerald-200' },
  inactive: { label: 'مُعَطَّل', cls: 'bg-slate-50 text-slate-600 border-slate-200' },
  returned: { label: 'مُسترَجَع', cls: 'bg-rose-50 text-rose-700 border-rose-200' },
};

const PAYMENT_TYPE_LABELS: Record<string, string> = {
  cash: 'كاش',
  installment: 'تقسيط',
};

function Badge({ text, cls }: { text: string; cls: string }) {
  return (
    <span className={`inline-flex items-center text-[11px] font-bold rounded-lg border px-2 py-0.5 ${cls}`}>
      {text}
    </span>
  );
}

export interface TaskContractTabProps {
  task: any;
}

export default function TaskContractTab({ task }: TaskContractTabProps) {
  const contract = task.contractSnapshot;
  const device = task.deviceSnapshot;
  // Legacy fallback — old snapshot embedded device fields under contract.device.
  const legacyDevice = contract?.device;
  const showDevice = device || legacyDevice;

  if (!contract && !showDevice) {
    return (
      <EmptyState
        icon={FileText}
        title="لا يوجد عقد أو جهاز مرتبط بهذه المهمة"
        description={
          task.taskType === 'device_demo'
            ? 'مهمة عرض الجهاز ما قبل البيع — لا يُنشأ العقد ولا الجهاز إلا بعد موافقة الزبون.'
            : 'هذه المهمة لا تتطلب عقداً أو جهازاً.'
        }
      />
    );
  }

  // Address resolution — merge field-by-field so the detailed text + GPS show
  // whenever EITHER source has them (device location may carry geo but no GPS,
  // while the contract's installation address may carry the detailed text/GPS).
  const dLoc = device?.location ?? null;
  const cAddr = contract?.installationAddress ?? null;
  const address = (dLoc || cAddr)
    ? {
        geoUnitId: dLoc?.geoUnitId ?? cAddr?.geoUnitId ?? null,
        geoUnitName: dLoc?.geoUnitName ?? cAddr?.geoUnitName ?? null,
        geoPath: (Array.isArray(dLoc?.geoPath) && dLoc.geoPath.length > 0) ? dLoc.geoPath : (cAddr?.geoPath ?? null),
        addressText: dLoc?.addressText ?? cAddr?.addressText ?? null,
        lat: dLoc?.lat ?? cAddr?.lat ?? null,
        lng: dLoc?.lng ?? cAddr?.lng ?? null,
      }
    : null;
  const addressLat = address?.lat;
  const addressLng = address?.lng;

  return (
    <div className="space-y-6">
      {/* ─── Contract block ─────────────────────────────────────── */}
      {contract ? (
        <Card title="بيانات العقد" icon={FileText}>
          <div className="flex items-center flex-wrap gap-2 mb-3">
            {contract.contractNumber && (
              <Badge text={`#${contract.contractNumber}`} cls="bg-slate-50 text-slate-700 border-slate-200 font-mono" />
            )}
            {contract.status && (
              <Badge
                text={CONTRACT_STATUS_LABELS[contract.status] ?? contract.status}
                cls="bg-indigo-50 text-indigo-700 border-indigo-200"
              />
            )}
            {contract.saleSubtype && SALE_SUBTYPE_LABELS[contract.saleSubtype] && (
              <Badge text={SALE_SUBTYPE_LABELS[contract.saleSubtype].label} cls={SALE_SUBTYPE_LABELS[contract.saleSubtype].cls} />
            )}
          </div>
          {/* BR §9.2 — a temporary sale must never read as a definitive one. */}
          {contract.policy?.isTemporary && (
            <div className="mb-3 rounded-lg border border-amber-200 bg-amber-50 px-3 py-2 text-xs font-bold text-amber-800">
              عقد مؤقت — يحتاج حسماً لاحقاً ولا يُعامَل كبيع قطعي.
            </div>
          )}
          <div className="grid grid-cols-1 md:grid-cols-2 gap-x-8 gap-y-1.5">
            <InfoLine label="رقم العقد" value={<span className="font-mono">{contract.contractNumber ?? '—'}</span>} />
            <InfoLine label="تاريخ العقد" value={formatDate(contract.contractDate)} />
            {contract.contractId && <InfoLine label="معرف العقد" value={`#${contract.contractId}`} />}
            {contract.parties?.branchName && <InfoLine label="الفرع" value={contract.parties.branchName} />}
            {contract.parties?.closingEmployeeName && (
              <InfoLine label="مُغلِق العقد" value={contract.parties.closingEmployeeName} />
            )}
            {contract.parties?.saleOwnerName && (
              <InfoLine label="منسوب البيعة" value={contract.parties.saleOwnerName} />
            )}
            {contract.commercial?.saleSource && (
              <InfoLine label="مصدر البيع" value={contract.commercial.saleSource} />
            )}
          </div>
        </Card>
      ) : (
        <Card title="بيانات العقد" icon={FileText}>
          <div className="text-sm text-slate-400 py-2">
            لا يوجد عقد مرتبط بهذه المهمة
            {task.taskType === 'emergency_maintenance' && ' — قد تكون مهمة صيانة على جهاز فقط'}
          </div>
        </Card>
      )}

      {/* ─── Device block ───────────────────────────────────────── */}
      {showDevice && (
        <Card title="بيانات الجهاز" icon={Wrench}>
          {device ? (
            <>
              <div className="flex items-center flex-wrap gap-2 mb-3">
                {device.id && <Badge text={`#${device.id}`} cls="bg-slate-50 text-slate-700 border-slate-200 font-mono" />}
                {device.lifecycle?.status && DEVICE_STATUS_LABELS[device.lifecycle.status] && (
                  <Badge text={DEVICE_STATUS_LABELS[device.lifecycle.status].label} cls={DEVICE_STATUS_LABELS[device.lifecycle.status].cls} />
                )}
                {device.lifecycle?.status && !DEVICE_STATUS_LABELS[device.lifecycle.status] && (
                  <Badge text={device.lifecycle.status} cls="bg-slate-50 text-slate-600 border-slate-200" />
                )}
              </div>
              <div className="grid grid-cols-1 md:grid-cols-2 gap-x-8 gap-y-1.5">
                <InfoLine label="الموديل" value={device.identity?.modelName || `#${device.identity?.modelId ?? '—'}`} />
                <InfoLine
                  label="الرقم التسلسلي"
                  value={<span className="font-mono">{device.identity?.serialNumber || '—'}</span>}
                />
                {device.lifecycle?.deliveryDate && (
                  <InfoLine label="تاريخ التسليم" value={formatDate(device.lifecycle.deliveryDate)} />
                )}
                {device.lifecycle?.installationDate && (
                  <InfoLine label="تاريخ التركيب" value={formatDate(device.lifecycle.installationDate)} />
                )}
                {device.lifecycle?.activatedAt && (
                  <InfoLine label="تاريخ التشغيل" value={formatDate(device.lifecycle.activatedAt)} />
                )}
                {device.branchName && <InfoLine label="فرع الجهاز" value={device.branchName} />}
              </div>
            </>
          ) : (
            // Legacy shape — show what we have under contract.device
            <div className="grid grid-cols-1 md:grid-cols-2 gap-x-8 gap-y-1.5">
              <InfoLine label="الموديل" value={legacyDevice.modelName || `#${legacyDevice.modelId ?? '—'}`} />
              <InfoLine
                label="الرقم التسلسلي"
                value={<span className="font-mono">{legacyDevice.serialNumber || '—'}</span>}
              />
            </div>
          )}
        </Card>
      )}

      {/* ─── Warranty block (only if device snapshot has it) ────── */}
      {device?.warranty && (device.warranty.warrantyMonths || device.warranty.contractWarrantyEndDate || device.warranty.goldenWarrantyEndDate) && (
        <Card title="الكفالة ودورة الصيانة" icon={ShieldCheck}>
          <div className="grid grid-cols-1 md:grid-cols-2 gap-x-8 gap-y-1.5">
            {device.warranty.warrantyMonths && (
              <InfoLine label="مُدّة الكفالة" value={`${device.warranty.warrantyMonths} شهر`} />
            )}
            {device.warranty.warrantyVisits && (
              <InfoLine label="عدد زيارات الصيانة" value={device.warranty.warrantyVisits} />
            )}
            {device.warranty.warrantyMonths && device.warranty.warrantyVisits && (
              <InfoLine
                label="دورة الصيانة"
                value={`كل ${Math.round((device.warranty.warrantyMonths * 30) / device.warranty.warrantyVisits)} يوم`}
              />
            )}
            {device.warranty.contractWarrantyEndDate && (
              <InfoLine label="انتهاء كفالة العقد" value={formatDate(device.warranty.contractWarrantyEndDate)} />
            )}
            {device.warranty.goldenWarrantyEndDate && (
              <InfoLine label="انتهاء الكفالة الذهبية" value={formatDate(device.warranty.goldenWarrantyEndDate)} />
            )}
          </div>
        </Card>
      )}

      {/* ─── Installation address ───────────────────────────────── */}
      {address && (address.geoUnitName || address.addressText || addressLat) && (() => {
        // BR-4: Full Address = Governorate → District → Neighborhood → Detailed
        const pathNames: string[] = Array.isArray(address.geoPath) && address.geoPath.length > 0
          ? address.geoPath.map((g: any) => g.name).filter(Boolean)
          : (address.geoUnitName ? [address.geoUnitName] : []);
        const fullAddress = [...pathNames, address.addressText].filter(Boolean).join('، ');
        return (
        <Card title="عنوان التركيب" icon={MapPin}>
          {fullAddress && (
            <div className="mb-3 rounded-xl bg-slate-50 border border-slate-200 px-3 py-2.5">
              <div className="text-[11px] font-bold text-slate-500 mb-1">العنوان الكامل</div>
              <div className="text-sm text-slate-800 leading-relaxed">{fullAddress}</div>
            </div>
          )}
          {pathNames.length > 0 && (
            <div className="mb-3 flex items-center flex-wrap gap-1.5 text-xs">
              {pathNames.map((n, i) => (
                <span key={i} className="inline-flex items-center gap-1.5">
                  <span className="rounded-md bg-white border border-slate-200 px-2 py-0.5 font-bold text-slate-700">{n}</span>
                  {i < pathNames.length - 1 && <span className="text-slate-300">›</span>}
                </span>
              ))}
            </div>
          )}
          {address.addressText && (
            <div className="grid grid-cols-1 gap-y-1.5 mb-3">
              <InfoLine label="العنوان التفصيلي" value={address.addressText} />
            </div>
          )}
          {addressLat && addressLng && (
            <div className="space-y-2">
              <div className="rounded-xl overflow-hidden border border-slate-200 shadow-sm relative" style={{ height: 220 }}>
                <iframe
                  src={`https://www.openstreetmap.org/export/embed.html?bbox=${addressLng - 0.005},${addressLat - 0.0025},${addressLng + 0.005},${addressLat + 0.0025}&layer=mapnik&marker=${addressLat},${addressLng}`}
                  style={{ width: '100%', height: '100%', border: 0 }}
                  loading="lazy"
                  title="موقع التركيب"
                />
              </div>
              <div className="flex items-center justify-between text-[11px] text-slate-500">
                <span dir="ltr" className="font-mono">{Number(addressLat).toFixed(6)}, {Number(addressLng).toFixed(6)}</span>
                <a
                  href={`https://www.google.com/maps?q=${addressLat},${addressLng}`}
                  target="_blank"
                  rel="noopener noreferrer"
                  className="inline-flex items-center gap-1 text-sky-600 hover:text-sky-700 font-bold"
                >
                  <ExternalLink className="w-3 h-3" /> فتح في خرائط Google
                </a>
              </div>
            </div>
          )}
        </Card>
        );
      })()}

      {/* ─── Financials (contract only) ─────────────────────────── */}
      {contract?.financials && (
        <Card title="البيانات المالية" icon={FileText}>
          {contract.financials.noFinancialObligations ? (
            <div className="text-sm text-violet-700 bg-violet-50 border border-violet-200 rounded-lg p-3">
              عقد مجاني / هبة — لا التزامات مالية
            </div>
          ) : (
            <div className="grid grid-cols-1 md:grid-cols-2 gap-x-8 gap-y-1.5">
              <InfoLine
                label="نوع الدفع"
                value={PAYMENT_TYPE_LABELS[contract.financials.paymentType] ?? contract.financials.paymentType ?? '—'}
              />
              <InfoLine
                label="السعر النهائي"
                value={formatMoney(contract.financials.finalPrice, contract.financials.currency)}
              />
              <InfoLine
                label="الدفعة الأولى"
                value={formatMoney(contract.financials.downPayment, contract.financials.currency)}
              />
              <InfoLine label="عدد الأقساط" value={contract.financials.installmentsCount || '—'} />
            </div>
          )}
        </Card>
      )}
    </div>
  );
}
