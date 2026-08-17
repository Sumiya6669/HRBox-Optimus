import React, { useState } from "react";
import { useQuery, useMutation, useQueryClient } from "@tanstack/react-query";
import { api } from "@/api/client";
import { Card } from "@/components/ui/card";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Dialog, DialogContent, DialogHeader, DialogTitle, DialogTrigger } from "@/components/ui/dialog";
import { CalendarDays, Plus, Check, X, Plane } from "lucide-react";
import { useToast } from "@/components/ui/use-toast";
import { cn } from "@/lib/utils";
import { mutationErrorMessage } from "@/lib/dataErrors";
import { useCurrentEmployee } from "@/lib/useCurrentEmployee";

const typeLabel = { vacation: "Отпуск", sick: "Больничный", personal: "По семейным", unpaid: "Без сохранения ЗП" };
// leave_status: pending / approved / rejected / cancelled — покрываем все значения enum.
const statusColor = { pending: "bg-amber-100 text-amber-700", approved: "bg-emerald-100 text-emerald-700", rejected: "bg-red-100 text-red-700", cancelled: "bg-slate-100 text-slate-600" };
const statusLabel = { pending: "Ожидает", approved: "Согласован", rejected: "Отклонён", cancelled: "Отменён" };

export default function CabinetVacation() {
  const { toast } = useToast();
  const qc = useQueryClient();
  const [open, setOpen] = useState(false);
  const [form, setForm] = useState({ type: "vacation", start_date: "", end_date: "", notes: "" });

  const { me, employeeId } = useCurrentEmployee();
  const { data: leaves } = useQuery({ queryKey: ["leaves-me", employeeId], queryFn: () => api.entities.LeaveRequest.filter({ employee_id: employeeId }, "-created_date"), enabled: !!employeeId });

  const create = useMutation({
    mutationFn: (data) => api.entities.LeaveRequest.create(data),
    onSuccess: () => { toast({ title: "Заявка подана" }); qc.invalidateQueries({ queryKey: ["leaves-me", employeeId] }); setOpen(false); setForm({ type: "vacation", start_date: "", end_date: "", notes: "" }); },
    onError: (e) => toast({ variant: "destructive", title: "Не удалось подать заявку", description: mutationErrorMessage(e, { 23514: "Дата окончания не может быть раньше даты начала" }) }),
  });

  const submit = () => {
    if (!form.start_date || !form.end_date || !employeeId) return;
    // BUG-017: leave_requests.days — генерируемая колонка, писать в неё нельзя.
    // Остатка дней в схеме тоже нет: он считается по согласованным заявкам (usedDays).
    create.mutate({
      type: form.type,
      start_date: form.start_date,
      end_date: form.end_date,
      notes: form.notes.trim() || null,
      employee_id: employeeId,
      employee_name: me?.full_name || null,
      status: "pending",
    });
  };

  const usedDays = (leaves || []).filter(l => l.status === "approved").reduce((s, l) => s + (l.days || 0), 0);
  const pending = (leaves || []).filter(l => l.status === "pending").length;

  return (
    <div className="p-6 max-w-7xl mx-auto space-y-6">
      <div className="flex items-center justify-between flex-wrap gap-4">
        <div>
          <h1 className="text-2xl font-bold text-slate-900">Отпуск</h1>
          <p className="text-sm text-slate-500 mt-1">Заявки на отпуск и больничные</p>
        </div>
        <Dialog open={open} onOpenChange={setOpen}>
          <DialogTrigger asChild><Button><Plus className="w-4 h-4 mr-1" /> Новая заявка</Button></DialogTrigger>
          <DialogContent>
            <DialogHeader><DialogTitle>Новая заявка</DialogTitle></DialogHeader>
            <div className="space-y-3">
              <div>
                <Label>Тип</Label>
                <select className="w-full h-9 rounded-md border border-input px-3 text-sm" value={form.type} onChange={e => setForm({ ...form, type: e.target.value })}>
                  {Object.entries(typeLabel).map(([v, l]) => <option key={v} value={v}>{l}</option>)}
                </select>
              </div>
              <div className="grid grid-cols-2 gap-3">
                <div><Label>С</Label><Input type="date" value={form.start_date} onChange={e => setForm({ ...form, start_date: e.target.value })} /></div>
                <div><Label>По</Label><Input type="date" value={form.end_date} onChange={e => setForm({ ...form, end_date: e.target.value })} /></div>
              </div>
              <div><Label>Комментарий</Label><Input value={form.notes} onChange={e => setForm({ ...form, notes: e.target.value })} /></div>
              <Button onClick={submit} className="w-full">Подать заявку</Button>
            </div>
          </DialogContent>
        </Dialog>
      </div>

      {/* Balance */}
      <div className="grid grid-cols-3 gap-4">
        <Card className="p-5">
          <div className="flex items-center gap-2 text-xs text-slate-500 mb-1"><Plane className="w-4 h-4" /> Доступно</div>
          <div className="text-3xl font-bold text-emerald-600">{24 - usedDays}</div>
          <div className="text-xs text-slate-400">дней</div>
        </Card>
        <Card className="p-5">
          <div className="flex items-center gap-2 text-xs text-slate-500 mb-1"><Check className="w-4 h-4" /> Использовано</div>
          <div className="text-3xl font-bold text-slate-900">{usedDays}</div>
          <div className="text-xs text-slate-400">дней</div>
        </Card>
        <Card className="p-5">
          <div className="flex items-center gap-2 text-xs text-slate-500 mb-1"><CalendarDays className="w-4 h-4" /> Ожидает</div>
          <div className="text-3xl font-bold text-amber-500">{pending}</div>
          <div className="text-xs text-slate-400">заявок</div>
        </Card>
      </div>

      {/* History */}
      <div>
        <h2 className="font-semibold text-slate-900 mb-3">История заявок</h2>
        <div className="space-y-2">
          {(leaves || []).map(l => (
            <Card key={l.id} className="p-4 flex items-center gap-4">
              <div className="w-10 h-10 rounded-lg bg-sky-50 flex items-center justify-center shrink-0">
                <CalendarDays className="w-5 h-5 text-sky-500" />
              </div>
              <div className="flex-1 min-w-0">
                <div className="flex items-center gap-2 mb-0.5">
                  <Badge variant="secondary" className="text-[10px]">{typeLabel[l.type]}</Badge>
                  <Badge className={cn("border-0", statusColor[l.status])}>{statusLabel[l.status]}</Badge>
                </div>
                <div className="text-sm text-slate-600">{l.start_date} → {l.end_date} · {l.days} дн.</div>
              </div>
              {l.notes && <div className="text-xs text-slate-400 hidden sm:block truncate max-w-xs">{l.notes}</div>}
            </Card>
          ))}
          {(leaves || []).length === 0 && <Card className="p-8 text-center text-slate-400">Заявок пока нет</Card>}
        </div>
      </div>
    </div>
  );
}