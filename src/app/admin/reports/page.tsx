'use client';

import { useEffect, useMemo, useState } from 'react';
import { auth, db } from '@/lib/firebase.client';
import { onAuthStateChanged, signInAnonymously, User } from 'firebase/auth';
import {
  collection, doc, getDoc, getDocs, query, where, orderBy, limit,
  Timestamp,
} from 'firebase/firestore';

type SlotDoc = {
  resourceId: string;
  serviceId: string;
  startAt: Timestamp;
  endAt: Timestamp;
  status?: 'OPEN' | 'CLOSED' | 'FULL';
  capacity?: number;
};

export default function AdminReportsPage() {
  const [user, setUser] = useState<User | null>(null);
  const [role, setRole] = useState<string | null>(null); // 'ADMIN' | 'MEMBER' | null
  const [busy, setBusy] = useState(false);
  const [err, setErr] = useState<string | null>(null);

  const [totals, setTotals] = useState({
    slotCount: 0,
    totalCapacity: 0,
    activeBookings: 0, // PENDING + CONFIRMED
    utilization: 0,    // activeBookings / totalCapacity
  });

  const [topSlots, setTopSlots] = useState<Array<{
    id: string;
    startAt: Date;
    endAt: Date;
    serviceName: string;
    resourceName: string;
    capacity: number;
    active: number;
    status: string;
  }>>([]);

  // 登入 + 角色
  useEffect(() => {
    const unsub = onAuthStateChanged(auth, async (u) => {
      setUser(u);
      if (!u) {
        await signInAnonymously(auth).catch(() => {});
        setRole(null);
        return;
      }
      try {
        const snap = await getDoc(doc(db, 'userRoles', u.uid));
        setRole(snap.exists() ? ((snap.data() as any).role ?? 'MEMBER') : 'MEMBER');
      } catch {
        setRole('MEMBER');
      }
    });
    return () => unsub();
  }, []);

  const ensureSignedIn = async () => {
    if (!auth.currentUser) await signInAnonymously(auth);
  };

  const fmt = (d: Date) =>
    d.toLocaleString('zh-TW', {
      timeZone: 'Asia/Taipei',
      year: 'numeric',
      month: '2-digit',
      day: '2-digit',
      hour: '2-digit',
      minute: '2-digit',
      hour12: false,
    });

  // 把陣列切成 10 筆一組（Firestore 'in' 最多 10）
  const chunk10 = <T,>(arr: T[]): T[][] => {
    const out: T[][] = [];
    for (let i = 0; i < arr.length; i += 10) out.push(arr.slice(i, i + 10));
    return out;
  };

  const load = async () => {
    setBusy(true);
    setErr(null);
    try {
      await ensureSignedIn();

      // 1) 取未來 7 天的 slots
      const now = Timestamp.now();
      const to = Timestamp.fromDate(new Date(Date.now() + 7 * 24 * 60 * 60 * 1000));
      const qSlots = query(
        collection(db, 'slots'),
        where('startAt', '>=', now),
        where('startAt', '<=', to),
        orderBy('startAt', 'asc'),
        limit(500),
      );
      const slotSnap = await getDocs(qSlots);
      const slots = slotSnap.docs.map(d => ({ id: d.id, ...(d.data() as SlotDoc) }));

      // 總容量（capacity 預設 1）
      const totalCapacity = slots.reduce((sum, s: any) => sum + (s.capacity ?? 1), 0);

      // 2) 取這些 slot 的 bookings（用 slotId in 分批；不過濾狀態，前端統計）
      const slotIds = slots.map(s => s.id);
      let bookings: any[] = [];
      for (const chunk of chunk10(slotIds)) {
        const qBk = query(collection(db, 'bookings'), where('slotId', 'in', chunk));
        const snap = await getDocs(qBk);
        bookings.push(...snap.docs.map(d => ({ id: d.id, ...(d.data() as any) })));
      }

      // 3) 名稱快取（service/resource）
      const nameCache = new Map<string, string>();
      const getName = async (col: 'services' | 'resources', id: string) => {
        const key = `${col}:${id}`;
        if (nameCache.has(key)) return nameCache.get(key)!;
        const s = await getDoc(doc(db, col, id));
        const name = s.exists() ? ((s.data() as any).name ?? id) : id;
        nameCache.set(key, name);
        return name;
      };

      // 4) 計數
      const activeSet = new Set(['PENDING', 'CONFIRMED']);
      const activeBySlot = new Map<string, number>();
      for (const b of bookings) {
        if (activeSet.has(b.status)) {
          activeBySlot.set(b.slotId, (activeBySlot.get(b.slotId) ?? 0) + 1);
        }
      }
      const activeBookings = Array.from(activeBySlot.values()).reduce((a, b) => a + b, 0);
      const utilization = totalCapacity > 0 ? activeBookings / totalCapacity : 0;

      // 5) 取前 8 個即將到來的 slot，附上名稱與占用
      const top = await Promise.all(
        slots.slice(0, 8).map(async (s: any) => {
          const serviceName = await getName('services', s.serviceId);
          const resourceName = await getName('resources', s.resourceId);
          return {
            id: s.id,
            startAt: s.startAt.toDate(),
            endAt: s.endAt.toDate(),
            serviceName,
            resourceName,
            capacity: s.capacity ?? 1,
            active: activeBySlot.get(s.id) ?? 0,
            status: s.status ?? 'OPEN',
          };
        })
      );

      setTotals({
        slotCount: slots.length,
        totalCapacity,
        activeBookings,
        utilization,
      });
      setTopSlots(top);
    } catch (e: any) {
      setErr(e?.message ?? String(e));
    } finally {
      setBusy(false);
    }
  };

  useEffect(() => {
    load();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  // —— 前端權限保護（403） ——
  if (role === null) return <main className="p-6">載入權限中…</main>;
  if (role !== 'ADMIN') {
    return (
      <main className="p-6 space-y-3">
        <h1 className="text-2xl font-bold">管理端｜報表</h1>
        <div className="p-3 rounded border bg-red-50 text-red-700">
          403｜你沒有權限檢視此頁（需要 ADMIN 角色）。
        </div>
        <div className="text-sm text-gray-600">
          若為開發測試，可到 <code>/debug/grant-admin</code> 先授予自己 ADMIN。
        </div>
      </main>
    );
  }

  return (
    <main className="p-6 space-y-5">
      <h1 className="text-2xl font-bold">管理端｜報表（未來 7 天）</h1>
      <div className="text-sm text-gray-600">目前 UID：{user?.uid ?? '(未登入)'}　角色：{role}</div>

      <div className="grid gap-3 sm:grid-cols-4">
        <Stat label="時段數" value={totals.slotCount} />
        <Stat label="總容量" value={totals.totalCapacity} />
        <Stat label="有效預約（PENDING+CONFIRMED）" value={totals.activeBookings} />
        <Stat label="利用率" value={(totals.utilization * 100).toFixed(1) + '%'} />
      </div>

      <div className="flex gap-2">
        <button
          onClick={load}
          className="px-4 py-2 rounded bg-black text-white disabled:opacity-50"
          disabled={busy}
        >
          {busy ? '載入中…' : '重新整理'}
        </button>
      </div>

      {err && <div className="p-3 bg-red-50 text-red-700 rounded border border-red-200">{err}</div>}

      <h2 className="text-lg font-semibold mt-2">近期時段占用（前 8 筆）</h2>
      <ul className="divide-y">
        {topSlots.map((s) => (
          <li key={s.id} className="py-3">
            <div className="font-medium">
              {fmt(s.startAt)} — {fmt(s.endAt)}
            </div>
            <div className="text-sm text-gray-600">
              服務：{s.serviceName}　資源：{s.resourceName}
            </div>
            <div className="text-xs text-gray-500">
              狀態：{s.status}　容量：{s.capacity}　有效預約：{s.active}　
              佔用率：{s.capacity > 0 ? ((s.active / s.capacity) * 100).toFixed(0) : 0}%
            </div>
          </li>
        ))}
      </ul>
    </main>
  );
}

function Stat({ label, value }: { label: string; value: string | number }) {
  return (
    <div className="rounded-2xl border p-4">
      <div className="text-sm text-gray-600">{label}</div>
      <div className="text-2xl font-semibold">{value}</div>
    </div>
  );
}