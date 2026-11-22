// «نقل الحيازة إلى زبون آخر» (migration 500): administrative transfer of the
// device to another client. The server checks every condition (closed device
// tasks, allowed status, no active service agreement) and moves the holder,
// the contract's remaining installments and their collection tasks; warranties
// stay on the device. The location may change; the branch does not.
import { useCallback, useEffect, useMemo, useState } from 'react';
import { AlertCircle, ArrowLeftRight, CheckCircle2, MapPin } from '../ui/icons';
import Button from '../ui/Button';
import Modal from '../ui/Modal';
import Select from '../ui/Select';
import CustomerLookupField, { type LookupCustomer } from '../CustomerLookupField';
import GeoSmartSearch, { deepestGeoId, type GeoSelection } from '../GeoSmartSearch';
import MapPicker from '../MapPicker';
import { api } from '../../lib/api';

interface Props {
  device: { id: number; customerId?: number | null; customerName?: string | null; branchId?: number | null };
  onClose: () => void;
  onDone: () => void;
}

interface TransferResult {
  transferId: number;
  contractBalanceSyp: number;
  warrantyBalanceSyp: number;
  movedTaskIds: number[];
  locationChanged: boolean;
}

function syp(n: number) {
  return `${Math.round(n).toLocaleString('en-US')} ل.س`;
}

