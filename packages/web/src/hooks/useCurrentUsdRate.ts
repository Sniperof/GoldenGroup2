import { useEffect, useState } from 'react';
import { api } from '../lib/api';

/** Central USD rate in effect today (SYP per 1 USD) — migr 493. null = none set. */
export function useCurrentUsdRate() {
  const [rate, setRate] = useState<number | null>(null);
  const [effectiveFrom, setEffectiveFrom] = useState<string | null>(null);
  const [loading, setLoading] = useState(true);

  useEffect(() => {
    let cancelled = false;
    api.exchangeRates.current()
      .then((r) => {
        if (cancelled) return;
        setRate(r.current?.rate ?? null);
        setEffectiveFrom(r.current?.effectiveFrom ?? null);
      })
      .catch(() => { if (!cancelled) setRate(null); })
      .finally(() => { if (!cancelled) setLoading(false); });
    return () => { cancelled = true; };
  }, []);

  return { rate, effectiveFrom, loading };
}
