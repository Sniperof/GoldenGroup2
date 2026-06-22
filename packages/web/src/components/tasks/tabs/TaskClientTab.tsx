import {
  UserRound, Phone, MapPin, Briefcase, Award, Users2,
  StickyNote, Tag, Map as MapIcon, MessageCircle, Home, Smartphone,
} from 'lucide-react';
import { useEffect, useMemo, useState } from 'react';
import { Card, InfoLine, TabAlert } from '../shared';
import { getGeoUnits, type GeoUnit } from '../../../lib/geoUnitsCache';

// ============================================================
// TaskClientTab — Standard Snapshot (Level 2)
// ============================================================
// Reference: docs/constitution/components/client-snapshot.md §المستوى الثاني
// Renders the 8 sections specified there:
//   أ) Identity (avatar + names + classification badge)
//   ب) Contacts (primary mobile + contacts[])
//   ج) Address (4-level geo + detailed + GPS map link)
//   د) Personal (occupation, spouse occupation, committed if OP)
//   هـ) Referrers (count only)
//   و) Notes
//   ز) Ownership (assignments + branch ownership)
//   ح) Source channel
// ============================================================

const CLASSIFICATION_META: Record<string, { label: string; cls: string }> = {
  LEAD: { label: 'LEAD', cls: 'bg-sky-50 text-sky-700 border-sky-200' },
  FOP:  { label: 'FOP',  cls: 'bg-rose-50 text-rose-700 border-rose-200' },
  OP:   { label: 'OP',   cls: 'bg-emerald-50 text-emerald-700 border-emerald-200' },
};

const RATING_LABELS: Record<string, string> = {
  Committed:    'ملتزم',
  NotCommitted: 'غير ملتزم',
  Undefined:    'غير محدد',
};

// Source channel labels — mirror of ClientInfoCard.CHANNEL_LABELS.
const CHANNEL_LABELS: Record<string, string> = {
  Acquaintance: 'معرفة شخصية',
  PhoneCall:    'اتصال هاتفي',
  SocialMedia:  'تواصل اجتماعي',
  Campaign:     'حملة',
  App:          'تطبيق',
};

// Legacy single-referrer type labels — mirror of ClientInfoCard.REFERRER_TYPE_LABELS.
const REFERRER_TYPE_LABELS: Record<string, string> = {
  Personal:   'شخصي',
  Employee:   'موظف',
  Client:     'زبون',
  Unknown:    'مجهول',
  FieldVisit: 'زيارة ميدانية',
};

// Normalize a mobile/phone string for dedupe comparison: digits only.
function normalizePhone(p: any): string {
  if (typeof p !== 'string') return '';
  return p.replace(/\D+/g, '');
}

const CONTACT_ICON: Record<string, typeof Phone> = {
  موبايل:  Smartphone,
  بيت:     Home,
  واتساب:  MessageCircle,
  عمل:     Briefcase,
};

function getContactIcon(label?: string) {
  if (!label) return Phone;
  return CONTACT_ICON[label.trim()] ?? Phone;
}

function buildFullName(t: any, snap: any): string {
  const parts = [
    t.clientFirstName ?? snap?.firstName,
    t.clientFatherName ?? snap?.fatherName,
    t.clientLastName ?? snap?.lastName,
  ].map((p: any) => (typeof p === 'string' ? p.trim() : '')).filter(Boolean);
  if (parts.length > 0) return parts.join(' ');
  return snap?.name || t.clientName || '—';
}

function buildMapUrl(gps: any): string | null {
  if (!gps || typeof gps !== 'object') return null;
  const lat = Number(gps.lat);
  const lng = Number(gps.lng);
  if (!Number.isFinite(lat) || !Number.isFinite(lng)) return null;
  return `https://www.google.com/maps/search/?api=1&query=${lat},${lng}`;
}

function parseGeoId(value: unknown): number | null {
  if (typeof value === 'number' && Number.isFinite(value)) return value;
  if (typeof value === 'string' && /^\d+$/.test(value.trim())) return Number(value.trim());
  return null;
}

function resolveGeoName(value: unknown, geoMap: Map<number, GeoUnit>): string {
  if (typeof value === 'string' && value.trim() && !/^\d+$/.test(value.trim())) return value.trim();
  const id = parseGeoId(value);
  return id ? geoMap.get(id)?.name ?? '' : '';
}

