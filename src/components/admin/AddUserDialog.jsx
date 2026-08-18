import React, { useMemo, useState } from 'react';
import { useQuery, useMutation } from '@tanstack/react-query';
import {
  UserPlus, Link2, Mail, Copy, Check, RefreshCw, Eye, EyeOff, KeyRound, Info,
} from 'lucide-react';

import { api } from '@/api/client';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import {
  Dialog, DialogContent, DialogDescription, DialogFooter, DialogHeader, DialogTitle,
} from '@/components/ui/dialog';
import { Tabs, TabsList, TabsTrigger } from '@/components/ui/tabs';
import { useToast } from '@/components/ui/use-toast';
import { ROLE_LABELS } from '@/lib/AuthContext';
import { mutationErrorMessage } from '@/lib/dataErrors';
import { useFormDraft } from '@/lib/useFormDraft';

/**
 * Добавление пользователя тремя способами.
 *
 * Одного способа не хватало. Письмо требует настроенного SMTP — встроенный
 * почтовик Supabase шлёт несколько писем в час и на приём десяти человек не
 * годится. Ссылка требует, чтобы человек её открыл и сам придумал пароль —
 * не подходит кладовщику без рабочей почты. Поэтому добавлен третий, самый
 * прямой: администратор задаёт логин и пароль сам и передаёт их лично.
 *
 * Заодно здесь же заводится карточка сотрудника (ФИО, должность,
 * подразделение, филиал). Без неё личный кабинет пустой: KPI, цели, отпуск и
 * уведомления привязаны к карточке, а не к учётной записи, — и раньше это
 * приходилось делать вторым заходом в другом разделе, о чём легко забыть.
 */

const ROLES = ['employee', 'manager', 'hr', 'admin'];

const MODES = [
  { value: 'direct', label: 'Сразу с паролем', icon: KeyRound },
  { value: 'link', label: 'Ссылкой', icon: Link2 },
  { value: 'email', label: 'Письмом', icon: Mail },
];

const EMAIL_RE = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;

/**
 * Пароль без похожих символов: 0/O и 1/l/I неразличимы в большинстве шрифтов,
 * а пароль здесь диктуют вслух или переписывают с экрана.
 */
function generatePassword(length = 12) {
  const alphabet = 'ABCDEFGHJKLMNPQRSTUVWXYZabcdefghijkmnopqrstuvwxyz23456789';
  const bytes = new Uint32Array(length);
  crypto.getRandomValues(bytes);
  return Array.from(bytes, (n) => alphabet[n % alphabet.length]).join('');
}

/**
 * Пароля в этом объекте НЕТ намеренно.
 *
 * Черновик формы сохраняется в хранилище браузера, чтобы случайная перезагрузка
 * не заставляла заполнять всё заново. Пароль туда попадать не должен: он остался
 * бы лежать открытым текстом в хранилище вкладки. Поэтому он живёт в отдельном
 * состоянии и никуда не пишется.
 */
const EMPTY = {
  email: '',
  fullName: '',
  position: '',
  phone: '',
  departmentId: '',
  branchId: '',
  hireDate: '',
  role: 'employee',
};

