'use client';
import { createContext, useCallback, useContext, useEffect, useMemo, useState } from 'react';
import { api, patch } from '@/lib/api';
import { getSocket } from '@/lib/socket';

export type Me = {
  id: string; email: string; username: string; phoneNumber: string | null;
  countryCode: string; country: string; preferredAccountType: 'real' | 'demo';
  userType: 'standard' | 'vip' | 'admin'; frozen: boolean; kycRequired: boolean;
  createdAt: string;
  balances: Record<string, { amount: number; locked: number }>;
};

type Ctx = {
  me: Me | null;
  loading: boolean;
  account: 'real' | 'demo';
  setAccount: (a: 'real' | 'demo') => Promise<void>;
  balance: number;
  refresh: () => Promise<void>;
};

const UserCtx = createContext<Ctx>(null as unknown as Ctx);

export function UserProvider({ children }: { children: React.ReactNode }) {
  const [me, setMe] = useState<Me | null>(null);
  const [loading, setLoading] = useState(true);

  const refresh = useCallback(async () => {
    try {
      const data = await api<Me>('/me');
      setMe(data);
    } catch {
      setMe(null);
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => { refresh(); }, [refresh]);

  useEffect(() => {
    if (!me) return;
    const s = getSocket();
    const onBalance = (b: Me['balances']) => setMe((prev) => (prev ? { ...prev, balances: b } : prev));
    const onAccount = (p: Partial<Me>) => setMe((prev) => (prev ? { ...prev, ...p } : prev));
    s.on('balance:update', onBalance);
    s.on('account:update', onAccount);
    return () => { s.off('balance:update', onBalance); s.off('account:update', onAccount); };
  }, [me?.id]);

  const setAccount = useCallback(async (a: 'real' | 'demo') => {
    await patch('/profile', { preferredAccountType: a });
    setMe((prev) => (prev ? { ...prev, preferredAccountType: a } : prev));
  }, []);

  const value = useMemo<Ctx>(() => {
    const account = me?.preferredAccountType ?? 'real';
    return {
      me, loading, account, setAccount,
      balance: me?.balances?.[account]?.amount ?? 0,
      refresh,
    };
  }, [me, loading, setAccount, refresh]);

  return <UserCtx.Provider value={value}>{children}</UserCtx.Provider>;
}

export const useUser = () => useContext(UserCtx);
