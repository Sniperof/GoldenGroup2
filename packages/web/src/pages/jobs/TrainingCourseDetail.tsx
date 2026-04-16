import { useEffect, useState } from 'react';
import { useParams, useNavigate } from 'react-router-dom';
import { useTrainingStore } from '../../hooks/useTrainingStore';
import type { TrainingCourseTrainee } from '../../lib/types';
import { authFetch } from '../../lib/authFetch';
import {
  GraduationCap, ArrowRight, Calendar, User, Monitor, Building2,
  CheckCircle, XCircle, Loader2, AlertTriangle, Play, Award,
  UserPlus, ChevronDown,
} from 'lucide-react';
import PermissionGate from '../../components/PermissionGate';
import PaginationBar from '../../components/PaginationBar';

// ── helpers ───────────────────────────────────────────────────────────────────

function generateDates(attendance: { attendanceDate: string }[]): string[] {
  const datesSet = new Set<string>();
  for (const a of attendance) {
    datesSet.add(a.attendanceDate);
  }
  return Array.from(datesSet).sort();
}

function formatDate(d: string) {
  return new Date(d).toLocaleDateString('ar-IQ', { month: 'short', day: 'numeric' });
}

const STATUS_COLORS: Record<string, string> = {
  'Training Scheduled': 'bg-blue-100 text-blue-700',
  'Training Started': 'bg-amber-100 text-amber-700',
  'Training Completed': 'bg-emerald-100 text-emerald-700',
};
const STATUS_LABELS: Record<string, string> = {
  'Training Scheduled': 'مجدولة',
  'Training Started': 'جارية',
  'Training Completed': 'مكتملة',
};

const RESULT_LABELS: Record<string, string> = {
  Passed: 'ناجح', Retraining: 'إعادة تدريب', Rejected: 'مرفوض', Retreated: 'منسحب',
};
const RESULT_COLORS: Record<string, string> = {
  Passed: 'bg-emerald-100 text-emerald-700',
  Retraining: 'bg-orange-100 text-orange-700',
  Rejected: 'bg-red-100 text-red-700',
  Retreated: 'bg-slate-100 text-slate-600',
};

interface PaginatedResponse<T> {
  data: T[];
  total: number;
  page: number;
  limit: number;
  totalPages: number;
}

interface AttendancePageResponse extends PaginatedResponse<TrainingCourseTrainee> {
  attendanceDates: string[];
  attendance: { applicationId: number; attendanceDate: string; status: 'Present' | 'Absent' }[];
}

// ── component ─────────────────────────────────────────────────────────────────

