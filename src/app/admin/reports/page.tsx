'use client';

import { useEffect, useMemo, useState } from 'react';
import { auth, db } from '@/lib/firebase.client';
import { onAuthStateChanged, signInAnonymously, User } from 'firebase/auth';
import {
  collection, doc, getDoc, getDocs, query, where, orderBy, limit, Timestamp,
} from 'firebase/firestore';

/** Slots 型別（沿用舊版） */
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

  // —— Slots 統計（沿用舊版） ——
  const [totals, setTotals] = useState({
    slotCount: 0,
    totalCapacity: 0,
    activeBookings: 0,
    utilization: 0,
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

  // —— 推播統計（新） ——
  const [pushStats, setPushStats] = useState({
    rangeText: '',
    total: 0,
    adminTotal: 0,
    userTotal: 0,
    ok: 0,
    failed: 0,
    skipped: 0,
    successRate: 0,
  });
  const [recentPushes, setRecentPushes] = useState<Array<{
    ts: Date | null;
    kind: 'admin' | 'user' | string;
    result: 'OK' | 'Skipped' | 'Failed';
    status?: number | null;
    uid?: string | null;
    to?: string | null;
    preview?: string | null;
    env?: string | null;
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

  // 幫助把陣列切 10 份（slots→bookings 查詢用）
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

      // ----- 1) 近 7 天 slots 統計 -----
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
      const totalCapacity = slots.reduce((sum, s: any) => sum + (s.capacity ?? 1), 0);

      // 取這些 slot 的 bookings（slotId in…）
      const slotIds = slots.map(s => s.id);
      let bookings: any[] = [];
      for (const chunk of chunk10(slotIds)) {
        const qBk = query(collection(db, 'bookings'), where('slotId', 'in', chunk));
        const snap = await getDocs(qBk);
        bookings.push(...snap.docs.map(d => ({ id: d.id, ...(d.data() as any) })));
      }

      const activeSet = new Set(['PENDING', 'CONFIRMED']);
      const activeBySlot = new Map<string, number>();
      for (const b of bookings) {
        if (activeSet.has(b.status)) {
          activeBySlot.set(b.slotId, (activeBySlot.get(b.slotId) ?? 0) + 1);
        }
      }
      const activeBookings = Array.from(activeBySlot.values()).reduce((a, b) => a + b, 0);
      const utilization = totalCapacity > 0 ? activeBookings / totalCapacity : 0;

      // 近期 8 筆 slots 概覽
      // 名稱快取
      const nameCache = new Map<string, string>();
      const getName = async (col: 'services' | 'resources', id: string) => {
        const key = `${col}:${id}`;
        if (nameCache.has(key)) return nameCache.get(key)!;
        const s = await getDoc(doc(db, col, id));
        const name = s.exists() ? ((s.data() as any).name ?? id) : id;
        nameCache.set(key, name);
        return name;
      };
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

      // ----- 2) 近 7 天推播統計 -----
      const since = Timestamp.fromDate(new Date(Date.now() - 7 * 24 * 60 * 60 * 1000));
      const qLogs = query(
        collection(db, 'notifyLogs'),
        where('ts', '>=', since),
        orderBy('ts', 'desc'),
        limit(200),
      );
      const logSnap = await getDocs(qLogs);

      const logs = logSnap.docs.map((d) => {
        const x = d.data() as any;
        const ts: Date | null = x?.ts?.toDate?.() ?? (x?.ts ? new Date(x.ts) : null);
        const kind = x?.kind ?? '';
        const ok = !!x?.ok;
        const skipped = !!x?.skipped;
        const status = x?.status ?? null;
        const uid = x?.uid ?? null;
        const to = x?.toLineUserId ?? null;
        const preview = x?.preview ?? null;
        const env = x?.env ?? null;
        return {
          ts,
          kind,
          result: skipped ? 'Skipped' : ok ? 'OK' : 'Failed',
          status,
          uid,
          to,
          preview,
          env,
        } as {
          ts: Date | null;
          kind: 'admin' | 'user' | string;
          result: 'OK' | 'Skipped' | 'Failed';
          status?: number | null;
          uid?: string | null;
          to?: string | null;
          preview?: string | null;
          env?: string | null;
        };
      });

      const total = logs.length;
      const adminTotal = logs.filter(l => l.kind === 'admin').length;
      const userTotal = logs.filter(l => l.kind === 'user').length;
      const ok = logs.filter(l => l.result === 'OK').length;
      const skipped = logs.filter(l => l.result === 'Skipped').length;
      const failed = logs.filter(l => l.result === 'Failed').length;
      const denom = ok + failed;
      const successRate = denom > 0 ? ok / denom : 0;

      setPushStats({
        rangeText: `近 7 天（${fmt(new Date(Date.now() - 7 * 24 * 60 * 60 * 1000))} ~ ${fmt(new Date())}）`,
        total, adminTotal, userTotal, ok, failed, skipped, successRate,
      });

      setRecentPushes(logs.slice(0, 20));
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
    <main className="p-6 space-y-6">
      <h1 className="text-2xl font-bold">管理端｜報表（未來 7 天 + 推播近 7 天）</h1>
      <div className="text-sm text-gray-600">目前 UID：{user?.uid ?? '(未登入)'}　角色：{role}</div>

      {/* Slots 整體統計 */}
      <section className="space-y-3">
        <h2 className="text-lg font-semibold">預約容量概覽（未來 7 天）</h2>
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

        <h3 className="text-base font-semibold mt-2">近期時段占用（前 8 筆）</h3>
        <ul className="divide-y">
          {topSlots.map((s) => (
            <li key={s.id} className="py-3">
              <div className="font-medium">{fmt(s.startAt)} — {fmt(s.endAt)}</div>
              <div className="text-sm text-gray-600">服務：{s.serviceName}　資源：{s.resourceName}</div>
              <div className="text-xs text-gray-500">
                狀態：{s.status}　容量：{s.capacity}　有效預約：{s.active}　
                佔用率：{s.capacity > 0 ? ((s.active / s.capacity) * 100).toFixed(0) : 0}%
              </div>
            </li>
          ))}
        </ul>
      </section>

      {/* 推播統計 */}
      <section className="space-y-3">
        <h2 className="text-lg font-semibold">LINE 推播統計（{pushStats.rangeText}）</h2>
        <div className="grid gap-3 sm:grid-cols-5">
          <Stat label="推播總數" value={pushStats.total} />
          <Stat label="管理員推播" value={pushStats.adminTotal} />
          <Stat label="學員推播" value={pushStats.userTotal} />
          <Stat label="成功 / 失敗" value={`${pushStats.ok} / ${pushStats.failed}`} />
          <Stat label="成功率（不含跳過）" value={(pushStats.successRate * 100).toFixed(1) + '%'} />
        </div>

        <h3 className="text-base font-semibold mt-2">最新 20 筆推播明細</h3>
        <ul className="divide-y">
          {recentPushes.map((r, i) => (
            <li key={i} className="py-3">
              <div className="text-sm">
                <span className="font-mono">{r.ts ? fmt(r.ts) : '(無時間)'}</span>｜{r.kind.toUpperCase()}｜
                <span className={
                  r.result === 'OK' ? 'text-green-700' :
                  r.result === 'Skipped' ? 'text-gray-600' : 'text-red-700'
                }>
                  {r.result}
                </span>
                {typeof r.status === 'number' ? `（${r.status}）` : ''}
              </div>
              <div className="text-xs text-gray-600">
                {r.kind === 'user' ? `uid=${r.uid ?? '-'}` : `to=${r.to ?? '-'}`}　env={r.env ?? '-'}
              </div>
              {r.preview && <div className="text-xs text-gray-500 mt-1">「{r.preview}」</div>}
            </li>
          ))}
        </ul>
      </section>
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
