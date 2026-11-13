'use client';
import { useEffect, useState } from 'react';
import { setStorageOwner } from '@/lib/account-storage';
export default function AccountWorkspace({ owner, children }: { owner: string; children: React.ReactNode }) {
  const [readyOwner, setReadyOwner] = useState('');
  useEffect(() => { setStorageOwner(owner); setReadyOwner(owner); }, [owner]);
  return readyOwner === owner ? <>{children}</> : <div className="account-loading" role="status">正在打开你的学习记录…</div>;
}
