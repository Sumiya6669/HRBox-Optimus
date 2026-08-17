import React from 'react';

export default function StatCard({ icon: Icon, label, value, hint, tone = 'primary' }) {
  const tones = {
    primary: 'bg-primary/10 text-primary',
    accent: 'bg-amber-100 text-amber-600',
    green: 'bg-emerald-100 text-emerald-600',
    rose: 'bg-rose-100 text-rose-600',
  };
  return (
    <div className="bg-card rounded-xl border border-border p-5">
      <div className={`w-10 h-10 rounded-lg flex items-center justify-center mb-3.5 ${tones[tone]}`}>
        <Icon className="w-5 h-5" />
      </div>
      <p className="text-2xl font-semibold text-foreground leading-none">{value}</p>
      <p className="text-xs text-muted-foreground mt-2">{label}</p>
      {hint && <p className="text-[11px] text-muted-foreground/70 mt-1">{hint}</p>}
    </div>
  );
}