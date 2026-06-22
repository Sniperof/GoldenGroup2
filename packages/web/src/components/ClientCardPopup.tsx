import { useEffect, useMemo, useState } from 'react';
import { motion, AnimatePresence } from 'framer-motion';
import { X, MapPin, Phone, Smartphone, UserRound } from 'lucide-react';
import IconButton from './ui/IconButton';
import { api } from '../lib/api';
import type { Client, ClientRating, ContactEntry, GeoUnit } from '../lib/types';

interface Props {
    clientId: number;
    onClose: () => void;
}

const RATING_CONFIG: Record<ClientRating, { label: string; color: string }> = {
    Committed: { label: 'ملتزم', color: 'bg-emerald-50 text-emerald-700 border-emerald-200' },
    NotCommitted: { label: 'غير ملتزم', color: 'bg-rose-50 text-rose-700 border-rose-200' },
    Undefined: { label: 'غير محدد', color: 'bg-slate-100 text-slate-600 border-slate-200' },
};

const CONTACT_STATUS_LABELS: Record<string, string> = {
    active: 'يعمل',
    preferred: 'مفضل',
    'out-of-coverage': 'خارج تغطية',
    unused: 'غير مستخدم',
    invalid: 'قيمة خاطئة',
};

const CONTACT_STATUS_COLORS: Record<string, string> = {
    active: 'bg-emerald-50 text-emerald-700 border-emerald-200',
    preferred: 'bg-sky-50 text-sky-700 border-sky-200',
    'out-of-coverage': 'bg-amber-50 text-amber-700 border-amber-200',
    unused: 'bg-slate-100 text-slate-500 border-slate-200',
    invalid: 'bg-rose-50 text-rose-700 border-rose-200',
};

function getContacts(client: Client | null): ContactEntry[] {
    if (!client) return [];
    if (Array.isArray(client.contacts) && client.contacts.length > 0) return client.contacts;
    return client.mobile
        ? [{
            id: 'primary-mobile',
            type: 'mobile',
            number: client.mobile,
            label: 'الرئيسي',
            hasWhatsApp: false,
            isPrimary: true,
            status: 'active',
        }]
        : [];
}

function buildGeoHierarchy(
    client: Client | null,
    geoMap: Map<number, { name: string; level: number; parentId: number | null }>,
): { governorate?: string; district?: string; subArea?: string; neighborhood?: string } {
    if (!client) return {};

    const neighborhoodId = parseInt(client.neighborhood, 10);
    if (Number.isNaN(neighborhoodId)) {
        return {
            governorate: client.governorate || undefined,
            district: client.district || undefined,
            neighborhood: client.neighborhood || undefined,
        };
    }

    const result: { governorate?: string; district?: string; subArea?: string; neighborhood?: string } = {};
    let currentId: number | null = neighborhoodId;
    const visited = new Set<number>();

    while (currentId !== null && !visited.has(currentId)) {
        visited.add(currentId);
        const unit = geoMap.get(currentId);
        if (!unit) break;

        if (unit.level === 4) result.neighborhood = unit.name;
        else if (unit.level === 3) result.subArea = unit.name;
        else if (unit.level === 2) result.district = unit.name;
        else if (unit.level === 1) result.governorate = unit.name;

        currentId = unit.parentId;
    }

    return result;
}

