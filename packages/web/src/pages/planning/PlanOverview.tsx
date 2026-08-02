import { useCallback, useEffect, useMemo, useState } from 'react';
import { useNavigate } from 'react-router-dom';
import { motion } from 'framer-motion';
import {
  Activity,
  AlertTriangle,
  ArrowLeft,
  ArrowRight,
  BarChart3,
  Building2,
  Calendar,
  CheckCircle2,
  ChevronLeft,
  ChevronRight,
  CircleDot,
  ClipboardList,
  Clock3,
  Eye,
  Layers,
  Loader2,
  MapPin,
  PhoneCall,
  RefreshCw,
  Route as RouteIcon,
  ShieldAlert,
  User,
  Users,
} from '../../components/ui/icons';
import { api, type PlanningCurationDashboardResponse } from '../../lib/api';
import { useBranchContextStore } from '../../hooks/useBranchContextStore';
import type { DaySchedule, GeoUnit, Route, RouteAssignmentData } from '../../lib/types';
import Modal from '../../components/ui/Modal';

const formatDateArabic = (dateStr: string) => {
  const value = new Date(`${dateStr}T00:00:00`);
  return value.toLocaleDateString('ar-SY', {
    weekday: 'long',
    year: 'numeric',
    month: 'long',
    day: 'numeric',
  });
};

const shiftDate = (dateStr: string, days: number) => {
  const [year, month, day] = dateStr.split('-').map(Number);
  if (!year || !month || !day) return dateStr;
  const value = new Date(year, month - 1, day);
  value.setDate(value.getDate() + days);
  return `${value.getFullYear()}-${String(value.getMonth() + 1).padStart(2, '0')}-${String(value.getDate()).padStart(2, '0')}`;
};

const getPlanningDate = () => {
  const value = new Date();
  value.setDate(value.getDate() + 1);
  return `${value.getFullYear()}-${String(value.getMonth() + 1).padStart(2, '0')}-${String(value.getDate()).padStart(2, '0')}`;
};

type WorkScope = {
  counts?: { marketing: number; emergency: number; service: number; other: number; total: number };
  tasks?: Array<{ ownershipType?: string }>;
};

type TeamCard = {
  key: string;
  type: 'team' | 'solo';
  label: string;
  supervisor: any | null;
  technician: any | null;
  assignment: RouteAssignmentData | null;
};

const cycleLabels: Record<PlanningCurationDashboardResponse['cycle']['status'], string> = {
  planning: 'قيد التخطيط',
  ready: 'جاهزة للتفعيل',
  active: 'قيد التنفيذ',
  closing: 'جارٍ الإنهاء',
  closed: 'منتهية',
};

const cycleStyles: Record<PlanningCurationDashboardResponse['cycle']['status'], string> = {
  planning: 'border-slate-200 bg-slate-50 text-slate-600',
  ready: 'border-indigo-200 bg-indigo-50 text-indigo-700',
  active: 'border-emerald-200 bg-emerald-50 text-emerald-700',
  closing: 'border-amber-200 bg-amber-50 text-amber-700',
  closed: 'border-slate-300 bg-slate-100 text-slate-700',
};

const percentage = (value: number, total: number) => (total > 0 ? Math.round((value / total) * 100) : 0);

function MetricCard({
  label,
  value,
  hint,
  icon: Icon,
  tone,
}: {
  label: string;
  value: number | string;
  hint: string;
  icon: typeof Users;
  tone: 'sky' | 'emerald' | 'violet' | 'amber' | 'rose' | 'slate';
}) {
  const tones = {
    sky: 'bg-sky-50 text-sky-700 ring-sky-100',
    emerald: 'bg-emerald-50 text-emerald-700 ring-emerald-100',
    violet: 'bg-violet-50 text-violet-700 ring-violet-100',
    amber: 'bg-amber-50 text-amber-700 ring-amber-100',
    rose: 'bg-rose-50 text-rose-700 ring-rose-100',
    slate: 'bg-slate-100 text-slate-700 ring-slate-200',
  } as const;

  return (
    <div className="rounded-2xl border border-slate-200 bg-white p-4 shadow-sm">
      <div className="flex items-start justify-between gap-3">
        <div>
          <p className="text-xs font-medium text-slate-500">{label}</p>
          <p className="mt-1 text-2xl font-black text-slate-900">{value}</p>
          <p className="mt-1 text-[11px] text-slate-500">{hint}</p>
        </div>
        <div className={`flex h-10 w-10 shrink-0 items-center justify-center rounded-xl ring-1 ${tones[tone]}`}>
          <Icon className="h-5 w-5" />
        </div>
      </div>
    </div>
  );
}

