import { useState, useEffect } from 'react';
import { api } from '../lib/api';

export type SystemListItem = { id: number; value: string; displayOrder: number };

/** Like useSystemList but returns full objects with id + value for use in selects. */
export function useSystemListItems(category: string): { items: SystemListItem[]; loading: boolean } {
  const [items, setItems]   = useState<SystemListItem[]>([]);
  const [loading, setLoading] = useState(true);

  useEffect(() => {
    let cancelled = false;
    setLoading(true);
    api.systemLists
      .list({ category, activeOnly: true })
      .then((data: any[]) => {
        if (!cancelled) setItems(data.map(d => ({ id: Number(d.id), value: String(d.value), displayOrder: Number(d.displayOrder ?? 0) })));
      })
      .catch(() => { if (!cancelled) setItems([]); })
      .finally(() => { if (!cancelled) setLoading(false); });
    return () => { cancelled = true; };
  }, [category]);

  return { items, loading };
}
