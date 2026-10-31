'use client';
import { cn } from '@/lib/cn';
import { X } from 'lucide-react';
import { useEffect } from 'react';

export function Button({
  variant = 'primary', size = 'md', className, ...props
}: React.ButtonHTMLAttributes<HTMLButtonElement> & {
  variant?: 'primary' | 'outline' | 'ghost' | 'danger';
  size?: 'sm' | 'md';
}) {
  return (
    <button
      className={cn(
        'btn',
        variant === 'primary' && 'btn-primary',
        variant === 'outline' && 'btn-outline',
        variant === 'ghost' && 'btn-ghost',
        variant === 'danger' && 'btn-danger',
        size === 'sm' && 'h-8 px-3 text-xs',
        className,
      )}
      {...props}
    />
  );
}

export function Card({ className, ...props }: React.HTMLAttributes<HTMLDivElement>) {
  return <div className={cn('card', className)} {...props} />;
}

export function Badge({
  tone = 'neutral', className, children,
}: { tone?: 'neutral' | 'positive' | 'negative' | 'warning' | 'primary'; className?: string; children: React.ReactNode }) {
  const tones: Record<string, string> = {
    neutral: 'bg-[var(--surface-2)] text-[var(--muted)] border-[var(--border)]',
    positive: 'bg-emerald-500/10 text-emerald-600 dark:text-emerald-400 border-emerald-500/25',
    negative: 'bg-red-500/10 text-red-600 dark:text-red-400 border-red-500/25',
    warning: 'bg-amber-500/10 text-amber-600 dark:text-amber-400 border-amber-500/25',
    primary: 'bg-[var(--primary)]/15 text-[#8a6d00] dark:text-[#ffcc00] border-[#ffcc00]/30',
  };
  return (
    <span className={cn('chip', tones[tone], className)}>{children}</span>
  );
}

export function Modal({
  open, onClose, title, children, width = 520,
}: { open: boolean; onClose: () => void; title?: string; children: React.ReactNode; width?: number }) {
  useEffect(() => {
    const fn = (e: KeyboardEvent) => e.key === 'Escape' && onClose();
    if (open) window.addEventListener('keydown', fn);
    return () => window.removeEventListener('keydown', fn);
  }, [open, onClose]);
  if (!open) return null;
  return (
    <div className="fixed inset-0 z-[80] flex items-center justify-center p-4">
      <div className="absolute inset-0 bg-black/55 backdrop-blur-[2px]" onClick={onClose} />
      <div
        className="relative card w-full max-h-[88vh] overflow-auto p-5"
        style={{ maxWidth: width }}
      >
        {title && (
          <div className="mb-4 flex items-center justify-between">
            <h3 className="text-base font-semibold">{title}</h3>
            <button onClick={onClose} className="rounded-md p-1 text-[var(--muted)] hover:bg-[var(--surface-2)]">
              <X size={16} />
            </button>
          </div>
        )}
        {children}
      </div>
    </div>
  );
}

export function Field({ label, children, hint }: { label: string; children: React.ReactNode; hint?: string }) {
  return (
    <label className="block">
      <span className="label mb-1.5 block">{label}</span>
      {children}
      {hint && <span className="mt-1 block text-xs text-[var(--muted)]">{hint}</span>}
    </label>
  );
}

export function Tabs<T extends string>({
  tabs, value, onChange,
}: { tabs: { id: T; label: string; badge?: string }[]; value: T; onChange: (v: T) => void }) {
  return (
    <div role="tablist" className="flex gap-1 rounded-xl border border-[var(--border)] bg-[var(--surface-2)] p-1">
      {tabs.map((t) => (
        <button
          key={t.id}
          role="tab"
          aria-selected={value === t.id}
          onClick={() => onChange(t.id)}
          className={cn(
            'flex-1 rounded-lg px-3 py-2 text-sm font-medium transition-colors',
            value === t.id
              ? 'bg-[var(--surface)] text-[var(--text)] shadow-sm'
              : 'text-[var(--muted)] hover:text-[var(--text)]',
          )}
        >
          {t.label}
          {t.badge && <span className="ml-2 text-xs text-[var(--muted)]">{t.badge}</span>}
        </button>
      ))}
    </div>
  );
}

export function Spinner({ className }: { className?: string }) {
  return (
    <div className={cn('h-5 w-5 animate-spin rounded-full border-2 border-[var(--border-strong)] border-t-[var(--primary)]', className)} />
  );
}

export function Empty({ title, hint, icon }: { title: string; hint?: string; icon?: React.ReactNode }) {
  return (
    <div className="flex flex-col items-center justify-center gap-2 py-14 text-center">
      <div className="mb-1 text-[var(--muted-2)]">{icon}</div>
      <p className="text-sm font-medium">{title}</p>
      {hint && <p className="max-w-sm text-xs text-[var(--muted)]">{hint}</p>}
    </div>
  );
}
