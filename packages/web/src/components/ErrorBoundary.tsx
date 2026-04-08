import React, { Component, ErrorInfo, ReactNode } from 'react';
import { AlertOctagon, RefreshCw, Trash2 } from 'lucide-react';

interface Props {
    children: ReactNode;
}

interface State {
    hasError: boolean;
    error: Error | null;
}

export class ErrorBoundary extends Component<Props, State> {
    public state: State = {
        hasError: false,
        error: null
    };

    public static getDerivedStateFromError(error: Error): State {
        return { hasError: true, error };
    }

    public componentDidCatch(error: Error, errorInfo: ErrorInfo) {
        console.error('Uncaught error:', error, errorInfo);
    }

    private handleReset = () => {
        if (confirm('هل أنت متأكد من إعادة التحميل؟')) {
            window.location.href = '/';
        }
    };

    public render() {
        if (this.state.hasError) {
            return (
                <div className="h-screen w-screen flex flex-col items-center justify-center bg-slate-50 p-4 font-sans" dir="rtl">
                    <div className="bg-white p-8 rounded-2xl shadow-xl max-w-md w-full text-center border border-slate-200">
                        <div className="w-16 h-16 bg-red-100 rounded-full flex items-center justify-center mx-auto mb-4">
                            <AlertOctagon className="w-8 h-8 text-red-600" />
                        </div>
                        <h1 className="text-xl font-bold text-slate-800 mb-2">عذراً، حدث خطأ غير متوقع</h1>
                        <p className="text-slate-500 text-sm mb-6 leading-relaxed">
                            تعطل النظام بسبب مشكلة في البيانات أو خطأ برمجي. يمكنك محاولة تحديث الصفحة أو "إعادة ضبط البيانات" لحل المشكلة جذرياً.
                        </p>

                        <div className="p-3 bg-slate-50 rounded-lg text-left text-xs font-mono text-slate-500 mb-6 overflow-auto max-h-32 border border-slate-200">
                            {this.state.error?.message}
                        </div>

                        <div className="flex flex-col gap-3">
                            <button
                                onClick={() => window.location.reload()}
                                className="w-full flex items-center justify-center gap-2 py-3 bg-sky-600 hover:bg-sky-700 text-white rounded-xl font-bold transition-all"
                            >
                                <RefreshCw className="w-4 h-4" />
                                تحديث الصفحة
                            </button>
                            <button
                                onClick={this.handleReset}
                                className="w-full flex items-center justify-center gap-2 py-3 bg-white border border-red-200 text-red-600 hover:bg-red-50 rounded-xl font-bold transition-all"
                            >
                                <Trash2 className="w-4 h-4" />
                                إعادة ضبط البيانات (حذف الكل)
                            </button>
                        </div>
                    </div>
                </div>
            );
        }

        return this.props.children;
    }
}
