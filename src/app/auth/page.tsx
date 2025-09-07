'use client';

import { useEffect, useState } from 'react';
import { auth } from '@/lib/firebase.client';
import {
  GoogleAuthProvider,
  signInWithRedirect,
  getRedirectResult,
  signOut,
  onAuthStateChanged,
} from 'firebase/auth';
import Link from 'next/link';

export default function AuthPage() {
  const [uid, setUid] = useState<string | null>(null);
  const [note, setNote] = useState<string>('就緒');

  useEffect(() => {
    const unsub = onAuthStateChanged(auth, (u) => setUid(u?.uid ?? null));
    return () => unsub();
  }, []);

  useEffect(() => {
    getRedirectResult(auth)
      .then((cred) => {
        if (cred?.user) setNote(`登入成功：${cred.user.email ?? cred.user.uid}`);
      })
      .catch((e) => setNote(`回跳錯誤：${e?.code ?? ''} ${e?.message ?? e}`))
      .finally(() => { try { sessionStorage.removeItem('auth:redirect'); } catch {} });
  }, []);

  const login = async () => {
    try { sessionStorage.setItem('auth:redirect', '1'); } catch {}
    setNote('前往 Google 登入…');
    const provider = new GoogleAuthProvider();
    await signInWithRedirect(auth, provider);
  };

  const logout = async () => {
    await signOut(auth);
    setNote('已登出');
  };

  return (
    <main className="mx-auto max-w-md p-6 space-y-4">
      <h1 className="text-2xl font-bold">Google 登入測試（/auth）</h1>
      <div className="text-sm text-gray-600">目前 UID：{uid ?? '(未登入)'}</div>

      <div className="flex gap-2">
        <button onClick={login} className="px-4 py-2 rounded bg-black text-white">使用 Google 登入</button>
        <button onClick={logout} className="px-4 py-2 rounded bg-black text-white">登出</button>
        <Link href="/" className="px-4 py-2 rounded border">回首頁</Link>
      </div>

      <div className="text-sm">{note}</div>
      <p className="text-xs text-gray-500">此頁不會自動匿名登入，適合手機測試 Redirect 流程。</p>
    </main>
  );
}
