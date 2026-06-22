import { useState } from 'react';
import {
  User, Phone, Home, Building2, Briefcase, Star,
  MapPin, ChevronDown, ChevronUp, UserCheck, Smartphone,
  PhoneCall, Wifi, Globe, Wrench, Users, BadgeCheck,
} from 'lucide-react';

// ── Types ──────────────────────────────────────────────────────────────────────

export interface ClientContactItem {
  number: string;
  type?: string;
  label?: string;
  hasWhatsApp?: boolean;
  isPrimary?: boolean;
  status?: string;
}

export interface ClientReferrerItem {
  type?: string;
  channel?: string;
  method?: string;
  name?: string;
  referralName?: string;
  notes?: string;
}

export interface ClientInfoCardData {
  name?: string | null;
  firstName?: string | null;
  fatherName?: string | null;
  lastName?: string | null;
  nickname?: string | null;
  mobile?: string | null;
  contacts?: ClientContactItem[] | null;
  address?: {
    governorate?: string | null;
    district?: string | null;
    subDistrict?: string | null;
    neighborhood?: string | null;
    detailedAddress?: string | null;
    gps?: string | null;
  } | null;
  branchName?: string | null;
  occupation?: string | null;
  spouseOccupation?: string | null;
  rating?: string | null;
  candidateStatus?: string | null;
  ownership?: {
    ownerType: string;
    ownerLabel: string;
  } | null;
  referrers?: ClientReferrerItem[] | null;
}

// ── Static config ──────────────────────────────────────────────────────────────

const OWNERSHIP_META: Record<string, {
  icon: any; color: string; bg: string; border: string; dot: string;
}> = {
  company_branch: {
    icon: Building2,
    color: 'text-blue-700', bg: 'bg-blue-50', border: 'border-blue-200', dot: 'bg-blue-500',
  },
  company_global: {
    icon: Globe,
    color: 'text-slate-600', bg: 'bg-slate-100', border: 'border-slate-200', dot: 'bg-slate-400',
  },
  personal_single_supervisor: {
    icon: UserCheck,
    color: 'text-violet-700', bg: 'bg-violet-50', border: 'border-violet-200', dot: 'bg-violet-500',
  },
  personal_single_technician: {
    icon: Wrench,
    color: 'text-teal-700', bg: 'bg-teal-50', border: 'border-teal-200', dot: 'bg-teal-500',
  },
  personal_multi: {
    icon: Users,
    color: 'text-amber-700', bg: 'bg-amber-50', border: 'border-amber-200', dot: 'bg-amber-500',
  },
};

const CANDIDATE_STATUS_META: Record<string, { label: string; color: string; bg: string; border: string }> = {
  Lead: { label: 'Lead', color: 'text-sky-700',     bg: 'bg-sky-50',     border: 'border-sky-200'     },
  OP:   { label: 'OP',   color: 'text-emerald-700', bg: 'bg-emerald-50', border: 'border-emerald-200' },
  FOP:  { label: 'FOP',  color: 'text-rose-700',    bg: 'bg-rose-50',    border: 'border-rose-200'    },
};

const CONTACT_TYPE_ICONS: Record<string, { icon: any; color: string; label: string }> = {
  mobile:   { icon: Smartphone, color: 'text-sky-500',     label: 'جوال'   },
  phone:    { icon: PhoneCall,  color: 'text-slate-500',   label: 'هاتف'   },
  whatsapp: { icon: Wifi,       color: 'text-emerald-500', label: 'واتساب' },
  default:  { icon: Phone,      color: 'text-slate-400',   label: 'رقم'    },
};

const REFERRER_TYPE_LABELS: Record<string, string> = {
  Personal:   'شخصي',
  Employee:   'موظف',
  Client:     'زبون',
  Unknown:    'مجهول',
  FieldVisit: 'زيارة ميدانية',
};

const CHANNEL_LABELS: Record<string, string> = {
  Acquaintance: 'معرفة شخصية',
  PhoneCall:    'اتصال هاتفي',
  SocialMedia:  'تواصل اجتماعي',
  Campaign:     'حملة',
  App:          'تطبيق',
};

// ── Sub-components ─────────────────────────────────────────────────────────────

function Divider() {
  return <div className="border-t border-slate-100 my-3" />;
}

