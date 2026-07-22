import { useState, useMemo, useRef, useCallback, useEffect } from 'react';
import { MapPin, Search, ChevronLeft, X, CheckCircle2 } from './ui/icons';
import type { GeoUnit } from '../lib/types';
const levelNames: Record<number, string> = {
    1: 'المحافظة',
    2: 'المنطقة',
    3: 'الناحية',
    4: 'الحي',
};

/* ------------------------------------------------------------------ */
/*  Types                                                               */
/* ------------------------------------------------------------------ */

export interface GeoSelection {
    govId: string;
    regionId: string;
    subId: string;
    neighborhoodId: string;
}

interface GeoSmartSearchProps {
    geoUnits: GeoUnit[];
    value: GeoSelection;
    onChange: (selection: GeoSelection) => void;
    label?: string;
    required?: boolean;
    placeholder?: string;
    disabled?: boolean;
    minSelectableLevel?: number;
    invalid?: boolean;
}

export function getLevelName(geoUnits: GeoUnit[], idStr: string | undefined): string | null {
    if (!idStr) return null;
    const unit = geoUnits.find(u => u.id.toString() === idStr);
    return unit ? unit.name : null;
}

interface GeoSuggestion {
    /** The leaf unit the user can pick */
    unit: GeoUnit;
    /** Full breadcrumb path from gov → leaf */
    path: GeoUnit[];
    /** Search-match score (lower = better) */
    score: number;
}

/* ------------------------------------------------------------------ */
/*  Helpers                                                             */
/* ------------------------------------------------------------------ */

/** Walk up from a unit to root, returns [gov, region, sub, neighborhood] */
export function buildPath(unit: GeoUnit, unitsMap: Map<number, GeoUnit>): GeoUnit[] {
    const path: GeoUnit[] = [unit];
    let current = unit;
    while (current.parentId !== null) {
        const parent = unitsMap.get(current.parentId);
        if (!parent) break;
        path.unshift(parent);
        current = parent;
    }
    return path;
}

/** Fill GeoSelection from a path array */
export function pathToSelection(path: GeoUnit[]): GeoSelection {
    return {
        govId: path[0]?.id?.toString() || '',
        regionId: path[1]?.id?.toString() || '',
        subId: path[2]?.id?.toString() || '',
        neighborhoodId: path[3]?.id?.toString() || '',
    };
}

/** Format a path for display */
function formatPath(path: GeoUnit[]): string {
    return path.map(u => u.name).join(' > ');
}

/** Format short display: [Badge: Gov] Sub, Neighborhood */
function formatShort(path: GeoUnit[]): { gov: string; detail: string } {
    const gov = path[0]?.name || '';
    const parts: string[] = [];
    if (path[2]) parts.push(path[2].name);
    if (path[3]) parts.push(path[3].name);
    return { gov, detail: parts.join('، ') || path[1]?.name || '' };
}

export function formatGeoUnitLastLevels(geoUnits: GeoUnit[], geoUnitId?: number | string | null): string {
    if (geoUnitId == null || geoUnitId === '') return '';
    const unitsMap = new Map<number, GeoUnit>();
    geoUnits.forEach(u => unitsMap.set(u.id, u));
    const unit = unitsMap.get(Number(geoUnitId));
    if (!unit) return '';
    const path = buildPath(unit, unitsMap);
    const displayParts = path.length <= 2 ? path : path.slice(-2);
    return displayParts.map(item => item.name).filter(Boolean).join(' > ');
}

/* ------------------------------------------------------------------ */
/*  GeoSmartSearch Component                                            */
/* ------------------------------------------------------------------ */

