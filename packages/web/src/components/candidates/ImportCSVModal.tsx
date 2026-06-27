import { AlertCircle } from 'lucide-react';
import Button from '../ui/Button';
import Modal from '../ui/Modal';

interface ImportCSVModalProps {
    isOpen: boolean;
    onClose: () => void;
}

export default function ImportCSVModal({ isOpen, onClose }: ImportCSVModalProps) {
    // Component disabled temporarily for build stability
    return (
        <Modal isOpen={isOpen} onClose={onClose} size="lg" hideCloseButton>
            <div className="p-6 text-center">
                <AlertCircle className="w-12 h-12 text-amber-500 mx-auto mb-4" />
                <h3 className="text-base font-bold text-slate-800 mb-2">ميزة قيد الصيانة</h3>
                <p className="text-slate-500 mb-6">نعمل على تحسين استيراد الملفات، ستعود قريباً!</p>
                <Button variant="secondary" onClick={onClose}>إغلاق</Button>
            </div>
        </Modal>
    );
}