export default function AddUserDialog({ open, onOpenChange, onCreated }) {
  const { toast } = useToast();
  const [mode, setMode] = useState('direct');
  const [form, setForm, clearForm] = useFormDraft('new-user', EMPTY);
  const [password, setPassword] = useState('');
  const [showPassword, setShowPassword] = useState(false);
  const [touched, setTouched] = useState(false);
  const [link, setLink] = useState(null);
  const [copied, setCopied] = useState(false);
  const [created, setCreated] = useState(null);

  const set = (field) => (e) => setForm((f) => ({ ...f, [field]: e.target.value }));

  const departments = useQuery({
    queryKey: ['departments-list'],
    queryFn: () => api.entities.Department.list('name', 500),
    enabled: open,
  });
  const branches = useQuery({
    queryKey: ['branches-list'],
    queryFn: () => api.entities.Branch.list('city', 500),
    enabled: open,
  });

  const emailValid = EMAIL_RE.test(form.email.trim());
  const nameValid = form.fullName.trim().length >= 3;
  const passwordValid = password.length >= 8;

  const directValid = emailValid && nameValid && passwordValid;
  const linkValid = !form.email.trim() || emailValid;

  const reset = () => {
    clearForm();
    setPassword('');
    setTouched(false);
    setLink(null);
    setCopied(false);
    setCreated(null);
    setShowPassword(false);
  };

  const close = (next) => {
    onOpenChange(next);
    if (!next) reset();
  };

  const createDirect = useMutation({
    mutationFn: () =>
      api.users.createUser({
        email: form.email,
        password,
        fullName: form.fullName,
        role: form.role,
        position: form.position,
        phone: form.phone,
        departmentId: form.departmentId || null,
        branchId: form.branchId || null,
        hireDate: form.hireDate || null,
      }),
    onSuccess: (data) => {
      // Диалог не закрываем: пароль показан один раз, и закрыв окно, восстановить
      // его нельзя — только сбросить. Администратор сам решит, когда он его записал.
      setCreated({ ...data, password });
      onCreated?.();
      toast({ title: 'Пользователь создан', description: data.email });
    },
    onError: (e) => toast({
      variant: 'destructive', title: 'Не удалось создать пользователя', description: mutationErrorMessage(e),
    }),
  });

  const createLink = useMutation({
    mutationFn: () =>
      api.users.createInvitation({
        email: form.email.trim() || null,
        fullName: form.fullName.trim() || null,
        role: form.role,
      }),
    onSuccess: (data) => {
      setLink(data);
      setCopied(false);
      onCreated?.();
    },
    onError: (e) => toast({
      variant: 'destructive', title: 'Не удалось создать ссылку', description: mutationErrorMessage(e),
    }),
  });

  const sendEmail = useMutation({
    mutationFn: () => api.users.inviteUser(form.email.trim(), form.role),
    onSuccess: () => {
      toast({ title: 'Приглашение отправлено', description: form.email.trim() });
      onCreated?.();
      close(false);
    },
    onError: (e) => toast({
      variant: 'destructive', title: 'Не удалось отправить письмо', description: mutationErrorMessage(e),
    }),
  });

  const copy = async (text) => {
    try {
      await navigator.clipboard.writeText(text);
      setCopied(true);
      toast({ title: 'Скопировано' });
    } catch {
      toast({ variant: 'destructive', title: 'Не удалось скопировать', description: 'Выделите текст и скопируйте вручную.' });
    }
  };

  const roleSelect = (
    <div>
      <Label htmlFor="new-user-role">Роль в портале</Label>
      <select
        id="new-user-role"
        className="mt-1 min-h-[40px] w-full rounded-md border border-input bg-background px-3 text-sm"
        value={form.role}
        onChange={set('role')}
      >
        {ROLES.map((r) => <option key={r} value={r}>{ROLE_LABELS[r]}</option>)}
      </select>
      <p className="mt-1 text-xs text-muted-foreground">
        Какие разделы увидит роль — настраивается в «Правах доступа».
      </p>
    </div>
  );

  const modeDescription = useMemo(() => ({
    direct: 'Учётная запись заводится сразу. Логин и пароль передаёте лично — человек сможет войти немедленно и сменить пароль в профиле.',
    link: 'Одноразовая ссылка: человек сам задаёт пароль при первом входе. Ссылку можно передать в мессенджере. Почта не нужна.',
    email: 'Письмо со ссылкой для входа. Требует настроенного SMTP в Supabase — встроенный почтовик ограничен несколькими письмами в час.',
  }[mode]), [mode]);

  return (
    <Dialog open={open} onOpenChange={close}>
      <DialogContent className="max-h-[90vh] overflow-y-auto sm:max-w-lg">
        <DialogHeader>
          <DialogTitle>Добавить пользователя</DialogTitle>
          <DialogDescription>{modeDescription}</DialogDescription>
        </DialogHeader>

        {/* Результат создания: пароль виден один раз, поэтому экран отдельный. */}
        {created ? (
          <div className="space-y-4 py-2">
            <div className="flex gap-3 rounded-lg border border-success/40 bg-success/5 p-3">
              <Check className="mt-0.5 h-5 w-5 shrink-0 text-success" aria-hidden="true" />
              <div className="text-sm">
                <p className="font-medium text-foreground">Пользователь создан</p>
                <p className="text-muted-foreground">
                  Передайте эти данные сотруднику. Пароль больше нигде не хранится в открытом
                  виде — если потеряется, придётся задать новый.
                </p>
              </div>
            </div>
            <div className="space-y-2 rounded-lg border border-border bg-muted/40 p-3 font-mono text-sm">
              <div className="flex items-center justify-between gap-2">
                <span className="text-muted-foreground">Логин</span>
                <span className="text-foreground">{created.email}</span>
              </div>
              <div className="flex items-center justify-between gap-2">
                <span className="text-muted-foreground">Пароль</span>
                <span className="text-foreground">{created.password}</span>
              </div>
            </div>
            <Button
              variant="outline"
              className="w-full"
              onClick={() => copy(`Портал Optimus KZ\nЛогин: ${created.email}\nПароль: ${created.password}`)}
            >
              {copied ? <Check className="mr-1 h-4 w-4" aria-hidden="true" /> : <Copy className="mr-1 h-4 w-4" aria-hidden="true" />}
              {copied ? 'Скопировано' : 'Скопировать логин и пароль'}
            </Button>
            <DialogFooter className="gap-2">
              <Button variant="outline" onClick={() => reset()}>Добавить ещё одного</Button>
              <Button onClick={() => close(false)}>Готово</Button>
            </DialogFooter>
          </div>
        ) : link ? (
          <div className="space-y-4 py-2">
            <div className="flex gap-3 rounded-lg border border-info/40 bg-info/5 p-3 text-sm">
              <Info className="mt-0.5 h-5 w-5 shrink-0 text-info" aria-hidden="true" />
              <p className="text-muted-foreground">
                Ссылка показывается один раз — в базе хранится только её отпечаток.
                Скопируйте сейчас, позже подсмотреть не получится.
              </p>
            </div>
            <div className="break-all rounded-lg border border-border bg-muted/40 p-3 font-mono text-xs text-foreground">
              {link.url}
            </div>
            <Button variant="outline" className="w-full" onClick={() => copy(link.url)}>
              {copied ? <Check className="mr-1 h-4 w-4" aria-hidden="true" /> : <Copy className="mr-1 h-4 w-4" aria-hidden="true" />}
              {copied ? 'Скопировано' : 'Скопировать ссылку'}
            </Button>
            <DialogFooter className="gap-2">
              <Button variant="outline" onClick={() => reset()}>Создать ещё одну</Button>
              <Button onClick={() => close(false)}>Готово</Button>
            </DialogFooter>
          </div>
        ) : (
          <>
            <Tabs value={mode} onValueChange={setMode}>
              <TabsList className="w-full">
                {MODES.map((m) => (
                  <TabsTrigger key={m.value} value={m.value} className="min-h-[40px] flex-1">
                    <m.icon className="mr-1 h-4 w-4" aria-hidden="true" />
                    {m.label}
                  </TabsTrigger>
                ))}
              </TabsList>
            </Tabs>

            <div className="space-y-4 py-2">
              <div>
                <Label htmlFor="new-user-email">
                  Логин (email){mode === 'link' && <span className="font-normal text-muted-foreground"> — необязательно</span>}
                </Label>
                <Input
                  id="new-user-email"
                  type="email"
                  className="mt-1 min-h-[40px]"
                  value={form.email}
                  onChange={set('email')}
                  onBlur={() => setTouched(true)}
                  aria-invalid={touched && !!form.email && !emailValid}
                  placeholder="ivanov@optimus-kz.kz"
                />
                {touched && !!form.email && !emailValid && (
                  <p role="alert" className="mt-1 text-xs text-destructive">
                    Введите корректный адрес электронной почты.
                  </p>
                )}
                {mode === 'link' && (
                  <p className="mt-1 text-xs text-muted-foreground">
                    Если оставить пустым, человек укажет свою почту сам при регистрации.
                  </p>
                )}
              </div>

              {mode !== 'email' && (
                <div>
                  <Label htmlFor="new-user-name">
                    ФИО{mode === 'direct' && <span className="text-destructive"> *</span>}
                  </Label>
                  <Input
                    id="new-user-name"
                    className="mt-1 min-h-[40px]"
                    value={form.fullName}
                    onChange={set('fullName')}
                    onBlur={() => setTouched(true)}
                    aria-invalid={mode === 'direct' && touched && !nameValid}
                    placeholder="Иванов Иван Иванович"
                  />
                  {mode === 'direct' && touched && !nameValid && (
                    <p role="alert" className="mt-1 text-xs text-destructive">Укажите ФИО полностью.</p>
                  )}
                </div>
              )}

              {mode === 'direct' && (
                <>
                  <div className="grid grid-cols-1 gap-3 sm:grid-cols-2">
                    <div>
                      <Label htmlFor="new-user-position">Должность</Label>
                      <Input
                        id="new-user-position"
                        className="mt-1 min-h-[40px]"
                        value={form.position}
                        onChange={set('position')}
                        placeholder="Менеджер по продажам"
                      />
                    </div>
                    <div>
                      <Label htmlFor="new-user-phone">Телефон</Label>
                      <Input
                        id="new-user-phone"
                        className="mt-1 min-h-[40px]"
                        value={form.phone}
                        onChange={set('phone')}
                        placeholder="+7 700 000 00 00"
                      />
                    </div>
                    <div>
                      <Label htmlFor="new-user-dept">Подразделение</Label>
                      <select
                        id="new-user-dept"
                        className="mt-1 min-h-[40px] w-full rounded-md border border-input bg-background px-3 text-sm"
                        value={form.departmentId}
                        onChange={set('departmentId')}
                      >
                        <option value="">— не указано —</option>
                        {(departments.data || []).map((d) => (
                          <option key={d.id} value={d.id}>{d.name}</option>
                        ))}
                      </select>
                    </div>
                    <div>
                      <Label htmlFor="new-user-branch">Филиал</Label>
                      <select
                        id="new-user-branch"
                        className="mt-1 min-h-[40px] w-full rounded-md border border-input bg-background px-3 text-sm"
                        value={form.branchId}
                        onChange={set('branchId')}
                      >
                        <option value="">— не указан —</option>
                        {(branches.data || []).map((b) => (
                          <option key={b.id} value={b.id}>{b.city}</option>
                        ))}
                      </select>
                    </div>
                    <div>
                      <Label htmlFor="new-user-hire">Дата приёма</Label>
                      <Input
                        id="new-user-hire"
                        type="date"
                        className="mt-1 min-h-[40px]"
                        value={form.hireDate}
                        onChange={set('hireDate')}
                      />
                    </div>
                  </div>

                  <div>
                    <Label htmlFor="new-user-password">
                      Пароль<span className="text-destructive"> *</span>
                    </Label>
                    <div className="mt-1 flex gap-2">
                      <Input
                        id="new-user-password"
                        type={showPassword ? 'text' : 'password'}
                        className="min-h-[40px] font-mono"
                        value={password}
                        onChange={(e) => setPassword(e.target.value)}
                        onBlur={() => setTouched(true)}
                        aria-invalid={touched && !passwordValid}
                        autoComplete="new-password"
                      />
                      <Button
                        type="button"
                        variant="outline"
                        size="icon"
                        className="min-h-[40px] shrink-0"
                        onClick={() => setShowPassword((v) => !v)}
                        aria-label={showPassword ? 'Скрыть пароль' : 'Показать пароль'}
                      >
                        {showPassword
                          ? <EyeOff className="h-4 w-4" aria-hidden="true" />
                          : <Eye className="h-4 w-4" aria-hidden="true" />}
                      </Button>
                      <Button
                        type="button"
                        variant="outline"
                        className="min-h-[40px] shrink-0"
                        onClick={() => { setPassword(generatePassword()); setShowPassword(true); }}
                      >
                        <RefreshCw className="mr-1 h-4 w-4" aria-hidden="true" /> Сгенерировать
                      </Button>
                    </div>
                    {touched && !passwordValid ? (
                      <p role="alert" className="mt-1 text-xs text-destructive">
                        Минимум 8 символов.
                      </p>
                    ) : (
                      <p className="mt-1 text-xs text-muted-foreground">
                        Пароль показывается один раз после создания. Сотрудник сможет сменить его в профиле.
                      </p>
                    )}
                  </div>
                </>
              )}

              {roleSelect}
            </div>

            <DialogFooter className="gap-2">
              <Button variant="outline" onClick={() => close(false)}>Отмена</Button>
              {mode === 'direct' && (
                <Button onClick={() => { setTouched(true); if (directValid) createDirect.mutate(); }} disabled={createDirect.isPending}>
                  <UserPlus className="mr-1 h-4 w-4" aria-hidden="true" />
                  {createDirect.isPending ? 'Создаю…' : 'Создать пользователя'}
                </Button>
              )}
              {mode === 'link' && (
                <Button onClick={() => createLink.mutate()} disabled={!linkValid || createLink.isPending}>
                  <Link2 className="mr-1 h-4 w-4" aria-hidden="true" />
                  {createLink.isPending ? 'Создаю…' : 'Создать ссылку'}
                </Button>
              )}
              {mode === 'email' && (
                <Button onClick={() => { setTouched(true); if (emailValid) sendEmail.mutate(); }} disabled={sendEmail.isPending}>
                  <Mail className="mr-1 h-4 w-4" aria-hidden="true" />
                  {sendEmail.isPending ? 'Отправляю…' : 'Отправить приглашение'}
                </Button>
              )}
            </DialogFooter>
          </>
        )}
      </DialogContent>
    </Dialog>
  );
}
