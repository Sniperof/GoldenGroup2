import { PhoneCall, User, Briefcase, MapPin } from 'lucide-react';
import { Candidate, Client, GeoUnit } from '../../lib/types';
import Button from '../ui/Button';
import Modal from '../ui/Modal';

interface TeamDetailsModalProps {
    isOpen: boolean;
    onClose: () => void;
    teamKey: string;
    teamLabel: string;
    candidates: Candidate[];
    leads: Client[];
    geoUnits: GeoUnit[];
    onGenerate: (teamKey: string, candList: Candidate[], leadList: Client[]) => void;
}

export default function TeamDetailsModal({
    isOpen,
    onClose,
    teamKey,
    teamLabel,
    candidates,
    leads,
    geoUnits,
    onGenerate,
}: TeamDetailsModalProps) {
    const totalCustomers = candidates.length + leads.length;

    const getGeoName = (id: number | null) => {
        const unit = geoUnits.find((geoUnit) => geoUnit.id === id);
        return unit ? unit.name : 'غير محدد';
    };

    const handleGenerateClick = () => {
        onGenerate(teamKey, candidates, leads);
        onClose();
    };

    return (
        <Modal
            isOpen={isOpen}
            onClose={onClose}
            size="4xl"
            title={teamLabel}
            subtitle={
                <span className="flex items-center gap-2">
                    <Briefcase className="w-4 h-4 text-emerald-500" />
                    إجمالي الزبائن المستهدفين: {totalCustomers}
                </span>
            }
            footer={<Button variant="secondary" onClick={onClose}>إغلاق</Button>}
        >
                    <div className="p-6 bg-slate-50/30">
                        {totalCustomers === 0 ? (
                            <div className="text-center py-12">
                                <MapPin className="w-12 h-12 text-slate-300 mx-auto mb-4" />
                                <h3 className="text-base font-bold text-slate-800">لا يوجد زبائن في مسار هذا الفريق</h3>
                                <p className="text-slate-500 mt-2">يرجى التأكد من تعيين مسار صحيح أو إضافة زبائن للمناطق المستهدفة.</p>
                            </div>
                        ) : (
                            <div className="space-y-4">
                                <div className="flex justify-between items-center">
                                    <h3 className="text-base font-bold text-slate-800">قائمة الزبائن المستهدفين</h3>
                                    <Button onClick={handleGenerateClick} icon={PhoneCall}>
                                        توليد/تحديث قائمة الاتصال
                                    </Button>
                                </div>

                                <div className="bg-white border text-sm border-slate-200 rounded-xl overflow-hidden shadow-sm">
                                    <table className="w-full text-right">
                                        <thead className="bg-slate-50 border-b border-slate-200">
                                            <tr>
                                                <th className="px-4 py-3 font-semibold text-slate-600">الاسم</th>
                                                <th className="px-4 py-3 font-semibold text-slate-600">النوع</th>
                                                <th className="px-4 py-3 font-semibold text-slate-600">رقم الهاتف</th>
                                                <th className="px-4 py-3 font-semibold text-slate-600">العنوان</th>
                                            </tr>
                                        </thead>
                                        <tbody className="divide-y divide-slate-100">
                                            {candidates.map((candidate) => (
                                                <tr key={`cand-${candidate.id}`} className="hover:bg-slate-50/50 transition-colors">
                                                    <td className="px-4 py-3 text-slate-800 font-medium">
                                                        <div className="flex items-center gap-2">
                                                            <User className="w-4 h-4 text-blue-400" />
                                                            {`${candidate.firstName || ''} ${candidate.lastName || ''}`.trim() || candidate.nickname || 'بدون اسم'}
                                                        </div>
                                                    </td>
                                                    <td className="px-4 py-3"><span className="px-2 py-1 rounded bg-blue-50 text-blue-700 text-xs font-bold">اسم مقترح</span></td>
                                                    <td className="px-4 py-3 text-slate-600" dir="ltr">{candidate.mobile || (candidate.contacts && candidate.contacts.length > 0 ? candidate.contacts[0].number : '')}</td>
                                                    <td className="px-4 py-3 text-slate-500">{candidate.addressText || getGeoName(candidate.geoUnitId)}</td>
                                                </tr>
                                            ))}
                                            {leads.map((lead) => (
                                                <tr key={`lead-${lead.id}`} className="hover:bg-slate-50/50 transition-colors">
                                                    <td className="px-4 py-3 text-slate-800 font-medium">
                                                        <div className="flex items-center gap-2">
                                                            <Briefcase className="w-4 h-4 text-amber-500" />
                                                            {lead.name}
                                                        </div>
                                                    </td>
                                                    <td className="px-4 py-3"><span className="px-2 py-1 rounded bg-amber-50 text-amber-700 text-xs font-bold">زبون محتمل</span></td>
                                                    <td className="px-4 py-3 text-slate-600" dir="ltr">{lead.contacts?.find((contact) => contact.isPrimary)?.number || lead.contacts?.[0]?.number || '--'}</td>
                                                    <td className="px-4 py-3 text-slate-500">{getGeoName(parseInt(lead.neighborhood)) || lead.neighborhood}</td>
                                                </tr>
                                            ))}
                                        </tbody>
                                    </table>
                                </div>
                            </div>
                        )}
                    </div>
        </Modal>
    );
}
