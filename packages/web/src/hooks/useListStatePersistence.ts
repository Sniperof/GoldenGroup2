import { useEffect, useRef, useState, type DependencyList, type Dispatch, type EffectCallback, type SetStateAction } from 'react';

// Records-page state (page, sort, search, filters, scroll) kept for the browser
// TAB session, so opening a record and coming back lands on the same page of
// the same filtered list instead of page 1. sessionStorage is per-tab and is
// cleared when the tab closes; every access is guarded because storage can be
// unavailable (private mode, blocked site data) — the page then simply behaves
// as before.

const PREFIX = 'gg:list:';

function readSession<T>(key: string, fallback: T): T {
    try {
        const raw = window.sessionStorage.getItem(PREFIX + key);
        return raw == null ? fallback : (JSON.parse(raw) as T);
    } catch {
        return fallback;
    }
}

function writeSession(key: string, value: unknown): void {
    try {
        window.sessionStorage.setItem(PREFIX + key, JSON.stringify(value));
    } catch {
        /* storage unavailable — state just isn't remembered */
    }
}

/**
 * useState whose value survives leaving and re-entering the page (same tab).
 * A null key turns persistence off (plain useState), for shared hooks whose
 * callers opt in.
 */
export function useSessionState<T>(key: string | null, initial: T): [T, Dispatch<SetStateAction<T>>] {
    const [value, setValue] = useState<T>(() => (key == null ? initial : readSession(key, initial)));
    useEffect(() => { if (key != null) writeSession(key, value); }, [key, value]);
    return [value, setValue];
}

/**
 * useEffect that runs only when a dependency actually CHANGED — never for the
 * initial values. Records pages reset to page 1 whenever a filter changes; on
 * mount those resets would wipe the restored page. Compares against the
 * previous deps instead of a "first run" flag, because StrictMode (dev) runs
 * mount effects twice and a flag would let the second run through.
 */
export function useDidUpdateEffect(effect: EffectCallback, deps: DependencyList): void {
    const prevDeps = useRef<DependencyList | null>(null);
    useEffect(() => {
        const prev = prevDeps.current;
        prevDeps.current = deps;
        if (prev === null) return;
        if (prev.length === deps.length && prev.every((v, i) => Object.is(v, deps[i]))) return;
        return effect();
        // eslint-disable-next-line react-hooks/exhaustive-deps
    }, deps);
}

/**
 * Remembers the main content scroll position for a records page and restores
 * it once, after the first data load (`ready`), so the user returns to the row
 * they opened. The scroll container is MainLayout's <main>.
 */
export function useScrollRestoration(key: string, ready: boolean): void {
    const restored = useRef(false);
    // Saved while scrolling (throttled), not on unmount: by the time an unmount
    // cleanup runs the next page already replaced <main>'s content. A timer, not
    // requestAnimationFrame, so saving never depends on the tab being painted.
    useEffect(() => {
        const main = document.querySelector('main');
        if (!main) return;
        let timer: ReturnType<typeof setTimeout> | null = null;
        const onScroll = () => {
            // Ignore scrolls before the restore ran (route swap / clamping would
            // overwrite the saved position with 0).
            if (timer || !restored.current) return;
            timer = setTimeout(() => { timer = null; writeSession(key + ':scroll', main.scrollTop); }, 100);
        };
        main.addEventListener('scroll', onScroll, { passive: true });
        return () => {
            main.removeEventListener('scroll', onScroll);
            if (timer) clearTimeout(timer);
        };
    }, [key]);
    useEffect(() => {
        if (!ready || restored.current) return;
        restored.current = true;
        const top = readSession<number>(key + ':scroll', 0);
        // After this commit's layout (rows rendered with `ready`).
        if (top > 0) setTimeout(() => document.querySelector('main')?.scrollTo({ top }), 0);
    }, [key, ready]);
}
