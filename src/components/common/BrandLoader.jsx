import React from 'react';

export default function BrandLoader({ label = 'OPTIMUS KZ' }) {
  return (
    <div className="fixed inset-0 flex items-center justify-center bg-background" role="status" aria-live="polite">
      <div className="text-center">
        <div className="w-10 h-10 border-2 border-primary border-t-transparent rounded-full animate-spin mx-auto mb-4" />
        <p className="text-xs uppercase tracking-[0.25em] text-muted-foreground">{label}</p>
        <span className="sr-only">Загрузка…</span>
      </div>
    </div>
  );
}
