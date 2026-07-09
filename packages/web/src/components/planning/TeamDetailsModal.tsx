import { PhoneCall, User, Briefcase, MapPin } from '../ui/icons';
import { Candidate, Client, GeoUnit } from '../../lib/types';
import Button from '../ui/Button';
import Modal from '../ui/Modal';
import DataTable from '../ui/DataTable';

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

                                <DataTable card>
                                    <DataTable.Head>
                                        <DataTable.Row>
                                            <DataTable.Th>الاسم</DataTable.Th>
                                            <DataTable.Th>النوع</DataTable.Th>
                                            <DataTable.Th>رقم الهاتف</DataTable.Th>
                                            <DataTable.Th>العنوان</DataTable.Th>
                                        </DataTable.Row>
                                    </DataTable.Head>
                                    <DataTable.Body>
                                        {candidates.map((candidate) => (
                                            <DataTable.Row key={`cand-${candidate.id}`} className="hover:bg-slate-50/50 transition-colors">
                                                <DataTable.Td className="text-slate-800 font-medium">
                                                    <div className="flex items-center gap-2">
                                                        <User className="w-4 h-4 text-blue-400" />
                                                        {`${candidate.firstName || ''} ${candidate.lastName || ''}`.trim() || candidate.nickname || 'بدون اسم'}
                                                    </div>
                                                </DataTable.Td>
                                                <DataTable.Td><span className="px-2 py-1 rounded bg-blue-50 text-blue-700 text-xs font-bold">اسم مقترح</span></DataTable.Td>
                                                <DataTable.Td className="text-slate-600" dir="ltr">{candidate.mobile || (candidate.contacts && candidate.contacts.length > 0 ? candidate.contacts[0].number : '')}</DataTable.Td>
                                                <DataTable.Td className="text-slate-500">{candidate.addressText || getGeoName(candidate.geoUnitId)}</DataTable.Td>
                                            </DataTable.Row>
                                        ))}
                                        {leads.map((lead) => (
                                            <DataTable.Row key={`lead-${lead.id}`} className="hover:bg-slate-50/50 transition-colors">
                                                <DataTable.Td className="text-slate-800 font-medium">
                                                    <div className="flex items-center gap-2">
                                                        <Briefcase className="w-4 h-4 text-amber-500" />
                                                        {lead.name}
                                                    </div>
                                                </DataTable.Td>
                                                <DataTable.Td><span className="px-2 py-1 rounded bg-amber-50 text-amber-700 text-xs font-bold">زبون محتمل</span></DataTable.Td>
                                                <DataTable.Td className="text-slate-600" dir="ltr">{lead.contacts?.find((contact) => contact.isPrimary)?.number || lead.contacts?.[0]?.number || '--'}</DataTable.Td>
                                                <DataTable.Td className="text-slate-500">{getGeoName(parseInt(lead.neighborhood)) || lead.neighborhood}</DataTable.Td>
                                            </DataTable.Row>
                                        ))}
                                    </DataTable.Body>
                                </DataTable>
                            </div>
                        )}
                    </div>
        </Modal>
    );
}
