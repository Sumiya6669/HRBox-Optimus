import React, { Suspense, lazy } from 'react';
import { BrowserRouter as Router, Route, Routes, Navigate } from 'react-router-dom';
import { QueryClientProvider } from '@tanstack/react-query';

import { Toaster } from '@/components/ui/toaster';
import { queryClientInstance } from '@/lib/query-client';
import { AuthProvider, ROLES } from '@/lib/AuthContext';
import { I18nProvider } from '@/lib/i18n';
import RequireAuth from '@/components/RequireAuth';
import BrandLoader from '@/components/common/BrandLoader';
import PageNotFound from '@/lib/PageNotFound';

/*
 * ЭТАП 6 аудита: бандл был 1,18 МБ одним чанком на 45 маршрутов.
 * Все страницы грузятся лениво — в первый экран попадает только оболочка.
 */
const PortalShell = lazy(() => import('@/components/layout/PortalShell'));
const Login = lazy(() => import('@/pages/auth/Login'));
const ResetPassword = lazy(() => import('@/pages/auth/ResetPassword'));
const AcceptInvite = lazy(() => import('@/pages/auth/AcceptInvite'));

const CompanyHome = lazy(() => import('@/pages/company/CompanyHome'));
const CmsPage = lazy(() => import('@/pages/company/CmsPage'));
const SearchResults = lazy(() => import('@/pages/SearchResults'));

const CabinetDashboard = lazy(() => import('@/pages/cabinet/CabinetDashboard'));
const CabinetNews = lazy(() => import('@/pages/cabinet/CabinetNews'));
const NewsDetail = lazy(() => import('@/pages/cabinet/NewsDetail'));
const CabinetLearning = lazy(() => import('@/pages/cabinet/CabinetLearning'));
const CourseDetail = lazy(() => import('@/pages/cabinet/CourseDetail'));
const CabinetDevelopment = lazy(() => import('@/pages/cabinet/CabinetDevelopment'));
const CabinetRequests = lazy(() => import('@/pages/cabinet/CabinetRequests'));
const RequestDetail = lazy(() => import('@/pages/cabinet/RequestDetail'));
const CabinetSurveys = lazy(() => import('@/pages/cabinet/CabinetSurveys'));
const CabinetFeedback = lazy(() => import('@/pages/cabinet/CabinetFeedback'));
const CabinetGoals = lazy(() => import('@/pages/cabinet/CabinetGoals'));
const CabinetKPI = lazy(() => import('@/pages/cabinet/CabinetKPI'));
const CabinetVacation = lazy(() => import('@/pages/cabinet/CabinetVacation'));
const CabinetCalendar = lazy(() => import('@/pages/cabinet/CabinetCalendar'));
const CabinetDocuments = lazy(() => import('@/pages/cabinet/CabinetDocuments'));
const CabinetWallet = lazy(() => import('@/pages/cabinet/CabinetWallet'));
const CabinetLibrary = lazy(() => import('@/pages/cabinet/CabinetLibrary'));
const BookDetail = lazy(() => import('@/pages/cabinet/BookDetail'));
const CabinetStore = lazy(() => import('@/pages/cabinet/CabinetStore'));
const CabinetFavorites = lazy(() => import('@/pages/cabinet/CabinetFavorites'));
const CabinetFiles = lazy(() => import('@/pages/cabinet/CabinetFiles'));
const CabinetNotifications = lazy(() => import('@/pages/cabinet/CabinetNotifications'));
const CabinetProfile = lazy(() => import('@/pages/cabinet/CabinetProfile'));
const PersonCard = lazy(() => import('@/pages/cabinet/PersonCard'));
const ProcessCatalog = lazy(() => import('@/pages/cabinet/ProcessCatalog'));
const ProcessRequestForm = lazy(() => import('@/pages/cabinet/ProcessRequestForm'));
const ProcessRequests = lazy(() => import('@/pages/cabinet/ProcessRequests'));
const ProcessRequestDetail = lazy(() => import('@/pages/cabinet/ProcessRequestDetail'));

