// ============================================================
// GeoCascadeFilter — reusable branch-scoped geo cascade filter
// ============================================================
// Extracted from Clients.tsx so any records page (Clients, Installed Devices, …)
// can offer the same محافظة → منطقة → ناحية → حي cascade that resolves to a
// subtree of geo-unit ids (`geoIdsCsv`) the server matches with `= ANY`.
//
//   • Options are branch-scoped (api.geoUnits.list(branchId)) — only the areas a
//     branch covers; the national tree when GLOBAL is on "all branches".
//   • The global names tree (api.geoUnits.names()) drives subtree expansion so a
//     selection matches every record beneath it.
//   • Gated: a level shows only once its parent is determined (explicitly or
//     auto-resolved when the level above has exactly one option). A single-option
//     level is hidden but still narrows the subtree.
//
// Usage:
//   const geo = useGeoCascade({ branchId });
//   // in the filter panel:   <GeoCascadeFields cascade={geo} />
//   // in the query:           geoIds: geo.geoIdsCsv
//   // in the chip list:       if (geo.active) chips.push({ ..., value: geo.chipLabel, onRemove: geo.reset })
//   // on clear-all:           geo.reset()
// ============================================================

import { useCallback, useEffect, useMemo, useState, type ReactNode } from 'react';
import Select from '../ui/Select';
import { api } from '../../lib/api';

interface GeoUnitNode { id: number; parentId: number | null; level: number; name: string }

export interface GeoCascade {
  geoIdsCsv: string;
  active: boolean;
  chipLabel: string | null;
  reset: () => void;
  // Internal rendering state (consumed by GeoCascadeFields).
  gov: string; setGov: (v: string) => void; govOptions: GeoUnitNode[];
  region: string; setRegion: (v: string) => void; regionOptions: GeoUnitNode[];
  subarea: string; setSubarea: (v: string) => void; subareaOptions: GeoUnitNode[];
  hood: string; setHood: (v: string) => void; hoodOptions: GeoUnitNode[];
}

export function useGeoCascade({ branchId }: { branchId: number | null }): GeoCascade {
  const [gov, setGov] = useState('all');
  const [region, setRegion] = useState('all');
  const [subarea, setSubarea] = useState('all');
  const [hood, setHood] = useState('all');

  const [scopedGeo, setScopedGeo] = useState<GeoUnitNode[]>([]);
  const [namesTree, setNamesTree] = useState<GeoUnitNode[]>([]);

  const reset = useCallback(() => { setGov('all'); setRegion('all'); setSubarea('all'); setHood('all'); }, []);

  // Branch-scoped options; reset the cascade when the scope changes so stale
  // selections don't linger under a different branch's coverage.
  useEffect(() => {
    api.geoUnits.list(branchId)
      .then(rows => setScopedGeo(rows as GeoUnitNode[]))
      .catch(() => setScopedGeo([]));
    setGov('all'); setRegion('all'); setSubarea('all'); setHood('all');
  }, [branchId]);

  // Global names tree (for subtree expansion) — fetched once.
  useEffect(() => {
    api.geoUnits.names()
      .then(rows => setNamesTree(rows as GeoUnitNode[]))
      .catch(() => setNamesTree([]));
  }, []);

  const geoChildren = useMemo(() => {
    const m = new Map<number, number[]>();
    for (const g of namesTree) {
      if (g.parentId == null) continue;
      const arr = m.get(g.parentId) ?? [];
      arr.push(g.id);
      m.set(g.parentId, arr);
    }
    return m;
  }, [namesTree]);

  const expandSubtrees = useCallback((roots: number[]): string[] => {
    const out: number[] = [];
    const seen = new Set<number>();
    const stack = [...roots];
    while (stack.length) {
      const id = stack.pop()!;
      if (seen.has(id)) continue;
      seen.add(id);
      out.push(id);
      for (const child of geoChildren.get(id) ?? []) stack.push(child);
    }
    return out.map(String);
  }, [geoChildren]);

  const geoIdsCsv = useMemo(() => {
    const deepest = [hood, subarea, region, gov].find(v => v !== 'all');
    return deepest ? expandSubtrees([Number(deepest)]).join(',') : '';
  }, [gov, region, subarea, hood, expandSubtrees]);

  const govOptions = useMemo(() => scopedGeo.filter(g => g.level === 1), [scopedGeo]);
  const effGov = gov !== 'all' ? Number(gov) : (govOptions.length === 1 ? govOptions[0].id : null);
  const regionOptions = useMemo(() => effGov == null ? [] : scopedGeo.filter(g => g.level === 2 && g.parentId === effGov), [scopedGeo, effGov]);
  const effRegion = region !== 'all' ? Number(region) : (regionOptions.length === 1 ? regionOptions[0].id : null);
  const subareaOptions = useMemo(() => effRegion == null ? [] : scopedGeo.filter(g => g.level === 3 && g.parentId === effRegion), [scopedGeo, effRegion]);
  const effSubarea = subarea !== 'all' ? Number(subarea) : (subareaOptions.length === 1 ? subareaOptions[0].id : null);
  const hoodOptions = useMemo(() => effSubarea == null ? [] : scopedGeo.filter(g => g.level === 4 && g.parentId === effSubarea), [scopedGeo, effSubarea]);

  const deepestGeo = [hood, subarea, region, gov].find(v => v !== 'all');
  const chipLabel = deepestGeo
    ? (namesTree.find(g => String(g.id) === deepestGeo)?.name ?? scopedGeo.find(g => String(g.id) === deepestGeo)?.name ?? deepestGeo)
    : null;

  return {
    geoIdsCsv, active: deepestGeo != null, chipLabel, reset,
    gov, setGov, govOptions,
    region, setRegion, regionOptions,
    subarea, setSubarea, subareaOptions,
    hood, setHood, hoodOptions,
  };
}

