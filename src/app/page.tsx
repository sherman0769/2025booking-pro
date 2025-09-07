"use client";

import Link from "next/link";
import { useEffect, useState } from "react";
import { auth } from "@/lib/firebase.client";
import { onAuthStateChanged, signInAnonymously, User } from "firebase/auth";
import AuthButtons from "@/components/AuthButtons";

export default function Home() {
  const [user, setUser] = useState<User | null>(null);

  useEffect(() => onAuthStateChanged(auth, setUser), []);

  useEffect(() => {
    // 正在 Google redirect 流程時，暫停匿名登入，避免回來被覆蓋
    let skipAnon = false;
    try { skipAnon = sessionStorage.getItem('auth:redirect') === '1'; } catch {}
    if (!skipAnon && !auth.currentUser) {
      signInAnonymously(auth).catch(() => {});
    }
  }, []);

  const Item = ({ href, label, desc }: { href: string; label: string; desc: string }) => (
    <Link href={href} className="block rounded-2xl border p-4 hover:shadow-sm transition">
      <div className="text-lg font-semibold">{label}</div>
      <div className="text-sm text-gray-600">{desc}</div>
      <div className="mt-2 text-blue-600">前往 →</div>
    </Link>
  );

  return (
    <main className="mx-auto max-w-3xl p-6 space-y-6">
      <h1 className="text-2xl font-bold">預約系統｜快速導覽</h1>

      <AuthButtons />

      <div className="text-sm text-gray-600">
        目前 UID：{user?.uid ?? "(未登入)"}（未登入時會自動以匿名身分瀏覽，可隨時升級為 Google 登入）
      </div>

      <div className="grid gap-4 sm:grid-cols-2">
        <Item href="/slots" label="可預約時段" desc="查看未來 7 天可預約時段並一鍵預約" />
        <Item href="/me/bookings" label="我的預約" desc="查看/取消我建立的預約" />
        <Item href="/admin/slots" label="管理端｜排程產生器" desc="批量建立指定日期區間的時段" />
        <Item href="/admin/slots/manage" label="管理端｜時段管理" desc="開關時段、調整容量、候補補位" />
        <Item href="/admin/reports" label="管理端｜報表" desc="推播/預約統計、日期範圍、CSV 匯出" />
        <Item href="/me/line" label="綁定 LINE" desc="輸入 6 碼綁定你的 LINE，用於通知" />
      </div>

      <p className="text-xs text-gray-500">提醒：Production 建議關閉 /debug/* 頁面或僅限 ADMIN 可見。</p>
    </main>
  );
}