export default function TrainingCourseDetail() {
  const { id } = useParams<{ id: string }>();
  const navigate = useNavigate();
  const { selectedCourse, detailLoading, detailError, fetchCourseDetail,
    startCourse, completeCourse, recordAttendance, recordTraineeResult } = useTrainingStore();

  // Attendance state
  const today = new Date().toISOString().split('T')[0];
  const [attDate, setAttDate] = useState(today);
  const [pendingAtt, setPendingAtt] = useState<Record<number, 'Present' | 'Absent'>>({});
  const [savingAtt, setSavingAtt] = useState(false);
  const [attError, setAttError] = useState('');

  // Action state
  const [actionLoading, setActionLoading] = useState(false);
  const [actionError, setActionError] = useState('');

  // Result dropdowns
  const [pendingResults, setPendingResults] = useState<Record<number, string>>({});
  const [savingResult, setSavingResult] = useState<Record<number, boolean>>({});
  const [resultErrors, setResultErrors] = useState<Record<number, string>>({});
  const [trainees, setTrainees] = useState<TrainingCourseTrainee[]>([]);
  const [traineesPage, setTraineesPage] = useState(1);
  const [traineesLimit, setTraineesLimit] = useState(10);
  const [traineesTotal, setTraineesTotal] = useState(0);
  const [traineesTotalPages, setTraineesTotalPages] = useState(1);
  const [attendanceTrainees, setAttendanceTrainees] = useState<TrainingCourseTrainee[]>([]);
  const [attendanceRows, setAttendanceRows] = useState<Array<{ applicationId: number; attendanceDate: string; status: 'Present' | 'Absent' }>>([]);
  const [attendanceDates, setAttendanceDates] = useState<string[]>([]);
  const [attendancePage, setAttendancePage] = useState(1);
  const [attendanceLimit, setAttendanceLimit] = useState(10);
  const [attendanceTotal, setAttendanceTotal] = useState(0);
  const [attendanceTotalPages, setAttendanceTotalPages] = useState(1);

  useEffect(() => {
    if (id) fetchCourseDetail(Number(id));
  }, [id]);

  const fetchTraineesPage = async () => {
    if (!id) return;
    const res = await authFetch(`/api/admin/training-courses/${id}/trainees?page=${traineesPage}&limit=${traineesLimit}`);
    const result = await res.json() as PaginatedResponse<TrainingCourseTrainee>;
    if (!res.ok) return;
    setTrainees(result.data || []);
    setTraineesTotal(result.total || 0);
    setTraineesTotalPages(result.totalPages || 1);
  };

  const fetchAttendancePage = async () => {
    if (!id) return;
    const res = await authFetch(`/api/admin/training-courses/${id}/attendance?page=${attendancePage}&limit=${attendanceLimit}`);
    const result = await res.json() as AttendancePageResponse;
    if (!res.ok) return;
    setAttendanceTrainees(result.data || []);
    setAttendanceRows(result.attendance || []);
    setAttendanceDates(result.attendanceDates || []);
    setAttendanceTotal(result.total || 0);
    setAttendanceTotalPages(result.totalPages || 1);
  };

  useEffect(() => {
    setTraineesPage(1);
    setAttendancePage(1);
  }, [id]);

  useEffect(() => { fetchTraineesPage(); }, [id, traineesPage, traineesLimit]);
  useEffect(() => { fetchAttendancePage(); }, [id, attendancePage, attendanceLimit]);

  if (detailLoading) return (
    <div className="h-full flex items-center justify-center" dir="rtl">
      <Loader2 className="w-8 h-8 animate-spin text-sky-500" />
    </div>
  );

  if (detailError || !selectedCourse) return (
    <div className="h-full flex flex-col items-center justify-center gap-4 text-slate-500" dir="rtl">
      <AlertTriangle className="w-10 h-10 text-red-400" />
      <p>{detailError || 'الدورة غير موجودة'}</p>
      <button onClick={() => navigate('/jobs/training-courses')} className="text-sky-600 text-sm hover:underline">
        العودة للقائمة
      </button>
    </div>
  );

  const course = selectedCourse;
  const dates = attendanceDates.length > 0 ? attendanceDates : generateDates(attendanceRows);

  // Build attendance lookup: { applicationId_date: status }
  const attMap: Record<string, 'Present' | 'Absent'> = {};
  for (const a of attendanceRows) {
    attMap[`${a.applicationId}_${a.attendanceDate}`] = a.status;
  }

  // Init pending attendance from existing when date changes
  function initPendingForDate(date: string) {
    const init: Record<number, 'Present' | 'Absent'> = {};
    for (const t of attendanceTrainees) {
      init[t.applicationId] = attMap[`${t.applicationId}_${date}`] || 'Present';
    }
    setPendingAtt(init);
    setAttError('');
  }

  function handleDateChange(date: string) {
    setAttDate(date);
    initPendingForDate(date);
  }

  useEffect(() => {
    if (attendanceTrainees.length > 0) initPendingForDate(attDate);
  }, [attendanceRows, attendanceTrainees, attDate]);

  async function saveAttendance() {
    setSavingAtt(true); setAttError('');
    try {
      const attendance = attendanceTrainees.map(t => ({
        application_id: t.applicationId,
        status: pendingAtt[t.applicationId] ?? 'Present',
      }));
      await recordAttendance(course.id, attDate, attendance);
      await fetchAttendancePage();
    } catch (err: any) { setAttError(err.message); }
    finally { setSavingAtt(false); }
  }

  async function handleStart() {
    setActionLoading(true); setActionError('');
    try {
      await startCourse(course.id);
      await fetchTraineesPage();
      await fetchAttendancePage();
    }
    catch (err: any) { setActionError(err.message); }
    finally { setActionLoading(false); }
  }

  async function handleComplete() {
    setActionLoading(true); setActionError('');
    try {
      await completeCourse(course.id);
      await fetchTraineesPage();
      await fetchAttendancePage();
    }
    catch (err: any) { setActionError(err.message); }
    finally { setActionLoading(false); }
  }

  async function handleRecordResult(trainee: TrainingCourseTrainee) {
    const result = pendingResults[trainee.applicationId] as 'Passed' | 'Retraining' | 'Rejected' | 'Retreated';
    if (!result) { setResultErrors(e => ({ ...e, [trainee.applicationId]: 'اختر نتيجة' })); return; }
    setSavingResult(s => ({ ...s, [trainee.applicationId]: true }));
    setResultErrors(e => ({ ...e, [trainee.applicationId]: '' }));
    try {
      await recordTraineeResult(course.id, trainee.applicationId, result);
      await fetchTraineesPage();
      await fetchAttendancePage();
      setPendingResults(p => { const n = { ...p }; delete n[trainee.applicationId]; return n; });
    } catch (err: any) {
      setResultErrors(e => ({ ...e, [trainee.applicationId]: err.message }));
    } finally {
      setSavingResult(s => ({ ...s, [trainee.applicationId]: false }));
    }
  }

  const isScheduled = course.trainingStatus === 'Training Scheduled';
  const isStarted = course.trainingStatus === 'Training Started';
  const isCompleted = course.trainingStatus === 'Training Completed';

  return (
    <div className="h-full overflow-y-auto p-6" dir="rtl">
      {/* Back */}
      <button
        onClick={() => navigate('/jobs/training-courses')}
        className="flex items-center gap-2 text-sm text-slate-500 hover:text-slate-800 mb-6 transition-colors"
      >
        <ArrowRight className="w-4 h-4" />
        العودة للدورات التدريبية
      </button>

      {/* Course Info Card */}
      <div className="bg-white rounded-2xl border border-slate-200 p-6 mb-6">
        <div className="flex items-start justify-between flex-wrap gap-4">
          <div>
            <div className="flex items-center gap-3 mb-1">
              <GraduationCap className="w-6 h-6 text-sky-500" />
              <h1 className="text-xl font-bold text-slate-800">{course.trainingName}</h1>
              <span className={`px-2.5 py-1 rounded-full text-xs font-bold ${STATUS_COLORS[course.trainingStatus]}`}>
                {STATUS_LABELS[course.trainingStatus]}
              </span>
            </div>
            {course.vacancy && (
              <p className="text-sm text-slate-500 mr-9">{course.vacancy.title} — {course.vacancy.branch}</p>
            )}
          </div>
          <span className="text-xs text-slate-400 font-mono">#{course.id}</span>
        </div>

        <div className="grid grid-cols-2 md:grid-cols-4 gap-4 mt-5">
          <div className="flex items-center gap-2 text-sm text-slate-600">
            <User className="w-4 h-4 text-slate-400" />
            <span><span className="text-xs text-slate-400 block">المدرب</span>{course.trainer}</span>
          </div>
          {course.deviceName && (
            <div className="flex items-center gap-2 text-sm text-slate-600">
              <Monitor className="w-4 h-4 text-slate-400" />
              <span><span className="text-xs text-slate-400 block">الجهاز</span>{course.deviceName}</span>
            </div>
          )}
          <div className="flex items-center gap-2 text-sm text-slate-600">
            <Building2 className="w-4 h-4 text-slate-400" />
            <span><span className="text-xs text-slate-400 block">الفرع</span>{course.branch}</span>
          </div>
          <div className="flex items-center gap-2 text-sm text-slate-600">
            <Calendar className="w-4 h-4 text-slate-400" />
            <span>
              <span className="text-xs text-slate-400 block">الفترة</span>
              {course.startDate ? new Date(course.startDate).toLocaleDateString('ar-IQ') : '—'}
              {' → '}
              {course.endDate ? new Date(course.endDate).toLocaleDateString('ar-IQ') : '—'}
            </span>
          </div>
        </div>

        {course.notes && (
          <p className="mt-4 text-sm text-slate-600 bg-slate-50 rounded-xl px-4 py-2">{course.notes}</p>
        )}

        {/* Action buttons */}
        {actionError && (
          <div className="mt-4 bg-red-50 border border-red-200 text-red-700 rounded-xl px-4 py-2 text-sm">{actionError}</div>
        )}
        <div className="mt-4 flex items-center gap-3 flex-wrap">
          {isScheduled && (
            <PermissionGate permission="jobs.training.start">
              <button
                onClick={handleStart}
                disabled={actionLoading}
                className="flex items-center gap-2 px-4 py-2 bg-amber-500 text-white rounded-xl text-sm font-semibold hover:bg-amber-600 disabled:opacity-50 transition-colors"
              >
                {actionLoading ? <Loader2 className="w-4 h-4 animate-spin" /> : <Play className="w-4 h-4" />}
                بدء الدورة
              </button>
            </PermissionGate>
          )}
          {isStarted && (
            <PermissionGate permission="jobs.training.complete">
              <button
                onClick={handleComplete}
                disabled={actionLoading}
                className="flex items-center gap-2 px-4 py-2 bg-emerald-600 text-white rounded-xl text-sm font-semibold hover:bg-emerald-700 disabled:opacity-50 transition-colors"
              >
                {actionLoading ? <Loader2 className="w-4 h-4 animate-spin" /> : <Award className="w-4 h-4" />}
                إكمال الدورة
              </button>
            </PermissionGate>
          )}
        </div>
      </div>

      {/* Attendance Grid */}
      {(isStarted || isCompleted) && course.traineeCount > 0 && (
        <div className="bg-white rounded-2xl border border-slate-200 p-6 mb-6">
          <div className="mb-4 flex items-center justify-between flex-wrap gap-3">
            <h2 className="text-base font-bold text-slate-800 flex items-center gap-2">
            <Calendar className="w-5 h-5 text-sky-500" />
            سجل الحضور
            </h2>
            <label className="flex items-center gap-2 text-xs text-slate-500">
              <span>لكل صفحة</span>
              <select
                value={attendanceLimit}
                onChange={(e) => {
                  setAttendanceLimit(parseInt(e.target.value, 10));
                  setAttendancePage(1);
                }}
                className="rounded-lg border border-slate-200 bg-white px-2 py-1 text-xs text-slate-700"
              >
                {[5, 10, 25, 50].map((size) => (
                  <option key={size} value={size}>{size}</option>
                ))}
              </select>
            </label>
          </div>

          {dates.length > 0 ? (
            <>
            <div className="overflow-x-auto">
            <table className="text-xs min-w-full">
              <thead>
                <tr className="bg-slate-50">
                  <th className="px-3 py-2 text-right font-semibold text-slate-600 min-w-[150px]">المتدرب</th>
                  {dates.map(d => (
                    <th key={d} className="px-2 py-2 text-center font-medium text-slate-500 min-w-[52px]">
                      {formatDate(d)}
                    </th>
                  ))}
                </tr>
              </thead>
              <tbody>
                {attendanceTrainees.map(t => (
                  <tr key={t.applicationId} className="border-t border-slate-100">
                    <td className="px-3 py-2 font-medium text-slate-800 whitespace-nowrap">
                      {t.firstName} {t.lastName}
                      <span className="text-slate-400 font-normal"> #{t.applicationId}</span>
                    </td>
                    {dates.map(d => {
                      const recorded = attMap[`${t.applicationId}_${d}`];
                      return (
                        <td key={d} className="px-2 py-2 text-center">
                          {recorded === 'Present' ? (
                            <CheckCircle className="w-4 h-4 text-emerald-500 mx-auto" />
                          ) : recorded === 'Absent' ? (
                            <XCircle className="w-4 h-4 text-red-400 mx-auto" />
                          ) : (
                            <span className="text-slate-300">—</span>
                          )}
                        </td>
                      );
                    })}
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
          <PaginationBar
            page={attendancePage}
            totalPages={attendanceTotalPages}
            total={attendanceTotal}
            limit={attendanceLimit}
            onPageChange={setAttendancePage}
          />
          </>
          ) : (
            <div className="text-center text-slate-500 py-6 text-sm bg-slate-50 rounded-xl">
              لم يتم تسجيل أي حضور حتى الآن. الرجاء تحديد يوم لإضافته.
            </div>
          )}

          {/* Record attendance (only when started) */}
          {isStarted && (
            <PermissionGate permission="jobs.training.record_attendance">
            <div className="mt-5 border-t border-slate-100 pt-5">
              <h3 className="text-sm font-semibold text-slate-700 mb-3">تسجيل حضور يوم:</h3>
              <div className="flex items-center gap-3 mb-4 flex-wrap">
                <input
                  type="date"
                  value={attDate}
                  min={course.startDate}
                  max={course.endDate}
                  onChange={e => handleDateChange(e.target.value)}
                  className="border border-slate-200 rounded-lg px-3 py-2 text-sm focus:ring-2 focus:ring-sky-500"
                />
                <button
                  onClick={() => initPendingForDate(attDate)}
                  className="text-xs text-slate-500 hover:text-slate-700"
                >
                  تحميل الحضور السابق
                </button>
              </div>

              <div className="space-y-2">
                {attendanceTrainees.map(t => {
                  const current = pendingAtt[t.applicationId] ?? attMap[`${t.applicationId}_${attDate}`] ?? 'Present';
                  return (
                    <div key={t.applicationId} className="flex items-center justify-between bg-slate-50 rounded-xl px-4 py-2">
                      <span className="text-sm font-medium text-slate-800">{t.firstName} {t.lastName}</span>
                      <div className="flex gap-2">
                        <button
                          onClick={() => setPendingAtt(p => ({ ...p, [t.applicationId]: 'Present' }))}
                          className={`px-3 py-1 rounded-lg text-xs font-semibold transition-colors ${current === 'Present' ? 'bg-emerald-500 text-white' : 'bg-slate-200 text-slate-600 hover:bg-emerald-100'}`}
                        >
                          حاضر
                        </button>
                        <button
                          onClick={() => setPendingAtt(p => ({ ...p, [t.applicationId]: 'Absent' }))}
                          className={`px-3 py-1 rounded-lg text-xs font-semibold transition-colors ${current === 'Absent' ? 'bg-red-500 text-white' : 'bg-slate-200 text-slate-600 hover:bg-red-100'}`}
                        >
                          غائب
                        </button>
                      </div>
                    </div>
                  );
                })}
              </div>

              {attError && (
                <div className="mt-3 text-sm text-red-600 bg-red-50 rounded-xl px-4 py-2">{attError}</div>
              )}
              <div className="mt-3 flex justify-end">
                <button
                  onClick={saveAttendance}
                  disabled={savingAtt}
                  className="flex items-center gap-2 px-5 py-2 bg-sky-600 text-white rounded-xl text-sm font-semibold hover:bg-sky-700 disabled:opacity-50"
                >
                  {savingAtt && <Loader2 className="w-4 h-4 animate-spin" />}
                  حفظ الحضور
                </button>
              </div>
            </div>
            </PermissionGate>
          )}
        </div>
      )}

      {/* Results Section */}
      {isCompleted && course.traineeCount > 0 && (
        <div className="bg-white rounded-2xl border border-slate-200 p-6 mb-6">
          <div className="mb-4 flex items-center justify-between flex-wrap gap-3">
            <h2 className="text-base font-bold text-slate-800 flex items-center gap-2">
            <Award className="w-5 h-5 text-sky-500" />
            النتائج
            </h2>
            <label className="flex items-center gap-2 text-xs text-slate-500">
              <span>لكل صفحة</span>
              <select
                value={traineesLimit}
                onChange={(e) => {
                  setTraineesLimit(parseInt(e.target.value, 10));
                  setTraineesPage(1);
                }}
                className="rounded-lg border border-slate-200 bg-white px-2 py-1 text-xs text-slate-700"
              >
                {[5, 10, 25, 50].map((size) => (
                  <option key={size} value={size}>{size}</option>
                ))}
              </select>
            </label>
          </div>

          <div className="space-y-3">
            {trainees.map(t => (
              <div key={t.applicationId} className="flex items-center gap-4 bg-slate-50 rounded-xl px-4 py-3 flex-wrap">
                <div className="flex-1 min-w-[150px]">
                  <p className="text-sm font-medium text-slate-800">{t.firstName} {t.lastName}</p>
                  <p className="text-xs text-slate-400">طلب #{t.applicationId}</p>
                </div>

                {t.result ? (
                  <span className={`px-3 py-1 rounded-full text-xs font-bold ${RESULT_COLORS[t.result]}`}>
                    {RESULT_LABELS[t.result]}
                  </span>
                ) : (
                  <PermissionGate permission="jobs.training.record_result">
                    <div className="flex items-center gap-2 flex-wrap">
                      <div className="relative">
                        <select
                          value={pendingResults[t.applicationId] || ''}
                          onChange={e => setPendingResults(p => ({ ...p, [t.applicationId]: e.target.value }))}
                          className="appearance-none bg-white border border-slate-200 rounded-lg px-3 py-1.5 pr-8 text-sm text-slate-700 focus:ring-2 focus:ring-sky-500"
                        >
                          <option value="">اختر النتيجة...</option>
                          <option value="Passed">ناجح</option>
                          <option value="Retraining">إعادة تدريب</option>
                          <option value="Rejected">مرفوض</option>
                          <option value="Retreated">منسحب</option>
                        </select>
                        <ChevronDown className="w-3.5 h-3.5 absolute left-2 top-1/2 -translate-y-1/2 text-slate-400 pointer-events-none" />
                      </div>
                      <button
                        onClick={() => handleRecordResult(t)}
                        disabled={savingResult[t.applicationId]}
                        className="flex items-center gap-1.5 px-3 py-1.5 bg-sky-600 text-white rounded-lg text-xs font-semibold hover:bg-sky-700 disabled:opacity-50"
                      >
                        {savingResult[t.applicationId] ? <Loader2 className="w-3 h-3 animate-spin" /> : <CheckCircle className="w-3 h-3" />}
                        تسجيل
                      </button>
                      {resultErrors[t.applicationId] && (
                        <span className="text-xs text-red-600">{resultErrors[t.applicationId]}</span>
                      )}
                    </div>
                  </PermissionGate>
                )}
              </div>
            ))}
          </div>
          <PaginationBar
            page={traineesPage}
            totalPages={traineesTotalPages}
            total={traineesTotal}
            limit={traineesLimit}
            onPageChange={setTraineesPage}
          />
        </div>
      )}

      {/* Trainees list (for Scheduled courses) */}
      {isScheduled && course.traineeCount > 0 && (
        <div className="bg-white rounded-2xl border border-slate-200 p-6 mb-6">
          <div className="mb-4 flex items-center justify-between flex-wrap gap-3">
            <h2 className="text-base font-bold text-slate-800 flex items-center gap-2">
              <UserPlus className="w-5 h-5 text-sky-500" />
              المتدربون المسجلون ({traineesTotal})
            </h2>
            <label className="flex items-center gap-2 text-xs text-slate-500">
              <span>لكل صفحة</span>
              <select
                value={traineesLimit}
                onChange={(e) => {
                  setTraineesLimit(parseInt(e.target.value, 10));
                  setTraineesPage(1);
                }}
                className="rounded-lg border border-slate-200 bg-white px-2 py-1 text-xs text-slate-700"
              >
                {[5, 10, 25, 50].map((size) => (
                  <option key={size} value={size}>{size}</option>
                ))}
              </select>
            </label>
          </div>
          <div className="divide-y divide-slate-100">
            {trainees.map(t => (
              <div key={t.applicationId} className="flex items-center justify-between py-2.5">
                <div>
                  <p className="text-sm font-medium text-slate-800">{t.firstName} {t.lastName}</p>
                  <p className="text-xs text-slate-400">طلب #{t.applicationId}</p>
                </div>
                <span className="text-xs px-2 py-0.5 rounded-full bg-blue-100 text-blue-700">
                  {t.applicationStatus === 'Retraining' ? 'إعادة تدريب' : 'مجدول'}
                </span>
              </div>
            ))}
          </div>
          <PaginationBar
            page={traineesPage}
            totalPages={traineesTotalPages}
            total={traineesTotal}
            limit={traineesLimit}
            onPageChange={setTraineesPage}
          />
        </div>
      )}
    </div>
  );
}
