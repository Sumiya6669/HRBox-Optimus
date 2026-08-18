import React, { useState, useEffect, useMemo } from 'react';
import { useQuery, useMutation, useQueryClient } from '@tanstack/react-query';
import { api } from '@/api/client';
import { Card } from '@/components/ui/card';
import { Badge } from '@/components/ui/badge';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import { Switch } from '@/components/ui/switch';
import { Tabs, TabsList, TabsTrigger, TabsContent } from '@/components/ui/tabs';
import {
  Building2, Palette, Bell, Shield, Database, Globe, Save, RotateCcw, Check,
  Moon, Mail, Smartphone, AppWindow, CalendarClock, FileBarChart, Lock,
  KeyRound, Clock, Plug, CalendarDays, Info,
} from 'lucide-react';
import { useToast } from '@/components/ui/use-toast';
import PageContainer from '@/components/common/PageContainer';
import ErrorState from '@/components/common/ErrorState';
import { useI18n } from '@/lib/i18n';
import { useAuth } from '@/lib/AuthContext';
import { mutationErrorMessage } from '@/lib/dataErrors';
import { formatNumber } from '@/lib/format';
import { cn } from '@/lib/utils';

/**
 * Настройки портала.
 *
 * BUG-085: сущности Settings в приложении не существовало — сохранять конфигурацию
 *          было некуда («404 Entity schema Settings not found»). Теперь читаем и
 *          пишем таблицу settings (key text PK, value jsonb) через api.entities.Settings.
 * BUG-045: часовой пояс подписывался как «Asia/Almaty (UTC+6)», хотя Казахстан
 *          с 01.03.2024 полностью в UTC+5. Храним IANA-идентификатор, смещение
 *          считаем через Intl.DateTimeFormat и показываем посчитанное.
 * BUG-054: из палитры брендинга убраны фиолетовый и оранжевый.
 * Аудит: удачная разбивка на 6 вкладок сохранена; вкладка «Интеграции» перестала
 *        быть набором мёртвых кнопок — это честный роадмап со статусами.
 */

/** Значения по умолчанию соответствуют структуре seed.sql. */
const DEFAULTS = {
  general: {
    company_name: 'ТОО «Optimus KZ»',
    brands: ['BASF', 'Tikkurila'],
    email: 'info@optimus-kz.kz',
    phone: '+7 (727) 000-00-00',
    address: 'г. Алматы',
    timezone: 'Asia/Almaty',
  },
  branding: { primary_color: '#C4001A', dark_mode_enabled: true },
  notifications: { email: true, push: false, in_app: true, daily_digest: false, weekly_report: true },
  security: {
    require_2fa_for_admins: true,
    password_min_length: 8,
    session_timeout_minutes: 480,
    max_login_attempts: 5,
  },
  localization: { default_locale: 'ru', available_locales: ['ru', 'kk'] },
  vacation: { days_per_year: 24, sla_days_to_approve: 3 },
};

const SETTINGS_KEYS = Object.keys(DEFAULTS);

/** BUG-054: без фиолетовой и оранжевой палитр — только брендовые и нейтральные тона. */
const THEME_COLORS = [
  { name: 'Красный Optimus', value: '#C4001A' },
  { name: 'Тёмно-красный', value: '#8E0016' },
  { name: 'Синий', value: '#1A56DB' },
  { name: 'Зелёный', value: '#059669' },
  { name: 'Графитовый', value: '#334155' },
];

/** Часовые пояса Казахстана и соседних офисов. Смещение НЕ хардкодится (BUG-045). */
const TIMEZONES = [
  'Asia/Almaty', 'Asia/Qostanay', 'Asia/Aqtobe', 'Asia/Atyrau', 'Asia/Oral', 'Asia/Aqtau',
  'Europe/Moscow', 'UTC',
];

/**
 * Смещение зоны от UTC в минутах — вычисляется на текущую дату,
 * поэтому переход Казахстана на UTC+5 отражается автоматически (BUG-045).
 */