export default function GeoSmartSearch({ geoUnits, value, onChange, label, required, placeholder, disabled, minSelectableLevel = 1, invalid = false }: GeoSmartSearchProps) {
    const [search, setSearch] = useState('');
    const [isOpen, setIsOpen] = useState(false);
    // Fixed-position popover geometry (viewport coords). Computed on open and
    // kept in sync on scroll/resize so the list never gets clipped by the
    // scroll container / viewport edge and is never hidden behind a fixed
    // bottom action bar.
    const [ddPos, setDdPos] = useState<{ left: number; width: number; top?: number; bottom?: number; maxHeight: number } | null>(null);
    const containerRef = useRef<HTMLDivElement>(null);
    const fieldRef = useRef<HTMLDivElement>(null);
    const inputRef = useRef<HTMLInputElement>(null);
    // Vertical band the popover is allowed to occupy: below any fixed/sticky top
    // bar (app header, sticky page toolbar) and above any fixed bottom bar
    // (action footer). Measured on open/resize; bars don't move during scroll.
    const boundsRef = useRef<{ top: number; bottom: number }>({ top: 0, bottom: 0 });

    // Build units map once
    const unitsMap = useMemo(() => {
        const map = new Map<number, GeoUnit>();
        geoUnits.forEach(u => map.set(u.id, u));
        return map;
    }, [geoUnits]);

    // Selected path (derived from value)
    const selectedPath = useMemo((): GeoUnit[] | null => {
        // Find deepest selected ID
        const deepestId = value.neighborhoodId || value.subId || value.regionId || value.govId;
        if (!deepestId) return null;
        const unit = unitsMap.get(Number(deepestId));
        if (!unit) return null;
        return buildPath(unit, unitsMap);
    }, [value, unitsMap]);

    // Search suggestions
    const suggestions = useMemo((): GeoSuggestion[] => {
        if (!isOpen) return [];

        if (!search.trim()) {
            // Keep the closed-field transition cheap. When opened without a
            // search term, surface only a small default window instead of
            // traversing the full geo tree.
            const defaults: GeoSuggestion[] = [];
            for (const unit of geoUnits) {
                if (unit.level < minSelectableLevel) continue;
                if (unit.status === 'inactive') continue; // inactive units are not selectable in address fields
                defaults.push({ unit, path: buildPath(unit, unitsMap), score: 0 });
                if (defaults.length >= 30) break;
            }
            return defaults.sort((a, b) => a.unit.level - b.unit.level);
        }

        const q = search.trim().toLowerCase();
        const results: GeoSuggestion[] = [];

        geoUnits.forEach(u => {
            if (u.level < minSelectableLevel) return;
            if (u.status === 'inactive') return; // inactive units are not selectable in address fields
            const name = u.name.toLowerCase();
            if (!name.includes(q)) return;
            const path = buildPath(u, unitsMap);
            const score = name.startsWith(q) ? 0 : name.indexOf(q) + 1;
            results.push({ unit: u, path, score });
        });

        // Sort by score, then by level ascending (more general first when tied)
        results.sort((a, b) => a.score - b.score || a.unit.level - b.unit.level);
        return results.slice(0, 15);
    }, [search, geoUnits, unitsMap, minSelectableLevel, isOpen]);

    // Selection handler
    const handleSelect = useCallback((suggestion: GeoSuggestion) => {
        const path = suggestion.path;
        onChange(pathToSelection(path));
        setSearch('');
        setIsOpen(false);
    }, [onChange]);

    // Clear
    const handleClear = useCallback(() => {
        onChange({ govId: '', regionId: '', subId: '', neighborhoodId: '' });
        setSearch('');
        inputRef.current?.focus();
    }, [onChange]);

    // Measure the safe vertical band: start from the field's scrollable ancestor,
    // then pull the top edge below any fixed/sticky top bar and the bottom edge
    // above any fixed bottom bar. Fixed/sticky bars stay put while the inner
    // container scrolls, so this only needs to run on open and on resize.
    const measureBounds = useCallback(() => {
        const field = fieldRef.current;
        let top = 0;
        let bottom = window.innerHeight;
        // nearest scrollable ancestor clips content vertically
        let sp: HTMLElement | null = field?.parentElement ?? null;
        while (sp) {
            const s = window.getComputedStyle(sp);
            if (/auto|scroll/.test(s.overflowY)) {
                const r = sp.getBoundingClientRect();
                top = Math.max(top, r.top);
                bottom = Math.min(bottom, r.bottom);
                break;
            }
            sp = sp.parentElement;
        }
        // fixed/sticky chrome overlapping the top/bottom edges
        document.querySelectorAll<HTMLElement>('body *').forEach(el => {
            if (field && el.contains(field)) return; // skip our own ancestors
            const s = window.getComputedStyle(el);
            if (s.position !== 'fixed' && s.position !== 'sticky') return;
            const r = el.getBoundingClientRect();
            if (r.width < 200 || r.height === 0 || r.height > 220) return;
            if (r.top <= top + 8) top = Math.max(top, r.bottom);          // top bar
            if (r.bottom >= bottom - 8) bottom = Math.min(bottom, r.top); // bottom bar
        });
        boundsRef.current = { top, bottom };
    }, []);

    // Position the list within the safe band: pick whichever side of the anchor
    // has more room and cap the height so it never spills over a bar or off-screen.
    // If the field has scrolled out of the band, close instead of floating over chrome.
    const computePosition = useCallback(() => {
        const el = fieldRef.current;
        if (!el) return;
        const r = el.getBoundingClientRect();
        const { top: safeTop, bottom: safeBottom } = boundsRef.current;
        // Field scrolled behind the top bar or under the bottom bar → dismiss.
        if (r.bottom <= safeTop + 2 || r.top >= safeBottom - 2) {
            setIsOpen(false);
            return;
        }
        const GAP = 6;          // gap between field and list
        const DESIRED = 256;    // preferred list height (matches old max-h-64)
        const spaceBelow = safeBottom - r.bottom - GAP;
        const spaceAbove = r.top - safeTop - GAP;
        // Open upward only when below can't hold a usable list AND above is roomier.
        const upward = spaceBelow < Math.min(DESIRED, 200) && spaceAbove > spaceBelow;
        const avail = upward ? spaceAbove : spaceBelow;
        if (avail < 96) { setIsOpen(false); return; } // no usable room either way
        const maxHeight = Math.min(DESIRED, avail);
        setDdPos({
            left: r.left,
            width: r.width,
            top: upward ? undefined : r.bottom + GAP,
            bottom: upward ? window.innerHeight - r.top + GAP : undefined,
            maxHeight,
        });
    }, []);

    // Measure + position synchronously before opening so the first paint is correct.
    const openWithDirection = useCallback(() => {
        measureBounds();
        computePosition();
        setIsOpen(true);
    }, [measureBounds, computePosition]);

    // Keep the popover glued to the field while the page/container scrolls or resizes.
    useEffect(() => {
        if (!isOpen) return;
        measureBounds();
        computePosition();
        let raf = 0;
        const onScroll = () => {
            if (raf) return;
            raf = requestAnimationFrame(() => { raf = 0; computePosition(); });
        };
        const onResize = () => { measureBounds(); computePosition(); };
        window.addEventListener('scroll', onScroll, true); // capture: catches inner scroll containers
        window.addEventListener('resize', onResize);
        return () => {
            if (raf) cancelAnimationFrame(raf);
            window.removeEventListener('scroll', onScroll, true);
            window.removeEventListener('resize', onResize);
        };
    }, [isOpen, computePosition, measureBounds]);

    // Outside click
    useEffect(() => {
        const handler = (e: MouseEvent) => {
            if (containerRef.current && !containerRef.current.contains(e.target as Node)) {
                setIsOpen(false);
            }
        };
        document.addEventListener('mousedown', handler);
        return () => document.removeEventListener('mousedown', handler);
    }, []);

    const short = selectedPath ? formatShort(selectedPath) : null;

    return (
        <div className="space-y-1.5" ref={containerRef}>
            {label && (
                <label className="text-xs font-semibold text-slate-500 flex items-center gap-1.5">
                    <MapPin className="w-3.5 h-3.5" />
                    <span>{label}</span>
                    {required && <span className="text-red-400">*</span>}
                </label>
            )}

            <div ref={fieldRef} className={`relative ${disabled ? 'opacity-50 pointer-events-none' : ''}`}>
                {/* Selected State */}
                {selectedPath && !isOpen ? (
                    <div
                        onClick={() => !disabled && openWithDirection()}
                        className={`flex items-center gap-2 w-full bg-white border rounded-xl px-3 py-3 ${invalid ? 'border-red-300 bg-red-50/40' : 'border-slate-200'} ${disabled ? 'cursor-not-allowed bg-slate-50' : invalid ? 'cursor-pointer hover:border-red-400' : 'cursor-pointer hover:border-sky-300'} transition-all group`}
                    >
                        <MapPin className="w-4 h-4 text-sky-500 shrink-0" />
                        <span className="px-2 py-0.5 rounded-lg text-xs font-bold bg-sky-50 text-sky-700 border border-sky-200 shrink-0">
                            {short!.gov}
                        </span>
                        <span className="text-sm text-slate-700 font-medium truncate flex-1">
                            {short!.detail}
                        </span>
                        {!disabled && (
                            <button
                                type="button"
                                onClick={e => { e.stopPropagation(); handleClear(); }}
                                className="w-6 h-6 rounded-lg flex items-center justify-center text-slate-300 hover:text-red-500 hover:bg-red-50 transition-colors opacity-0 group-hover:opacity-100 shrink-0"
                            >
                                <X className="w-3.5 h-3.5" />
                            </button>
                        )}
                    </div>
                ) : (
                    /* Search Input */
                    <div className="relative">
                        <Search className="absolute right-3 top-1/2 -translate-y-1/2 w-4 h-4 text-slate-300 pointer-events-none" />
                        <input
                            ref={inputRef}
                            type="text"
                            value={search}
                            disabled={disabled}
                            onChange={e => { setSearch(e.target.value); openWithDirection(); }}
                            onFocus={() => openWithDirection()}
                            placeholder={placeholder || 'ابحث عن محافظة أو منطقة أو حي...'}
                            className={`w-full bg-white border rounded-xl px-3 py-3 pr-10 text-sm placeholder:text-slate-300 focus:ring-2 focus:outline-none transition-all ${invalid ? 'border-red-300 focus:border-red-400 focus:ring-red-100' : 'border-slate-200 focus:border-sky-400 focus:ring-sky-400/10'} ${disabled ? 'cursor-not-allowed bg-slate-50' : ''}`}
                        />
                    </div>
                )}

                {/* Dropdown — fixed popover so it can't be clipped by the scroll
                    container/viewport or hidden behind a fixed bottom action bar. */}
                {isOpen && ddPos && (
                    <div
                        className="fixed z-[70] bg-white border border-slate-200 rounded-xl shadow-xl overflow-y-auto"
                        style={{ left: ddPos.left, width: ddPos.width, top: ddPos.top, bottom: ddPos.bottom, maxHeight: ddPos.maxHeight }}
                    >
                        {suggestions.length === 0 ? (
                            <div className="p-4 text-center text-sm text-slate-400">لا توجد نتائج</div>
                        ) : (
                            suggestions.map(s => {
                                const isSelected = selectedPath && s.unit.id === selectedPath[selectedPath.length - 1]?.id;
                                return (
                                    <button
                                        key={`${s.unit.id}-${s.unit.level}`}
                                        type="button"
                                        onClick={() => handleSelect(s)}
                                        className={`w-full flex items-center gap-3 px-4 py-3 text-right hover:bg-sky-50 transition-colors border-b border-slate-50 last:border-b-0 ${isSelected ? 'bg-sky-50' : ''}`}
                                    >
                                        <div className={`w-7 h-7 rounded-lg flex items-center justify-center shrink-0 ${s.unit.level === 1 ? 'bg-indigo-50 text-indigo-500' :
                                                s.unit.level === 2 ? 'bg-blue-50 text-blue-500' :
                                                    s.unit.level === 3 ? 'bg-emerald-50 text-emerald-500' :
                                                        'bg-amber-50 text-amber-500'
                                            }`}>
                                            <MapPin className="w-3.5 h-3.5" />
                                        </div>
                                        <div className="flex-1 min-w-0">
                                            <p className="text-sm font-bold text-slate-800">{s.unit.name}</p>
                                            <div className="flex items-center gap-1 mt-0.5 text-xs text-slate-400">
                                                {s.path.map((p, i) => (
                                                    <span key={p.id} className="flex items-center gap-0.5">
                                                        {i > 0 && <ChevronLeft className="w-2.5 h-2.5" />}
                                                        <span className={p.id === s.unit.id ? 'font-bold text-sky-600' : ''}>{p.name}</span>
                                                    </span>
                                                ))}
                                            </div>
                                        </div>
                                        <span className={`px-1.5 py-0.5 rounded text-xs font-medium border ${s.unit.level === 1 ? 'bg-indigo-50 text-indigo-600 border-indigo-200' :
                                                s.unit.level === 2 ? 'bg-blue-50 text-blue-600 border-blue-200' :
                                                    s.unit.level === 3 ? 'bg-emerald-50 text-emerald-600 border-emerald-200' :
                                                        'bg-amber-50 text-amber-600 border-amber-200'
                                            }`}>
                                            {levelNames[s.unit.level]}
                                        </span>
                                        {isSelected && <CheckCircle2 className="w-4 h-4 text-sky-500 shrink-0" />}
                                    </button>
                                );
                            })
                        )}
                    </div>
                )}
            </div>

            {/* Breadcrumb display when selected */}
            {selectedPath && !isOpen && (
                <div className="flex items-center gap-1 text-xs text-slate-400 px-1">
                    {selectedPath.map((p, i) => (
                        <span key={p.id} className="flex items-center gap-0.5">
                            {i > 0 && <ChevronLeft className="w-2.5 h-2.5" />}
                            <span>{levelNames[p.level]}:&nbsp;{p.name}</span>
                        </span>
                    ))}
                </div>
            )}
        </div>
    );
}

