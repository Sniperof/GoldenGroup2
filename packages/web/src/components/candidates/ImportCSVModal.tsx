import React, { useState, useMemo } from 'react';
import { useCandidateStore } from '../../hooks/useCandidateStore';
import { Upload, X, AlertCircle, FileText } from 'lucide-react';
// import Papa from 'papaparse'; // Temporarily disabled due to build issues
import { api } from '../../lib/api';

interface ImportCSVModalProps {
    isOpen: boolean;
    onClose: () => void;
}

export default function ImportCSVModal({ isOpen, onClose }: ImportCSVModalProps) {
    // Component disabled temporarily for build stability
    if (!isOpen) return null;

    return (
        <div className="fixed inset-0 z-[70] flex items-center justify-center p-4 bg-slate-900/50 backdrop-blur-sm" dir="rtl">
            <div className="bg-white rounded-2xl w-full max-w-lg shadow-2xl p-6 text-center">
                <AlertCircle className="w-12 h-12 text-amber-500 mx-auto mb-4" />
                <h3 className="text-lg font-bold text-slate-800 mb-2">ميزة قيد الصيانة</h3>
                <p className="text-slate-500 mb-6">نعمل على تحسين استيراد الملفات، ستعود قريباً!</p>
                <button onClick={onClose} className="px-6 py-2 bg-slate-100 rounded-xl font-bold">إغلاق</button>
            </div>
        </div>
    );
}