export default function ClientCardPopup({ clientId, onClose }: Props) {
    const [client, setClient] = useState<Client | null>(null);
    const [geoUnits, setGeoUnits] = useState<GeoUnit[]>([]);
    const [loading, setLoading] = useState(true);
    const [error, setError] = useState<string | null>(null);

    useEffect(() => {
        let cancelled = false;

        setLoading(true);
        setError(null);

        Promise.all([
            api.clients.get(clientId),
            api.geoUnits.list(),
        ])
            .then(([clientData, geoUnitsData]) => {
                if (cancelled) return;
                setClient(clientData);
                setGeoUnits(Array.isArray(geoUnitsData) ? geoUnitsData as GeoUnit[] : []);
                setLoading(false);
            })
            .catch((err: unknown) => {
                console.error('Failed to load client card popup:', err);
                if (cancelled) return;
                setError('تعذر تحميل بيانات الزبون');
                setGeoUnits([]);
                setLoading(false);
            });

        return () => {
            cancelled = true;
        };
    }, [clientId]);

    const contacts = useMemo(() => getContacts(client), [client]);
    const geoMap = useMemo(() => {
        const map = new Map<number, { name: string; level: number; parentId: number | null }>();
        geoUnits.forEach((gu) => {
            const id = typeof gu.id === 'string' ? parseInt(gu.id, 10) : gu.id;
            const rawParentId = 'parentId' in gu ? gu.parentId : (gu as GeoUnit & { parent_id?: number | null }).parent_id;
            const parentId = typeof rawParentId === 'string' ? parseInt(rawParentId, 10) : rawParentId;

            if (!Number.isNaN(id)) {
                map.set(id, {
                    name: gu.name,
                    level: gu.level,
                    parentId: Number.isNaN(parentId) ? null : (parentId ?? null),
                });
            }
        });
        return map;
    }, [geoUnits]);
    const hierarchy = useMemo(() => buildGeoHierarchy(client, geoMap), [client, geoMap]);
    const rating = client?.rating || 'Undefined';

    return (
        <AnimatePresence>
            <div className="fixed inset-0 z-[100] flex items-center justify-center bg-black/40 p-4 backdrop-blur-sm" onClick={onClose}>
                <motion.div
                    initial={{ opacity: 0, scale: 0.96, y: 12 }}
                    animate={{ opacity: 1, scale: 1, y: 0 }}
                    exit={{ opacity: 0, scale: 0.96, y: 12 }}
                    className="w-full max-w-md overflow-hidden rounded-2xl bg-white shadow-2xl"
                    onClick={(e) => e.stopPropagation()}
                    dir="rtl"
                >
                    <div className="flex items-start justify-between border-b border-slate-100 bg-slate-50 px-5 py-4">
                        <div>
                            <h3 className="text-base font-bold text-slate-800">بطاقة الزبون</h3>
                            {client && <p className="mt-1 text-sm text-slate-500">#{client.id}</p>}
                        </div>
                        <IconButton icon={X} label="إغلاق" onClick={onClose} />
                    </div>

                    <div className="space-y-4 px-5 py-4">
                        {loading && <p className="text-sm text-slate-500">جارٍ تحميل بيانات الزبون...</p>}
                        {error && <p className="text-sm text-rose-600">{error}</p>}

                        {!loading && !error && client && (
                            <>
                                <div className="rounded-xl border border-slate-200 p-4">
                                    <div className="flex items-center gap-2">
                                        <UserRound className="h-4 w-4 text-slate-400" />
                                        <span className="text-xs font-bold text-slate-500">الاسم</span>
                                    </div>
                                    <p className="mt-2 text-base font-bold text-slate-800">{client.name}</p>
                                </div>

                                <div className="rounded-xl border border-slate-200 p-4">
                                    <span className="text-xs font-bold text-slate-500">الحالة</span>
                                    <div className="mt-2">
                                        <span className={`inline-flex rounded-full border px-3 py-1 text-xs font-bold ${RATING_CONFIG[rating].color}`}>
                                            {RATING_CONFIG[rating].label}
                                        </span>
                                    </div>
                                </div>

                                <div className="rounded-xl border border-slate-200 p-4">
                                    <div className="flex items-center gap-2">
                                        <Phone className="h-4 w-4 text-slate-400" />
                                        <span className="text-xs font-bold text-slate-500">أرقام الهواتف</span>
                                    </div>
                                    <div className="mt-3 space-y-2">
                                        {contacts.length > 0 ? contacts.map((contact) => (
                                            <div key={contact.id} className="rounded-lg bg-slate-50 px-3 py-2 space-y-1.5">
                                                <div className="flex items-center justify-between gap-2">
                                                    <div className="flex items-center gap-1.5 min-w-0">
                                                        <span className="text-sm font-medium text-slate-800" dir="ltr">{contact.number}</span>
                                                        {contact.isPrimary && (
                                                            <span className="text-xs font-bold px-1.5 py-0.5 rounded bg-amber-50 text-amber-700 border border-amber-200">رئيسي</span>
                                                        )}
                                                    </div>
                                                    <div className="flex items-center gap-1 shrink-0">
                                                        {contact.hasWhatsApp && (
                                                            <span className="text-xs font-bold px-1.5 py-0.5 rounded bg-emerald-50 text-emerald-700 border border-emerald-200">واتساب</span>
                                                        )}
                                                        <span className={`text-xs font-bold px-1.5 py-0.5 rounded border ${CONTACT_STATUS_COLORS[contact.status] || 'bg-slate-100 text-slate-600 border-slate-200'}`}>
                                                            {CONTACT_STATUS_LABELS[contact.status] || contact.status}
                                                        </span>
                                                    </div>
                                                </div>
                                                <div className="flex items-center gap-2 text-xs text-slate-500">
                                                    {contact.type === 'mobile' ? <Smartphone className="h-3.5 w-3.5" /> : <Phone className="h-3.5 w-3.5" />}
                                                    <span>{contact.label || contact.type}</span>
                                                </div>
                                            </div>
                                        )) : <p className="text-sm text-slate-500">لا توجد أرقام محفوظة</p>}
                                    </div>
                                </div>

                                <div className="rounded-xl border border-slate-200 p-4 space-y-3">
                                    <div className="flex items-center gap-2">
                                        <MapPin className="h-4 w-4 text-slate-400" />
                                        <span className="text-xs font-bold text-slate-500">العنوان الجغرافي</span>
                                    </div>

                                    {hierarchy.governorate && (
                                        <div className="flex items-center justify-between">
                                            <span className="text-xs text-slate-500">المحافظة</span>
                                            <span className="text-sm font-medium text-slate-800">{hierarchy.governorate}</span>
                                        </div>
                                    )}
                                    {hierarchy.district && (
                                        <div className="flex items-center justify-between">
                                            <span className="text-xs text-slate-500">المنطقة</span>
                                            <span className="text-sm font-medium text-slate-800">{hierarchy.district}</span>
                                        </div>
                                    )}
                                    {hierarchy.subArea && (
                                        <div className="flex items-center justify-between">
                                            <span className="text-xs text-slate-500">الناحية</span>
                                            <span className="text-sm font-medium text-slate-800">{hierarchy.subArea}</span>
                                        </div>
                                    )}
                                    {hierarchy.neighborhood && (
                                        <div className="flex items-center justify-between">
                                            <span className="text-xs text-slate-500">الحي</span>
                                            <span className="text-sm font-medium text-slate-800">{hierarchy.neighborhood}</span>
                                        </div>
                                    )}

                                    {!hierarchy.governorate && !hierarchy.district && !hierarchy.subArea && !hierarchy.neighborhood && (
                                        <p className="text-sm text-slate-500">غير محدد</p>
                                    )}
                                </div>

                                <div className="rounded-xl border border-slate-200 p-4">
                                    <p className="text-xs font-bold text-slate-500">العنوان التفصيلي</p>
                                    <p className="mt-2 text-sm text-slate-800">{client.detailedAddress || 'غير محدد'}</p>
                                </div>

                                {client.gpsCoordinates ? (
                                    <div className="rounded-xl border border-slate-200 p-4">
                                        <p className="text-xs font-bold text-slate-500">الموقع على الخريطة</p>
                                        <div className="mt-2 overflow-hidden rounded-lg border border-slate-200">
                                            <iframe
                                                width="100%"
                                                height="200"
                                                frameBorder="0"
                                                scrolling="no"
                                                marginHeight={0}
                                                marginWidth={0}
                                                src={`https://www.openstreetmap.org/export/embed.html?bbox=${client.gpsCoordinates.lng - 0.01}%2C${client.gpsCoordinates.lat - 0.01}%2C${client.gpsCoordinates.lng + 0.01}%2C${client.gpsCoordinates.lat + 0.01}&layer=mapnik&marker=${client.gpsCoordinates.lat}%2C${client.gpsCoordinates.lng}`}
                                                style={{ border: 0 }}
                                                title="خريطة موقع الزبون"
                                            />
                                        </div>
                                        <a
                                            href={`https://www.openstreetmap.org/?mlat=${client.gpsCoordinates.lat}&mlon=${client.gpsCoordinates.lng}#map=16/${client.gpsCoordinates.lat}/${client.gpsCoordinates.lng}`}
                                            target="_blank"
                                            rel="noopener noreferrer"
                                            className="mt-2 inline-block text-xs text-sky-600 hover:underline"
                                        >
                                            فتح بخريطة أكبر ↗
                                        </a>
                                    </div>
                                ) : (
                                    <div className="rounded-xl border border-slate-200 p-4">
                                        <p className="text-xs font-bold text-slate-500">الموقع على الخريطة</p>
                                        <p className="mt-2 text-sm text-slate-500">لا يوجد موقع محدد</p>
                                    </div>
                                )}
                            </>
                        )}
                    </div>
                </motion.div>
            </div>
        </AnimatePresence>
    );
}