function buildAddressShort(neighborhoodValue: unknown, districtValue: unknown, geoMap: Map<number, GeoUnit>): string {
  const neighborhoodId = parseGeoId(neighborhoodValue);
  const districtId = parseGeoId(districtValue);
  const neighborhood = neighborhoodId ? geoMap.get(neighborhoodId) : null;
  if (neighborhood) {
    const subArea = neighborhood.parentId ? geoMap.get(neighborhood.parentId) : null;
    if (subArea) return `${subArea.name} ← ${neighborhood.name}`;
    return neighborhood.name;
  }
  const district = districtId ? geoMap.get(districtId) : null;
  if (district) {
    const subArea = Array.from(geoMap.values()).find((unit) => unit.parentId === district.id && unit.level === 3);
    if (subArea) return `${district.name} ← ${subArea.name}`;
    return district.name;
  }
  return '';
}

export interface TaskClientTabProps {
  task: any;
  onClientClick: (clientId: number) => void;
}

export default function TaskClientTab({ task, onClientClick }: TaskClientTabProps) {
  const snap = task.clientSnapshot || {};
  const [geoUnits, setGeoUnits] = useState<GeoUnit[]>([]);

  useEffect(() => {
    getGeoUnits().then(setGeoUnits).catch(() => setGeoUnits([]));
  }, []);

  const geoMap = useMemo(() => new Map(geoUnits.map((unit) => [unit.id, unit])), [geoUnits]);
  const fullName = buildFullName(task, snap);
  const nickname = task.clientNickname || snap.nickname || '';
  const classification: string | null = task.clientClassification || null;

  const primaryMobile = task.clientMobile || snap.mobile || '';
  const primaryDigits = normalizePhone(primaryMobile);
  // Dedupe: drop any contact that is flagged isPrimary OR whose number matches the primary mobile.
  const contactsRaw: any[] = Array.isArray(task.clientContacts) && task.clientContacts.length > 0
    ? task.clientContacts
    : (Array.isArray(snap.contacts) ? snap.contacts : []);
  const contacts = contactsRaw.filter((c: any) => !c?.isPrimary && normalizePhone(c?.number) !== primaryDigits);

  const governorate = resolveGeoName(snap.address?.governorate || task.clientGovernorate || '', geoMap);
  const district    = resolveGeoName(snap.address?.district || task.clientDistrict || '', geoMap);
  const neighborhood = resolveGeoName(snap.address?.neighborhood || task.clientNeighborhood || '', geoMap);
  const subArea = (() => {
    const explicit = resolveGeoName(snap.address?.subArea || '', geoMap);
    if (explicit) return explicit;
    const neighborhoodId = parseGeoId(snap.address?.neighborhood || task.clientNeighborhood || '');
    const neighborhoodUnit = neighborhoodId ? geoMap.get(neighborhoodId) : null;
    return neighborhoodUnit?.parentId ? geoMap.get(neighborhoodUnit.parentId)?.name ?? '' : '';
  })();
  const addressShort = buildAddressShort(snap.address?.neighborhood || task.clientNeighborhood || '', snap.address?.district || task.clientDistrict || '', geoMap);
  const detailedAddress = task.clientDetailedAddress || snap.address?.detailed || '';
  const gps  = task.clientGps || snap.address?.gps || null;
  const mapUrl = buildMapUrl(gps);

  const occupation = task.clientOccupation || snap.occupation || '';
  const spouseOccupation = task.clientSpouseOccupation || snap.spouseOccupation || '';
  const rating = task.clientRating || snap.rating || null;
  const showRating = classification === 'OP' && rating && rating !== 'Undefined';

  // Referrers: combine the new JSONB array with the legacy single-referrer fields
  // (referrer_type + referrer_id + referrer_name) so clients added before the array
  // shape was rolled out still appear.
  const referrersArray: any[] = Array.isArray(task.clientReferrers) ? task.clientReferrers : (Array.isArray(snap.referrers) ? snap.referrers : []);
  const legacyReferrer = (task.clientReferrerType || task.clientReferrerId || task.clientReferrerName)
    ? {
        type: task.clientReferrerType,
        id: task.clientReferrerId,
        name: task.clientReferrerName,
        notes: task.clientReferralNotes,
      }
    : null;
  const referrersTotal = referrersArray.length + (legacyReferrer ? 1 : 0);
  const notes = task.clientNotes || snap.notes || '';
  const sourceChannel = task.clientSourceChannel || snap.sourceChannel || '';

  const assignments: any[] = Array.isArray(task.assignments) ? task.assignments : [];
  const branchOwnership = task.branchName ? { name: task.branchName } : null;

  // Issue list (top alert)
  const issues: string[] = [];
  if (!primaryMobile)    issues.push('رقم الهاتف غير متوفر');
  if (!detailedAddress)  issues.push('العنوان التفصيلي غير متوفر');
  if (!occupation)       issues.push('المهنة غير محددة');

  const classMeta = classification ? CLASSIFICATION_META[classification] : null;

  return (
    <>
      <TabAlert title="ملاحظات على بيانات الزبون" items={issues} />

      <Card title="لقطة الزبون" icon={UserRound}>
        <div className="space-y-6">

          {/* ──────── أ) Identity ──────── */}
          <div className="flex items-center gap-3 flex-wrap pb-4 border-b border-slate-100">
            <div className="w-11 h-11 rounded-full bg-slate-100 flex items-center justify-center">
              <UserRound className="w-5 h-5 text-slate-500" />
            </div>
            <button
              onClick={() => task.clientId && onClientClick(task.clientId)}
              className="text-lg font-bold text-slate-800 hover:text-sky-700 hover:underline transition-colors"
            >
              {fullName}{nickname && <span className="text-slate-500 font-medium"> ({nickname})</span>}
            </button>
            {classMeta && (
              <span className={`inline-flex items-center px-2.5 py-0.5 rounded-full text-xs font-bold border ${classMeta.cls}`}>
                {classMeta.label}
              </span>
            )}
          </div>

          {/* ──────── ب) Contacts ──────── */}
          <div>
            <p className="text-xs font-bold text-slate-400 mb-2">التواصل</p>
            <div className="space-y-1.5">
              <div className="flex items-center gap-2">
                <Phone className="w-4 h-4 text-slate-400" />
                <span className="text-sm font-bold text-slate-800 font-mono" dir="ltr">
                  {primaryMobile || '—'}
                </span>
                <span className="text-xs text-slate-400">رئيسي</span>
              </div>
              {contacts.map((c: any, i: number) => {
                const Icon = getContactIcon(c.label);
                const inactive = c.status === 'inactive';
                return (
                  <div key={c.id ?? i} className={`flex items-center gap-2 ${inactive ? 'opacity-50' : ''}`}>
                    <Icon className="w-4 h-4 text-slate-400" />
                    {c.label && <span className="text-xs text-slate-500">{c.label}:</span>}
                    <span className="text-sm text-slate-700 font-mono" dir="ltr">{c.number}</span>
                    {c.hasWhatsApp && <MessageCircle className="w-3.5 h-3.5 text-emerald-500" />}
                    {inactive && <span className="text-xs text-slate-400">(غير نشط)</span>}
                  </div>
                );
              })}
            </div>
          </div>

          {/* ──────── ج) Address ──────── */}
          <div>
            <p className="text-xs font-bold text-slate-400 mb-2">العنوان</p>
            <div className="space-y-1.5">
              <div className="flex items-start gap-2">
                <MapPin className="w-4 h-4 text-slate-400 mt-0.5" />
                <span className="text-sm text-slate-700">
                  {addressShort || '—'}
                </span>
              </div>
              {([governorate, district, subArea, neighborhood].filter(Boolean).length > 0) && (
                <p className="text-xs text-slate-500 pr-6">
                  {[governorate, district, subArea, neighborhood].filter(Boolean).join(' ← ')}
                </p>
              )}
              {detailedAddress && (
                <p className="text-sm text-slate-600 pr-6">{detailedAddress}</p>
              )}
              {mapUrl && (
                <a
                  href={mapUrl}
                  target="_blank"
                  rel="noopener noreferrer"
                  className="inline-flex items-center gap-1.5 pr-6 text-xs text-sky-600 hover:underline"
                >
                  <MapIcon className="w-3.5 h-3.5" />
                  فتح الخريطة
                </a>
              )}
            </div>
          </div>

          {/* ──────── د) Personal ──────── */}
          <div>
            <p className="text-xs font-bold text-slate-400 mb-2">المعلومات الشخصية</p>
            <div className="grid grid-cols-1 md:grid-cols-2 gap-x-8 gap-y-0.5">
              <InfoLine
                label={<><Briefcase className="w-3 h-3 inline ml-1" />المهنة</>}
                value={occupation || 'غير محدد'}
              />
              <InfoLine
                label={<><Briefcase className="w-3 h-3 inline ml-1" />مهنة الزوج/ة</>}
                value={spouseOccupation || 'غير محدد'}
              />
              {showRating && (
                <InfoLine
                  label={<><Award className="w-3 h-3 inline ml-1" />التقييم</>}
                  value={
                    <span className={`inline-flex items-center px-2 py-0.5 rounded text-xs font-bold border ${
                      rating === 'Committed' ? 'bg-green-50 text-green-700 border-green-200' : 'bg-rose-50 text-rose-700 border-rose-200'
                    }`}>
                      {RATING_LABELS[rating] || rating}
                    </span>
                  }
                />
              )}
            </div>
          </div>

          {/* ──────── هـ) Referrers ──────── */}
          <div>
            <div className="flex items-center gap-2 mb-1.5">
              <Users2 className="w-4 h-4 text-slate-400" />
              <span className="text-xs text-slate-500">الوسطاء:</span>
              <span className="text-sm font-medium text-slate-700">
                {referrersTotal > 0 ? `${referrersTotal} وسطاء` : 'لا يوجد وسطاء مسجّلين'}
              </span>
            </div>
            {legacyReferrer && (
              <div className="pr-6">
                <span className="inline-flex items-center gap-1.5 px-2.5 py-1 rounded-lg bg-slate-50 border border-slate-200 text-xs">
                  {legacyReferrer.type && (
                    <span className="text-xs font-bold text-slate-500">
                      {REFERRER_TYPE_LABELS[legacyReferrer.type] ?? legacyReferrer.type}
                    </span>
                  )}
                  <span className="font-bold text-slate-800">{legacyReferrer.name || `#${legacyReferrer.id ?? '—'}`}</span>
                </span>
                {legacyReferrer.notes && (
                  <p className="text-xs text-slate-500 mt-1">{legacyReferrer.notes}</p>
                )}
              </div>
            )}
          </div>

          {/* ──────── و) Notes ──────── */}
          {notes && (
            <div>
              <div className="flex items-center gap-2 mb-1.5">
                <StickyNote className="w-4 h-4 text-slate-400" />
                <span className="text-xs font-bold text-slate-500">ملاحظات</span>
              </div>
              <p className="text-sm text-slate-700 leading-relaxed bg-slate-50 rounded-lg p-3 border border-slate-100 whitespace-pre-wrap">
                {notes}
              </p>
            </div>
          )}

          {/* ──────── ز) Ownership ──────── */}
          <div>
            <p className="text-xs font-bold text-slate-400 mb-2">المسؤول</p>
            {assignments.length > 0 ? (
              <div className="flex flex-wrap gap-2">
                {assignments.map((a: any) => (
                  <span key={a.userId} className="inline-flex items-center gap-1.5 px-2.5 py-1 rounded-lg bg-indigo-50 text-indigo-700 border border-indigo-200 text-xs">
                    <UserRound className="w-3 h-3" />
                    <span className="font-bold">{a.userName}</span>
                    {a.roleDisplayName && <span className="text-indigo-500">· {a.roleDisplayName}</span>}
                  </span>
                ))}
              </div>
            ) : branchOwnership ? (
              <span className="inline-flex items-center gap-1.5 px-2.5 py-1 rounded-lg bg-slate-100 text-slate-600 border border-slate-200 text-xs">
                <Home className="w-3 h-3" />
                ملكية الفرع: {branchOwnership.name}
              </span>
            ) : (
              <span className="text-sm text-slate-400">—</span>
            )}
          </div>

          {/* ──────── ح) Source Channel ──────── */}
          {sourceChannel && (
            <div className="flex items-center gap-2">
              <Tag className="w-4 h-4 text-slate-400" />
              <span className="text-xs text-slate-500">المصدر:</span>
              <span className="inline-flex items-center px-2 py-0.5 rounded text-xs font-bold bg-violet-50 text-violet-700 border border-violet-200">
                {CHANNEL_LABELS[sourceChannel] ?? sourceChannel}
              </span>
            </div>
          )}

        </div>
      </Card>
    </>
  );
}
