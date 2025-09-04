'use client';

import Link from 'next/link';
import { useEffect, useState } from 'react';
import { auth } from '@/lib/firebase.client';
import { onAuthStateChanged, signInAnonymously, User } from 'firebase/auth';

export default function Home() {
  const [user, setUser] = useState<User | null>(null);

  useEffect(() => {
    const unsub = onAuthStateChanged(auth, (u) => setUser(u));
    return () => unsub();
  }, []);

  useEffect(() => {
    // 自動匿名登入（若尚未登入）
    if (!auth.currentUser) {
      signInAnonymously(auth).catch(() => {});
    }
  }, []);

  const Item = ({ href, label, desc }: { href: string; label: string; desc: string }) => (
    <Link
      href={href}
      className="block rounded-2xl border p-4 hover:shadow-sm transition"
    >
      <div className="text-lg font-semibold">{label}</div>
      <div className="text-sm text-gray-600">{desc}</div>
      <div className="mt-2 text-blue-600">前往 →</div>
    </Link>
  );

  return (
    <main className="mx-auto max-w-3xl p-6 space-y-6">
      <h1 className="text-2xl font-bold">預約系統｜快速導覽</h1>
      <div className="text-sm text-gray-600">
        目前 UID：{user?.uid ?? '(未登入)'}（首頁會自動匿名登入）
      </div>

      <div className="grid gap-4 sm:grid-cols-2">
        <Item href="/slots" label="可預約時段" desc="查看未來 7 天可預約時段並一鍵預約" />
        <Item href="/me/bookings" label="我的預約" desc="查看/取消我建立的預約" />
        <Item href="/admin/slots" label="管理端｜排程產生器" desc="批量建立指定日期區間的時段" />
        <Item href="/admin/slots/manage" label="管理端｜時段管理" desc="開關時段、調整容量" />
        <Item href="/debug/seed" label="Debug｜建立範例資料" desc="一鍵產生示範 org/location/slot" />
        <Item href="/debug/firestore" label="Debug｜Firestore 健康檢查" desc="匿名登入＋讀寫測試" />
      </div>

      <p className="text-xs text-gray-500">
        提醒：目前未做角色限制（含匿名可用）。上線前會加上管理者保護與更嚴格的 Firestore 規則。
      </p>
    </main>
  );
}