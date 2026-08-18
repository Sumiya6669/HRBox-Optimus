import React, { useState, useMemo, useEffect, useRef } from "react";
import { Link, useLocation, useNavigate, Outlet } from "react-router-dom";
import { useQuery, useQueryClient, useMutation } from "@tanstack/react-query";
import {
  LayoutDashboard, User, Settings, Search, Bell, LogOut, Menu, X, ChevronDown,
  Briefcase, GraduationCap, Target, TrendingUp, CalendarDays, Wallet, BookOpen,
  Award, FileText, Star, FolderOpen, Newspaper, BarChart3, Users, Building2, Workflow, Inbox,
  MessageSquare, Zap, Store, ClipboardList, ScrollText, PanelLeftClose,
  PanelLeftOpen, Layers, FileBarChart, Loader2, CheckCheck, CornerDownLeft, ShieldCheck,
} from "lucide-react";

import { api } from "@/api/client";
import { cn } from "@/lib/utils";
import OptimusLogo from "@/components/common/OptimusLogo";
import SafeImage from "@/components/common/SafeImage";
import { useI18n } from "@/lib/i18n";
import { useAuth, ROLES } from "@/lib/AuthContext";
import { initials, formatRelative } from "@/lib/format";

const ZONES = [
  { id: "company", label: "zone_company", icon: LayoutDashboard, path: "/", role: null },
  { id: "cabinet", label: "zone_cabinet", icon: User, path: "/cabinet", role: null },
  { id: "admin", label: "zone_admin", icon: Settings, path: "/admin", role: ROLES.HR },
];

/**
 * BUG-078: семь страниц кабинета были недостижимы из меню — только прямым вводом URL.
 * Теперь в навигации присутствуют все реализованные разделы, сгруппированные по смыслу.
 * BUG-071: «Приглашения» схлопнуты в «Пользователей», магазин наград — один пункт.
 */