// Labeled slot — matches the records pages' unified filter panel styling.
function Field({ label, children }: { label: string; children: ReactNode }) {
  return (
    <div className="flex flex-col gap-1">
      <label className="px-1 text-[11px] font-bold text-slate-500">{label}</label>
      {children}
    </div>
  );
}

// Renders the gated cascade selects. Drop inside the filter-panel grid; each
// level is a standalone grid cell so it flows with the surrounding FilterFields.
export function GeoCascadeFields({ cascade }: { cascade: GeoCascade }) {
  const c = cascade;
  return (
    <>
      {c.govOptions.length > 1 && (
        <Field label="المحافظة">
          <Select className="w-full" value={c.gov} ariaLabel="المحافظة"
            onChange={(v) => { c.setGov(v); c.setRegion('all'); c.setSubarea('all'); c.setHood('all'); }}
            options={[{ value: 'all', label: 'كل المحافظات' }, ...c.govOptions.map(g => ({ value: String(g.id), label: g.name }))]} />
        </Field>
      )}
      {c.regionOptions.length > 1 && (
        <Field label="المنطقة">
          <Select className="w-full" value={c.region} ariaLabel="المنطقة"
            onChange={(v) => { c.setRegion(v); c.setSubarea('all'); c.setHood('all'); }}
            options={[{ value: 'all', label: 'كل المناطق' }, ...c.regionOptions.map(g => ({ value: String(g.id), label: g.name }))]} />
        </Field>
      )}
      {c.subareaOptions.length > 1 && (
        <Field label="الناحية">
          <Select className="w-full" value={c.subarea} ariaLabel="الناحية"
            onChange={(v) => { c.setSubarea(v); c.setHood('all'); }}
            options={[{ value: 'all', label: 'كل النواحي' }, ...c.subareaOptions.map(g => ({ value: String(g.id), label: g.name }))]} />
        </Field>
      )}
      {c.hoodOptions.length > 1 && (
        <Field label="الحي">
          <Select className="w-full" value={c.hood} ariaLabel="الحي"
            onChange={c.setHood}
            options={[{ value: 'all', label: 'كل الأحياء' }, ...c.hoodOptions.map(g => ({ value: String(g.id), label: g.name }))]} />
        </Field>
      )}
    </>
  );
}
