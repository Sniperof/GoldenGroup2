import { useState } from 'react';
import { NavLink, Outlet, useLocation, useNavigate } from 'react-router-dom';
import { useAuthStore } from '../hooks/useAuthStore';
import { usePermissions } from '../hooks/usePermissions';
import { motion, AnimatePresence } from 'framer-motion';
import FloatingActionButton from '../components/FloatingActionButton';
import NewEmergencyTicketModal from '../components/NewEmergencyTicketModal';
import AddCandidateModal from '../components/candidates/AddCandidateModal';
import {
    LayoutDashboard, Route, Users, BookUser, Globe,
    ClipboardList, UsersRound, MapPinned, ChevronDown, Gem, Eye,
    Briefcase, Calendar, AlertTriangle, DollarSign, RefreshCw, RotateCcw, PhoneCall,
    FileText, FilePlus2, Headset, Settings, UserPlus, Menu, X as CloseIcon,
    ChevronLeft, ChevronRight, Target, BadgeCheck, GraduationCap, Mic2, LogOut, Building2, SlidersHorizontal, ShieldCheck
} from 'lucide-react';

const navItems = [
    { path: '/', label: 'نظرة عامة', icon: LayoutDashboard },
];

const geoChildren = [
    { path: '/geo', label: 'إدارة المستويات الإدارية', icon: Globe },
    { path: '/routes', label: 'إدارة خطوط السير', icon: Route },
];

const recordsChildren = [
    { path: '/clients', label: 'سجلات الزبائن', icon: BookUser },
    { path: '/candidates', label: 'سجلات الأسماء المقترحة', icon: UserPlus },
    { path: '/employees', label: 'سجلات الموظفين', icon: Users },
];

const operationsChildren = [
    { path: '/tasks/today', label: 'مهام اليوم', icon: Calendar },
    { path: '/tasks/emergency', label: 'طوارئ', icon: AlertTriangle },
    { path: '/tasks/dues', label: 'مستحقات', icon: DollarSign },
    { path: '/tasks/periodic', label: 'صيانة دورية', icon: RefreshCw },
    { path: '/tasks/returns', label: 'إرجاع', icon: RotateCcw },
    { path: '/tasks/followup', label: 'متابعة', icon: PhoneCall },
    { path: '/operations/marketing', label: 'عمليات التسويق', icon: Target },
];

const planningChildren = [
    { path: '/planning/overview', label: 'ملخص الخطة', icon: Eye },
    { path: '/planning/schedule', label: 'جدولة الفرق', icon: UsersRound },
    { path: '/planning/assign', label: 'تعيين المسارات', icon: MapPinned },
];

const jobsChildren = [
    { path: '/jobs/vacancies', label: 'إدارة الشواغر', icon: Briefcase },
    { path: '/jobs/applications', label: 'طلبات التوظيف', icon: ClipboardList },
    { path: '/jobs/interviews', label: 'المقابلات', icon: Mic2 },
    { path: '/jobs/training-courses', label: 'الدورات التدريبية', icon: GraduationCap },
    { path: '/jobs/public', label: 'الوظائف المتاحة (عام)', icon: BadgeCheck },
];