/* ------------------------------------------------------------------ */
/*  LocationBadge — Standardized display for tables                    */
/* ------------------------------------------------------------------ */

interface LocationBadgeProps {
    /** Plain location text (e.g., "حي المنصور") */
    location: string;
    /** Optional full GeoUnit path if available */
    geoPath?: GeoUnit[];
    /** Optional gov name for the badge */
    govName?: string;
}

export function LocationBadge({ location, geoPath, govName }: LocationBadgeProps) {
    const [showTooltip, setShowTooltip] = useState(false);

    // If no structured data, show a simple badge with the raw text
    const displayGov = govName || geoPath?.[0]?.name || null;
    const displayDetail = geoPath
        ? [geoPath[2]?.name, geoPath[3]?.name].filter(Boolean).join('، ')
        : location;

    const fullPath = geoPath ? formatPath(geoPath) : location;

    return (
        <div
            className="relative inline-flex items-center gap-1.5"
            onMouseEnter={() => setShowTooltip(true)}
            onMouseLeave={() => setShowTooltip(false)}
        >
            {displayGov && (
                <span className="px-1.5 py-0.5 rounded text-xs font-bold bg-sky-50 text-sky-700 border border-sky-200 shrink-0">
                    {displayGov}
                </span>
            )}
            <span className="text-sm text-slate-600">{displayDetail}</span>

            {/* Tooltip */}
            {showTooltip && (
                <div className="absolute z-50 bottom-full mb-1.5 right-0 px-3 py-2 rounded-lg bg-slate-800 text-white text-xs whitespace-nowrap shadow-lg pointer-events-none">
                    <div className="flex items-center gap-1.5">
                        <MapPin className="w-3 h-3 text-sky-300" />
                        <span>{fullPath}</span>
                    </div>
                    <div className="absolute top-full right-4 w-2 h-2 bg-slate-800 rotate-45 -translate-y-1" />
                </div>
            )}
        </div>
    );
}

/** Helper to get LocationBadge props from a plain location string + geoUnits list */
export function getLocationBadgeProps(locationText: string, geoUnits: GeoUnit[]): LocationBadgeProps {
    // Try to find a matching unit by name
    const matchingUnit = geoUnits.find(u => u.name === locationText);
    if (!matchingUnit) return { location: locationText };

    const unitsMap = new Map<number, GeoUnit>();
    geoUnits.forEach(u => unitsMap.set(u.id, u));
    const path = buildPath(matchingUnit, unitsMap);

    return {
        location: locationText,
        geoPath: path,
        govName: path[0]?.name,
    };
}
