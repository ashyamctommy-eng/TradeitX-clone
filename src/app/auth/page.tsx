'use client';
import { useState } from 'react';
import { useRouter } from 'next/navigation';
import { ArrowLeft } from 'lucide-react';
import { post } from '@/lib/api';
import { Button, Field } from '@/components/ui';
import { cn } from '@/lib/cn';

export default function AuthPage() {
  const router = useRouter();
  const [tab, setTab] = useState<'signin' | 'signup'>('signin');
  const [form, setForm] = useState({ email: '', password: '', username: '', phoneNumber: '', countryCode: '+254', country: 'KE' });
  const [error, setError] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);

  const submit = async (e: React.FormEvent) => {
    e.preventDefault();
    setBusy(true); setError(null);
    try {
      if (tab === 'signin') await post('/auth/login', { email: form.email, password: form.password });
      else await post('/auth/register', form);
      router.replace('/dashboard');
      router.refresh();
    } catch (err) {
      const code = (err as Error).message;
      setError(
        code === 'INVALID_CREDENTIALS' ? 'Email or password is incorrect.'
          : code === 'EMAIL_TAKEN' ? 'An account with that email already exists.'
          : code === 'ACCOUNT_FROZEN' ? 'This account is frozen. Contact support.'
          : code,
      );
    } finally { setBusy(false); }
  };

  return (
    <div className="flex min-h-screen items-center justify-center bg-[#050505] px-4 py-10">
      <div className="w-full max-w-[430px]">
        <div className="mb-6 flex items-center justify-between">
          <button onClick={() => router.push('/dashboard')} className="flex items-center gap-2 text-sm text-white/50 hover:text-white">
            <ArrowLeft size={15} /> Back
          </button>
          <span className="text-xs uppercase tracking-[0.2em] text-white/30">TradeitX</span>
        </div>

        <div className="rounded-2xl border border-white/10 bg-[#0d0d0f] p-6 shadow-2xl">
          <h1 className="mb-5 text-lg font-semibold text-white">Account Access</h1>

          <div className="mb-5 grid grid-cols-2 gap-1 rounded-lg bg-white/[0.04] p-1">
            {(['signin', 'signup'] as const).map((t) => (
              <button
                key={t}
                onClick={() => { setTab(t); setError(null); }}
                className={cn(
                  'rounded-md py-2 text-sm font-medium transition',
                  tab === t ? 'bg-[#FFCC00] text-black' : 'text-white/60 hover:text-white',
                )}
              >
                {t === 'signin' ? 'Sign In' : 'Sign Up'}
              </button>
            ))}
          </div>

          <form onSubmit={submit} className="space-y-4">
            {tab === 'signup' && (
              <Field label="Username">
                <input className="input bg-white/[0.03] text-white placeholder:text-white/25" placeholder="johndoe"
                  value={form.username} onChange={(e) => setForm({ ...form, username: e.target.value })} required />
              </Field>
            )}
            <Field label="Email">
              <input type="email" className="input bg-white/[0.03] text-white placeholder:text-white/25" placeholder="name@example.com"
                value={form.email} onChange={(e) => setForm({ ...form, email: e.target.value })} required />
            </Field>
            {tab === 'signup' && (
              <div className="grid grid-cols-[86px_1fr] gap-2">
                <Field label="Code">
                  <input className="input bg-white/[0.03] text-white" value={form.countryCode}
                    onChange={(e) => setForm({ ...form, countryCode: e.target.value })} />
                </Field>
                <Field label="Phone number">
                  <input className="input bg-white/[0.03] text-white placeholder:text-white/25" placeholder="712345678"
                    value={form.phoneNumber} onChange={(e) => setForm({ ...form, phoneNumber: e.target.value })} />
                </Field>
              </div>
            )}
            <Field label="Password">
              <input type="password" className="input bg-white/[0.03] text-white placeholder:text-white/25" placeholder="••••••••"
                value={form.password} onChange={(e) => setForm({ ...form, password: e.target.value })} required />
            </Field>
            {error && <p className="rounded-lg border border-red-500/30 bg-red-500/10 px-3 py-2 text-xs text-red-300">{error}</p>}
            <Button type="submit" className="w-full" disabled={busy}>
              {busy ? 'Please wait…' : tab === 'signin' ? 'Sign In' : 'Create Account'}
            </Button>
          </form>

          <p className="mt-4 text-center text-[11px] leading-relaxed text-white/30">
            Demo environment · real-money transfers are gated by <code>ENABLE_LIVE_PAYMENTS</code>.
          </p>
        </div>

        <div className="mt-4 rounded-xl border border-white/10 bg-white/[0.03] p-3 text-[11px] text-white/45">
          <p className="mb-1 font-semibold text-white/60">Seeded logins</p>
          <p>Trader — wildpharmtech9@gmail.com / TraderDemo123!</p>
          <p>Admin — admin@tradeitx.com / BrabicanaAdmin123!</p>
        </div>
      </div>
    </div>
  );
}
