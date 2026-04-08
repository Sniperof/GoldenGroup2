import { useState, useMemo, useRef, useCallback, useEffect } from 'react';
import { MapPin, Search, ChevronLeft, X, CheckCircle2 } from 'lucide-react';
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
function buildPath(unit: GeoUnit, unitsMap: Map<number, GeoUnit>): GeoUnit[] {
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
function pathToSelection(path: GeoUnit[]): GeoSelection {
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

/* ------------------------------------------------------------------ */
/*  GeoSmartSearch Component                                            */
/* ------------------------------------------------------------------ */

export default function GeoSmartSearch({ geoUnits, value, onChange, label, required, placeholder, disabled }: GeoSmartSearchProps) {
    const [search, setSearch] = useState('');
    const [isOpen, setIsOpen] = useState(false);
    const containerRef = useRef<HTMLDivElement>(null);
    const inputRef = useRef<HTMLInputElement>(null);

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
        if (!search.trim()) {
            // Show all level-4 neighborhoods when empty
            return geoUnits
                .filter(u => u.level === 4)
                .map(u => {
                    const path = buildPath(u, unitsMap);
                    return { unit: u, path, score: 0 };
                })
                .slice(0, 30);
        }

        const q = search.trim().toLowerCase();
        const results: GeoSuggestion[] = [];

        // Search all units
        geoUnits.forEach(u => {
            const name = u.name.toLowerCase();
            if (!name.includes(q)) return;
            const path = buildPath(u, unitsMap);
            // Exact prefix match = best score
            const score = name.startsWith(q) ? 0 : name.indexOf(q) + 1;
            results.push({ unit: u, path, score });
        });

        // Sort by score, then by level (deeper = more specific = better)
        results.sort((a, b) => a.score - b.score || b.unit.level - a.unit.level);
        return results.slice(0, 15);
    }, [search, geoUnits, unitsMap]);

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

            <div className={`relative ${disabled ? 'opacity-50 pointer-events-none' : ''}`}>
                {/* Selected State */}
                {selectedPath && !isOpen ? (
                    <div
                        onClick={() => !disabled && setIsOpen(true)}
                        className={`flex items-center gap-2 w-full bg-white border border-gray-200 rounded-xl px-3 py-2.5 ${disabled ? 'cursor-not-allowed bg-gray-50' : 'cursor-pointer hover:border-sky-300'} transition-all group`}
                    >
                        <MapPin className="w-4 h-4 text-sky-500 shrink-0" />
                        <span className="px-2 py-0.5 rounded-md text-[10px] font-bold bg-sky-50 text-sky-700 border border-sky-200 shrink-0">
                            {short!.gov}
                        </span>
                        <span className="text-sm text-slate-700 font-medium truncate flex-1">
                            {short!.detail}
                        </span>
                        {!disabled && (
                            <button
                                type="button"
                                onClick={e => { e.stopPropagation(); handleClear(); }}
                                className="w-6 h-6 rounded-md flex items-center justify-center text-gray-300 hover:text-red-500 hover:bg-red-50 transition-colors opacity-0 group-hover:opacity-100 shrink-0"
                            >
                                <X className="w-3.5 h-3.5" />
                            </button>
                        )}
                    </div>
                ) : (
                    /* Search Input */
                    <div className="relative">
                        <Search className="absolute right-3 top-1/2 -translate-y-1/2 w-4 h-4 text-gray-300 pointer-events-none" />
                        <input
                            ref={inputRef}
                            type="text"
                            value={search}
                            disabled={disabled}
                            onChange={e => { setSearch(e.target.value); setIsOpen(true); }}
                            onFocus={() => setIsOpen(true)}
                            placeholder={placeholder || 'ابحث عن محافظة، منطقة، حي...'}
                            className={`w-full bg-white border border-gray-200 rounded-xl px-3 py-2.5 pr-10 text-sm placeholder:text-gray-300 focus:border-sky-400 focus:ring-2 focus:ring-sky-400/10 focus:outline-none transition-all ${disabled ? 'cursor-not-allowed bg-gray-50' : ''}`}
                        />
                    </div>
                )}

                {/* Dropdown */}
                {isOpen && (
                    <div className="absolute z-50 top-full mt-1 w-full bg-white border border-gray-200 rounded-xl shadow-xl max-h-64 overflow-y-auto">
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
                                        className={`w-full flex items-center gap-3 px-4 py-3 text-right hover:bg-sky-50 transition-colors border-b border-gray-50 last:border-b-0 ${isSelected ? 'bg-sky-50' : ''}`}
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
                                            <div className="flex items-center gap-1 mt-0.5 text-[10px] text-slate-400">
                                                {s.path.map((p, i) => (
                                                    <span key={p.id} className="flex items-center gap-0.5">
                                                        {i > 0 && <ChevronLeft className="w-2.5 h-2.5" />}
                                                        <span className={p.id === s.unit.id ? 'font-bold text-sky-600' : ''}>{p.name}</span>
                                                    </span>
                                                ))}
                                            </div>
                                        </div>
                                        <span className={`px-1.5 py-0.5 rounded text-[9px] font-medium border ${s.unit.level === 1 ? 'bg-indigo-50 text-indigo-600 border-indigo-200' :
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
                <div className="flex items-center gap-1 text-[10px] text-slate-400 px-1">
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
                <span className="px-1.5 py-0.5 rounded text-[9px] font-bold bg-sky-50 text-sky-700 border border-sky-200 shrink-0">
                    {displayGov}
                </span>
            )}
            <span className="text-sm text-slate-600">{displayDetail}</span>

            {/* Tooltip */}
            {showTooltip && (
                <div className="absolute z-50 bottom-full mb-1.5 right-0 px-3 py-2 rounded-lg bg-slate-800 text-white text-[11px] whitespace-nowrap shadow-lg pointer-events-none">
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