const NAV = {
  company: [
    { label: "dashboard", path: "/", perm: "company.home", icon: LayoutDashboard },
    { label: "nav_page_about", path: "/about", perm: "company.home", icon: Building2 },
    { label: "nav_page_vacation_policy", path: "/vacation-policy", perm: "company.home", icon: CalendarDays },
    { label: "nav_page_ethics", path: "/ethics", perm: "company.home", icon: ScrollText },
  ],
  cabinet: [
    { label: "dashboard", path: "/cabinet", perm: "cabinet.dashboard", icon: LayoutDashboard },
    { section: "section_my_work" },
    { label: "nav_requests", path: "/cabinet/requests", perm: "cabinet.requests", icon: ClipboardList },
    { label: "nav_processes", path: "/cabinet/processes", perm: "cabinet.processes", icon: Workflow },
    { label: "nav_my_process_requests", path: "/cabinet/processes/requests", perm: "cabinet.processes", icon: Inbox },
    { label: "nav_goals", path: "/cabinet/goals", perm: "cabinet.goals", icon: Target },
    { label: "nav_kpi", path: "/cabinet/kpi", perm: "cabinet.kpi", icon: Zap },
    { label: "nav_development", path: "/cabinet/development", perm: "cabinet.development", icon: TrendingUp },
    { label: "nav_vacation", path: "/cabinet/vacation", perm: "cabinet.vacation", icon: CalendarDays },
    { section: "section_knowledge" },
    { label: "learning", path: "/cabinet/learning", perm: "cabinet.learning", icon: GraduationCap },
    { label: "nav_library", path: "/cabinet/library", perm: "cabinet.library", icon: BookOpen },
    { label: "nav_hr_documents", path: "/cabinet/documents", perm: "cabinet.documents", icon: FileText },
    { label: "nav_files", path: "/cabinet/files", perm: "cabinet.files", icon: FolderOpen },
    { section: "section_company_life" },
    { label: "nav_news", path: "/cabinet/news", perm: "cabinet.news", icon: Newspaper },
    { label: "nav_calendar", path: "/cabinet/calendar", perm: "cabinet.calendar", icon: CalendarDays },
    { label: "nav_surveys", path: "/cabinet/surveys", perm: "cabinet.surveys", icon: BarChart3 },
    { label: "nav_feedback", path: "/cabinet/feedback", perm: "cabinet.feedback", icon: MessageSquare },
    { section: "section_recognition" },
    { label: "nav_wallet", path: "/cabinet/wallet", perm: "cabinet.wallet", icon: Wallet },
    { label: "nav_store", path: "/cabinet/store", perm: "cabinet.store", icon: Store },
    { section: "section_personal" },
    { label: "nav_favorites", path: "/cabinet/favorites", perm: "cabinet.favorites", icon: Star },
    { label: "nav_notifications", path: "/cabinet/notifications", perm: "cabinet.notifications", icon: Bell, badgeKey: "notifications" },
    { label: "nav_profile", path: "/cabinet/profile", perm: "cabinet.profile", icon: Settings },
  ],
  admin: [
    { label: "nav_overview", path: "/admin", perm: "admin.overview", icon: LayoutDashboard },
    { section: "section_hr" },
    { label: "employees", path: "/admin/employees", perm: "admin.employees", icon: Briefcase },
    { label: "nav_departments", path: "/admin/departments", perm: "admin.departments", icon: Building2 },
    { label: "nav_users", path: "/admin/users", perm: "admin.users", icon: Users, role: ROLES.ADMIN },
    { label: "nav_permissions", path: "/admin/permissions", perm: "admin.permissions", icon: ShieldCheck, role: ROLES.ADMIN },
    { section: "section_content" },
    { label: "nav_news", path: "/admin/news", perm: "admin.news", icon: Newspaper },
    { label: "nav_pages", path: "/admin/pages", perm: "admin.pages", icon: FileText },
    { label: "nav_files", path: "/admin/files", perm: "admin.files", icon: FolderOpen },
    { section: "section_learning" },
    { label: "nav_courses", path: "/admin/courses", perm: "admin.courses", icon: GraduationCap },
    { label: "nav_library", path: "/admin/library", perm: "admin.library", icon: BookOpen },
    { section: "section_processes" },
    { label: "nav_process_setup", path: "/admin/processes", perm: "admin.processes", icon: Workflow },
    { label: "nav_process_requests", path: "/admin/process-requests", perm: "admin.process_requests", icon: Inbox },
    { section: "section_gamification" },
    { label: "nav_achievements", path: "/admin/achievements", perm: "admin.achievements", icon: Award },
    { label: "nav_achievement_rules", path: "/admin/achievement-rules", perm: "admin.achievement_rules", icon: Zap },
    { label: "nav_store", path: "/admin/store", perm: "admin.store", icon: Store },
    { label: "nav_wallet_ops", path: "/admin/wallet", perm: "admin.wallet", icon: Wallet },
    { label: "nav_wallet_reports", path: "/admin/wallet-reports", perm: "admin.wallet_reports", icon: BarChart3 },
    { label: "nav_award_reasons", path: "/admin/award-reasons", perm: "admin.award_reasons", icon: Award },
    { section: "section_surveys" },
    { label: "nav_surveys", path: "/admin/surveys", perm: "admin.surveys", icon: BarChart3 },
    { label: "nav_survey_sessions", path: "/admin/survey-sessions", perm: "admin.survey_sessions", icon: Layers },
    { label: "nav_survey_auto", path: "/admin/survey-auto", perm: "admin.survey_auto", icon: Zap },
    { label: "nav_survey_reports", path: "/admin/survey-reports", perm: "admin.survey_reports", icon: FileBarChart },
    { section: "section_vacation" },
    { label: "nav_vacation", path: "/admin/vacation", perm: "admin.vacation", icon: CalendarDays },
    { section: "section_system" },
    { label: "settings", path: "/admin/settings", perm: "admin.settings", icon: Settings, role: ROLES.ADMIN },
    { label: "nav_audit", path: "/admin/audit", perm: "admin.audit", icon: ScrollText, role: ROLES.ADMIN },
  ],
};

