import {
    Phone, Home, MessageCircle, Briefcase, MapPin, Navigation,
    Star, UserCog, FileText, Building2, Users, Globe,
} from 'lucide-react';
import ClientAvatar from './ClientAvatar';

// ============================================================
// ClientSnapshot — Standard (Level 2)
// ============================================================
// Canonical "lb of the project" customer card for tasks/visits per
//   docs/constitution/components/client-snapshot.md → المستوى الثاني.
// Consumes the `clientSnapshot` object built by GET /api/field-visits/:id.
// ============================================================

interface GeoUnit { id: number; name: string; level: number; }
interface ContactEntry {
    id?: string; label?: string; number?: string; type?: string;
    isPrimary?: boolean; hasWhatsApp?: boolean; status?: string;
}
export interface ClientSnapshotData {
    gender?: 'male' | 'female' | null;
    dataQuality?: string | null;
    firstName?: string | null;
    fatherName?: string | null;
    lastName?: string | null;
    nickname?: string | null;
    fullName?: string | null;
    classification?: string | null;
    primaryMobile?: string | null;
    contacts?: ContactEntry[];
    address?: {
        governorate?: string | null;
        district?: string | null;
        subArea?: string | null;
        neighborhood?: string | null;
        detailedAddress?: string | null;
        gps?: { lat?: number; lng?: number } | null;
        geoPath?: GeoUnit[];
    };
    occupation?: string | null;
    spouseOccupation?: string | null;
    committed?: string | null;
    referrers?: Array<{ type?: string | null; name?: string | null }>;
    referrersCount?: number;
    notes?: string | null;
    sourceChannel?: string | null;
    ownership?: {
        assignees?: Array<{ userName: string; roleDisplay?: string | null }>;
        branchName?: string | null;
    };
}

// classification badge (LEAD / OP / FOP) — empty renders nothing
const CLASSIFICATION_BADGE: Record<string, string> = {
    LEAD: 'bg-slate-100 text-slate-600 border border-slate-200',
    OP: 'bg-blue-50 text-blue-700 border border-blue-200',
    FOP: 'bg-emerald-50 text-emerald-700 border border-emerald-200',
};

// contact label → icon
function contactIcon(label?: string) {
    const l = (label ?? '').toLowerCase();
    if (l.includes('واتس') || l.includes('whats')) return MessageCircle;
    if (l.includes('بيت') || l.includes('منزل') || l.includes('home')) return Home;
    if (l.includes('عمل') || l.includes('work')) return Briefcase;
    return Phone;
}

const NA = 'غير محدد';

function Row({ label, children }: { label: string; children: React.ReactNode }) {
    return (
        <div className="flex items-start gap-2 text-sm">
            <span className="text-slate-400 shrink-0">{label}:</span>
            <span className="font-semibold text-slate-800">{children}</span>
        </div>
    );
}

