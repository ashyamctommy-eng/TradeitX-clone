'use client';
import { useState } from 'react';
import { useRouter } from 'next/navigation';
import { ShieldCheck } from 'lucide-react';
import { api, post } from '@/lib/api';
import { Button, Field } from '@/components/ui';

export default function AdminLogin() {
  const router = useRouter();
  const [email, setEmail] = useState('');
  const [password, setPassword] = useState('');
  const [error, setError] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);

  const submit = async (e: React.FormEvent) => {
    e.preventDefault();
    setBusy(true); setError(null);
    try {
      await post('/auth/login', { email, password });
      const me = await api<{ userType: string }>('/me');
      if (me.userType !== 'admin') {
        await post('/auth/logout').catch(() => {});
        setError('This account does not have management access.');
        return;
      }
      router.replace('/brabicana');
    } catch (err) {
      setError((err as Error).message === 'INVALID_CREDENTIALS' ? 'Email or password is incorrect.' : (err as Error).message);
    } finally { setBusy(false); }
  };

  return (
    <div className="flex min-h-screen items-center justify-center bg-[#070708] px-4">
      <div className="w-full max-w-[400px]">
        <div className="mb-5 flex items-center gap-2 text-white/70">
          <div className="grid h-8 w-8 place-items-center rounded-lg bg-[#FFCC00] text-black"><ShieldCheck size={17} /></div>
          <span className="text-sm font-semibold tracking-tight">Management Portal</span>
        </div>
        <form onSubmit={submit} className="rounded-2xl border border-white/10 bg-[#0e0e10] p-6 shadow-2xl">
          <h1 className="text-lg font-semibold text-white">Log in to access the management dashboard</h1>
          <p className="mt-1 text-xs text-white/40">Restricted to treasury, compliance and support staff.</p>
          <div className="mt-5 space-y-3">
            <Field label="Email">
              <input className="input border-white/10 bg-white/[0.04] text-white placeholder:text-white/25" type="email"
                value={email} onChange={(e) => setEmail(e.target.value)} placeholder="admin@tradeitx.com" required />
            </Field>
            <Field label="Password">
              <input className="input border-white/10 bg-white/[0.04] text-white placeholder:text-white/25" type="password"
                value={password} onChange={(e) => setPassword(e.target.value)} placeholder="••••••••" required />
            </Field>
            {error && <p className="rounded-lg border border-red-500/30 bg-red-500/10 px-3 py-2 text-xs text-red-300">{error}</p>}
            <Button type="submit" className="w-full" disabled={busy}>{busy ? 'Signing in…' : 'Log In'}</Button>
          </div>
          <p className="mt-5 text-[11px] text-white/25">admin@tradeitx.com / BrabicanaAdmin123!</p>
        </form>
      </div>
    </div>
  );
}