export function PossessionTransferModal({ device, onClose, onDone }: Props) {
  const [toClient, setToClient] = useState<LookupCustomer | null>(null);
  const searchCustomers = useCallback(
    (query: string, signal: AbortSignal) => api.devicePossession.customerLookup(device.id, query, signal),
    [device.id],
  );
  const [reasons, setReasons] = useState<Array<{ value: string; label: string }>>([]);
  const [reasonCode, setReasonCode] = useState('');
  const [notes, setNotes] = useState('');
  const [changeLocation, setChangeLocation] = useState(false);
  const [geoUnits, setGeoUnits] = useState<any[]>([]);
  const [geoSelection, setGeoSelection] = useState<GeoSelection>({ govId: '', regionId: '', subId: '', neighborhoodId: '' });
  const [addressText, setAddressText] = useState('');
  const [mapPosition, setMapPosition] = useState<[number, number] | null>(null);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [result, setResult] = useState<TransferResult | null>(null);

  useEffect(() => {
    api.systemLists.list({ category: 'device_possession_transfer_reasons', activeOnly: true })
      .then((rows: any[]) => setReasons((rows ?? []).map(r => ({ value: String(r.value), label: String(r.label ?? r.metadata?.label ?? r.value) }))))
      .catch(() => setReasons([]));
  }, []);

  useEffect(() => {
    if (!changeLocation || geoUnits.length > 0) return;
    api.geoUnits.list(device.branchId ?? null).then(rows => setGeoUnits(rows ?? [])).catch(() => setGeoUnits([]));
  }, [changeLocation, device.branchId, geoUnits.length]);

  const activeGeoUnits = useMemo(() => geoUnits.filter(unit => unit?.status !== 'inactive'), [geoUnits]);

  const submit = async () => {
    setError(null);
    if (!toClient) { setError('اختر الزبون الجديد'); return; }
    if (!reasonCode) { setError('اختر سبب النقل'); return; }
    if (reasonCode === 'other' && !notes.trim()) { setError('اختيار «أخرى» يتطلب ملاحظة'); return; }
    let location: { geoUnitId: number; addressText: string; lat: number | null; lng: number | null } | null = null;
    if (changeLocation) {
      const geoId = Number(deepestGeoId(geoSelection));
      if (!geoId) { setError('اختر الناحية أو الحي للموقع الجديد'); return; }
      if (!addressText.trim()) { setError('العنوان التفصيلي مطلوب'); return; }
      location = {
        geoUnitId: geoId,
        addressText: addressText.trim(),
        lat: mapPosition ? mapPosition[0] : null,
        lng: mapPosition ? mapPosition[1] : null,
      };
    }
    setBusy(true);
    try {
      const res = await api.devicePossession.transferToClient(device.id, {
        toClientId: toClient.id,
        reasonCode,
        notes: notes.trim() || null,
        location,
      });
      setResult(res);
    } catch (err: any) {
      setError(err?.message || 'تعذّر نقل الحيازة');
    } finally {
      setBusy(false);
    }
  };

  if (result) {
    return (
      <Modal
        isOpen
        onClose={onDone}
        size="md"
        title={<span className="flex items-center gap-2"><CheckCircle2 className="h-5 w-5 text-emerald-600" />تم نقل الحيازة</span>}
        footer={<Button onClick={onDone}>تم</Button>}
      >
        <div className="space-y-2 px-5 py-4 text-sm text-slate-700">
          <p>انتقلت حيازة الجهاز إلى <span className="font-bold">{toClient?.name}</span>.</p>
          <p>ذمة العقد المنقولة: <span className="font-bold">{syp(result.contractBalanceSyp)}</span></p>
          {result.warrantyBalanceSyp > 0 && (
            <p>ذمة الكفالة الذهبية المنقولة: <span className="font-bold">{syp(result.warrantyBalanceSyp)}</span></p>
          )}
          <p>مهام التحصيل المنقولة: <span className="font-bold">{result.movedTaskIds.length}</span></p>
          {result.locationChanged && <p>تم تحديث موقع الجهاز.</p>}
        </div>
      </Modal>
    );
  }

  return (
    <Modal
      isOpen
      onClose={onClose}
      size="2xl"
      title={<span className="flex items-center gap-2"><ArrowLeftRight className="h-5 w-5 text-sky-600" />نقل الحيازة إلى زبون آخر</span>}
      footer={(
        <>
          <Button variant="secondary" onClick={onClose}>إلغاء</Button>
          <Button onClick={submit} loading={busy}>نقل الحيازة</Button>
        </>
      )}
    >
      <div className="space-y-4 px-5 py-4">
        {error && (
          <div className="flex items-start gap-2 rounded-lg border border-rose-200 bg-rose-50 px-3 py-2 text-sm text-rose-700">
            <AlertCircle className="mt-0.5 h-4 w-4 shrink-0" />
            <span>{error}</span>
          </div>
        )}
        <div className="rounded-lg border border-amber-200 bg-amber-50 px-3 py-2 text-xs leading-relaxed text-amber-800">
          ينتقل الجهاز إلى الزبون الجديد، ومعه ما تبقى من أقساط العقد والكفالة الذهبية ومهام تحصيلها المفتوحة.
          تبقى الكفالات على الجهاز، ويبقى العقد باسم مشتريه، ويبقى فرع الجهاز كما هو.
          يُشترط أن تكون كل مهام الجهاز مكتملة أو ملغاة.
        </div>
        <div className="text-xs text-slate-500">
          الحائز الحالي: <span className="font-bold text-slate-700">{device.customerName ?? `#${device.customerId ?? '—'}`}</span>
        </div>
        <div className="space-y-1.5">
          <span className="text-xs font-bold text-slate-500">الزبون الجديد *</span>
          <CustomerLookupField
            value={toClient}
            onChange={setToClient}
            search={searchCustomers}
            excludeIds={device.customerId ? [Number(device.customerId)] : []}
          />
        </div>
        <label className="block space-y-1.5">
          <span className="text-xs font-bold text-slate-500">سبب النقل *</span>
          <Select<string>
            value={reasonCode}
            onChange={setReasonCode}
            ariaLabel="سبب النقل"
            className="w-full"
            options={[{ value: '', label: 'اختر السبب' }, ...reasons]}
          />
        </label>
        <label className="block space-y-1.5">
          <span className="text-xs font-bold text-slate-500">ملاحظة{reasonCode === 'other' ? ' *' : ''}</span>
          <textarea
            value={notes}
            onChange={e => setNotes(e.target.value)}
            rows={2}
            className="w-full resize-none rounded-lg border border-slate-200 px-3 py-2 text-sm"
          />
        </label>
        <label className="flex items-center gap-2 text-sm font-bold text-slate-700">
          <input type="checkbox" checked={changeLocation} onChange={e => setChangeLocation(e.target.checked)} />
          تغيير موقع الجهاز
        </label>
        {changeLocation && (
          <div className="space-y-3 rounded-lg border border-slate-200 bg-white p-3">
            <GeoSmartSearch
              geoUnits={activeGeoUnits}
              value={geoSelection}
              onChange={setGeoSelection}
              label="موقع الجهاز الجديد"
              required
              minSelectableLevel={3}
              placeholder="ابحث عن الناحية أو الحي"
            />
            <label className="block space-y-1.5">
              <span className="text-xs font-bold text-slate-500">العنوان التفصيلي *</span>
              <textarea value={addressText} onChange={e => setAddressText(e.target.value)} rows={2} className="w-full resize-none rounded-lg border border-slate-200 px-3 py-2 text-sm" />
            </label>
            <div className="space-y-1.5">
              <div className="flex items-center justify-between gap-2">
                <span className="flex items-center gap-1 text-xs font-bold text-slate-500">
                  <MapPin className="h-3.5 w-3.5" /> الموقع على الخريطة
                </span>
                {mapPosition ? (
                  <span className="font-mono text-xs text-slate-500" dir="ltr">
                    {mapPosition[0].toFixed(5)}, {mapPosition[1].toFixed(5)}
                  </span>
                ) : (
                  <span className="text-xs text-slate-400">انقر على الخريطة لتحديد الموقع</span>
                )}
              </div>
              <MapPicker
                position={mapPosition}
                onLocationSelect={(lat, lng) => setMapPosition(lat === 0 && lng === 0 ? null : [lat, lng])}
              />
            </div>
          </div>
        )}
      </div>
    </Modal>
  );
}

export default PossessionTransferModal;