export default function ClientSnapshot({ data }: { data: ClientSnapshotData }) {
    const name = [data.firstName, data.fatherName, data.lastName].filter(Boolean).join(' ')
        || data.fullName || '—';
    const classification = (data.classification ?? '').toUpperCase();
    const badgeCls = CLASSIFICATION_BADGE[classification];
    const addr = data.address ?? {};
    const hierarchy = (addr.geoPath?.length
        ? addr.geoPath.map((g) => g.name)
        : [addr.governorate, addr.district, addr.subArea, addr.neighborhood]
    ).filter(Boolean) as string[];
    const gps = addr.gps;
    const gpsHref = gps?.lat && gps?.lng ? `https://www.google.com/maps?q=${gps.lat},${gps.lng}` : null;

    const contacts = (data.contacts ?? []).filter((c) => c.number && c.number !== data.primaryMobile);
    // active first, then by label
    contacts.sort((a, b) => (a.status === 'inactive' ? 1 : 0) - (b.status === 'inactive' ? 1 : 0));

    const assignees = data.ownership?.assignees ?? [];
    const showCommitted = classification === 'OP' && data.committed;

    return (
        <div className="space-y-0">
            {/* أ) الهوية */}
            <div className="flex items-center gap-3 pb-4">
                <ClientAvatar
                    gender={data.gender ?? null}
                    dataQuality={(data.dataQuality as any) ?? null}
                    size="md"
                />
                <div className="min-w-0">
                    <div className="flex items-center gap-2 flex-wrap">
                        <h3 className="text-base font-bold text-slate-800">
                            {name}
                            {data.nickname && <span className="text-slate-400 font-medium"> ({data.nickname})</span>}
                        </h3>
                        {badgeCls && (
                            <span className={`text-xs font-bold px-2 py-0.5 rounded-full ${badgeCls}`}>{classification}</span>
                        )}
                    </div>
                    {data.sourceChannel && (
                        <span className="inline-flex items-center gap-1 text-xs text-slate-500 bg-slate-100 px-1.5 py-0.5 rounded mt-1">
                            <Globe className="w-2.5 h-2.5" /> {data.sourceChannel}
                        </span>
                    )}
                </div>
            </div>

            {/* ب) التواصل */}
            <div className="py-4 border-t border-slate-100 space-y-2">
                <a href={`tel:${data.primaryMobile}`} className="flex items-center gap-2 text-sm font-bold text-sky-600">
                    <Phone className="w-4 h-4 text-sky-500" /><span dir="ltr">{data.primaryMobile ?? '—'}</span>
                </a>
                {contacts.map((ct, i) => {
                    const Icon = contactIcon(ct.label);
                    const inactive = ct.status === 'inactive';
                    return (
                        <div key={ct.id ?? i} className={`flex items-center gap-2 text-sm ${inactive ? 'opacity-50' : ''}`}>
                            <Icon className="w-3.5 h-3.5 text-slate-400" />
                            {ct.label && <span className="text-slate-500 text-xs">{ct.label}:</span>}
                            <a href={`tel:${ct.number}`} className="font-semibold text-slate-700" dir="ltr">{ct.number}</a>
                            {ct.hasWhatsApp && <MessageCircle className="w-3.5 h-3.5 text-green-500" />}
                            {inactive && <span className="text-xs text-rose-400">(غير نشط)</span>}
                        </div>
                    );
                })}
            </div>

            {/* ج) العنوان */}
            <div className="py-4 border-t border-slate-100 space-y-2">
                <div className="flex items-start gap-2">
                    <MapPin className="w-4 h-4 text-rose-500 mt-0.5 shrink-0" />
                    {hierarchy.length > 0 ? (
                        <p className="text-sm font-semibold text-slate-700">{hierarchy.join(' ← ')}</p>
                    ) : (
                        <p className="text-sm text-slate-400">{NA}</p>
                    )}
                </div>
                {data.address?.detailedAddress && (
                    <p className="text-xs text-slate-500 pr-6">{data.address.detailedAddress}</p>
                )}
                {gpsHref && (
                    <a href={gpsHref} target="_blank" rel="noreferrer"
                        className="inline-flex items-center gap-1 text-xs font-bold text-sky-600 hover:underline pr-6">
                        <Navigation className="w-3.5 h-3.5" /> فتح على الخريطة
                    </a>
                )}
            </div>

            {/* د) المعلومات الشخصية */}
            <div className="py-4 border-t border-slate-100 grid grid-cols-1 md:grid-cols-2 gap-2">
                <Row label="المهنة"><span className="inline-flex items-center gap-1"><Briefcase className="w-3 h-3 text-slate-400" />{data.occupation || NA}</span></Row>
                <Row label="مهنة الزوج / الزوجة"><span className="inline-flex items-center gap-1"><Briefcase className="w-3 h-3 text-slate-400" />{data.spouseOccupation || NA}</span></Row>
                {showCommitted && (
                    <Row label="التقييم">
                        <span className={`inline-flex items-center gap-1 ${data.committed === 'ملتزم' ? 'text-emerald-600' : 'text-amber-600'}`}>
                            <Star className="w-3 h-3" />{data.committed}
                        </span>
                    </Row>
                )}
            </div>

            {/* ه) الوسطاء */}
            <div className="py-4 border-t border-slate-100">
                {(() => {
                    const names = (data.referrers ?? []).map((r) => r.name).filter(Boolean) as string[];
                    const count = data.referrersCount ?? names.length;
                    const countLabel = count === 0 ? 'لا يوجد وسطاء مسجّلين'
                        : count === 1 ? 'وسيط واحد' : `${count} وسطاء`;
                    return (
                        <Row label="الوسطاء">
                            <span className="inline-flex items-center gap-1 text-slate-600 font-normal">
                                <UserCog className="w-3.5 h-3.5 text-slate-400" />
                                {countLabel}
                                {names.length > 0 && <span className="text-slate-700 font-semibold">— {names.join('، ')}</span>}
                            </span>
                        </Row>
                    );
                })()}
            </div>

            {/* و) الملاحظات */}
            {data.notes && (
                <div className="py-4 border-t border-slate-100">
                    <p className="text-xs text-slate-400 flex items-center gap-1 mb-1"><FileText className="w-3 h-3" /> ملاحظات</p>
                    <p className="text-sm text-slate-700 bg-slate-50 rounded-lg px-3 py-2">{data.notes}</p>
                </div>
            )}

            {/* ز) المسؤول/ين */}
            <div className="py-4 border-t border-slate-100">
                {assignees.length > 0 ? (
                    <div className="space-y-1">
                        <p className="text-xs text-slate-400 flex items-center gap-1 mb-1"><Users className="w-3 h-3" /> المسؤول/ون</p>
                        {assignees.map((a, i) => (
                            <p key={i} className="text-sm font-semibold text-slate-700">
                                {a.userName}{a.roleDisplay && <span className="text-slate-400 font-normal"> — {a.roleDisplay}</span>}
                            </p>
                        ))}
                    </div>
                ) : (
                    <Row label="الملكية">
                        <span className="inline-flex items-center gap-1"><Building2 className="w-3.5 h-3.5 text-slate-400" />{data.ownership?.branchName || NA}</span>
                    </Row>
                )}
            </div>
        </div>
    );
}
