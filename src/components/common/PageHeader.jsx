import React from 'react';

export default function PageHeader({ title, subtitle, children }) {
  return (
    <div className="flex flex-col sm:flex-row sm:items-end justify-between gap-4 mb-7">
      <div>
        <h1 className="text-2xl md:text-[28px] font-semibold text-foreground tracking-tight leading-tight">{title}</h1>
        {subtitle && <p className="text-sm text-muted-foreground mt-1.5">{subtitle}</p>}
      </div>
      {children && <div className="flex items-center gap-2 flex-wrap">{children}</div>}
    </div>
  );
}