function InfoRow({ label, value }: { label: string; value: React.ReactNode }) {
  return (
    <div className="flex items-start justify-between gap-4 py-2 border-b border-slate-50 last:border-0">
      <span className="text-xs text-slate-400 shrink-0 pt-0.5 min-w-[6.5rem]">{label}</span>
      <span className="text-xs font-semibold text-slate-800 text-end leading-relaxed">
        {value ?? <span className="text-slate-400 font-normal">غير محدد</span>}
      </span>
    </div>
  );
}

function OwnershipBadge({ ownership }: { ownership: NonNullable<ClientInfoCardData['ownership']> }) {
  const meta = OWNERSHIP_META[ownership.ownerType] ?? OWNERSHIP_META.company_global;
  const IconComp = meta.icon;
  return (
    <span className={`inline-flex items-center gap-1.5 px-2.5 py-1.5 rounded-xl text-xs font-bold border shrink-0 ${meta.bg} ${meta.border} ${meta.color}`}>
      <span className={`w-1.5 h-1.5 rounded-full shrink-0 ${meta.dot}`} />
      <IconComp className="w-3 h-3 shrink-0" />
      {ownership.ownerLabel}
    </span>
  );
}

function CandidateStatusBadge({ status }: { status: string }) {
  const meta = CANDIDATE_STATUS_META[status];
  if (!meta) return null;
  return (
    <span className={`inline-flex items-center gap-1 px-2 py-0.5 rounded-full text-xs font-bold border ${meta.bg} ${meta.border} ${meta.color}`}>
      <BadgeCheck className="w-3 h-3" />
      {meta.label}
    </span>
  );
}

function ReferrerCard({ referrer }: { referrer: ClientReferrerItem }) {
  const typeLabel = referrer.type ? (REFERRER_TYPE_LABELS[referrer.type] ?? referrer.type) : null;
  const channelLabel = (referrer.channel || referrer.method)
    ? (CHANNEL_LABELS[referrer.channel ?? referrer.method ?? ''] ?? (referrer.channel ?? referrer.method))
    : null;
  const displayName = referrer.name ?? referrer.referralName;

  return (
    <div className="flex items-start gap-2.5 rounded-xl bg-slate-50 border border-slate-100 px-3 py-2.5">
      <UserCheck className="w-3.5 h-3.5 text-slate-400 shrink-0 mt-0.5" />
      <div className="min-w-0 flex-1">
        <div className="flex items-center gap-2 flex-wrap">
          {typeLabel && (
            <span className="text-xs font-bold text-slate-700 bg-white border border-slate-200 px-2 py-0.5 rounded-full">
              {typeLabel}
            </span>
          )}
          {channelLabel && (
            <span className="text-xs text-slate-400">{channelLabel}</span>
          )}
        </div>
        {displayName && (
          <p className="text-sm font-semibold text-slate-800 mt-1">{displayName}</p>
        )}
        {referrer.notes && (
          <p className="text-xs text-slate-400 mt-0.5">{referrer.notes}</p>
        )}
      </div>
    </div>
  );
}

// ── Section card shell ─────────────────────────────────────────────────────────

function SectionShell({ children }: { children: React.ReactNode }) {
  return (
    <div className="bg-white rounded-2xl border border-slate-200 overflow-hidden shadow-sm">
      <div className="px-5 py-3.5 border-b border-slate-100 flex items-center gap-3">
        <div className="w-7 h-7 rounded-lg bg-indigo-50 flex items-center justify-center shrink-0">
          <User className="w-4 h-4 text-indigo-600" />
        </div>
        <h2 className="text-lg font-bold text-slate-800">بيانات الزبون</h2>
      </div>
      <div className="p-5">{children}</div>
    </div>
  );
}

// ── Main component ─────────────────────────────────────────────────────────────