function tzOffsetMinutes(timeZone, at = new Date()) {
  try {
    const dtf = new Intl.DateTimeFormat('en-US', {
      timeZone, hour12: false,
      year: 'numeric', month: '2-digit', day: '2-digit',
      hour: '2-digit', minute: '2-digit', second: '2-digit',
    });
    const parts = Object.fromEntries(dtf.formatToParts(at).map((p) => [p.type, p.value]));
    const asUTC = Date.UTC(
      Number(parts.year), Number(parts.month) - 1, Number(parts.day),
      Number(parts.hour) % 24, Number(parts.minute), Number(parts.second)
    );
    return Math.round((asUTC - at.getTime()) / 60000);
  } catch {
    return null;
  }
}

function formatUtcOffset(timeZone, at = new Date()) {
  const minutes = tzOffsetMinutes(timeZone, at);
  if (minutes === null) return 'смещение неизвестно';
  const sign = minutes < 0 ? '−' : '+';
  const abs = Math.abs(minutes);
  const hh = String(Math.floor(abs / 60)).padStart(2, '0');
  const mm = String(abs % 60).padStart(2, '0');
  return `UTC${sign}${hh}:${mm}`;
}

function SkeletonBlock() {
  return (
    <div className="space-y-4" aria-hidden="true">
      <div className="h-12 animate-pulse rounded-xl bg-muted" />
      <div className="h-96 animate-pulse rounded-xl bg-muted" />
    </div>
  );
}

/** Вкладка «Интеграции»: честный роадмап вместо кнопок, которые ничего не делают. */
const INTEGRATIONS = [
  {
    id: 'telegram',
    name: 'Telegram',
    desc: 'Дублирование уведомлений о согласованиях и начислениях баллов в мессенджер.',
    stage: 'Пилот запланирован после включения push-уведомлений.',
  },
];

