import { BrowserRouter, Routes, Route, Navigate } from 'react-router-dom';
import { useEffect } from 'react';
import { useAuthStore } from './hooks/useAuthStore';
import Login from './pages/auth/Login';
import { ErrorBoundary } from './components/ErrorBoundary';
import MainLayout from './layout/MainLayout';
import RequireBranchContext from './components/RequireBranchContext';
import Dashboard from './pages/Dashboard';
import SupervisorAlertsPage from './pages/supervisor/SupervisorAlertsPage';
import GeoSettings from './pages/GeoSettings';
import RouteManager from './pages/RouteManager';
import Employees from './pages/Employees';
import EmployeeDetail from './pages/EmployeeDetail';
import Clients from './pages/Clients';
import ClientProfile from './pages/ClientProfile';
import CandidatesEntry from './pages/candidates/CandidatesEntry';
import TeamScheduler from './pages/planning/TeamScheduler';
import ZoneStudy from './pages/planning/ZoneStudy';
import RouteAssigner from './pages/planning/RouteAssigner';
import PlanOverview from './pages/planning/PlanOverview';
import PlanningContactTargets from './pages/planning/PlanningContactTargets';
import EmergencyTasks from './pages/tasks/EmergencyTasks';
import EmergencyTaskDetail from './pages/tasks/EmergencyTaskDetail';
import Dues from './pages/tasks/Dues';
import DeviceManagement from './pages/DeviceManagement';
import DeviceDetail from './pages/DeviceDetail';
import DeviceProfilePage from './pages/devices/DeviceProfilePage'; // DEC-CT plan §2
import InstalledDevicesList from './pages/devices/InstalledDevicesList';
import ContractList from './pages/contracts/ContractList';
import ContractForm from './pages/contracts/ContractForm';
import ContractDetail from './pages/contracts/ContractDetail';
import TelemarketerWorkspace from './pages/TelemarketerWorkspace';
import TeamTasksDetail from './pages/planning/TeamTasksDetail';
import DeviceDemo from './pages/tasks/DeviceDemo';
import DeviceDemoDetail from './pages/tasks/DeviceDemoDetail';
import PostSaleTaskDetail from './pages/tasks/PostSaleTaskDetail';
import WarrantyServicesTaskDetail from './pages/tasks/WarrantyServicesTaskDetail';
import CollectionTaskDetail from './pages/tasks/CollectionTaskDetail';
import OpenTasks from './pages/OpenTasks';
import SystemSettings from './pages/SystemSettings';
import Branches from './pages/Branches';
import Departments from './pages/Departments';
import Vacancies from './pages/jobs/Vacancies';
import VacancyDetail from './pages/jobs/VacancyDetail';
import PublicJobs from './pages/jobs/PublicJobs';
import Applications from './pages/jobs/Applications';
import ApplicationDetail from './pages/jobs/ApplicationDetail';
import ManualApplicationEntry from './pages/jobs/ManualApplicationEntry';
import Interviews from './pages/jobs/Interviews';
import TrainingCourses from './pages/jobs/TrainingCourses';
import TrainingCourseDetail from './pages/jobs/TrainingCourseDetail';
import SystemLists from './pages/admin/SystemLists';
import Roles from './pages/admin/Roles';
import Users from './pages/admin/Users';
import RolePermissions from './pages/admin/RolePermissions';
import PermissionSettings from './pages/admin/PermissionSettings';
import TaskTypes from './pages/admin/TaskTypes';
import EmergencyActionTypes from './pages/admin/EmergencyActionTypes';
import VisitsListPage from './pages/visits/VisitsListPage';
import MyVisitsPage from './pages/visits/MyVisitsPage';
import VisitDetailPage from './pages/visits/VisitDetailPage';
import TaskGroupPage from './pages/tasks/TaskGroupPage';
import ServiceRequestsListPage from './pages/service-requests/ServiceRequestsListPage';
import ServiceRequestDetailPage from './pages/service-requests/ServiceRequestDetailPage';
import NewServiceRequestPage from './pages/service-requests/NewServiceRequestPage';