const SEARCH_KIND_LABEL = {
  employee: "Сотрудник",
  news: "Новость",
  course: "Курс",
  book: "Книга",
  page: "Страница",
};

function getZone(pathname) {
  if (pathname.startsWith("/cabinet")) return "cabinet";
  if (pathname.startsWith("/admin")) return "admin";
  return "company";
}

/* ------------------------------------------------------------ глобальный поиск */

/** BUG-010: поле поиска было на каждом экране и не работало ни по Enter, ни выпадашкой. */
function GlobalSearch() {
  const navigate = useNavigate();
  const { t } = useI18n();
  const [term, setTerm] = useState("");
  const [debounced, setDebounced] = useState("");
  const [open, setOpen] = useState(false);
  const [highlight, setHighlight] = useState(0);
  const boxRef = useRef(null);

  useEffect(() => {
    const id = setTimeout(() => setDebounced(term.trim()), 250);
    return () => clearTimeout(id);
  }, [term]);

  useEffect(() => {
    const onClick = (e) => {
      if (boxRef.current && !boxRef.current.contains(e.target)) setOpen(false);
    };
    document.addEventListener("mousedown", onClick);
    return () => document.removeEventListener("mousedown", onClick);
  }, []);

  const { data: results = [], isFetching } = useQuery({
    queryKey: ["global-search", debounced],
    queryFn: () => api.rpc.globalSearch(debounced, 8),
    enabled: debounced.length >= 2,
    staleTime: 30_000,
  });

  const go = (item) => {
    setOpen(false);
    setTerm("");
    navigate(item.url);
  };

  const onKeyDown = (e) => {
    if (e.key === "Enter") {
      e.preventDefault();
      if (open && results[highlight]) go(results[highlight]);
      else if (term.trim().length >= 2) {
        setOpen(false);
        navigate(`/search?q=${encodeURIComponent(term.trim())}`);
      }
    } else if (e.key === "ArrowDown") {
      e.preventDefault();
      setHighlight((h) => Math.min(h + 1, Math.max(results.length - 1, 0)));
    } else if (e.key === "ArrowUp") {
      e.preventDefault();
      setHighlight((h) => Math.max(h - 1, 0));
    } else if (e.key === "Escape") {
      setOpen(false);
    }
  };

  const showDropdown = open && debounced.length >= 2;

  return (
    <div className="relative flex-1 max-w-md" ref={boxRef}>
      <label htmlFor="global-search" className="sr-only">{t("global_search")}</label>
      <Search className="absolute left-3 top-1/2 -translate-y-1/2 w-4 h-4 text-muted-foreground pointer-events-none" aria-hidden="true" />
      <input
        id="global-search"
        type="search"
        role="combobox"
        aria-expanded={showDropdown}
        aria-controls="global-search-results"
        aria-autocomplete="list"
        value={term}
        onChange={(e) => { setTerm(e.target.value); setOpen(true); setHighlight(0); }}
        onFocus={() => setOpen(true)}
        onKeyDown={onKeyDown}
        placeholder={t("global_search")}
        className="w-full h-9 pl-9 pr-9 rounded-lg bg-muted border border-transparent focus:bg-card focus:border-primary/40 text-sm outline-none transition"
      />
      {isFetching && <Loader2 className="absolute right-3 top-1/2 -translate-y-1/2 w-4 h-4 animate-spin text-muted-foreground" aria-hidden="true" />}

      {showDropdown && (
        <div
          id="global-search-results"
          role="listbox"
          className="absolute top-full left-0 right-0 mt-1 bg-popover border border-border rounded-lg shadow-premium-lg overflow-hidden z-50 animate-scale-in max-h-[60vh] overflow-y-auto scrollbar-thin"
        >
          {results.length === 0 && !isFetching && (
            <p className="px-3 py-4 text-sm text-muted-foreground text-center">{t("nothing_found")}</p>
          )}
          {results.map((item, i) => (
            <button
              key={`${item.kind}-${item.id}`}
              role="option"
              aria-selected={i === highlight}
              onMouseEnter={() => setHighlight(i)}
              onClick={() => go(item)}
              className={cn(
                "w-full flex items-start gap-3 px-3 py-2.5 text-left transition",
                i === highlight ? "bg-accent" : "hover:bg-accent/60"
              )}
            >
              <span className="mt-0.5 text-[10px] uppercase tracking-wide font-semibold text-muted-foreground w-20 shrink-0">
                {SEARCH_KIND_LABEL[item.kind] || item.kind}
              </span>
              <span className="min-w-0">
                <span className="block text-sm text-foreground truncate">{item.title}</span>
                {item.subtitle && <span className="block text-xs text-muted-foreground truncate">{item.subtitle}</span>}
              </span>
            </button>
          ))}
          {term.trim().length >= 2 && (
            <button
              onClick={() => { setOpen(false); navigate(`/search?q=${encodeURIComponent(term.trim())}`); }}
              className="w-full flex items-center gap-2 px-3 py-2.5 text-xs text-muted-foreground hover:bg-accent border-t border-border"
            >
              <CornerDownLeft className="w-3.5 h-3.5" aria-hidden="true" />
              Показать все результаты по запросу «{term.trim()}»
            </button>
          )}
        </div>
      )}
    </div>
  );
}