export default function AdminSettings() {
  const { t, lang, setLang } = useI18n();
  const { toast } = useToast();
  const qc = useQueryClient();
  const { isAdmin } = useAuth();

  const [draft, setDraft] = useState(null);

  const settingsQuery = useQuery({
    queryKey: ['settings'],
    queryFn: () => api.entities.Settings.list(),
  });

  /** Значения из БД, дополненные значениями по умолчанию. */
  const saved = useMemo(() => {
    const byKey = new Map((settingsQuery.data || []).map((row) => [row.key, row.value || {}]));
    return SETTINGS_KEYS.reduce((acc, key) => {
      acc[key] = { ...DEFAULTS[key], ...(byKey.get(key) || {}) };
      return acc;
    }, {});
  }, [settingsQuery.data]);

  useEffect(() => {
    if (settingsQuery.data) setDraft(JSON.parse(JSON.stringify(saved)));
  }, [settingsQuery.data, saved]);

  const isDirty = useMemo(
    () => !!draft && JSON.stringify(draft) !== JSON.stringify(saved),
    [draft, saved]
  );

  const set = (section, field, value) =>
    setDraft((d) => ({ ...d, [section]: { ...d[section], [field]: value } }));

  const save = useMutation({
    mutationFn: async () => {
      const existing = new Set((settingsQuery.data || []).map((row) => row.key));
      for (const key of SETTINGS_KEYS) {
        if (JSON.stringify(draft[key]) === JSON.stringify(saved[key])) continue;
        if (existing.has(key)) {
          await api.entities.Settings.update(key, { value: draft[key] });
        } else {
          await api.entities.Settings.create({ key, value: draft[key] });
        }
      }
      return true;
    },
    onSuccess: () => {
      toast({ title: t('settings_saved') });
      qc.invalidateQueries({ queryKey: ['settings'] });
    },
    // RLS отдаёт 42501, если роль не admin — показываем понятный текст, а не код.
    onError: (e) => toast({
      title: 'Настройки не сохранены',
      description: mutationErrorMessage(e, {
        42501: 'Сохранять настройки портала может только роль «Администратор». Обратитесь к администратору системы.',
      }),
      variant: 'destructive',
    }),
  });

  const sections = [
    { id: 'general', icon: Building2, title: t('settings_general') },
    { id: 'branding', icon: Palette, title: t('settings_branding') },
    { id: 'notifications', icon: Bell, title: t('settings_notifications') },
    { id: 'security', icon: Shield, title: t('settings_security') },
    { id: 'integrations', icon: Database, title: t('settings_integrations') },
    { id: 'localization', icon: Globe, title: t('settings_localization') },
  ];

  const selectCls =
    'min-h-[40px] w-full rounded-md border border-input bg-transparent px-3 text-sm outline-none focus:border-primary/40';

  const actions = (
    <>
      <Button variant="outline" disabled={!isDirty || save.isPending} onClick={() => setDraft(JSON.parse(JSON.stringify(saved)))}>
        <RotateCcw className="mr-1 h-4 w-4" aria-hidden="true" /> Отменить изменения
      </Button>
      {/* Кнопка активна только при наличии несохранённых изменений */}
      <Button disabled={!isDirty || save.isPending} onClick={() => save.mutate()}>
        <Save className="mr-1 h-4 w-4" aria-hidden="true" /> {t('save')}
      </Button>
    </>
  );

  if (settingsQuery.error) {
    return (
      <PageContainer title={t('settings_title')} description={t('settings_desc')}>
        <ErrorState error={settingsQuery.error} onRetry={settingsQuery.refetch} />
      </PageContainer>
    );
  }

  if (settingsQuery.isPending || !draft) {
    return (
      <PageContainer title={t('settings_title')} description={t('settings_desc')}>
        <SkeletonBlock />
      </PageContainer>
    );
  }

  const currentTz = draft.general.timezone;

  return (
    <PageContainer title={t('settings_title')} description={t('settings_desc')} actions={actions}>
      {!isAdmin && (
        <div role="alert" className="mb-4 flex items-start gap-2 rounded-xl border border-warning/40 bg-warning/10 p-3 text-sm">
          <Info className="mt-0.5 h-4 w-4 shrink-0 text-warning" aria-hidden="true" />
          <span>Изменять настройки портала может только роль «Администратор». Поля доступны для просмотра.</span>
        </div>
      )}

      <Tabs defaultValue="general">
        <TabsList className="flex h-auto flex-wrap gap-1 p-1">
          {sections.map((s) => {
            const Icon = s.icon;
            return (
              <TabsTrigger key={s.id} value={s.id} className="flex min-h-[40px] items-center gap-1.5 px-3">
                <Icon className="h-4 w-4" aria-hidden="true" />
                <span className="hidden sm:inline">{s.title}</span>
              </TabsTrigger>
            );
          })}
        </TabsList>

        {/* --------------------------------------------------------- Общие */}
        <TabsContent value="general" className="space-y-4">
          <Card className="space-y-4 p-6">
            <h2 className="flex items-center gap-2 font-semibold text-foreground">
              <Building2 className="h-5 w-5 text-primary" aria-hidden="true" /> {t('settings_company_info')}
            </h2>
            <div className="grid grid-cols-1 gap-4 md:grid-cols-2">
              <div>
                <Label htmlFor="set-name">{t('settings_company_name')}</Label>
                <Input id="set-name" value={draft.general.company_name || ''}
                  onChange={(e) => set('general', 'company_name', e.target.value)} />
              </div>
              <div>
                <Label htmlFor="set-brands">{t('settings_company_brands')}</Label>
                <Input
                  id="set-brands"
                  value={(draft.general.brands || []).join(', ')}
                  placeholder="BASF, Tikkurila"
                  onChange={(e) => set('general', 'brands', e.target.value.split(',').map((s) => s.trim()).filter(Boolean))}
                />
                <p className="mt-1 text-xs text-muted-foreground">Перечислите бренды через запятую</p>
              </div>
              <div>
                <Label htmlFor="set-email">{t('settings_company_email')}</Label>
                <Input id="set-email" type="email" value={draft.general.email || ''}
                  onChange={(e) => set('general', 'email', e.target.value)} />
              </div>
              <div>
                <Label htmlFor="set-phone">{t('settings_company_phone')}</Label>
                <Input id="set-phone" value={draft.general.phone || ''}
                  onChange={(e) => set('general', 'phone', e.target.value)} />
              </div>
              <div className="md:col-span-2">
                <Label htmlFor="set-address">{t('settings_company_address')}</Label>
                <Input id="set-address" value={draft.general.address || ''}
                  onChange={(e) => set('general', 'address', e.target.value)} />
              </div>
              {/* BUG-045: в списке только IANA-идентификаторы, смещение вычисляется */}
              <div>
                <Label htmlFor="set-tz">{t('settings_timezone')}</Label>
                <select id="set-tz" className={selectCls} value={currentTz}
                  onChange={(e) => set('general', 'timezone', e.target.value)}>
                  {TIMEZONES.map((tz) => (
                    <option key={tz} value={tz}>{tz} — {formatUtcOffset(tz)}</option>
                  ))}
                </select>
                <p className="mt-1 text-xs text-muted-foreground">
                  Текущее смещение зоны {currentTz}: <strong>{formatUtcOffset(currentTz)}</strong> — считается
                  системой на сегодняшнюю дату, а не задаётся вручную.
                </p>
              </div>
            </div>
          </Card>

          <Card className="space-y-4 p-6">
            <h2 className="flex items-center gap-2 font-semibold text-foreground">
              <CalendarDays className="h-5 w-5 text-primary" aria-hidden="true" /> Политика отпусков
            </h2>
            <div className="grid grid-cols-1 gap-4 md:grid-cols-2">
              <div>
                <Label htmlFor="set-vac-days">Дней отпуска в году</Label>
                <Input id="set-vac-days" type="number" min="1" max="60" value={draft.vacation.days_per_year ?? 24}
                  onChange={(e) => set('vacation', 'days_per_year', Number(e.target.value) || 0)} />
                <p className="mt-1 text-xs text-muted-foreground">
                  По Трудовому кодексу РК — не менее {formatNumber(24)} календарных дней
                </p>
              </div>
              <div>
                <Label htmlFor="set-vac-sla">Срок согласования заявки, рабочих дней</Label>
                <Input id="set-vac-sla" type="number" min="1" max="30" value={draft.vacation.sla_days_to_approve ?? 3}
                  onChange={(e) => set('vacation', 'sla_days_to_approve', Number(e.target.value) || 0)} />
                <p className="mt-1 text-xs text-muted-foreground">
                  После этого срока заявка помечается «Просрочено» в графике отпусков
                </p>
              </div>
            </div>
          </Card>
        </TabsContent>

        {/* ------------------------------------------------------ Брендинг */}
        <TabsContent value="branding">
          <Card className="space-y-5 p-6">
            <h2 className="flex items-center gap-2 font-semibold text-foreground">
              <Palette className="h-5 w-5 text-primary" aria-hidden="true" /> {t('settings_branding')}
            </h2>
            <div>
              <Label className="mb-2 block">{t('settings_theme_color')}</Label>
              <div className="flex flex-wrap gap-3">
                {THEME_COLORS.map((c) => {
                  const selected = draft.branding.primary_color === c.value;
                  return (
                    <button
                      key={c.value}
                      type="button"
                      aria-label={`Основной цвет: ${c.name}`}
                      aria-pressed={selected}
                      onClick={() => set('branding', 'primary_color', c.value)}
                      className={cn(
                        'flex h-11 w-11 items-center justify-center rounded-xl transition',
                        selected ? 'ring-2 ring-primary ring-offset-2 ring-offset-background' : 'hover:scale-105'
                      )}
                      style={{ backgroundColor: c.value }}
                    >
                      {selected && <Check className="h-5 w-5 text-white" aria-hidden="true" />}
                    </button>
                  );
                })}
              </div>
              <p className="mt-2 text-xs text-muted-foreground">
                Выбран: {THEME_COLORS.find((c) => c.value === draft.branding.primary_color)?.name || draft.branding.primary_color}
              </p>
            </div>
            <div className="flex items-center justify-between gap-3 rounded-lg bg-muted/50 p-4">
              <div className="flex items-center gap-3">
                <Moon className="h-5 w-5 text-info" aria-hidden="true" />
                <div>
                  <div className="text-sm font-medium text-foreground">{t('settings_dark_mode')}</div>
                  <div className="text-xs text-muted-foreground">{t('settings_dark_mode_desc')}</div>
                </div>
              </div>
              <Switch
                checked={!!draft.branding.dark_mode_enabled}
                onCheckedChange={(v) => set('branding', 'dark_mode_enabled', v)}
                aria-label={t('settings_dark_mode')}
              />
            </div>
          </Card>
        </TabsContent>

        {/* --------------------------------------------------- Уведомления */}
        <TabsContent value="notifications">
          <Card className="space-y-3 p-6">
            <h2 className="flex items-center gap-2 font-semibold text-foreground">
              <Bell className="h-5 w-5 text-primary" aria-hidden="true" /> {t('settings_notifications')}
            </h2>
            {[
              { key: 'email', icon: Mail, title: t('settings_email_notif'), desc: t('settings_email_notif_desc') },
              { key: 'push', icon: Smartphone, title: t('settings_push_notif'), desc: t('settings_push_notif_desc') },
              { key: 'in_app', icon: AppWindow, title: t('settings_inapp_notif'), desc: t('settings_inapp_notif_desc') },
              { key: 'daily_digest', icon: CalendarClock, title: t('settings_daily_digest'), desc: t('settings_daily_digest_desc') },
              { key: 'weekly_report', icon: FileBarChart, title: t('settings_weekly_report'), desc: t('settings_weekly_report_desc') },
            ].map((item) => {
              const Icon = item.icon;
              return (
                <div key={item.key} className="flex items-center justify-between gap-3 rounded-lg bg-muted/50 p-4">
                  <div className="flex items-center gap-3">
                    <Icon className="h-5 w-5 text-primary" aria-hidden="true" />
                    <div>
                      <div className="text-sm font-medium text-foreground">{item.title}</div>
                      <div className="text-xs text-muted-foreground">{item.desc}</div>
                    </div>
                  </div>
                  <Switch
                    checked={!!draft.notifications[item.key]}
                    onCheckedChange={(v) => set('notifications', item.key, v)}
                    aria-label={item.title}
                  />
                </div>
              );
            })}
          </Card>
        </TabsContent>

        {/* -------------------------------------------------- Безопасность */}
        <TabsContent value="security">
          <Card className="space-y-4 p-6">
            <h2 className="flex items-center gap-2 font-semibold text-foreground">
              <Shield className="h-5 w-5 text-primary" aria-hidden="true" /> {t('settings_security')}
            </h2>
            <div className="flex items-center justify-between gap-3 rounded-lg bg-muted/50 p-4">
              <div className="flex items-center gap-3">
                <Lock className="h-5 w-5 text-primary" aria-hidden="true" />
                <div>
                  <div className="text-sm font-medium text-foreground">{t('settings_2fa')}</div>
                  <div className="text-xs text-muted-foreground">{t('settings_2fa_desc')}</div>
                </div>
              </div>
              <Switch
                checked={!!draft.security.require_2fa_for_admins}
                onCheckedChange={(v) => set('security', 'require_2fa_for_admins', v)}
                aria-label={t('settings_2fa')}
              />
            </div>
            <div className="grid grid-cols-1 gap-4 pt-2 md:grid-cols-3">
              <div>
                <Label htmlFor="set-pwd" className="mb-1 flex items-center gap-1.5">
                  <KeyRound className="h-3.5 w-3.5" aria-hidden="true" /> {t('settings_password_min')}
                </Label>
                <Input id="set-pwd" type="number" min="6" max="32" value={draft.security.password_min_length ?? 8}
                  onChange={(e) => set('security', 'password_min_length', Number(e.target.value) || 8)} />
              </div>
              <div>
                <Label htmlFor="set-session" className="mb-1 flex items-center gap-1.5">
                  <Clock className="h-3.5 w-3.5" aria-hidden="true" /> {t('settings_session_timeout')}
                </Label>
                <Input id="set-session" type="number" min="15" max="1440" value={draft.security.session_timeout_minutes ?? 480}
                  onChange={(e) => set('security', 'session_timeout_minutes', Number(e.target.value) || 480)} />
              </div>
              <div>
                <Label htmlFor="set-attempts" className="mb-1 flex items-center gap-1.5">
                  <Shield className="h-3.5 w-3.5" aria-hidden="true" /> {t('settings_login_attempts')}
                </Label>
                <Input id="set-attempts" type="number" min="3" max="10" value={draft.security.max_login_attempts ?? 5}
                  onChange={(e) => set('security', 'max_login_attempts', Number(e.target.value) || 5)} />
              </div>
            </div>
          </Card>
        </TabsContent>

        {/* ---------------------------------------------------- Интеграции */}
        <TabsContent value="integrations">
          <Card className="p-6">
            <h2 className="mb-1 flex items-center gap-2 font-semibold text-foreground">
              <Database className="h-5 w-5 text-primary" aria-hidden="true" /> {t('settings_integrations')}
            </h2>
            {/* Аудит: раньше здесь были кнопки «Подключить», которые ничего не делали */}
            <p className="mb-4 text-sm text-muted-foreground">
              Ни одна внешняя система пока не подключена. Ниже — планируемая интеграция и её статус;
              подключение выполняется администратором портала вместе с ИТ-службой, из интерфейса
              его запустить нельзя.
            </p>
            <ul role="list" className="space-y-2">
              {INTEGRATIONS.map((integ) => (
                <li key={integ.id} role="listitem" className="flex flex-wrap items-start gap-3 rounded-lg bg-muted/50 p-4">
                  <div className="flex h-10 w-10 shrink-0 items-center justify-center rounded-xl bg-muted" aria-hidden="true">
                    <Plug className="h-5 w-5 text-muted-foreground" />
                  </div>
                  <div className="min-w-0 flex-1">
                    <div className="text-sm font-medium text-foreground">{integ.name}</div>
                    <div className="text-xs text-muted-foreground">{integ.desc}</div>
                    <div className="mt-1 text-xs text-muted-foreground">{integ.stage}</div>
                  </div>
                  <Badge variant="outline" className="shrink-0">{t('settings_not_connected')}</Badge>
                </li>
              ))}
            </ul>
          </Card>
        </TabsContent>

        {/* ---------------------------------------------------- Локализация */}
        <TabsContent value="localization">
          <Card className="space-y-5 p-6">
            <h2 className="flex items-center gap-2 font-semibold text-foreground">
              <Globe className="h-5 w-5 text-primary" aria-hidden="true" /> {t('settings_localization')}
            </h2>
            <div>
              <Label htmlFor="set-locale">Язык портала по умолчанию</Label>
              <select
                id="set-locale"
                className={selectCls}
                value={draft.localization.default_locale || 'ru'}
                onChange={(e) => set('localization', 'default_locale', e.target.value)}
              >
                <option value="ru">{t('settings_russian')}</option>
                <option value="kk">{t('settings_kazakh')}</option>
              </select>
              <p className="mt-1 text-xs text-muted-foreground">
                Применяется к новым пользователям; каждый сотрудник может выбрать свой язык.
              </p>
            </div>
            <div>
              <Label className="mb-2 block">{t('settings_select_language')}</Label>
              <div className="grid max-w-md grid-cols-2 gap-3">
                {[
                  { code: 'ru', title: t('settings_russian'), native: 'Русский' },
                  { code: 'kk', title: t('settings_kazakh'), native: 'Қазақша' },
                ].map((l) => (
                  <button
                    key={l.code}
                    type="button"
                    onClick={() => setLang(l.code)}
                    aria-pressed={lang === l.code}
                    className={cn(
                      'flex min-h-[40px] items-center gap-3 rounded-xl border-2 p-4 transition',
                      lang === l.code ? 'border-primary bg-accent' : 'border-border hover:bg-muted'
                    )}
                  >
                    <div className="text-left">
                      <div className="font-medium text-foreground">{l.title}</div>
                      <div className="text-xs text-muted-foreground">{l.native}</div>
                    </div>
                    {lang === l.code && <Check className="ml-auto h-5 w-5 text-primary" aria-hidden="true" />}
                  </button>
                ))}
              </div>
              <p className="mt-2 text-xs text-muted-foreground">
                Переключатель меняет язык интерфейса только для вашей учётной записи.
              </p>
            </div>
          </Card>
        </TabsContent>
      </Tabs>
    </PageContainer>
  );
}