export default function ClientInfoCard({ data }: { data: ClientInfoCardData }) {
  const [expandedContacts, setExpandedContacts] = useState(false);

  // Name
  const displayName =
    [data.firstName, data.fatherName, data.lastName].filter(Boolean).join(' ') ||
    data.name ||
    '—';

  // Contacts
  const contacts = Array.isArray(data.contacts) ? data.contacts : [];
  const primaryContact = contacts.find((c) => c.isPrimary) ?? null;
  const primaryPhone = primaryContact?.number ?? data.mobile ?? null;
  const otherContacts = contacts.filter((c) => !c.isPrimary && c.number);
  const primaryHasWhatsApp = primaryContact?.hasWhatsApp ?? false;

  // Address
  const addr = data.address;
  const hasAddress =
    addr?.governorate || addr?.district || addr?.subDistrict ||
    addr?.neighborhood || addr?.detailedAddress || addr?.gps;

  // GPS map link
  let gpsLink: string | null = null;
  if (addr?.gps) {
    const parts = String(addr.gps).split(',').map((p) => p.trim());
    if (parts.length === 2 && !isNaN(Number(parts[0])) && !isNaN(Number(parts[1]))) {
      gpsLink = `https://www.google.com/maps?q=${parts[0]},${parts[1]}`;
    }
  }

  // Address hierarchy
  const addrHierarchy = [addr?.governorate, addr?.district, addr?.subDistrict, addr?.neighborhood]
    .filter(Boolean)
    .join(' ← ');

  // Rating translation
  const ratingNode = (() => {
    if (data.rating === 'Committed') {
      return (
        <span className="flex items-center gap-1 text-emerald-600 font-bold">
          <Star className="w-3.5 h-3.5 text-emerald-500 fill-emerald-500 animate-pulse" />
          زبون ملتزم
        </span>
      );
    }
    if (data.rating === 'NotCommitted') {
      return (
        <span className="flex items-center gap-1 text-rose-600 font-bold">
          <Star className="w-3.5 h-3.5 text-rose-500 fill-rose-500" />
          زبون غير ملتزم
        </span>
      );
    }
    return (
      <span className="flex items-center gap-1 text-slate-500 font-semibold">
        <Star className="w-3.5 h-3.5 text-slate-400" />
        غير محدد
      </span>
    );
  })();

  // Referrers
  const referrers = Array.isArray(data.referrers) ? data.referrers : [];

  return (
    <SectionShell>

      {/* ── Name + badges ─────────────────────────────────────────────────── */}
      <div className="flex items-start justify-between gap-3 mb-4">
        <div className="min-w-0 flex-1">
          <p className="text-base font-bold text-slate-900 leading-snug">{displayName}</p>
          {data.nickname && (
            <p className="text-xs text-slate-400 mt-0.5">"{data.nickname}"</p>
          )}
          {data.candidateStatus && (
            <div className="mt-1.5">
              <CandidateStatusBadge status={data.candidateStatus} />
            </div>
          )}
        </div>
        {data.ownership && <OwnershipBadge ownership={data.ownership} />}
      </div>

      {/* ── Primary contact ───────────────────────────────────────────────── */}
      {primaryPhone ? (
        <a
          href={`tel:${primaryPhone}`}
          className="flex items-center gap-3 rounded-2xl bg-gradient-to-l from-sky-50 to-blue-50 border border-sky-200 px-4 py-3.5 hover:from-sky-100 hover:to-blue-100 active:scale-[0.99] transition-all mb-3"
        >
          <div className="w-10 h-10 rounded-xl bg-sky-500 flex items-center justify-center shrink-0 shadow-sm">
            <Phone className="w-5 h-5 text-white" />
          </div>
          <div className="flex-1 min-w-0">
            <p className="text-xs text-sky-500 font-semibold mb-0.5">الرقم الرئيسي</p>
            <p className="text-lg font-bold text-sky-800 font-mono tracking-wide leading-none" dir="ltr">
              {primaryPhone}
            </p>
          </div>
          {primaryHasWhatsApp && (
            <span className="text-xs text-emerald-600 font-bold bg-white border border-emerald-200 px-2.5 py-1 rounded-full shrink-0">
              واتساب ✓
            </span>
          )}
        </a>
      ) : (
        <div className="flex items-center gap-2 rounded-xl bg-slate-50 border border-slate-100 px-4 py-3 mb-3 text-slate-400">
          <Phone className="w-4 h-4 shrink-0" />
          <span className="text-xs">لا يوجد رقم مسجّل</span>
        </div>
      )}

      {/* ── Other contacts (collapsible) ──────────────────────────────────── */}
      {otherContacts.length > 0 && (
        <div className="mb-1">
          <button
            onClick={() => setExpandedContacts(!expandedContacts)}
            className="flex items-center gap-1.5 text-xs text-slate-500 hover:text-slate-700 font-semibold transition-colors mb-2"
          >
            {expandedContacts ? <ChevronUp className="w-3.5 h-3.5" /> : <ChevronDown className="w-3.5 h-3.5" />}
            {otherContacts.length} {otherContacts.length === 1 ? 'رقم آخر' : 'أرقام أخرى'}
          </button>
          {expandedContacts && (
            <div className="space-y-1.5">
              {otherContacts.map((c, i) => {
                const typeMeta = CONTACT_TYPE_ICONS[c.type ?? ''] ?? CONTACT_TYPE_ICONS.default;
                const IconComp = typeMeta.icon;
                return (
                  <a
                    key={i}
                    href={`tel:${c.number}`}
                    className="flex items-center gap-3 rounded-xl border border-slate-100 bg-slate-50 px-3 py-2.5 hover:bg-slate-100 transition-colors"
                  >
                    <div className="w-7 h-7 rounded-lg bg-white border border-slate-200 flex items-center justify-center shrink-0">
                      <IconComp className={`w-3.5 h-3.5 ${typeMeta.color}`} />
                    </div>
                    <div className="flex-1 min-w-0">
                      <span className="text-sm font-mono text-slate-700" dir="ltr">{c.number}</span>
                      {c.label && <span className="text-xs text-slate-400 mr-2">{c.label}</span>}
                    </div>
                    <div className="flex items-center gap-1.5">
                      {c.hasWhatsApp && (
                        <span className="text-xs text-emerald-600 font-semibold bg-emerald-50 px-1.5 py-0.5 rounded-full">واتس</span>
                      )}
                      {c.status === 'inactive' && (
                        <span className="text-xs text-slate-400 bg-slate-100 px-1.5 py-0.5 rounded-full">غير فعّال</span>
                      )}
                    </div>
                  </a>
                );
              })}
            </div>
          )}
        </div>
      )}

      {/* ── Address — redesigned ──────────────────────────────────────────── */}
      {hasAddress && (
        <>
          <Divider />
          <div className="rounded-xl bg-slate-50 border border-slate-200 p-4">
            <div className="flex items-center gap-2 mb-2">
              <Home className="w-3.5 h-3.5 text-slate-400 shrink-0" />
              <span className="text-xs font-bold text-slate-500">عنوان الزبون</span>
            </div>
            {addrHierarchy && (
              <p className="text-sm font-bold text-slate-800 mb-2 leading-relaxed">{addrHierarchy}</p>
            )}
            {addr?.detailedAddress && (
              <p className="text-sm text-slate-600 mb-2 leading-relaxed">{addr.detailedAddress}</p>
            )}
            {gpsLink && (
              <a
                href={gpsLink}
                target="_blank"
                rel="noopener noreferrer"
                className="inline-flex items-center gap-1.5 text-xs text-sky-600 hover:text-sky-700 font-semibold"
              >
                <MapPin className="w-3.5 h-3.5" />
                عرض على الخريطة
              </a>
            )}
          </div>
        </>
      )}

      {/* ── Details ───────────────────────────────────────────────────────── */}
      <Divider />
      <div className="space-y-0">
        {data.branchName && (
          <InfoRow
            label="الفرع"
            value={
              <span className="flex items-center gap-1.5">
                <Building2 className="w-3.5 h-3.5 text-slate-400" />
                {data.branchName}
              </span>
            }
          />
        )}
        <InfoRow
          label="المهنة"
          value={
            data.occupation ? (
              <span className="flex items-center gap-1.5">
                <Briefcase className="w-3.5 h-3.5 text-slate-400" />
                {data.occupation}
              </span>
            ) : null
          }
        />
        <InfoRow label="مهنة الزوج / الزوجة" value={data.spouseOccupation ?? null} />
        <InfoRow label="التقييم" value={ratingNode} />
      </div>

      {/* ── Referrers ─────────────────────────────────────────────────────── */}
      <Divider />
      <p className="text-xs font-bold text-slate-400 mb-2">الوسطاء</p>
      {referrers.length > 0 ? (
        <div className="space-y-2">
          {referrers.map((r, i) => (
            <ReferrerCard key={i} referrer={r} />
          ))}
        </div>
      ) : (
        <p className="text-xs text-slate-400">لا يوجد وسطاء مسجّلين</p>
      )}

    </SectionShell>
  );
}