/* -------------------------------------------------------- поповер уведомлений */

/** BUG-027: колокольчик не открывался, бейджа непрочитанных не было. */
function NotificationsBell({ notifications, unreadCount }) {
  const [open, setOpen] = useState(false);
  const navigate = useNavigate();
  const queryClient = useQueryClient();
  const ref = useRef(null);

  useEffect(() => {
    const onClick = (e) => { if (ref.current && !ref.current.contains(e.target)) setOpen(false); };
    document.addEventListener("mousedown", onClick);
    return () => document.removeEventListener("mousedown", onClick);
  }, []);

  const markAllRead = useMutation({
    mutationFn: async () => {
      const unread = (notifications || []).filter((n) => !n.read);
      await Promise.all(unread.map((n) => api.entities.Notification.update(n.id, { read: true })));
    },
    onSuccess: () => queryClient.invalidateQueries({ queryKey: ["notifications"] }),
  });

  const openItem = async (n) => {
    setOpen(false);
    if (!n.read) {
      await api.entities.Notification.update(n.id, { read: true }).catch(() => {});
      queryClient.invalidateQueries({ queryKey: ["notifications"] });
    }
    navigate(n.link || "/cabinet/notifications");
  };

  return (
    <div className="relative" ref={ref}>
      <button
        type="button"
        onClick={() => setOpen((v) => !v)}
        aria-label={unreadCount > 0 ? `Уведомления, непрочитанных: ${unreadCount}` : "Уведомления"}
        aria-expanded={open}
        aria-haspopup="dialog"
        className="relative p-2 rounded-lg hover:bg-accent text-muted-foreground transition min-w-[40px] min-h-[40px] flex items-center justify-center"
      >
        <Bell className="w-5 h-5" aria-hidden="true" />
        {unreadCount > 0 && (
          <span className="absolute top-0.5 right-0.5 min-w-[18px] h-[18px] px-1 rounded-full bg-primary text-primary-foreground text-[10px] flex items-center justify-center font-bold">
            {unreadCount > 99 ? "99+" : unreadCount}
          </span>
        )}
      </button>

      {open && (
        <div role="dialog" aria-label="Уведомления" className="absolute right-0 top-full mt-2 w-[min(22rem,calc(100vw-2rem))] bg-popover border border-border rounded-lg shadow-premium-lg z-50 animate-scale-in overflow-hidden">
          <div className="flex items-center justify-between px-3 py-2 border-b border-border">
            <span className="text-sm font-semibold">Уведомления</span>
            {unreadCount > 0 && (
              <button onClick={() => markAllRead.mutate()} className="text-xs text-primary hover:underline flex items-center gap-1">
                <CheckCheck className="w-3.5 h-3.5" aria-hidden="true" /> Прочитать все
              </button>
            )}
          </div>
          <div className="max-h-80 overflow-y-auto scrollbar-thin">
            {(notifications || []).length === 0 && (
              <p className="px-3 py-6 text-sm text-muted-foreground text-center">Новых уведомлений нет</p>
            )}
            {(notifications || []).slice(0, 12).map((n) => (
              <button
                key={n.id}
                onClick={() => openItem(n)}
                className={cn("w-full text-left px-3 py-2.5 hover:bg-accent transition border-b border-border/50 last:border-0", !n.read && "bg-accent/40")}
              >
                <div className="flex items-start gap-2">
                  {!n.read && <span className="mt-1.5 w-1.5 h-1.5 rounded-full bg-primary shrink-0" aria-label="Не прочитано" />}
                  <div className={cn("min-w-0", n.read && "pl-3.5")}>
                    <p className="text-sm text-foreground truncate">{n.title}</p>
                    {n.body && <p className="text-xs text-muted-foreground line-clamp-2">{n.body}</p>}
                    <p className="text-[11px] text-muted-foreground mt-0.5">{formatRelative(n.date)}</p>
                  </div>
                </div>
              </button>
            ))}
          </div>
          <Link to="/cabinet/notifications" onClick={() => setOpen(false)} className="block px-3 py-2 text-xs text-center text-primary hover:bg-accent border-t border-border">
            Все уведомления
          </Link>
        </div>
      )}
    </div>
  );
}