const AdminHome = lazy(() => import('@/pages/admin/AdminHome'));
const AdminUsers = lazy(() => import('@/pages/admin/AdminUsers'));
const AdminEmployees = lazy(() => import('@/pages/admin/AdminEmployees'));
const AdminEmployeeDetail = lazy(() => import('@/pages/admin/AdminEmployeeDetail'));
const AdminDepartments = lazy(() => import('@/pages/admin/AdminDepartments'));
const AdminNews = lazy(() => import('@/pages/admin/AdminNews'));
const AdminPages = lazy(() => import('@/pages/admin/AdminPages'));
const AdminFiles = lazy(() => import('@/pages/admin/AdminFiles'));
const AdminCourses = lazy(() => import('@/pages/admin/AdminCourses'));
const AdminLibrary = lazy(() => import('@/pages/admin/AdminLibrary'));
const AdminAchievements = lazy(() => import('@/pages/admin/AdminAchievements'));
const AdminStore = lazy(() => import('@/pages/admin/AdminStore'));
const AdminWallet = lazy(() => import('@/pages/admin/AdminWallet'));
const AdminWalletReports = lazy(() => import('@/pages/admin/AdminWalletReports'));
const AdminAwardReasons = lazy(() => import('@/pages/admin/AdminAwardReasons'));
const AdminSurveys = lazy(() => import('@/pages/admin/AdminSurveys'));
const AdminSurveySessions = lazy(() => import('@/pages/admin/AdminSurveySessions'));
const AdminAutoSurveys = lazy(() => import('@/pages/admin/AdminAutoSurveys'));
const AdminSurveyReports = lazy(() => import('@/pages/admin/AdminSurveyReports'));
const AdminVacation = lazy(() => import('@/pages/admin/AdminVacation'));
const AdminSettings = lazy(() => import('@/pages/admin/AdminSettings'));
const AdminAudit = lazy(() => import('@/pages/admin/AdminAudit'));
const AdminProcesses = lazy(() => import('@/pages/admin/AdminProcesses'));
const AdminProcessBuilder = lazy(() => import('@/pages/admin/AdminProcessBuilder'));
const AdminProcessRequests = lazy(() => import('@/pages/admin/AdminProcessRequests'));
const AdminAchievementRules = lazy(() => import('@/pages/admin/AdminAchievementRules'));
const AdminPermissions = lazy(() => import('@/pages/admin/AdminPermissions'));
const AdminCourseBuilder = lazy(() => import('@/pages/admin/AdminCourseBuilder'));
const TestRunner = lazy(() => import('@/pages/cabinet/TestRunner'));

/**
 * Маршрут с проверкой раздела.
 *
 * Проверять доступ только в меню недостаточно: скрытый пункт не закрывает
 * страницу — адрес можно набрать руками. Поэтому каждый экран портала обёрнут
 * гейтом с ключом раздела из src/lib/sections.js, и меню с роутером опираются
 * на один и тот же источник правды.
 */
const gate = (section, element) => <RequireAuth section={section}>{element}</RequireAuth>;

