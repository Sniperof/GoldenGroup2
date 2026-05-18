import { useState, useEffect } from 'react';
import { api } from '../lib/api';

/**
 * Fetches active items for a system_lists category and returns their values.
 * Results are sorted by display_order (API already does this).
 */
export function useSystemList(category: string): { items: string[]; loading: boolean } {
    const [items, setItems] = useState<string[]>([]);
    const [loading, setLoading] = useState(true);

    useEffect(() => {
        let cancelled = false;
        setLoading(true);
        api.systemLists
            .list({ category, activeOnly: true })
            .then((data: any[]) => {
                if (!cancelled) setItems(data.map(d => d.value));
            })
            .catch(() => {
                if (!cancelled) setItems([]);
            })
            .finally(() => {
                if (!cancelled) setLoading(false);
            });
        return () => { cancelled = true; };
    }, [category]);

    return { items, loading };
}