/* ------------------------------------------------------------------ оболочка */

export default function PortalShell() {
  const location = useLocation();
  const navigate = useNavigate();
  const { t, lang, setLang } = useI18n();
  const { user, employee, roleLabel, hasRole, canAccess, logout } = useAuth();

  const [mobileOpen, setMobileOpen] = useState(false);
  const [zoneMenuOpen, setZoneMenuOpen] = useState(false);
  const [collapsed, setCollapsed] = useState(() => localStorage.getItem("sidebar-collapsed") === "true");
  const [navSearch, setNavSearch] = useState("");
  const activeItemRef = useRef(null);

  const zone = getZone(location.pathname);
  const availableZones = useMemo(() => ZONES.filter((z) => !z.role || hasRole(z.role)), [hasRole]);

  const { data: notifications } = useQuery({
    queryKey: ["notifications", user?.id],
    queryFn: () => api.entities.Notification.filter({ user_id: user.id }, "-date", 50),
    enabled: !!user?.id,
    refetchInterval: 120_000,
  });
  const unreadCount = (notifications || []).filter((n) => !n.read).length;

  /**
   * Меню зоны с учётом роли и настроенных прав.
   *
   * Второй проход убирает заголовки групп, под которыми не осталось ни одного
   * пункта: иначе после закрытия разделов в боковом меню оставались висеть
   * пустые подписи вроде «Опросы» без единой ссылки.
   */
  const nav = useMemo(() => {
    const visible = (NAV[zone] || []).filter((item) => {
      if (item.section) return true; // заголовок группы — решаем на втором проходе
      if (item.role && !hasRole(item.role)) return false;
      return canAccess(item.perm);
    });
    return visible.filter((item, i) => {
      if (!item.section) return true;
      const next = visible[i + 1];
      return !!next && !next.section;
    });
  }, [zone, hasRole, canAccess]);

  useEffect(() => { localStorage.setItem("sidebar-collapsed", String(collapsed)); }, [collapsed]);
  useEffect(() => { setMobileOpen(false); setNavSearch(""); }, [location.pathname]);

  // BUG-057: активный пункт обрезался внизу скролл-контейнера.
  useEffect(() => {
    activeItemRef.current?.scrollIntoView({ block: "nearest" });
  }, [location.pathname, collapsed]);

  const isActive = (path) => {
    if (path === "/" || path === "/cabinet" || path === "/admin") return location.pathname === path;
    return location.pathname === path || location.pathname.startsWith(path + "/");
  };

  const filteredNav = useMemo(() => {
    if (!navSearch.trim()) return nav;
    const q = navSearch.toLowerCase();
    return nav.filter((item) => !item.section && t(item.label).toLowerCase().includes(q));
  }, [nav, navSearch, t]);

  const displayName = employee?.name || user?.full_name || user?.email || "—";

  return (
    <div className="flex h-screen overflow-hidden bg-background">
      {/* BUG-060: не было ссылки «Перейти к содержимому». */}
      <a href="#main-content" className="skip-link">Перейти к содержимому</a>

      <aside
        aria-label="Основная навигация"
        className={cn(
          "fixed lg:static inset-y-0 left-0 z-50 bg-card border-r border-border flex flex-col transition-all duration-300 ease-in-out",
          collapsed ? "w-[68px]" : "w-64",
          mobileOpen ? "translate-x-0" : "-translate-x-full lg:translate-x-0"
        )}
      >
        <div className={cn("border-b border-border", collapsed ? "p-3" : "p-4")}>
          <div className={cn("flex items-center mb-3", collapsed && "justify-center")}>
            <Link to="/" aria-label="Портал Optimus KZ, на главную">
              <OptimusLogo size={collapsed ? 30 : 26} showText={!collapsed} />
            </Link>
          </div>
          {!collapsed && availableZones.length > 1 && (
            <div className="relative">
              <button
                onClick={() => setZoneMenuOpen((v) => !v)}
                aria-expanded={zoneMenuOpen}
                aria-haspopup="menu"
                className="w-full flex items-center gap-2 px-3 py-2 rounded-lg bg-muted hover:bg-muted/80 transition text-sm font-medium text-foreground/80 min-h-[40px]"
              >
                {(() => {
                  const Z = availableZones.find((z) => z.id === zone) || availableZones[0];
                  const Icon = Z.icon;
                  return <Icon className="w-4 h-4 text-primary" aria-hidden="true" />;
                })()}
                <span className="flex-1 text-left">{t(ZONES.find((z) => z.id === zone)?.label)}</span>
                <ChevronDown className={cn("w-4 h-4 transition", zoneMenuOpen && "rotate-180")} aria-hidden="true" />
              </button>
              {zoneMenuOpen && (
                <>
                  <div className="fixed inset-0 z-40" onClick={() => setZoneMenuOpen(false)} />
                  <div role="menu" className="absolute top-full left-0 right-0 mt-1 bg-popover border border-border rounded-lg shadow-premium-lg overflow-hidden z-50 animate-scale-in">
                    {availableZones.map((z) => {
                      const Icon = z.icon;
                      return (
                        <button
                          key={z.id}
                          role="menuitem"
                          onClick={() => { navigate(z.path); setZoneMenuOpen(false); setMobileOpen(false); }}
                          className={cn(
                            "w-full flex items-center gap-2 px-3 py-2.5 text-sm hover:bg-accent transition text-left",
                            zone === z.id ? "text-primary font-medium bg-accent" : "text-foreground/80"
                          )}
                        >
                          <Icon className="w-4 h-4" aria-hidden="true" />
                          <span>{t(z.label)}</span>
                        </button>
                      );
                    })}
                  </div>
                </>
              )}
            </div>
          )}
        </div>

        {!collapsed && (
          <div className="px-3 pt-3">
            <label htmlFor="nav-search" className="sr-only">{t("nav_search")}</label>
            <div className="relative">
              <Search className="absolute left-2.5 top-1/2 -translate-y-1/2 w-3.5 h-3.5 text-muted-foreground" aria-hidden="true" />
              <input
                id="nav-search"
                type="search"
                value={navSearch}
                onChange={(e) => setNavSearch(e.target.value)}
                placeholder={t("nav_search")}
                className="w-full h-8 pl-8 pr-3 rounded-lg bg-muted border border-transparent focus:bg-card focus:border-primary/40 text-xs outline-none transition"
              />
            </div>
          </div>
        )}

        <nav className="flex-1 nav-scroll scrollbar-thin px-3 py-2 space-y-0.5" aria-label="Разделы портала">
          {filteredNav.map((item, i) => {
            if (item.section) {
              if (collapsed) return <div key={i} className="my-2 border-t border-border" />;
              return (
                <div key={i} className="px-3 pt-4 pb-1 text-[10px] font-semibold uppercase tracking-wider text-muted-foreground">
                  {t(item.section)}
                </div>
              );
            }
            const Icon = item.icon;
            const active = isActive(item.path);
            const badge = item.badgeKey === "notifications" ? unreadCount : 0;
            return (
              <Link
                key={i}
                to={item.path}
                ref={active ? activeItemRef : undefined}
                aria-current={active ? "page" : undefined}
                // BUG-058: у свёрнутых иконок не было подсказок — навигация вслепую.
                title={collapsed ? t(item.label) : undefined}
                aria-label={collapsed ? t(item.label) : undefined}
                className={cn(
                  "flex items-center gap-3 rounded-lg text-sm transition-all duration-200 group relative min-h-[40px]",
                  collapsed ? "px-2.5 justify-center" : "px-3 py-2",
                  active
                    ? "bg-primary text-primary-foreground font-medium shadow-sm"
                    : "text-foreground/75 hover:bg-accent hover:text-accent-foreground"
                )}
              >
                <Icon className={cn("w-4 h-4 shrink-0", active ? "text-primary-foreground" : "text-muted-foreground group-hover:text-primary")} aria-hidden="true" />
                {!collapsed && <span className="truncate flex-1">{t(item.label)}</span>}
                {badge > 0 && !collapsed && (
                  <span className="px-1.5 h-4 min-w-4 rounded-full bg-primary text-primary-foreground text-[9px] flex items-center justify-center font-bold">{badge}</span>
                )}
                {badge > 0 && collapsed && <span className="absolute top-1 right-1 w-2 h-2 rounded-full bg-primary" />}
              </Link>
            );
          })}
          {filteredNav.length === 0 && !collapsed && (
            <p className="text-xs text-muted-foreground px-3 py-4 text-center">{t("nothing_found")}</p>
          )}
        </nav>

        <button
          onClick={() => setCollapsed((v) => !v)}
          aria-label={collapsed ? "Развернуть боковое меню" : "Свернуть боковое меню"}
          className="hidden lg:flex items-center gap-2 px-3 py-2.5 text-xs text-muted-foreground hover:bg-accent hover:text-foreground transition border-t border-border w-full min-h-[40px]"
        >
          {collapsed ? <PanelLeftOpen className="w-4 h-4 mx-auto" aria-hidden="true" /> : (<><PanelLeftClose className="w-4 h-4" aria-hidden="true" /> <span>{t("collapse")}</span></>)}
        </button>

        <div className={cn("border-t border-border", collapsed ? "p-2" : "p-3")}>
          {!collapsed && (
            <div className="rounded-lg bg-accent p-3 mb-2">
              <div className="text-[10px] font-semibold uppercase tracking-wider text-accent-foreground mb-1">{t("motto_label")}</div>
              <div className="text-xs text-foreground/75 italic">«{t("motto")}»</div>
            </div>
          )}
          {/* BUG-006: кнопка «Выйти» действительно завершает сессию. */}
          <button
            onClick={logout}
            aria-label={t("logout")}
            className={cn(
              "w-full flex items-center gap-2 rounded-lg text-sm text-muted-foreground hover:bg-accent hover:text-foreground transition min-h-[40px]",
              collapsed ? "p-2.5 justify-center" : "px-3 py-2"
            )}
          >
            <LogOut className="w-4 h-4 shrink-0" aria-hidden="true" />
            {!collapsed && <span>{t("logout")}</span>}
          </button>
        </div>
      </aside>

      {mobileOpen && (
        <div className="fixed inset-0 bg-black/40 z-40 lg:hidden backdrop-blur-sm" onClick={() => setMobileOpen(false)} aria-hidden="true" />
      )}

      <div className="flex-1 flex flex-col min-w-0">
        <header className="h-14 bg-card border-b border-border flex items-center gap-3 px-4 shrink-0">
          {/* BUG-059: бургер был без aria-label и без текста. */}
          <button
            className="lg:hidden p-1.5 rounded-lg hover:bg-accent transition min-w-[40px] min-h-[40px] flex items-center justify-center"
            onClick={() => setMobileOpen((v) => !v)}
            aria-label={mobileOpen ? "Закрыть меню" : "Открыть меню"}
            aria-expanded={mobileOpen}
          >
            {mobileOpen ? <X className="w-5 h-5" aria-hidden="true" /> : <Menu className="w-5 h-5" aria-hidden="true" />}
          </button>

          <GlobalSearch />

          <div className="flex items-center gap-1 ml-auto">
            <button
              onClick={() => setLang(lang === "ru" ? "kk" : "ru")}
              className="px-2.5 rounded-lg hover:bg-accent text-muted-foreground text-sm font-medium transition flex items-center min-h-[40px]"
              aria-label={lang === "ru" ? "Тілді қазақшаға ауыстыру" : "Переключить язык на русский"}
            >
              <span aria-hidden="true">{lang === "ru" ? "RU" : "KZ"}</span>
            </button>

            <NotificationsBell notifications={notifications} unreadCount={unreadCount} />

            <Link
              to="/cabinet/profile"
              className="flex items-center gap-2 pl-2 ml-1 border-l border-border hover:bg-accent rounded-lg py-1 pr-2 transition"
            >
              {/* Фото сотрудника, если оно загружено; иначе — инициалы */}
              <SafeImage
                src={employee?.photo_url}
                alt=""
                loading="eager"
                className="w-8 h-8 rounded-full object-cover shrink-0"
                fallbackText={initials(displayName)}
                fallbackClassName="bg-primary text-primary-foreground text-xs"
              />
              <span className="hidden sm:block text-left">
                {/* BUG-034: роль берётся из сессии, а не из надписи «HR-админ». */}
                <span className="block text-sm font-medium text-foreground leading-tight">{displayName}</span>
                <span className="block text-[10px] text-muted-foreground leading-tight">{roleLabel || "Optimus KZ"}</span>
              </span>
            </Link>
          </div>
        </header>

        <main id="main-content" tabIndex={-1} className="flex-1 overflow-y-auto scrollbar-thin focus:outline-none">
          <Outlet />
        </main>

        {/* BUG-060: отсутствовал footer-лендмарк. */}
        <footer className="hidden md:flex items-center justify-between px-4 py-2 text-[11px] text-muted-foreground border-t border-border bg-card shrink-0">
          <span>© {new Date().getFullYear()} ТОО «Optimus KZ»</span>
          <span className="flex items-center gap-3">
            <Link to="/about" className="hover:text-foreground">О компании</Link>
            <Link to="/vacation-policy" className="hover:text-foreground">Политика отпусков</Link>
            <Link to="/ethics" className="hover:text-foreground">Кодекс этики</Link>
          </span>
        </footer>
      </div>
    </div>
  );
}