function AppRoutes() {
  return (
    <Suspense fallback={<BrandLoader />}>
      <Routes>
        {/* Публичная зона: вход и опубликованные CMS-страницы */}
        <Route path="/login" element={<Login />} />
        <Route path="/reset-password" element={<ResetPassword />} />
        {/* Регистрация по ссылке-приглашению — до входа в систему */}
        <Route path="/invite/:token" element={<AcceptInvite />} />

        {/* Портал — только для аутентифицированных (BUG-001) */}
        <Route element={<RequireAuth />}>
          {/*
            Тест идёт БЕЗ оболочки портала: во время проверки знаний боковое меню
            только отвлекает, а уход по случайной ссылке стоил бы человеку попытки.
          */}
          <Route path="/cabinet/learning/:id/test" element={gate('cabinet.learning', <TestRunner />)} />

          <Route element={<PortalShell />}>
            <Route path="/" element={<CompanyHome />} />
            <Route path="/search" element={<SearchResults />} />

            {/* Личный кабинет */}
            <Route path="/cabinet" element={gate('cabinet.dashboard', <CabinetDashboard />)} />
            <Route path="/cabinet/news" element={gate('cabinet.news', <CabinetNews />)} />
            <Route path="/cabinet/news/:id" element={gate('cabinet.news', <NewsDetail />)} />
            <Route path="/cabinet/learning" element={gate('cabinet.learning', <CabinetLearning />)} />
            <Route path="/cabinet/learning/:id" element={gate('cabinet.learning', <CourseDetail />)} />
            <Route path="/cabinet/development" element={gate('cabinet.development', <CabinetDevelopment />)} />
            <Route path="/cabinet/requests" element={gate('cabinet.requests', <CabinetRequests />)} />
            <Route path="/cabinet/requests/:id" element={gate('cabinet.requests', <RequestDetail />)} />
            <Route path="/cabinet/surveys" element={gate('cabinet.surveys', <CabinetSurveys />)} />
            <Route path="/cabinet/feedback" element={gate('cabinet.feedback', <CabinetFeedback />)} />
            <Route path="/cabinet/goals" element={gate('cabinet.goals', <CabinetGoals />)} />
            <Route path="/cabinet/kpi" element={gate('cabinet.kpi', <CabinetKPI />)} />
            <Route path="/cabinet/vacation" element={gate('cabinet.vacation', <CabinetVacation />)} />
            <Route path="/cabinet/calendar" element={gate('cabinet.calendar', <CabinetCalendar />)} />
            <Route path="/cabinet/documents" element={gate('cabinet.documents', <CabinetDocuments />)} />
            <Route path="/cabinet/wallet" element={gate('cabinet.wallet', <CabinetWallet />)} />
            <Route path="/cabinet/library" element={gate('cabinet.library', <CabinetLibrary />)} />
            <Route path="/cabinet/library/:id" element={gate('cabinet.library', <BookDetail />)} />
            {/* BUG-071: магазин наград — один модуль, вкладка кошелька ведёт сюда же */}
            <Route path="/cabinet/store" element={gate('cabinet.store', <CabinetStore />)} />
            <Route path="/cabinet/favorites" element={gate('cabinet.favorites', <CabinetFavorites />)} />
            <Route path="/cabinet/files" element={gate('cabinet.files', <CabinetFiles />)} />
            <Route path="/cabinet/notifications" element={gate('cabinet.notifications', <CabinetNotifications />)} />
            <Route path="/cabinet/profile" element={gate('cabinet.profile', <CabinetProfile />)} />
            {/* Карточка коллеги: глобальный поиск раньше вёл на /admin/employees/:id — маршрут за ролью HR */}
            <Route path="/cabinet/people/:id" element={<PersonCard />} />

            {/* Процессы: каталог, подача заявки, мои заявки и очередь согласования */}
            <Route path="/cabinet/processes" element={gate('cabinet.processes', <ProcessCatalog />)} />
            <Route path="/cabinet/processes/requests" element={gate('cabinet.processes', <ProcessRequests />)} />
            <Route path="/cabinet/processes/requests/:id" element={gate('cabinet.processes', <ProcessRequestDetail />)} />
            <Route path="/cabinet/processes/:processId" element={gate('cabinet.processes', <ProcessRequestForm />)} />

            {/* Администрирование: доступно HR и администратору */}
            <Route element={<RequireAuth roles={ROLES.HR} />}>
              <Route path="/admin" element={gate('admin.overview', <AdminHome />)} />
              <Route path="/admin/employees" element={gate('admin.employees', <AdminEmployees />)} />
              <Route path="/admin/employees/:id" element={gate('admin.employees', <AdminEmployeeDetail />)} />
              <Route path="/admin/departments" element={gate('admin.departments', <AdminDepartments />)} />
              <Route path="/admin/news" element={gate('admin.news', <AdminNews />)} />
              <Route path="/admin/pages" element={gate('admin.pages', <AdminPages />)} />
              <Route path="/admin/files" element={gate('admin.files', <AdminFiles />)} />
              <Route path="/admin/courses" element={gate('admin.courses', <AdminCourses />)} />
              {/* Конструктор курса: уроки, видео и итоговый тест */}
              <Route path="/admin/courses/:id" element={gate('admin.courses', <AdminCourseBuilder />)} />
              <Route path="/admin/library" element={gate('admin.library', <AdminLibrary />)} />
              <Route path="/admin/achievements" element={gate('admin.achievements', <AdminAchievements />)} />
              <Route path="/admin/store" element={gate('admin.store', <AdminStore />)} />
              <Route path="/admin/wallet" element={gate('admin.wallet', <AdminWallet />)} />
              <Route path="/admin/wallet-reports" element={gate('admin.wallet_reports', <AdminWalletReports />)} />
              <Route path="/admin/award-reasons" element={gate('admin.award_reasons', <AdminAwardReasons />)} />
              <Route path="/admin/surveys" element={gate('admin.surveys', <AdminSurveys />)} />
              <Route path="/admin/survey-sessions" element={gate('admin.survey_sessions', <AdminSurveySessions />)} />
              <Route path="/admin/survey-auto" element={gate('admin.survey_auto', <AdminAutoSurveys />)} />
              <Route path="/admin/survey-reports" element={gate('admin.survey_reports', <AdminSurveyReports />)} />
              <Route path="/admin/vacation" element={gate('admin.vacation', <AdminVacation />)} />
              {/* Конструктор бизнес-процессов */}
              <Route path="/admin/processes" element={gate('admin.processes', <AdminProcesses />)} />
              <Route path="/admin/processes/:id" element={gate('admin.processes', <AdminProcessBuilder />)} />
              <Route path="/admin/process-requests" element={gate('admin.process_requests', <AdminProcessRequests />)} />
              <Route path="/admin/achievement-rules" element={gate('admin.achievement_rules', <AdminAchievementRules />)} />
            </Route>

            {/* Только администратор */}
            <Route element={<RequireAuth roles={ROLES.ADMIN} />}>
              <Route path="/admin/users" element={gate('admin.users', <AdminUsers />)} />
              {/* BUG-071: «Приглашения» дублировали «Пользователей» — модули схлопнуты */}
              <Route path="/admin/invitations" element={<Navigate to="/admin/users?tab=invitations" replace />} />
              {/* Настройка прав ролей на разделы */}
              <Route path="/admin/permissions" element={gate('admin.permissions', <AdminPermissions />)} />
              <Route path="/admin/settings" element={gate('admin.settings', <AdminSettings />)} />
              <Route path="/admin/audit" element={gate('admin.audit', <AdminAudit />)} />
            </Route>

            {/* BUG-008: CMS-страницы больше не отдают 404 */}
            <Route path="/:slug" element={<CmsPage />} />
            {/* BUG-066: 404 сохраняет layout портала */}
            <Route path="*" element={<PageNotFound />} />
          </Route>
        </Route>
      </Routes>
    </Suspense>
  );
}

export default function App() {
  return (
    <QueryClientProvider client={queryClientInstance}>
      <Router>
        <AuthProvider>
          <I18nProvider>
            <AppRoutes />
          </I18nProvider>
        </AuthProvider>
      </Router>
      <Toaster />
    </QueryClientProvider>
  );
}