export default function PlanOverview() {
  const navigate = useNavigate();
  const branchId = useBranchContextStore(state => state.branchId);
  const [date, setDate] = useState(getPlanningDate);
  const [loading, setLoading] = useState(true);
  const [operationalLoading, setOperationalLoading] = useState(false);
  const [loadError, setLoadError] = useState<string | null>(null);
  const [refreshVersion, setRefreshVersion] = useState(0);
  const [geoUnits, setGeoUnits] = useState<GeoUnit[]>([]);
  const [savedRoutes, setSavedRoutes] = useState<Route[]>([]);
  const [currentSchedule, setCurrentSchedule] = useState<DaySchedule>({ teams: [], solos: [] });
  const [routeAssignments, setRouteAssignments] = useState<Record<string, RouteAssignmentData>>({});
  const [employees, setEmployees] = useState<any[]>([]);
  const [teamDashboards, setTeamDashboards] = useState<Record<string, PlanningCurationDashboardResponse>>({});
  const [workScopes, setWorkScopes] = useState<Record<string, WorkScope>>({});
  const [dashboardFailures, setDashboardFailures] = useState(0);
  const [scopeDialogTeamKey, setScopeDialogTeamKey] = useState<string | null>(null);

  const refresh = useCallback(() => setRefreshVersion(value => value + 1), []);

  useEffect(() => {
    const intervalId = window.setInterval(() => {
      if (document.visibilityState === 'visible') refresh();
    }, 30_000);
    return () => window.clearInterval(intervalId);
  }, [refresh]);

  useEffect(() => {
    let cancelled = false;
    const loadBaseData = async () => {
      setLoading(true);
      setLoadError(null);
      try {
        const [geo, routes, schedule, assignments, employeeRows] = await Promise.all([
          api.geoUnits.list(),
          api.routes.list(),
          api.schedules.get(date),
          api.routeAssignments.list(),
          api.employees.list(),
        ]);
        if (cancelled) return;
        setGeoUnits(geo);
        setSavedRoutes(routes);
        setCurrentSchedule(schedule || { teams: [], solos: [] });
        setRouteAssignments(assignments || {});
        setEmployees(employeeRows);
      } catch (error) {
        console.error('Failed to load plan overview data:', error);
        if (!cancelled) setLoadError('تعذر تحميل بيانات الخطة. حاول تحديث الصفحة.');
      } finally {
        if (!cancelled) setLoading(false);
      }
    };
    void loadBaseData();
    return () => { cancelled = true; };
  }, [date, branchId, refreshVersion]);

  const employeeById = useMemo(
    () => new Map(employees.map(employee => [employee.id, employee])),
    [employees],
  );

  const teamCards = useMemo<TeamCard[]>(() => {
    const cards: TeamCard[] = [];
    (currentSchedule.teams || []).forEach((team, index) => {
      if ((team as any)?.locked === true) return;
      const key = `team_${index}`;
      const supervisor = team.supervisor ? employeeById.get(team.supervisor) || null : null;
      const technician = team.technician ? employeeById.get(team.technician) || null : null;
      cards.push({
        key,
        type: 'team',
        label: team.teamLabel || (supervisor ? `فريق ${supervisor.name}` : `فريق #${index + 1}`),
        supervisor,
        technician,
        assignment: routeAssignments[`${date}_${key}`] || null,
      });
    });
    (currentSchedule.solos || []).forEach((team, index) => {
      if ((team as any)?.locked === true) return;
      const key = `solo_${index}`;
      const technician = team.technician ? employeeById.get(team.technician) || null : null;
      cards.push({
        key,
        type: 'solo',
        label: team.teamLabel || (technician ? `طوارئ: ${technician.name}` : `فريق طوارئ #${index + 1}`),
        supervisor: null,
        technician,
        assignment: routeAssignments[`${date}_${key}`] || null,
      });
    });
    return cards;
  }, [currentSchedule, date, employeeById, routeAssignments]);

  useEffect(() => {
    let cancelled = false;
    if (teamCards.length === 0) {
      setTeamDashboards({});
      setWorkScopes({});
      setDashboardFailures(0);
      return () => { cancelled = true; };
    }

    const loadOperationalData = async () => {
      setOperationalLoading(true);
      const results = await Promise.all(teamCards.map(async card => {
        const hasRoute = Boolean(card.assignment?.routes?.length);
        const [dashboard, scope] = await Promise.all([
          api.planning.curationDashboard({ date, teamKey: card.key, page: 1, limit: 1 })
            .catch(error => {
              console.warn(`Failed to load curation summary for ${card.key}`, error);
              return null;
            }),
          hasRoute
            ? api.workScopes.get(date, card.key).catch(() => null)
            : Promise.resolve(null),
        ]);
        return { key: card.key, dashboard, scope };
      }));
      if (cancelled) return;
      setTeamDashboards(Object.fromEntries(results.filter(item => item.dashboard).map(item => [item.key, item.dashboard])));
      setWorkScopes(Object.fromEntries(results.filter(item => item.scope).map(item => [item.key, item.scope])));
      setDashboardFailures(results.filter(item => !item.dashboard).length);
      setOperationalLoading(false);
    };

    void loadOperationalData();
    return () => { cancelled = true; };
  }, [date, teamCards, refreshVersion]);

  const unitNames = useMemo(
    () => new Map(geoUnits.map(unit => [unit.id, unit.name])),
    [geoUnits],
  );

  const getAssignmentDetails = (assignment: RouteAssignmentData) => assignment.routes.flatMap(component => {
    const route = savedRoutes.find(item => item.id === component.routeId);
    if (!route) return [];
    const stations = [...route.points]
      .sort((a, b) => a.order - b.order)
      .map(point => ({ id: point.geoUnitId, name: unitNames.get(point.geoUnitId) || 'غير معروف' }));
    const selected = stations.slice(component.startIdx, component.endIdx + 1);
    const ordered = component.direction === 'reverse' ? [...selected].reverse() : selected;
    return [{
      routeName: route.name,
      startName: ordered[0]?.name || '--',
      endName: ordered[ordered.length - 1]?.name || '--',
      direction: component.direction,
      stationCount: ordered.length,
    }];
  });

  const staffCount = useMemo(() => {
    const ids = new Set<number>();
    [...(currentSchedule.teams || []), ...(currentSchedule.solos || [])].forEach(team => {
      if ((team as any)?.locked === true) return;
      [team.supervisor, team.technician, team.trainee, ...(team.telemarketers || [])]
        .filter((id): id is number => typeof id === 'number')
        .forEach(id => ids.add(id));
    });
    return ids.size;
  }, [currentSchedule]);

  const summary = useMemo(() => {
    const dashboards = Object.values(teamDashboards);
    const totalTeams = teamCards.length;
    const assignedTeams = teamCards.filter(card => card.assignment?.routes?.length).length;
    const generatedTeams = dashboards.filter(item => item.planState === 'COMMITTED').length;
    const activeTeams = dashboards.filter(item => item.cycle.status === 'active').length;
    const closedTeams = dashboards.filter(item => item.cycle.status === 'closed').length;
    const totalRoutes = teamCards.reduce((sum, card) => sum + (card.assignment?.routes?.length || 0), 0);
    const totalStations = teamCards.reduce(
      (sum, card) => sum + (card.assignment ? getAssignmentDetails(card.assignment).reduce((routeSum, route) => routeSum + route.stationCount, 0) : 0),
      0,
    );
    const totals = dashboards.reduce((acc, item) => {
      acc.contacts += item.summary.contacts;
      acc.tasks += item.summary.tasks;
      acc.ready += item.summary.ready;
      acc.queued += item.summary.queued;
      acc.inCallList += item.summary.in_call_list;
      acc.contacted += item.summary.contacted;
      acc.closed += item.summary.closed;
      acc.exclusions += item.summary.excludedTodayTasks;
      acc.blocked += item.summary.blockedCustomers;
      return acc;
    }, { contacts: 0, tasks: 0, ready: 0, queued: 0, inCallList: 0, contacted: 0, closed: 0, exclusions: 0, blocked: 0 });
    const readyForExecution = teamCards.filter(card =>
      Boolean(card.assignment?.routes?.length) && teamDashboards[card.key]?.planState === 'COMMITTED',
    ).length;
    return {
      ...totals,
      totalTeams,
      assignedTeams,
      unassignedTeams: totalTeams - assignedTeams,
      generatedTeams,
      activeTeams,
      closedTeams,
      totalRoutes,
      totalStations,
      readyForExecution,
      readiness: percentage(readyForExecution, totalTeams),
      routeCoverage: percentage(assignedTeams, totalTeams),
      listCoverage: percentage(generatedTeams, totalTeams),
      processed: totals.contacted + totals.closed,
      processingRate: percentage(totals.contacted + totals.closed, totals.contacts),
    };
  }, [teamCards, teamDashboards, savedRoutes, unitNames]);

  const openContactTargetsPage = (card: TeamCard) => {
    const query = new URLSearchParams({ date, label: card.label });
    navigate(`/planning/contact-targets/${card.key}?${query.toString()}`);
  };

  const scopeDialogCard = scopeDialogTeamKey
    ? teamCards.find(card => card.key === scopeDialogTeamKey) || null
    : null;
  const scopeDialogRoutes = scopeDialogCard?.assignment
    ? getAssignmentDetails(scopeDialogCard.assignment)
    : [];
  const scopeDialogExtraZones = (scopeDialogCard?.assignment?.extraZones || []).map(zoneId => ({
    id: zoneId,
    name: unitNames.get(zoneId) || `منطقة #${zoneId}`,
  }));
  const scopeDialogStations = scopeDialogRoutes.reduce((sum, route) => sum + route.stationCount, 0);

  if (loading && teamCards.length === 0) {
    return (
      <div className="flex h-full items-center justify-center">
        <div className="text-center">
          <Loader2 className="mx-auto mb-3 h-8 w-8 animate-spin text-sky-600" />
          <p className="text-sm text-slate-500">جارٍ تحميل بيانات الخطة...</p>
        </div>
      </div>
    );
  }

  return (
    <div className="h-full overflow-y-auto bg-slate-50/70 p-4 custom-scroll lg:p-7" dir="rtl">
      <div className="mx-auto max-w-[1700px] space-y-5">
        <section className="overflow-hidden rounded-2xl border border-slate-200 bg-white shadow-sm">
          <div className="flex flex-col gap-5 p-5 lg:flex-row lg:items-center lg:justify-between lg:p-6">
            <div>
              <div className="mb-2 flex items-center gap-2 text-xs font-bold text-sky-700">
                <BarChart3 className="h-4 w-4" />
                <span>لوحة المتابعة الإدارية</span>
              </div>
              <h1 className="text-2xl font-black tracking-tight text-slate-950">ملخص الخطة</h1>
              <p className="mt-1 text-sm text-slate-500">جاهزية الفرق، حجم العمل، ودورة جهات الاتصال في شاشة واحدة.</p>
            </div>

            <div className="flex flex-wrap items-center gap-2">
              <button
                type="button"
                onClick={() => setDate(value => shiftDate(value, -1))}
                className="inline-flex h-10 items-center gap-1 rounded-xl border border-slate-200 bg-white px-3 text-sm font-medium text-slate-700 hover:bg-slate-50"
              >
                <ChevronRight className="h-4 w-4" /> اليوم السابق
              </button>
              <label className="relative flex min-w-[245px] cursor-pointer items-center justify-center gap-3 rounded-xl border border-slate-200 bg-slate-50 px-5 py-2 shadow-sm hover:border-sky-300 hover:bg-white">
                <Calendar className="h-5 w-5 text-sky-600" />
                <span className="text-center">
                  <span className="block text-sm font-bold text-slate-900">{formatDateArabic(date)}</span>
                  {date === getPlanningDate() && <span className="block text-[10px] font-bold text-sky-600">خطة الغد</span>}
                </span>
                <input
                  type="date"
                  value={date}
                  onChange={event => event.target.value && setDate(event.target.value)}
                  className="absolute inset-0 h-full w-full cursor-pointer opacity-0"
                />
              </label>
              <button
                type="button"
                onClick={() => setDate(value => shiftDate(value, 1))}
                className="inline-flex h-10 items-center gap-1 rounded-xl border border-slate-200 bg-white px-3 text-sm font-medium text-slate-700 hover:bg-slate-50"
              >
                اليوم التالي <ChevronLeft className="h-4 w-4" />
              </button>
              <button
                type="button"
                onClick={refresh}
                disabled={loading || operationalLoading}
                title="تحديث البيانات"
                className="flex h-10 w-10 items-center justify-center rounded-xl border border-slate-200 text-slate-600 hover:bg-slate-50 disabled:opacity-50"
              >
                <RefreshCw className={`h-4 w-4 ${(loading || operationalLoading) ? 'animate-spin' : ''}`} />
              </button>
            </div>
          </div>

          {loadError && (
            <div className="border-t border-rose-100 bg-rose-50 px-5 py-3 text-sm font-medium text-rose-700">{loadError}</div>
          )}
        </section>

        {teamCards.length === 0 ? (
          <section className="rounded-2xl border border-slate-200 bg-white py-20 text-center shadow-sm">
            <ClipboardList className="mx-auto mb-4 h-12 w-12 text-slate-300" />
            <h2 className="text-lg font-bold text-slate-800">لا يوجد جدول لهذا التاريخ</h2>
            <p className="mt-1 text-sm text-slate-500">أنشئ جدول الفرق أولاً، ثم عيّن المسارات قبل تجهيز قوائم الاتصال.</p>
            <button
              type="button"
              onClick={() => navigate('/planning/schedule')}
              className="mt-5 inline-flex items-center gap-2 rounded-xl bg-sky-600 px-5 py-2.5 text-sm font-bold text-white hover:bg-sky-500"
            >
              <Users className="h-4 w-4" /> جدولة الفرق
            </button>
          </section>
        ) : (
          <>
            <section className="grid gap-4 xl:grid-cols-[1.15fr_1.85fr]">
              <div className="rounded-2xl bg-slate-950 p-5 text-white shadow-sm">
                <div className="flex items-start justify-between gap-4">
                  <div>
                    <p className="text-xs font-bold text-sky-300">جاهزية الخطة للتنفيذ</p>
                    <div className="mt-2 flex items-end gap-2">
                      <span className="text-4xl font-black">{summary.readiness}%</span>
                      <span className="pb-1 text-xs text-slate-400">{summary.readyForExecution} من {summary.totalTeams} فرق</span>
                    </div>
                  </div>
                  <div className={`rounded-xl p-2.5 ${summary.readiness === 100 ? 'bg-emerald-500/20 text-emerald-300' : 'bg-amber-500/20 text-amber-300'}`}>
                    {summary.readiness === 100 ? <CheckCircle2 className="h-6 w-6" /> : <Activity className="h-6 w-6" />}
                  </div>
                </div>
                <div className="mt-5 h-2 overflow-hidden rounded-full bg-white/10">
                  <div className="h-full rounded-full bg-gradient-to-l from-sky-400 to-emerald-400 transition-all" style={{ width: `${summary.readiness}%` }} />
                </div>
                <div className="mt-5 grid grid-cols-2 gap-3 text-xs">
                  <div className="rounded-xl bg-white/5 p-3 ring-1 ring-white/10">
                    <div className="flex items-center justify-between text-slate-300"><span>تغطية المسارات</span><RouteIcon className="h-3.5 w-3.5" /></div>
                    <p className="mt-1 text-lg font-black">{summary.routeCoverage}%</p>
                  </div>
                  <div className="rounded-xl bg-white/5 p-3 ring-1 ring-white/10">
                    <div className="flex items-center justify-between text-slate-300"><span>توليد القوائم</span><PhoneCall className="h-3.5 w-3.5" /></div>
                    <p className="mt-1 text-lg font-black">{summary.listCoverage}%</p>
                  </div>
                </div>
              </div>

              <div className="grid grid-cols-2 gap-3 md:grid-cols-3">
                <MetricCard label="الفرق" value={summary.totalTeams} hint={`${summary.assignedTeams} بمسار محدد`} icon={Users} tone="sky" />
                <MetricCard label="الطاقم المجدول" value={staffCount} hint="أفراد فريدون ضمن الفرق" icon={User} tone="violet" />
                <MetricCard label="المسارات والمحطات" value={summary.totalRoutes} hint={`${summary.totalStations} محطة ضمن التعيينات`} icon={RouteIcon} tone="emerald" />
                <MetricCard label="المهام" value={summary.tasks} hint="ضمن نطاقات عمل الفرق" icon={Layers} tone="slate" />
                <MetricCard label="جهات الاتصال" value={summary.contacts} hint={`${summary.generatedTeams} قوائم مولدة`} icon={PhoneCall} tone="amber" />
                <MetricCard label="نسبة المعالجة" value={`${summary.processingRate}%`} hint={`${summary.processed} جهة تمت معالجتها`} icon={Activity} tone="rose" />
              </div>
            </section>

            <section className="grid gap-4 xl:grid-cols-[1.65fr_1fr]">
              <div className="rounded-2xl border border-slate-200 bg-white p-5 shadow-sm">
                <div className="mb-4 flex items-center justify-between gap-3">
                  <div>
                    <h2 className="font-bold text-slate-900">مسار جهات الاتصال</h2>
                    <p className="text-xs text-slate-500">توزيع الحالة الحالية عبر جميع فرق الخطة</p>
                  </div>
                  {operationalLoading && <Loader2 className="h-4 w-4 animate-spin text-sky-600" />}
                </div>
                <div className="grid grid-cols-2 gap-3 md:grid-cols-5">
                  {[
                    { label: 'جاهزة', value: summary.ready, color: 'text-slate-700', bg: 'bg-slate-100', icon: CircleDot },
                    { label: 'ضمن القائمة', value: summary.queued, color: 'text-amber-700', bg: 'bg-amber-50', icon: PhoneCall },
                    { label: 'قيد المعالجة', value: summary.inCallList, color: 'text-indigo-700', bg: 'bg-indigo-50', icon: Clock3 },
                    { label: 'تم التواصل', value: summary.contacted, color: 'text-sky-700', bg: 'bg-sky-50', icon: Activity },
                    { label: 'مغلقة', value: summary.closed, color: 'text-emerald-700', bg: 'bg-emerald-50', icon: CheckCircle2 },
                  ].map(item => (
                    <div key={item.label} className={`rounded-xl p-3 ${item.bg}`}>
                      <div className={`flex items-center gap-1.5 text-xs font-bold ${item.color}`}><item.icon className="h-3.5 w-3.5" />{item.label}</div>
                      <p className="mt-2 text-2xl font-black text-slate-900">{item.value}</p>
                      <p className="text-[10px] text-slate-500">{percentage(item.value, summary.contacts)}% من الإجمالي</p>
                    </div>
                  ))}
                </div>
              </div>

              <div className="rounded-2xl border border-slate-200 bg-white p-5 shadow-sm">
                <div className="mb-4 flex items-center gap-2">
                  <ShieldAlert className="h-5 w-5 text-amber-600" />
                  <div>
                    <h2 className="font-bold text-slate-900">تحتاج انتباه الإدارة</h2>
                    <p className="text-xs text-slate-500">نقاط قد تمنع اكتمال التنفيذ</p>
                  </div>
                </div>
                <div className="space-y-2">
                  {[
                    { label: 'فرق بلا مسار', value: summary.unassignedTeams, tone: summary.unassignedTeams ? 'text-amber-700 bg-amber-50' : 'text-emerald-700 bg-emerald-50' },
                    { label: 'قوائم غير مولدة', value: summary.totalTeams - summary.generatedTeams, tone: summary.totalTeams - summary.generatedTeams ? 'text-amber-700 bg-amber-50' : 'text-emerald-700 bg-emerald-50' },
                    { label: 'مهام عليها استبعاد يومي', value: summary.exclusions, tone: 'text-slate-700 bg-slate-50' },
                    { label: 'جهات محجوبة عن التواصل', value: summary.blocked, tone: summary.blocked ? 'text-rose-700 bg-rose-50' : 'text-slate-700 bg-slate-50' },
                    ...(dashboardFailures ? [{ label: 'فرق تعذر قراءة إحصاءاتها', value: dashboardFailures, tone: 'text-rose-700 bg-rose-50' }] : []),
                  ].map(item => (
                    <div key={item.label} className={`flex items-center justify-between rounded-lg px-3 py-2 text-xs font-bold ${item.tone}`}>
                      <span>{item.label}</span><span className="text-sm">{item.value}</span>
                    </div>
                  ))}
                </div>
              </div>
            </section>

            <section>
              <div className="mb-3 flex flex-wrap items-end justify-between gap-3">
                <div>
                  <h2 className="text-lg font-black text-slate-900">تفاصيل الفرق</h2>
                  <p className="text-xs text-slate-500">المسار، حجم العمل، وحالة دورة الاتصال لكل فريق</p>
                </div>
                <div className="flex flex-wrap gap-2 text-[11px]">
                  <span className="rounded-full border border-emerald-200 bg-emerald-50 px-2.5 py-1 font-bold text-emerald-700">{summary.activeTeams} فعالة</span>
                  <span className="rounded-full border border-slate-200 bg-white px-2.5 py-1 font-bold text-slate-600">{summary.closedTeams} منتهية</span>
                </div>
              </div>

              <div className="grid grid-cols-1 gap-4 xl:grid-cols-2">
                {teamCards.map((card, index) => {
                  const hasAssignment = Boolean(card.assignment?.routes?.length);
                  const routes = card.assignment ? getAssignmentDetails(card.assignment) : [];
                  const dashboard = teamDashboards[card.key];
                  const scope = workScopes[card.key];
                  const totalTasks = dashboard?.summary.tasks ?? scope?.counts?.total ?? 0;
                  const includedTodayTasks = dashboard?.summary.includedTodayTasks ?? totalTasks;
                  const excludedTodayTasks = dashboard?.summary.excludedTodayTasks ?? 0;
                  const contacts = dashboard?.summary.contacts || 0;
                  const processed = dashboard ? dashboard.summary.contacted + dashboard.summary.closed : 0;
                  const processingRate = percentage(processed, contacts);
                  const cycleStatus = dashboard?.cycle.status || 'planning';
                  const companyTasks = scope?.tasks?.filter(task => task.ownershipType === 'company_branch').length || 0;

                  return (
                    <motion.article
                      key={card.key}
                      initial={{ opacity: 0, y: 12 }}
                      animate={{ opacity: 1, y: 0 }}
                      transition={{ delay: index * 0.04 }}
                      className={`overflow-hidden rounded-2xl border bg-white shadow-sm ${hasAssignment ? 'border-slate-200' : 'border-amber-300'}`}
                    >
                      <header className="flex flex-wrap items-start justify-between gap-3 border-b border-slate-100 bg-slate-50/70 p-4">
                        <div className="flex items-center gap-3">
                          <div className={`flex h-10 w-10 items-center justify-center rounded-xl ${card.type === 'solo' ? 'bg-orange-100 text-orange-700' : 'bg-sky-100 text-sky-700'}`}>
                            {card.type === 'solo' ? <User className="h-5 w-5" /> : <Users className="h-5 w-5" />}
                          </div>
                          <div>
                            <h3 className="font-black text-slate-950">{card.label}</h3>
                            <p className="text-[11px] text-slate-500">{card.type === 'solo' ? 'فريق طوارئ' : 'فريق قياسي'}</p>
                          </div>
                        </div>
                        <span className={`rounded-full border px-2.5 py-1 text-[11px] font-bold ${cycleStyles[cycleStatus]}`}>
                          {cycleLabels[cycleStatus]}
                        </span>
                      </header>

                      <div className="grid grid-cols-4 divide-x divide-x-reverse divide-slate-100 border-b border-slate-100">
                        {[
                          ['المهام', totalTasks],
                          ['جهات الاتصال', contacts],
                          ['المسارات', routes.length],
                          ['المعالجة', `${processingRate}%`],
                        ].map(([label, value]) => (
                          <div key={label} className="p-3 text-center">
                            <p className="text-lg font-black text-slate-900">{value}</p>
                            <p className="text-[10px] text-slate-500">{label}</p>
                          </div>
                        ))}
                      </div>

                      <div className="space-y-4 p-4">
                        <div className="flex flex-wrap gap-2">
                          {card.supervisor && (
                            <div className="flex items-center gap-2 rounded-lg border border-slate-200 bg-slate-50 px-2.5 py-1.5">
                              {card.supervisor.avatar ? <img src={card.supervisor.avatar} alt="" className="h-7 w-7 rounded-full object-cover" /> : <User className="h-4 w-4 text-slate-400" />}
                              <div><p className="text-xs font-bold text-slate-800">{card.supervisor.name}</p><p className="text-[10px] text-sky-600">مشرف</p></div>
                            </div>
                          )}
                          {card.technician && (
                            <div className="flex items-center gap-2 rounded-lg border border-slate-200 bg-slate-50 px-2.5 py-1.5">
                              {card.technician.avatar ? <img src={card.technician.avatar} alt="" className="h-7 w-7 rounded-full object-cover" /> : <User className="h-4 w-4 text-slate-400" />}
                              <div><p className="text-xs font-bold text-slate-800">{card.technician.name}</p><p className="text-[10px] text-emerald-600">فني</p></div>
                            </div>
                          )}
                        </div>

                        {hasAssignment ? (
                          <button
                            type="button"
                            onClick={() => setScopeDialogTeamKey(card.key)}
                            className="no-pill group w-full rounded-xl border border-sky-200 bg-gradient-to-l from-sky-50 to-white p-3 text-right transition-all hover:border-sky-300 hover:shadow-sm"
                          >
                            <div className="flex items-center justify-between gap-3">
                              <div className="flex items-center gap-2">
                                <div className="flex h-9 w-9 items-center justify-center rounded-lg bg-sky-100 text-sky-700">
                                  <RouteIcon className="h-4.5 w-4.5" />
                                </div>
                                <div>
                                  <p className="text-xs font-black text-slate-900">نطاق العمل الجغرافي</p>
                                  <p className="mt-0.5 text-[10px] text-slate-500">اضغط لعرض خطوط السير والمناطق المتفرقة</p>
                                </div>
                              </div>
                              <span className="inline-flex items-center gap-1 text-[10px] font-bold text-sky-700 group-hover:text-sky-800">
                                <Eye className="h-3.5 w-3.5" /> التفاصيل
                              </span>
                            </div>
                            <div className="mt-3 grid grid-cols-3 gap-2 border-t border-sky-100 pt-3">
                              <div className="rounded-lg bg-white/80 px-2 py-1.5 text-center ring-1 ring-slate-100">
                                <p className="text-sm font-black text-slate-900">{routes.length}</p>
                                <p className="text-[9px] text-slate-500">خط سير</p>
                              </div>
                              <div className="rounded-lg bg-white/80 px-2 py-1.5 text-center ring-1 ring-slate-100">
                                <p className="text-sm font-black text-slate-900">{routes.reduce((sum, route) => sum + route.stationCount, 0)}</p>
                                <p className="text-[9px] text-slate-500">محطة</p>
                              </div>
                              <div className="rounded-lg bg-white/80 px-2 py-1.5 text-center ring-1 ring-slate-100">
                                <p className="text-sm font-black text-slate-900">{card.assignment?.extraZones?.length || 0}</p>
                                <p className="text-[9px] text-slate-500">منطقة متفرقة</p>
                              </div>
                            </div>
                          </button>
                        ) : (
                          <div className="flex items-center justify-between gap-3 rounded-xl border border-amber-200 bg-amber-50 p-3">
                            <div className="flex items-center gap-2"><AlertTriangle className="h-5 w-5 text-amber-600" /><div><p className="text-xs font-bold text-amber-800">لا يوجد مسار معين</p><p className="text-[10px] text-amber-700">لن تكتمل جاهزية الفريق قبل التعيين.</p></div></div>
                            <button type="button" onClick={() => navigate('/planning/assign')} className="shrink-0 rounded-lg bg-amber-600 px-3 py-1.5 text-xs font-bold text-white hover:bg-amber-500">تعيين</button>
                          </div>
                        )}

                        {hasAssignment && (
                          <div>
                            <div className="mb-2 flex items-center justify-between text-[11px]"><span className="font-bold text-slate-700">جاهزية مهام الفريق</span><span className="text-slate-500">{totalTasks} مهمة</span></div>
                            <div className="grid grid-cols-2 gap-2">
                              <div className="rounded-lg bg-emerald-50 p-2 text-center"><CheckCircle2 className="mx-auto h-3.5 w-3.5 text-emerald-600" /><p className="mt-1 text-sm font-black text-emerald-700">{includedTodayTasks}</p><p className="text-[9px] text-emerald-700">غير مستبعدة اليوم</p></div>
                              <div className="rounded-lg bg-amber-50 p-2 text-center"><ShieldAlert className="mx-auto h-3.5 w-3.5 text-amber-600" /><p className="mt-1 text-sm font-black text-amber-700">{excludedTodayTasks}</p><p className="text-[9px] text-amber-700">مستبعدة اليوم</p></div>
                            </div>
                            {companyTasks > 0 && <p className="mt-2 flex items-center gap-1 text-[10px] text-slate-500"><Building2 className="h-3 w-3" />{companyTasks} مهمة بملكية الشركة/الفرع</p>}
                          </div>
                        )}

                        <div className="flex gap-2 border-t border-slate-100 pt-3">
                          <button
                            type="button"
                            onClick={() => openContactTargetsPage(card)}
                            disabled={!hasAssignment}
                            className="inline-flex flex-1 items-center justify-center gap-1.5 rounded-xl bg-sky-600 px-3 py-2 text-xs font-bold text-white hover:bg-sky-500 disabled:cursor-not-allowed disabled:bg-slate-200 disabled:text-slate-500"
                          >
                            <Eye className="h-3.5 w-3.5" /> إدارة جهات الاتصال
                          </button>
                          <button type="button" onClick={() => navigate('/planning/assign')} className="inline-flex items-center justify-center gap-1.5 rounded-xl border border-slate-200 px-3 py-2 text-xs font-bold text-slate-700 hover:bg-slate-50">
                            <RouteIcon className="h-3.5 w-3.5" /> تعديل المسار
                          </button>
                        </div>
                      </div>
                    </motion.article>
                  );
                })}
              </div>
            </section>
          </>
        )}
      </div>

      <Modal
        isOpen={scopeDialogCard != null}
        onClose={() => setScopeDialogTeamKey(null)}
        size="2xl"
        title="تفاصيل نطاق العمل"
        subtitle={scopeDialogCard?.label}
        footer={
          <div className="flex w-full items-center justify-between gap-2">
            <button
              type="button"
              onClick={() => setScopeDialogTeamKey(null)}
              className="rounded-xl border border-slate-200 px-4 py-2 text-xs font-bold text-slate-700 hover:bg-slate-50"
            >
              إغلاق
            </button>
            <button
              type="button"
              onClick={() => {
                setScopeDialogTeamKey(null);
                navigate('/planning/assign');
              }}
              className="inline-flex items-center gap-1.5 rounded-xl bg-sky-600 px-4 py-2 text-xs font-bold text-white hover:bg-sky-500"
            >
              <RouteIcon className="h-3.5 w-3.5" /> تعديل المسار
            </button>
          </div>
        }
      >
        <div className="space-y-5 bg-slate-50/60 p-5" dir="rtl">
          <div className="grid grid-cols-3 gap-3">
            <div className="rounded-xl border border-slate-200 bg-white p-3 text-center">
              <p className="text-2xl font-black text-sky-700">{scopeDialogRoutes.length}</p>
              <p className="text-xs text-slate-500">خطوط السير</p>
            </div>
            <div className="rounded-xl border border-slate-200 bg-white p-3 text-center">
              <p className="text-2xl font-black text-emerald-700">{scopeDialogStations}</p>
              <p className="text-xs text-slate-500">المحطات ضمن الخطوط</p>
            </div>
            <div className="rounded-xl border border-slate-200 bg-white p-3 text-center">
              <p className="text-2xl font-black text-orange-700">{scopeDialogExtraZones.length}</p>
              <p className="text-xs text-slate-500">المناطق المتفرقة</p>
            </div>
          </div>

          <section>
            <div className="mb-2 flex items-center gap-2">
              <RouteIcon className="h-4 w-4 text-sky-600" />
              <h4 className="text-sm font-black text-slate-900">خطوط السير</h4>
            </div>
            {scopeDialogRoutes.length > 0 ? (
              <div className="space-y-2">
                {scopeDialogRoutes.map((route, routeIndex) => (
                  <div key={`${route.routeName}-${routeIndex}`} className="rounded-xl border border-slate-200 bg-white p-3">
                    <div className="flex flex-wrap items-center justify-between gap-2">
                      <div>
                        <p className="text-sm font-black text-slate-900">{route.routeName}</p>
                        <p className="mt-1 text-xs text-slate-500">من {route.startName} إلى {route.endName}</p>
                      </div>
                      <div className="flex items-center gap-2">
                        <span className="rounded-lg bg-slate-100 px-2 py-1 text-[10px] font-bold text-slate-600">{route.stationCount} محطة</span>
                        <span className={`inline-flex items-center gap-1 rounded-lg border px-2 py-1 text-[10px] font-bold ${route.direction === 'forward' ? 'border-emerald-200 bg-emerald-50 text-emerald-700' : 'border-orange-200 bg-orange-50 text-orange-700'}`}>
                          {route.direction === 'forward' ? <ArrowRight className="h-3 w-3" /> : <ArrowLeft className="h-3 w-3" />}
                          {route.direction === 'forward' ? 'ذهاب' : 'إياب'}
                        </span>
                      </div>
                    </div>
                  </div>
                ))}
              </div>
            ) : (
              <div className="rounded-xl border border-dashed border-slate-300 bg-white p-5 text-center text-xs text-slate-500">لا توجد خطوط سير ضمن هذا النطاق.</div>
            )}
          </section>

          <section>
            <div className="mb-2 flex items-center gap-2">
              <MapPin className="h-4 w-4 text-orange-600" />
              <h4 className="text-sm font-black text-slate-900">المناطق المتفرقة</h4>
            </div>
            {scopeDialogExtraZones.length > 0 ? (
              <div className="flex flex-wrap gap-2 rounded-xl border border-orange-100 bg-orange-50/70 p-3">
                {scopeDialogExtraZones.map(zone => (
                  <span key={zone.id} className="inline-flex items-center gap-1 rounded-lg border border-orange-200 bg-white px-2.5 py-1.5 text-xs font-bold text-orange-800">
                    <MapPin className="h-3 w-3" /> {zone.name}
                  </span>
                ))}
              </div>
            ) : (
              <div className="rounded-xl border border-dashed border-slate-300 bg-white p-4 text-center text-xs text-slate-500">لا توجد مناطق متفرقة خارج خطوط السير.</div>
            )}
          </section>
        </div>
      </Modal>
    </div>
  );
}