export default function MainLayout() {
    const location = useLocation();
    const navigate = useNavigate();
    const { user: authUser, logout } = useAuthStore();
    const { hasPermission } = usePermissions();

    // Privileged users bypass explicit UI permission checks
    const isPrivilegedUser = authUser?.role === 'HR_MANAGER' || authUser?.role === 'ADMIN';
    const can = (perm: string) => isPrivilegedUser || hasPermission(perm);

    const jobsViewPermMap: Record<string, string> = {
      '/jobs/applications': 'jobs.applications.view_list',
      '/jobs/vacancies': 'jobs.vacancies.view_list',
      '/jobs/interviews': 'jobs.interviews.view_list',
      '/jobs/training-courses': 'jobs.training.view_list',
      '/jobs/public': 'jobs.vacancies.view_list',
    };
    const recordsViewPermMap: Record<string, string> = {
      '/clients': 'clients.view_list',
      '/candidates': 'candidates.view_list',
      '/employees': 'employees.view_list',
    };

    const visibleJobsChildren = jobsChildren.filter(child => {
      const perm = jobsViewPermMap[child.path];
      return !perm || can(perm);
    });
    const visibleRecordsChildren = recordsChildren.filter(child => {
      const perm = recordsViewPermMap[child.path];
      return !perm || can(perm);
    });

    function handleLogout() {
        logout();
        navigate('/login');
    }
    const isPlanningActive = location.pathname.startsWith('/planning');
    const isOperationsActive = location.pathname.startsWith('/tasks');
    const isContractsActive = location.pathname.startsWith('/contracts');
    const isGeoActive = location.pathname === '/geo' || location.pathname === '/routes';
    const isRecordsActive = visibleRecordsChildren.some(child => location.pathname.startsWith(child.path));
    const isAppointmentsActive = location.pathname.startsWith('/telemarketer');
    const isJobsActive = location.pathname.startsWith('/jobs');

    const [planningOpen, setPlanningOpen] = useState(isPlanningActive);
    const [operationsOpen, setOperationsOpen] = useState(isOperationsActive);
    const [geoOpen, setGeoOpen] = useState(isGeoActive);
    const [recordsOpen, setRecordsOpen] = useState(isRecordsActive);
    const [isMobileMenuOpen, setIsMobileMenuOpen] = useState(false);
    const [isCollapsed, setIsCollapsed] = useState(false);
    const [jobsOpen, setJobsOpen] = useState(isJobsActive);

    const toggleSidebar = () => setIsMobileMenuOpen(!isMobileMenuOpen);
    const toggleCollapse = () => setIsCollapsed(!isCollapsed);
    const [showEmergencyModal, setShowEmergencyModal] = useState(false);
    const [showCandidateModal, setShowCandidateModal] = useState(false);
    const [candidateInitialMode, setCandidateInitialMode] = useState(false);

    return (
        <div className="flex h-screen bg-slate-50 overflow-hidden">
            {/* Mobile Header */}
            <header className="lg:hidden fixed top-0 left-0 right-0 h-16 bg-white border-b border-slate-200 flex items-center justify-between px-4 z-30">
                <div className="flex items-center gap-3">
                    <div className="w-8 h-8 rounded-lg bg-sky-500 flex items-center justify-center shadow-lg shadow-sky-500/30">
                        <Gem className="w-4 h-4 text-white" />
                    </div>
                    <span className="text-lg font-bold text-slate-800">Golden Group</span>
                </div>
                <button
                    onClick={toggleSidebar}
                    className="p-2 rounded-lg text-slate-600 hover:bg-slate-100 transition-colors"
                >
                    {isMobileMenuOpen ? <CloseIcon className="w-6 h-6" /> : <Menu className="w-6 h-6" />}
                </button>
            </header>

            {/* Mobile Overlay */}
            <AnimatePresence>
                {isMobileMenuOpen && (
                    <motion.div
                        initial={{ opacity: 0 }}
                        animate={{ opacity: 1 }}
                        exit={{ opacity: 0 }}
                        onClick={() => setIsMobileMenuOpen(false)}
                        className="lg:hidden fixed inset-0 bg-slate-900/50 backdrop-blur-sm z-40"
                    />
                )}
            </AnimatePresence>

            {/* Sidebar */}
            <aside className={`
                fixed lg:static inset-y-0 right-0 ${isCollapsed ? 'lg:w-20' : 'lg:w-64'} w-64 bg-white border-l border-slate-200 flex flex-col z-50 shadow-sm flex-shrink-0 transition-all duration-300 transform
                ${isMobileMenuOpen ? 'translate-x-0' : 'translate-x-full lg:translate-x-0'}
            `}>
                {/* Logo & Toggle Header */}
                <div className="p-5 border-b border-slate-100 flex items-center justify-between">
                    <div className={`flex items-center gap-3 ${isCollapsed ? 'lg:hidden' : 'flex'} ${isMobileMenuOpen ? 'flex' : ''}`}>
                        <div className="w-8 h-8 rounded-lg bg-sky-500 flex items-center justify-center shadow-lg shadow-sky-500/30">
                            <Gem className="w-4 h-4 text-white" />
                        </div>
                        <span className="text-xl font-bold text-slate-800 tracking-wide">Golden Group</span>
                    </div>
                    {/* Desktop Collapse Toggle */}
                    <button
                        onClick={toggleCollapse}
                        className="hidden lg:flex p-1.5 rounded-lg hover:bg-slate-100 text-slate-400 hover:text-slate-600 transition-colors"
                    >
                        {isCollapsed ? <ChevronLeft className="w-5 h-5" /> : <ChevronRight className="w-5 h-5" />}
                    </button>
                    {/* Mobile Close Button */}
                    <button
                        onClick={() => setIsMobileMenuOpen(false)}
                        className="lg:hidden p-1.5 rounded-lg hover:bg-slate-100 text-slate-400 hover:text-slate-600 transition-colors"
                    >
                        <CloseIcon className="w-6 h-6" />
                    </button>
                </div>

                {/* Navigation */}
                <nav className="flex-1 overflow-y-auto py-6 px-3 space-y-1 mt-16 lg:mt-0">
                    {navItems.map(item => (
                        <NavLink
                            key={item.path}
                            to={item.path}
                            end={item.path === '/'}
                            onClick={() => setIsMobileMenuOpen(false)}
                            className={({ isActive }: { isActive: boolean }) =>
                                `w-full flex items-center gap-3 px-4 py-3 rounded-lg transition-all text-right ${isActive
                                    ? 'bg-sky-50 text-sky-600 border-r-4 border-sky-500 font-bold'
                                    : 'text-slate-600 hover:bg-slate-50 hover:text-slate-900'
                                } ${isCollapsed ? 'lg:justify-center lg:px-0 lg:border-r-0' : ''}`
                            }
                            title={isCollapsed ? item.label : ''}
                        >
                            <item.icon className={`w-5 h-5 ${isCollapsed ? 'lg:w-6 lg:h-6' : ''}`} />
                            <span className={`${isCollapsed ? 'lg:hidden' : 'block'}`}>{item.label}</span>
                        </NavLink>
                    ))}

                    {/* 1. Records Section */}
                    {visibleRecordsChildren.length > 0 && (
                    <div className={isCollapsed ? 'lg:hidden' : 'block'}>
                        <button
                            onClick={() => setRecordsOpen(o => !o)}
                            className={`w-full flex items-center gap-3 px-4 py-3 rounded-lg transition-all text-right ${isRecordsActive
                                ? 'bg-sky-50 text-sky-600 font-bold'
                                : 'text-slate-600 hover:bg-slate-50 hover:text-slate-900'
                                }`}
                        >
                            <BookUser className="w-5 h-5" />
                            <span className="flex-1">إدارة السجلات</span>
                            <motion.div animate={{ rotate: recordsOpen ? 180 : 0 }} transition={{ duration: 0.2 }}>
                                <ChevronDown className="w-3.5 h-3.5" />
                            </motion.div>
                        </button>

                        <AnimatePresence initial={false}>
                            {recordsOpen && (
                                <motion.div
                                    initial={{ height: 0, opacity: 0 }}
                                    animate={{ height: 'auto', opacity: 1 }}
                                    exit={{ height: 0, opacity: 0 }}
                                    className="overflow-hidden"
                                >
                                    {visibleRecordsChildren.map(child => (
                                        <NavLink
                                            key={child.path}
                                            to={child.path}
                                            onClick={() => setIsMobileMenuOpen(false)}
                                            className={({ isActive }: { isActive: boolean }) =>
                                                `w-full flex items-center gap-3 pr-12 pl-4 py-2.5 rounded-lg transition-all text-right text-sm ${isActive
                                                    ? 'text-sky-600 bg-sky-50 font-bold'
                                                    : 'text-slate-600 hover:bg-slate-50 hover:text-slate-900'
                                                }`
                                            }
                                        >
                                            <child.icon className="w-4 h-4" />
                                            <span>{child.label}</span>
                                        </NavLink>
                                    ))}
                                </motion.div>
                            )}
                        </AnimatePresence>
                    </div>
                    )}

                    {/* 2. Appointments (Separate Section) */}
                    {can('telemarketer.view') && (
                    <NavLink
                        to="/telemarketer"
                        onClick={() => setIsMobileMenuOpen(false)}
                        className={({ isActive }: { isActive: boolean }) =>
                            `w-full flex items-center gap-3 px-4 py-3 rounded-lg transition-all text-right ${isActive
                                ? 'bg-sky-50 text-sky-600 border-r-4 border-sky-500 font-bold'
                                : 'text-slate-600 hover:bg-slate-50 hover:text-slate-900'
                            } ${isCollapsed ? 'lg:justify-center lg:px-0 lg:border-r-0' : ''}`
                        }
                    >
                        <Headset className={`w-5 h-5 ${isCollapsed ? 'lg:w-6 lg:h-6' : ''}`} />
                        <span className={`${isCollapsed ? 'lg:hidden' : 'block'}`}>إدارة المواعيد</span>
                    </NavLink>
                    )}

                    {/* 3. Contracts (Single) */}
                    {can('contracts.view_list') && (
                    <NavLink
                        to="/contracts"
                        onClick={() => setIsMobileMenuOpen(false)}
                        className={({ isActive }: { isActive: boolean }) =>
                            `w-full flex items-center gap-3 px-4 py-3 rounded-lg transition-all text-right ${isActive
                                ? 'bg-sky-50 text-sky-600 border-r-4 border-sky-500 font-bold'
                                : 'text-slate-600 hover:bg-slate-50 hover:text-slate-900'
                            } ${isCollapsed ? 'lg:justify-center lg:px-0 lg:border-r-0' : ''}`
                        }
                    >
                        <FileText className={`w-5 h-5 ${isCollapsed ? 'lg:w-6 lg:h-6' : ''}`} />
                        <span className={`${isCollapsed ? 'lg:hidden' : 'block'}`}>إدارة العقود</span>
                    </NavLink>
                    )}

                    {/* 4. Devices (Single) */}
                    {can('devices.view') && (
                    <NavLink
                        to="/devices"
                        onClick={() => setIsMobileMenuOpen(false)}
                        className={({ isActive }: { isActive: boolean }) =>
                            `w-full flex items-center gap-3 px-4 py-3 rounded-lg transition-all text-right ${isActive
                                ? 'bg-sky-50 text-sky-600 border-r-4 border-sky-500 font-bold'
                                : 'text-slate-600 hover:bg-slate-50 hover:text-slate-900'
                            } ${isCollapsed ? 'lg:justify-center lg:px-0 lg:border-r-0' : ''}`
                        }
                    >
                        <Gem className={`w-5 h-5 ${isCollapsed ? 'lg:w-6 lg:h-6' : ''}`} />
                        <span className={`${isCollapsed ? 'lg:hidden' : 'block'}`}>إدارة الأجهزة وقطع الغيار</span>
                    </NavLink>
                    )}

                    {/* Jobs Section */}
                    {visibleJobsChildren.length > 0 && (
                    <div className={isCollapsed ? 'lg:hidden' : 'block'}>
                        <button
                            onClick={() => setJobsOpen(o => !o)}
                            className={`w-full flex items-center gap-3 px-4 py-3 rounded-lg transition-all text-right ${isJobsActive
                                ? 'bg-sky-50 text-sky-600 font-bold'
                                : 'text-slate-600 hover:bg-slate-50 hover:text-slate-900'
                                }`}
                        >
                            <BadgeCheck className="w-5 h-5" />
                            <span className="flex-1">إدارة التوظيف</span>
                            <motion.div animate={{ rotate: jobsOpen ? 180 : 0 }} transition={{ duration: 0.2 }}>
                                <ChevronDown className="w-3.5 h-3.5" />
                            </motion.div>
                        </button>

                        <AnimatePresence initial={false}>
                            {jobsOpen && (
                                <motion.div
                                    initial={{ height: 0, opacity: 0 }}
                                    animate={{ height: 'auto', opacity: 1 }}
                                    exit={{ height: 0, opacity: 0 }}
                                    className="overflow-hidden"
                                >
                                    {visibleJobsChildren.map(child => (
                                        <NavLink
                                            key={child.path}
                                            to={child.path}
                                            onClick={() => setIsMobileMenuOpen(false)}
                                            className={({ isActive }: { isActive: boolean }) =>
                                                `w-full flex items-center gap-3 pr-12 pl-4 py-2.5 rounded-lg transition-all text-right text-sm ${isActive
                                                    ? 'text-sky-600 bg-sky-50 font-bold'
                                                    : 'text-slate-600 hover:bg-slate-50 hover:text-slate-900'
                                                }`
                                            }
                                        >
                                            <child.icon className="w-4 h-4" />
                                            <span>{child.label}</span>
                                        </NavLink>
                                    ))}
                                </motion.div>
                            )}
                        </AnimatePresence>
                    </div>
                    )}

                    {/* 5. Branch Operations (formerly Planning) */}
                    {can('planning.view') && (
                    <div className={isCollapsed ? 'lg:hidden' : 'block'}>
                        <button
                            onClick={() => setPlanningOpen((o: boolean) => !o)}
                            className={`w-full flex items-center gap-3 px-4 py-3 rounded-lg transition-all text-right ${isPlanningActive
                                ? 'bg-sky-50 text-sky-600 font-bold'
                                : 'text-slate-600 hover:bg-slate-50 hover:text-slate-900'
                                }`}
                        >
                            <ClipboardList className="w-5 h-5" />
                            <span className="flex-1">إدارة عمل الفرع</span>
                            <motion.div animate={{ rotate: planningOpen ? 180 : 0 }} transition={{ duration: 0.2 }}>
                                <ChevronDown className="w-3.5 h-3.5" />
                            </motion.div>
                        </button>

                        <AnimatePresence initial={false}>
                            {planningOpen && (
                                <motion.div
                                    initial={{ height: 0, opacity: 0 }}
                                    animate={{ height: 'auto', opacity: 1 }}
                                    exit={{ height: 0, opacity: 0 }}
                                    className="overflow-hidden"
                                >
                                    {planningChildren.map(child => (
                                        <NavLink
                                            key={child.path}
                                            to={child.path}
                                            onClick={() => setIsMobileMenuOpen(false)}
                                            className={({ isActive }: { isActive: boolean }) =>
                                                `w-full flex items-center gap-3 pr-12 pl-4 py-2.5 rounded-lg transition-all text-right text-sm ${isActive
                                                    ? 'text-sky-600 bg-sky-50 font-bold'
                                                    : 'text-slate-600 hover:bg-slate-50 hover:text-slate-900'
                                                }`
                                            }
                                        >
                                            <child.icon className="w-4 h-4" />
                                            <span>{child.label}</span>
                                        </NavLink>
                                    ))}
                                </motion.div>
                            )}
                        </AnimatePresence>
                    </div>
                    )}

                    {/* 6. Tasks & Operations */}
                    {can('tasks.view') && (
                    <div className={isCollapsed ? 'lg:hidden' : 'block'}>
                        <button
                            onClick={() => setOperationsOpen((o: boolean) => !o)}
                            className={`w-full flex items-center gap-3 px-4 py-3 rounded-lg transition-all text-right ${isOperationsActive
                                ? 'bg-sky-50 text-sky-600 font-bold'
                                : 'text-slate-600 hover:bg-slate-50 hover:text-slate-900'
                                }`}
                        >
                            <Briefcase className="w-5 h-5" />
                            <span className="flex-1">العمليات والمهام</span>
                            <motion.div animate={{ rotate: operationsOpen ? 180 : 0 }} transition={{ duration: 0.2 }}>
                                <ChevronDown className="w-3.5 h-3.5" />
                            </motion.div>
                        </button>

                        <AnimatePresence initial={false}>
                            {operationsOpen && (
                                <motion.div
                                    initial={{ height: 0, opacity: 0 }}
                                    animate={{ height: 'auto', opacity: 1 }}
                                    exit={{ height: 0, opacity: 0 }}
                                    className="overflow-hidden"
                                >
                                    {operationsChildren.map(child => (
                                        <NavLink
                                            key={child.path}
                                            to={child.path}
                                            onClick={() => setIsMobileMenuOpen(false)}
                                            className={({ isActive }: { isActive: boolean }) =>
                                                `w-full flex items-center gap-3 pr-12 pl-4 py-2.5 rounded-lg transition-all text-right text-sm ${isActive
                                                    ? 'text-sky-600 bg-sky-50 font-bold'
                                                    : 'text-slate-600 hover:bg-slate-50 hover:text-slate-900'
                                                }`
                                            }
                                        >
                                            <child.icon className="w-4 h-4" />
                                            <span>{child.label}</span>
                                        </NavLink>
                                    ))}
                                </motion.div>
                            )}
                        </AnimatePresence>
                    </div>
                    )}

                    {/* 7. Geo Section (Moved above Settings) */}
                    {can('geo.view') && (
                    <div className={isCollapsed ? 'lg:hidden' : 'block'}>
                        <button
                            onClick={() => setGeoOpen(o => !o)}
                            className={`w-full flex items-center gap-3 px-4 py-3 rounded-lg transition-all text-right ${isGeoActive
                                ? 'bg-sky-50 text-sky-600 font-bold'
                                : 'text-slate-600 hover:bg-slate-50 hover:text-slate-900'
                                }`}
                        >
                            <MapPinned className="w-5 h-5" />
                            <span className="flex-1">إدارة المناطق الجغرافية</span>
                            <motion.div animate={{ rotate: geoOpen ? 180 : 0 }} transition={{ duration: 0.2 }}>
                                <ChevronDown className="w-3.5 h-3.5" />
                            </motion.div>
                        </button>

                        <AnimatePresence initial={false}>
                            {geoOpen && (
                                <motion.div
                                    initial={{ height: 0, opacity: 0 }}
                                    animate={{ height: 'auto', opacity: 1 }}
                                    exit={{ height: 0, opacity: 0 }}
                                    className="overflow-hidden"
                                >
                                    {geoChildren.map(child => (
                                        <NavLink
                                            key={child.path}
                                            to={child.path}
                                            onClick={() => setIsMobileMenuOpen(false)}
                                            className={({ isActive }: { isActive: boolean }) =>
                                                `w-full flex items-center gap-3 pr-12 pl-4 py-2.5 rounded-lg transition-all text-right text-sm ${isActive
                                                    ? 'text-sky-600 bg-sky-50 font-bold'
                                                    : 'text-slate-600 hover:bg-slate-50 hover:text-slate-900'
                                                }`
                                            }
                                        >
                                            <child.icon className="w-4 h-4" />
                                            <span>{child.label}</span>
                                        </NavLink>
                                    ))}
                                </motion.div>
                            )}
                        </AnimatePresence>
                    </div>
                    )}

                    {/* 8. Branches */}
                    {can('branches.view') && (
                    <NavLink
                        to="/branches"
                        onClick={() => setIsMobileMenuOpen(false)}
                        className={({ isActive }: { isActive: boolean }) =>
                            `w-full flex items-center gap-3 px-4 py-3 rounded-lg transition-all text-right ${isActive
                                ? 'bg-sky-50 text-sky-600 border-r-4 border-sky-500 font-bold'
                                : 'text-slate-600 hover:bg-slate-50 hover:text-slate-900'
                            } ${isCollapsed ? 'lg:justify-center lg:px-0 lg:border-r-0' : ''}`
                        }
                    >
                        <Building2 className={`w-5 h-5 ${isCollapsed ? 'lg:w-6 lg:h-6' : ''}`} />
                        <span className={`${isCollapsed ? 'lg:hidden' : 'block'}`}>إدارة الفروع</span>
                    </NavLink>
                    )}

                    {/* 9. System Lists */}
                    {can('admin.system_lists.view') && (
                        <NavLink
                            to="/system-lists"
                            onClick={() => setIsMobileMenuOpen(false)}
                            className={({ isActive }: { isActive: boolean }) =>
                                `w-full flex items-center gap-3 px-4 py-3 rounded-lg transition-all text-right ${isActive
                                    ? 'bg-sky-50 text-sky-600 border-r-4 border-sky-500 font-bold'
                                    : 'text-slate-600 hover:bg-slate-50 hover:text-slate-900'
                                } ${isCollapsed ? 'lg:justify-center lg:px-0 lg:border-r-0' : ''}`
                            }
                        >
                            <SlidersHorizontal className={`w-5 h-5 ${isCollapsed ? 'lg:w-6 lg:h-6' : ''}`} />
                            <span className={`${isCollapsed ? 'lg:hidden' : 'block'}`}>إدارة القوائم</span>
                        </NavLink>
                    )}

                    {/* 10. Roles & Permissions */}
                    {can('admin.roles.view') && (
                        <NavLink
                            to="/admin/roles"
                            onClick={() => setIsMobileMenuOpen(false)}
                            className={({ isActive }: { isActive: boolean }) =>
                                `w-full flex items-center gap-3 px-4 py-3 rounded-lg transition-all text-right ${isActive
                                    ? 'bg-sky-50 text-sky-600 border-r-4 border-sky-500 font-bold'
                                    : 'text-slate-600 hover:bg-slate-50 hover:text-slate-900'
                                } ${isCollapsed ? 'lg:justify-center lg:px-0 lg:border-r-0' : ''}`
                            }
                        >
                            <ShieldCheck className={`w-5 h-5 ${isCollapsed ? 'lg:w-6 lg:h-6' : ''}`} />
                            <span className={`${isCollapsed ? 'lg:hidden' : 'block'}`}>الأدوار والصلاحيات</span>
                        </NavLink>
                    )}

                    {/* 11. System Settings (At Bottom) */}
                    {can('settings.view') && (
                    <NavLink
                        to="/settings"
                        onClick={() => setIsMobileMenuOpen(false)}
                        className={({ isActive }: { isActive: boolean }) =>
                            `w-full flex items-center gap-3 px-4 py-3 rounded-lg transition-all text-right ${isActive
                                ? 'bg-sky-50 text-sky-600 border-r-4 border-sky-500 font-bold'
                                : 'text-slate-600 hover:bg-slate-50 hover:text-slate-900'
                            } ${isCollapsed ? 'lg:justify-center lg:px-0 lg:border-r-0' : ''}`
                        }
                    >
                        <Settings className={`w-5 h-5 ${isCollapsed ? 'lg:w-6 lg:h-6' : ''}`} />
                        <span className={`${isCollapsed ? 'lg:hidden' : 'block'}`}>إعدادات النظام</span>
                    </NavLink>
                    )}


                </nav>

                {/* User Profile */}
                <div className="p-4 border-t border-slate-200 bg-slate-50/50">
                    <div className={`flex items-center gap-3 p-2 rounded-lg ${isCollapsed ? 'lg:justify-center lg:px-0' : ''}`}>
                        <div className="relative">
                            <img
                                src={`https://ui-avatars.com/api/?name=${encodeURIComponent(authUser?.name || 'HR')}&background=0ea5e9&color=fff`}
                                alt="User"
                                className="w-10 h-10 rounded-full border border-slate-200"
                            />
                            <div className="absolute -bottom-0.5 -left-0.5 w-3.5 h-3.5 bg-emerald-500 rounded-full border-2 border-white" />
                        </div>
                        <div className={`flex-1 min-w-0 ${isCollapsed ? 'lg:hidden' : 'block'}`}>
                            <p className="text-sm font-semibold text-slate-700 truncate">{authUser?.name || '—'}</p>
                            <p className="text-xs text-slate-500 truncate">
                                {authUser?.role === 'ADMIN'
                                  ? 'مدير النظام'
                                  : authUser?.role === 'HR_MANAGER'
                                    ? 'مدير الموارد البشرية'
                                    : 'مساعد الموارد البشرية'}
                            </p>
                        </div>
                        <button
                            onClick={handleLogout}
                            title="تسجيل الخروج"
                            className={`p-1.5 rounded-lg hover:bg-red-50 hover:text-red-500 text-slate-400 transition-colors ${isCollapsed ? 'lg:hidden' : ''}`}
                        >
                            <LogOut className="w-4 h-4" />
                        </button>
                    </div>
                </div>
            </aside>

            {/* Main Content */}
            <main className="flex-1 overflow-hidden bg-slate-50 mt-16 lg:mt-0">
                <Outlet />
            </main>

            {/* Global FAB */}
            <FloatingActionButton
                onEmergencyClick={() => setShowEmergencyModal(true)}
                onAddSuggested={() => {
                    setCandidateInitialMode(false);
                    setShowCandidateModal(true);
                }}
                onAddCandidate={() => {
                    setCandidateInitialMode(true);
                    setShowCandidateModal(true);
                }}
            />

            {/* Emergency Ticket Modal */}
            <NewEmergencyTicketModal
                isOpen={showEmergencyModal}
                onClose={() => setShowEmergencyModal(false)}
            />

            {/* Add Candidate Modal */}
            <AddCandidateModal
                isOpen={showCandidateModal}
                onClose={() => setShowCandidateModal(false)}
                initialDirectMode={candidateInitialMode}
            />
        </div>
    );
}