function ProtectedRoute({ children }: { children: React.ReactNode }) {
    const token = useAuthStore((s) => s.token);
    if (!token) return <Navigate to="/login" replace />;
    return <>{children}</>;
}

export default function App() {
    const token = useAuthStore((s) => s.token);
    const refreshSession = useAuthStore((s) => s.refreshSession);

    useEffect(() => {
        if (!token) return;
        void refreshSession().catch((err) => {
            console.error('Session refresh failed:', err);
        });
    }, [token, refreshSession]);

    return (
        <BrowserRouter>
            <ErrorBoundary>
                <Routes>
                    <Route path="/login" element={<Login />} />
                    <Route element={<ProtectedRoute><MainLayout /></ProtectedRoute>}>
                        <Route path="/" element={<Dashboard />} />
                        <Route path="/devices" element={<DeviceManagement />} />
                        <Route path="/devices/:id" element={<DeviceDetail />} />
                        {/* Branch-scoped operational list of installed devices (Group 1) */}
                        <Route path="/installed-devices" element={<InstalledDevicesList />} />
                        {/* DEC-CT plan §2 — standalone profile for a customer's installed device */}
                        <Route path="/installed-devices/:id" element={<DeviceProfilePage />} />
                        <Route path="/geo" element={<GeoSettings />} />
                        <Route path="/routes" element={<RouteManager />} />
                        <Route path="/employees" element={<Employees />} />
                        <Route path="/employees/:id" element={<EmployeeDetail />} />
                        <Route path="/clients" element={<Clients />} />
                        <Route path="/clients/:id" element={<ClientProfile />} />
                        <Route path="/candidates" element={<CandidatesEntry />} />
                        {/* Group 3 — single-branch operational pages: hidden on "all branches" (§6 / Phase 3.2). */}
                        <Route path="/planning/schedule" element={<RequireBranchContext><TeamScheduler /></RequireBranchContext>} />
                        <Route path="/planning/zone-study" element={<RequireBranchContext><ZoneStudy /></RequireBranchContext>} />
                        <Route path="/planning/assign" element={<RequireBranchContext><RouteAssigner /></RequireBranchContext>} />
                        <Route path="/planning/overview" element={<RequireBranchContext><PlanOverview /></RequireBranchContext>} />
                        <Route path="/planning/contact-targets/:teamKey" element={<RequireBranchContext><PlanningContactTargets /></RequireBranchContext>} />
                        <Route path="/planning/team-tasks/:teamKey" element={<RequireBranchContext><TeamTasksDetail /></RequireBranchContext>} />
                        <Route path="/tasks/emergency" element={<EmergencyTasks />} />
                        <Route path="/tasks/emergency/:id" element={<EmergencyTaskDetail />} />
                        <Route path="/tasks/dues" element={<Dues />} />
                        <Route path="/tasks/open" element={<OpenTasks />} />
                        <Route path="/tasks/device-demo" element={<DeviceDemo />} />
                        <Route path="/tasks/device-demo/:id" element={<DeviceDemoDetail />} />
                        {/* Post-sale detail routes — each group's detailHref is
                            /tasks/group/<group>, so the per-row link is
                            /tasks/group/<group>/:id. These must precede the
                            /tasks/group/:group catch-all below. PostSaleTaskDetail
                            derives its back link from the group segment. */}
                        <Route path="/tasks/group/after-sale-services/:id" element={<PostSaleTaskDetail />} />
                        <Route path="/tasks/group/device-delivery/:id" element={<PostSaleTaskDetail />} />
                        <Route path="/tasks/group/device-installation/:id" element={<PostSaleTaskDetail />} />
                        <Route path="/tasks/group/device-activation/:id" element={<PostSaleTaskDetail />} />
                        <Route path="/tasks/group/device-disconnection/:id" element={<PostSaleTaskDetail />} />
                        {/* Unified open_task detail under group URL — V1.0 reuses EmergencyTaskDetail. */}
                        <Route path="/tasks/group/maintenance/:id" element={<EmergencyTaskDetail />} />
                        <Route path="/tasks/group/collection/:id" element={<CollectionTaskDetail />} />
                        <Route path="/tasks/group/warranty-services/:id" element={<WarrantyServicesTaskDetail />} />
                        {/* Unified task groups (2026-06-01) — single page, 6 display_groups */}
                        <Route path="/tasks/group/:group" element={<TaskGroupPage />} />
                        <Route path="/open-tasks" element={<Navigate to="/tasks/open" replace />} />
                        {/* Service Requests intake (٠.١٦ — GLOBAL) */}
                        <Route path="/service-requests" element={<ServiceRequestsListPage />} />
                        <Route path="/service-requests/new" element={<NewServiceRequestPage />} />
                        <Route path="/service-requests/:id" element={<ServiceRequestDetailPage />} />
                        {/* Group 3 — visit management is a single-branch supervisory surface (§6).
                            Hidden on "all branches"; super-admin / GLOBAL must pick a branch. The
                            field team uses the standalone "زياراتي" page instead. */}
                        <Route path="/field-visits" element={<RequireBranchContext><VisitsListPage /></RequireBranchContext>} />
                        {/* Standalone personal surface for the field team (ASSIGNED) — outside the
                            management Visits page. Self-scopes by team membership; not branch-gated. */}
                        <Route path="/my-visits" element={<MyVisitsPage />} />
                        <Route path="/field-visits/:id" element={<VisitDetailPage />} />
                        <Route path="/contracts" element={<ContractList />} />
                        <Route path="/contracts/new" element={<ContractForm />} />
                        <Route path="/contracts/:id/edit" element={<ContractForm />} />
                        <Route path="/contracts/:id" element={<ContractDetail />} />

                        <Route path="/telemarketer" element={<RequireBranchContext><TelemarketerWorkspace /></RequireBranchContext>} />
                        <Route path="/settings" element={<SystemSettings />} />
                        <Route path="/system-lists" element={<SystemLists />} />
                        <Route path="/branches" element={<Branches />} />
                        <Route path="/departments" element={<Departments />} />

                        {/* Job Applications Epic */}
                        <Route path="/jobs/vacancies" element={<Vacancies />} />
                        <Route path="/jobs/vacancies/:id" element={<VacancyDetail />} />
                        <Route path="/jobs/public" element={<PublicJobs />} />
                        <Route path="/jobs/applications" element={<Applications />} />
                        <Route path="/jobs/applications/new" element={<ManualApplicationEntry />} />
                        <Route path="/jobs/applications/:id" element={<ApplicationDetail />} />
                        <Route path="/jobs/interviews" element={<Interviews />} />
                        <Route path="/jobs/training-courses" element={<TrainingCourses />} />
                        <Route path="/jobs/training-courses/:id" element={<TrainingCourseDetail />} />

                        {/* Supervisor */}
                        <Route path="/supervisor/alerts" element={<RequireBranchContext><SupervisorAlertsPage /></RequireBranchContext>} />

                        {/* Admin */}
                        <Route path="/admin/roles" element={<Roles />} />
                        {/* Group-1 records page (branch-filtered) living under /admin; excluded
                            from isGlobalOnlyPath so it honours the external branch filter. */}
                        <Route path="/admin/users" element={<Users />} />
                        <Route path="/admin/roles/:id/permissions" element={<RolePermissions />} />
                        <Route path="/admin/permissions-settings" element={<PermissionSettings />} />
                        <Route path="/admin/task-types" element={<TaskTypes />} />
                        <Route path="/admin/emergency-action-types" element={<EmergencyActionTypes />} />
                    </Route>
                </Routes>
            </ErrorBoundary>
        </BrowserRouter>
    );
}

