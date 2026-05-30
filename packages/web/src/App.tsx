import { BrowserRouter, Routes, Route, Navigate } from 'react-router-dom';
import { useAuthStore } from './hooks/useAuthStore';
import Login from './pages/auth/Login';
import { ErrorBoundary } from './components/ErrorBoundary';
import MainLayout from './layout/MainLayout';
import Dashboard from './pages/Dashboard';
import GeoSettings from './pages/GeoSettings';
import RouteManager from './pages/RouteManager';
import Employees from './pages/Employees';
import EmployeeDetail from './pages/EmployeeDetail';
import Clients from './pages/Clients';
import ClientProfile from './pages/ClientProfile';
import CandidatesEntry from './pages/candidates/CandidatesEntry';
import TeamScheduler from './pages/planning/TeamScheduler';
import RouteAssigner from './pages/planning/RouteAssigner';
import PlanOverview from './pages/planning/PlanOverview';
import PlanningContactTargets from './pages/planning/PlanningContactTargets';
import TodaysTasks from './pages/tasks/TodaysTasks';
import EmergencyTasks from './pages/tasks/EmergencyTasks';
import EmergencyTaskDetail from './pages/tasks/EmergencyTaskDetail';
import Dues from './pages/tasks/Dues';
import Periodic from './pages/tasks/Periodic';
import Returns from './pages/tasks/Returns';
import FollowUp from './pages/tasks/FollowUp';
import DeviceManagement from './pages/DeviceManagement';
import DeviceDetail from './pages/DeviceDetail';
import DeviceProfilePage from './pages/devices/DeviceProfilePage'; // DEC-CT plan §2
import ContractList from './pages/contracts/ContractList';
import ContractForm from './pages/contracts/ContractForm';
import ContractDetail from './pages/contracts/ContractDetail';
import TelemarketerWorkspace from './pages/TelemarketerWorkspace';
import TeamTasksDetail from './pages/planning/TeamTasksDetail';
import DeviceDemo from './pages/tasks/DeviceDemo';
import DeviceDemoDetail from './pages/tasks/DeviceDemoDetail';
import OpenTasks from './pages/OpenTasks';
import SystemSettings from './pages/SystemSettings';
import Branches from './pages/Branches';
import BranchDetail from './pages/admin/BranchDetail';
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
import RolePermissions from './pages/admin/RolePermissions';
import PermissionSettings from './pages/admin/PermissionSettings';
import TaskTypes from './pages/admin/TaskTypes';
import EmergencyActionTypes from './pages/admin/EmergencyActionTypes';
import VisitDetailPage from './pages/visits/VisitDetailPage';


function ProtectedRoute({ children }: { children: React.ReactNode }) {
    const token = useAuthStore((s) => s.token);
    if (!token) return <Navigate to="/login" replace />;
    return <>{children}</>;
}

export default function App() {
    return (
        <BrowserRouter>
            <ErrorBoundary>
                <Routes>
                    <Route path="/login" element={<Login />} />
                    <Route element={<ProtectedRoute><MainLayout /></ProtectedRoute>}>
                        <Route path="/" element={<Dashboard />} />
                        <Route path="/devices" element={<DeviceManagement />} />
                        <Route path="/devices/:id" element={<DeviceDetail />} />
                        {/* DEC-CT plan §2 — standalone profile for a customer's installed device */}
                        <Route path="/installed-devices/:id" element={<DeviceProfilePage />} />
                        <Route path="/geo" element={<GeoSettings />} />
                        <Route path="/routes" element={<RouteManager />} />
                        <Route path="/employees" element={<Employees />} />
                        <Route path="/employees/:id" element={<EmployeeDetail />} />
                        <Route path="/clients" element={<Clients />} />
                        <Route path="/clients/:id" element={<ClientProfile />} />
                        <Route path="/candidates" element={<CandidatesEntry />} />
                        <Route path="/planning/schedule" element={<TeamScheduler />} />
                        <Route path="/planning/assign" element={<RouteAssigner />} />
                        <Route path="/planning/overview" element={<PlanOverview />} />
                        <Route path="/planning/contact-targets/:teamKey" element={<PlanningContactTargets />} />
                        <Route path="/planning/team-tasks/:teamKey" element={<TeamTasksDetail />} />
                        <Route path="/tasks/today" element={<TodaysTasks />} />
                        <Route path="/tasks/emergency" element={<EmergencyTasks />} />
                        <Route path="/tasks/emergency/:id" element={<EmergencyTaskDetail />} />
                        <Route path="/tasks/dues" element={<Dues />} />
                        <Route path="/tasks/periodic" element={<Periodic />} />
                        <Route path="/tasks/returns" element={<Returns />} />
                        <Route path="/tasks/followup" element={<FollowUp />} />
                        <Route path="/tasks/open" element={<OpenTasks />} />
                        <Route path="/tasks/device-demo" element={<DeviceDemo />} />
                        <Route path="/tasks/device-demo/:id" element={<DeviceDemoDetail />} />
                        <Route path="/open-tasks" element={<Navigate to="/tasks/open" replace />} />
                        <Route path="/field-visits/:id" element={<VisitDetailPage />} />
                        <Route path="/contracts" element={<ContractList />} />
                        <Route path="/contracts/new" element={<ContractForm />} />
                        <Route path="/contracts/:id/edit" element={<ContractForm />} />
                        <Route path="/contracts/:id" element={<ContractDetail />} />

                        <Route path="/telemarketer" element={<TelemarketerWorkspace />} />
                        <Route path="/settings" element={<SystemSettings />} />
                        <Route path="/system-lists" element={<SystemLists />} />
                        <Route path="/branches" element={<Branches />} />
                        <Route path="/branches/:id" element={<BranchDetail />} />

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

                        {/* Admin */}
                        <Route path="/admin/roles" element={<Roles />} />
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

