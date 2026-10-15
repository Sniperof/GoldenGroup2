import { useCallback, useState } from 'react';
import { api } from '../lib/api';

type PrintableDocument = 'original' | 'amendment';

export function useContractPrintable(contractId: number | null | undefined) {
  const [loadingDocument, setLoadingDocument] = useState<PrintableDocument | null>(null);

  const openDocument = useCallback(async (document: PrintableDocument) => {
    if (!contractId || loadingDocument) return;

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

    setLoadingDocument(document);
    let url: string | null = null;
    try {
      const html = await api.contracts.getPrintableHtml(contractId, document);
      const blob = new Blob([html], { type: 'text/html;charset=utf-8' });
      url = URL.createObjectURL(blob);
      previewWindow.location.replace(url);
      setTimeout(() => url && URL.revokeObjectURL(url), 30_000);
    } catch (err: any) {
      if (url) URL.revokeObjectURL(url);
      previewWindow.close();
      alert(err?.message ?? 'تعذر تحميل النسخة القانونية');
    } finally {
      setLoadingDocument(null);
    }
  }, [contractId, loadingDocument]);

  // Wrapped so they're safe as onClick handlers (the click event is ignored).
  const openPrintable = useCallback(() => openDocument('original'), [openDocument]);
  const openAmendment = useCallback(() => openDocument('amendment'), [openDocument]);

  return {
    openPrintable,
    openAmendment,
    printLoading: loadingDocument === 'original',
    amendmentLoading: loadingDocument === 'amendment',
  };
}
