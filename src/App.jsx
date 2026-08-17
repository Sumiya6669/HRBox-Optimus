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

function AppRoutes() {
  return (
    <Suspense fallback={<BrandLoader />}>
      <Routes>
        {/* Публичная зона: вход и опубликованные CMS-страницы */}
        <Route path="/login" element={<Login />} />
        <Route path="/reset-password" element={<ResetPassword />} />

        {/* Портал — только для аутентифицированных (BUG-001) */}
        <Route element={<RequireAuth />}>
          <Route element={<PortalShell />}>
            <Route path="/" element={<CompanyHome />} />
            <Route path="/search" element={<SearchResults />} />

            {/* Личный кабинет */}
            <Route path="/cabinet" element={<CabinetDashboard />} />
            <Route path="/cabinet/news" element={<CabinetNews />} />
            <Route path="/cabinet/news/:id" element={<NewsDetail />} />
            <Route path="/cabinet/learning" element={<CabinetLearning />} />
            <Route path="/cabinet/learning/:id" element={<CourseDetail />} />
            <Route path="/cabinet/development" element={<CabinetDevelopment />} />
            <Route path="/cabinet/requests" element={<CabinetRequests />} />
            <Route path="/cabinet/requests/:id" element={<RequestDetail />} />
            <Route path="/cabinet/surveys" element={<CabinetSurveys />} />
            <Route path="/cabinet/feedback" element={<CabinetFeedback />} />
            <Route path="/cabinet/goals" element={<CabinetGoals />} />
            <Route path="/cabinet/kpi" element={<CabinetKPI />} />
            <Route path="/cabinet/vacation" element={<CabinetVacation />} />
            <Route path="/cabinet/calendar" element={<CabinetCalendar />} />
            <Route path="/cabinet/documents" element={<CabinetDocuments />} />
            <Route path="/cabinet/wallet" element={<CabinetWallet />} />
            <Route path="/cabinet/library" element={<CabinetLibrary />} />
            <Route path="/cabinet/library/:id" element={<BookDetail />} />
            {/* BUG-071: магазин наград — один модуль, вкладка кошелька ведёт сюда же */}
            <Route path="/cabinet/store" element={<CabinetStore />} />
            <Route path="/cabinet/favorites" element={<CabinetFavorites />} />
            <Route path="/cabinet/files" element={<CabinetFiles />} />
            <Route path="/cabinet/notifications" element={<CabinetNotifications />} />
            <Route path="/cabinet/profile" element={<CabinetProfile />} />
            {/* Карточка коллеги: глобальный поиск раньше вёл на /admin/employees/:id — маршрут за ролью HR */}
            <Route path="/cabinet/people/:id" element={<PersonCard />} />

            {/* Администрирование: доступно HR и администратору */}
            <Route element={<RequireAuth roles={ROLES.HR} />}>
              <Route path="/admin" element={<AdminHome />} />
              <Route path="/admin/employees" element={<AdminEmployees />} />
              <Route path="/admin/employees/:id" element={<AdminEmployeeDetail />} />
              <Route path="/admin/departments" element={<AdminDepartments />} />
              <Route path="/admin/news" element={<AdminNews />} />
              <Route path="/admin/pages" element={<AdminPages />} />
              <Route path="/admin/files" element={<AdminFiles />} />
              <Route path="/admin/courses" element={<AdminCourses />} />
              <Route path="/admin/library" element={<AdminLibrary />} />
              <Route path="/admin/achievements" element={<AdminAchievements />} />
              <Route path="/admin/store" element={<AdminStore />} />
              <Route path="/admin/wallet" element={<AdminWallet />} />
              <Route path="/admin/wallet-reports" element={<AdminWalletReports />} />
              <Route path="/admin/award-reasons" element={<AdminAwardReasons />} />
              <Route path="/admin/surveys" element={<AdminSurveys />} />
              <Route path="/admin/survey-sessions" element={<AdminSurveySessions />} />
              <Route path="/admin/survey-auto" element={<AdminAutoSurveys />} />
              <Route path="/admin/survey-reports" element={<AdminSurveyReports />} />
              <Route path="/admin/vacation" element={<AdminVacation />} />
            </Route>

            {/* Только администратор */}
            <Route element={<RequireAuth roles={ROLES.ADMIN} />}>
              <Route path="/admin/users" element={<AdminUsers />} />
              {/* BUG-071: «Приглашения» дублировали «Пользователей» — модули схлопнуты */}
              <Route path="/admin/invitations" element={<Navigate to="/admin/users?tab=invitations" replace />} />
              <Route path="/admin/settings" element={<AdminSettings />} />
              <Route path="/admin/audit" element={<AdminAudit />} />
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
