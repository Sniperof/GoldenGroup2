import { useCallback, useState } from 'react';
import { api } from '../lib/api';

export function useContractPrintable(contractId: number | null | undefined) {
  const [printLoading, setPrintLoading] = useState(false);

  const openPrintable = useCallback(async () => {
    if (!contractId || printLoading) return;

    const previewWindow = window.open('', '_blank');
    if (!previewWindow) {
      alert('تعذر فتح نافذة جديدة. تأكد من السماح بالنوافذ المنبثقة.');
      return;
    }

    try {
      previewWindow.opener = null;
    } catch {
      // Some browsers expose opener as read-only; the preview still remains usable.
    }

    setPrintLoading(true);
    let url: string | null = null;
    try {
      const html = await api.contracts.getPrintableHtml(contractId);
      const blob = new Blob([html], { type: 'text/html;charset=utf-8' });
      url = URL.createObjectURL(blob);
      previewWindow.location.replace(url);
      setTimeout(() => url && URL.revokeObjectURL(url), 30_000);
    } catch (err: any) {
      if (url) URL.revokeObjectURL(url);
      previewWindow.close();
      alert(err?.message ?? 'تعذر تحميل النسخة القانونية');
    } finally {
      setPrintLoading(false);
    }
  }, [contractId, printLoading]);

  return { openPrintable, printLoading };
}
