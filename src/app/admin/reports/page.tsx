'use client';

import { useEffect, useMemo, useState } from 'react';
import { auth, db } from '@/lib/firebase.client';
import { onAuthStateChanged, signInAnonymously, User } from 'firebase/auth';
import {
  collection, doc, getDoc, getDocs, query, where, orderBy, limit, Timestamp,
} from 'firebase/firestore';

// --- CSV helpers ---
function toCsvRow(vals: (string | number | null | undefined)[]) {
  return vals.map(v => `"${String(v ?? '').replace(/"/g, '""')}"`).join(',');
}
function downloadCsv(filename: string, lines: string[]) {
  const blob = new Blob([lines.join('\r\n')], { type: 'text/csv;charset=utf-8;' });
  const url = URL.createObjectURL(blob);
  const a = document.createElement('a');
  a.href = url; a.download = filename; a.click();
  URL.revokeObjectURL(url);
}

/** Slots 型別（沿用舊版） */
type SlotDoc = {
  resourceId: string;
  serviceId: string;
  startAt: Timestamp;
  endAt: Timestamp;
  status?: 'OPEN' | 'CLOSED' | 'FULL';
  capacity?: number;
};

type RangePreset = '24h' | '7d' | '30d' | 'custom';

export default function AdminReportsPage() {
  const [user, setUser] = useState<User | null>(null);
  const [role, setRole] = useState<string | null>(null); // 'ADMIN' | 'MEMBER' | null
  const [busy, setBusy] = useState(false);
  const [err, setErr] = useState<string | null>(null);

  // —— Slots 統計（固定「未來 7 天」） ——
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

  // —— 推播統計（可調日期範圍） ——
  const [preset, setPreset] = useState<RangePreset>('7d');
  const [startInput, setStartInput] = useState<string>(''); // datetime-local
  const [endInput, setEndInput] = useState<string>('');     // datetime-local
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

  // 供折線圖使用：按日彙整成功率（0~100）
  const [rateSeries, setRateSeries] = useState<Array<{ label: string; rate: number }>>([]);

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

  // 由 preset / 自訂輸入，計算 notifyLogs 的時間範圍
  const computeLogRange = () => {
    const now = Date.now();
    if (preset === '24h') {
      return { since: new Date(now - 24 * 60 * 60 * 1000), until: new Date(now) };
    }
    if (preset === '7d') {
      return { since: new Date(now - 7 * 24 * 60 * 60 * 1000), until: new Date(now) };
    }
    if (preset === '30d') {
      return { since: new Date(now - 30 * 24 * 60 * 60 * 1000), until: new Date(now) };
    }
    // custom
    const s = startInput ? new Date(startInput) : null;
    const e = endInput ? new Date(endInput) : null;
    return {
      since: s ?? new Date(now - 7 * 24 * 60 * 60 * 1000),
      until: e ?? new Date(now),
    };
  };

  const load = async () => {
    setBusy(true);
    setErr(null);
    try {
      await ensureSignedIn();

      // ----- 1) 近 7 天 slots 統計（固定） -----
      const nowTs = Timestamp.now();
      const to7d = Timestamp.fromDate(new Date(Date.now() + 7 * 24 * 60 * 60 * 1000));
      const qSlots = query(
        collection(db, 'slots'),
        where('startAt', '>=', nowTs),
        where('startAt', '<=', to7d),
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

      // ----- 2) 推播統計（依據範圍） -----
      const { since, until } = computeLogRange();
      const sinceTs = Timestamp.fromDate(since);
      const untilTs = Timestamp.fromDate(until);

      const qLogs = query(
        collection(db, 'notifyLogs'),
        where('ts', '>=', sinceTs),
        where('ts', '<=', untilTs),
        orderBy('ts', 'desc'),
        limit(500),
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
        rangeText: `${fmt(since)} ~ ${fmt(until)}`,
        total, adminTotal, userTotal, ok, failed, skipped, successRate,
      });
      setRecentPushes(logs.slice(0, 20));

      // —— 2.1 生成「每日成功率」序列（提供折線圖）
      // 先建每日桶（YYYY-MM-DD）
      const bucket = new Map<string, { ok: number; fail: number }>();
      for (const l of logs) {
        if (!l.ts) continue;
        const d = new Date(l.ts);
        const key = d.toLocaleDateString('zh-TW', { timeZone: 'Asia/Taipei', year: 'numeric', month: '2-digit', day: '2-digit' });
        const cur = bucket.get(key) ?? { ok: 0, fail: 0 };
        if (l.result === 'OK') cur.ok += 1;
        else if (l.result === 'Failed') cur.fail += 1;
        bucket.set(key, cur);
      }
      // 依日期升冪
      const keys = Array.from(bucket.keys()).sort((a, b) => new Date(a).getTime() - new Date(b).getTime());
      const series = keys.map(k => {
        const v = bucket.get(k)!;
        const denomDay = v.ok + v.fail;
        const rate = denomDay > 0 ? (v.ok / denomDay) * 100 : 0;
        return { label: k, rate };
      });
      setRateSeries(series);
    } catch (e: any) {
      setErr(e?.message ?? String(e));
    } finally {
      setBusy(false);
    }
  };

  // preset 改變就重新載入（custom 由「套用」按鈕觸發）
  useEffect(() => {
    if (preset !== 'custom') load();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [preset]);

  // 匯出「最新明細」CSV（依目前範圍 recentPushes）
  const exportRecentCsv = () => {
    const header = ['ts', 'kind', 'result', 'status', 'uid', 'to', 'env', 'preview'];
    const rows = recentPushes.map((r) => [
      r.ts ? r.ts.toISOString() : '',
      r.kind,
      r.result,
      r.status ?? '',
      r.uid ?? '',
      r.to ?? '',
      r.env ?? '',
      r.preview ?? '',
    ]);
    const lines = [toCsvRow(header), ...rows.map(toCsvRow)];
    downloadCsv(`notify_logs_${Date.now()}.csv`, lines);
  };

  // 匯出「彙總」CSV（依目前範圍 pushStats）
  const exportSummaryCsv = () => {
    const s = pushStats;
    const lines = [
      toCsvRow(['range', s.rangeText]),
      toCsvRow(['total', s.total]),
      toCsvRow(['adminTotal', s.adminTotal]),
      toCsvRow(['userTotal', s.userTotal]),
      toCsvRow(['ok', s.ok]),
      toCsvRow(['failed', s.failed]),
      toCsvRow(['skipped', s.skipped]),
      toCsvRow(['successRate(%)', (s.successRate * 100).toFixed(1)]),
      toCsvRow(['generatedAt', new Date().toISOString()]),
    ];
    downloadCsv(`notify_summary_${Date.now()}.csv`, lines);
  };

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
      <h1 className="text-2xl font-bold">管理端｜報表（未來 7 天 + 推播可選範圍）</h1>
      <div className="text-sm text-gray-600">目前 UID：{user?.uid ?? '(未登入)'}　角色：{role}</div>

      {/* Slots 統計（未來 7 天） */}
      <section className="space-y-3">
        <h2 className="text-lg font-semibold">預約容量概覽（未來 7 天）</h2>
        <div className="grid gap-3 sm:grid-cols-4">
          <Stat label="時段數" value={totals.slotCount} />
          <Stat label="總容量" value={totals.totalCapacity} />
          <Stat label="有效預約（PENDING+CONFIRMED）" value={totals.activeBookings} />
          <Stat label="利用率" value={(totals.utilization * 100).toFixed(1) + '%'} />
        </div>

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

      {/* 推播統計（可選範圍） */}
      <section className="space-y-3">
        <div className="flex items-end gap-3 justify-between flex-wrap">
          <h2 className="text-lg font-semibold">LINE 推播統計</h2>
          <div className="flex items-end gap-2">
            {/* 預設範圍選單 */}
            <div className="flex rounded-xl border overflow-hidden">
              <button
                onClick={() => setPreset('24h')}
                className={`px-3 py-2 text-sm ${preset==='24h'?'bg-black text-white':'bg-white'}`}
              >近 24 小時</button>
              <button
                onClick={() => setPreset('7d')}
                className={`px-3 py-2 text-sm ${preset==='7d'?'bg-black text-white':'bg-white'}`}
              >近 7 天</button>
              <button
                onClick={() => setPreset('30d')}
                className={`px-3 py-2 text-sm ${preset==='30d'?'bg-black text-white':'bg-white'}`}
              >近 30 天</button>
              <button
                onClick={() => setPreset('custom')}
                className={`px-3 py-2 text-sm ${preset==='custom'?'bg-black text-white':'bg-white'}`}
              >自訂</button>
            </div>

            {/* 自訂區間（datetime-local） */}
            {preset === 'custom' && (
              <div className="flex items-end gap-2">
                <label className="text-sm">
                  <div className="text-xs text-gray-600">起</div>
                  <input
                    type="datetime-local"
                    className="border rounded px-2 py-1"
                    value={startInput}
                    onChange={(e)=>setStartInput(e.target.value)}
                  />
                </label>
                <label className="text-sm">
                  <div className="text-xs text-gray-600">迄</div>
                  <input
                    type="datetime-local"
                    className="border rounded px-2 py-1"
                    value={endInput}
                    onChange={(e)=>setEndInput(e.target.value)}
                  />
                </label>
                <button onClick={load} className="px-3 py-2 rounded bg-black text-white">套用</button>
              </div>
            )}
          </div>
        </div>

        <div className="grid gap-3 sm:grid-cols-5">
          <Stat label="範圍" value={pushStats.rangeText || '—'} />
          <Stat label="推播總數" value={pushStats.total} />
          <Stat label="管理員推播" value={pushStats.adminTotal} />
          <Stat label="學員推播" value={pushStats.userTotal} />
          <Stat label="成功率（不含跳過）" value={(pushStats.successRate * 100).toFixed(1) + '%'} />
        </div>

        {/* 成功率折線圖（依日彙整） */}
        <SuccessRateChart series={rateSeries} />

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

        <div className="flex gap-2 flex-wrap">
          <button
            onClick={load}
            className="px-4 py-2 rounded bg-black text-white disabled:opacity-50"
            disabled={busy}
          >
            {busy ? '載入中…' : '重新整理'}
          </button>
          <button
            onClick={() => {
              const header = ['ts', 'kind', 'result', 'status', 'uid', 'to', 'env', 'preview'];
              const rows = recentPushes.map((r) => [
                r.ts ? r.ts.toISOString() : '',
                r.kind, r.result, r.status ?? '', r.uid ?? '', r.to ?? '', r.env ?? '', r.preview ?? '',
              ]);
              const lines = [toCsvRow(header), ...rows.map(toCsvRow)];
              downloadCsv(`notify_logs_${Date.now()}.csv`, lines);
            }}
            className="px-4 py-2 rounded bg-black text-white"
          >
            匯出明細 CSV
          </button>
          <button
            onClick={() => {
              const s = pushStats;
              const lines = [
                toCsvRow(['range', s.rangeText]),
                toCsvRow(['total', s.total]),
                toCsvRow(['adminTotal', s.adminTotal]),
                toCsvRow(['userTotal', s.userTotal]),
                toCsvRow(['ok', s.ok]),
                toCsvRow(['failed', s.failed]),
                toCsvRow(['skipped', s.skipped]),
                toCsvRow(['successRate(%)', (s.successRate * 100).toFixed(1)]),
                toCsvRow(['generatedAt', new Date().toISOString()]),
              ];
              downloadCsv(`notify_summary_${Date.now()}.csv`, lines);
            }}
            className="px-4 py-2 rounded bg-black text-white"
          >
            匯出彙總 CSV
          </button>

          {err && <div className="p-3 bg-red-50 text-red-700 rounded border border-red-200">{err}</div>}
        </div>
      </section>
    </main>
  );
}

function Stat({ label, value }: { label: string; value: string | number }) {
  return (
    <div className="rounded-2xl border p-4">
      <div className="text-sm text-gray-600">{label}</div>
      <div className="text-2xl font-semibold break-all">{value}</div>
    </div>
  );
}

/** 簡易成功率折線圖（0~100%） */
function SuccessRateChart({ series }: { series: Array<{ label: string; rate: number }> }) {
  if (!series.length) {
    return <div className="text-sm text-gray-500">此範圍內沒有可統計的推播資料。</div>;
  }

  const W = 720;
  const H = 220;
  const PAD = { l: 48, r: 12, t: 16, b: 40 };
  const innerW = W - PAD.l - PAD.r;
  const innerH = H - PAD.t - PAD.b;

  const xs = series.map((_, i) => (series.length === 1 ? innerW / 2 : (i / (series.length - 1)) * innerW));
  const ys = series.map(s => innerH - Math.round((s.rate / 100) * innerH));

  const path = xs.map((x, i) => `${i === 0 ? 'M' : 'L'} ${PAD.l + x} ${PAD.t + ys[i]}`).join(' ');

  // y 軸格線（每 20%）
  const yTicks = [0, 20, 40, 60, 80, 100];

  return (
    <div className="rounded-2xl border p-3">
      <div className="text-sm text-gray-600 mb-2">成功率（%）</div>
      <svg width="100%" viewBox={`0 0 ${W} ${H}`} role="img" aria-label="Success Rate Line Chart">
        {/* y 軸格線與標籤 */}
        {yTicks.map((v, i) => {
          const y = PAD.t + (innerH - (v / 100) * innerH);
          return (
            <g key={i}>
              <line x1={PAD.l} y1={y} x2={PAD.l + innerW} y2={y} stroke="#eee" />
              <text x={PAD.l - 8} y={y + 4} textAnchor="end" fontSize="10" fill="#666">{v}%</text>
            </g>
          );
        })}
        {/* x 軸標籤（最多顯示 12 個，避免重疊） */}
        {series.map((s, i) => {
          const x = PAD.l + xs[i];
          const show = series.length <= 12 || i % Math.ceil(series.length / 12) === 0;
          return show ? (
            <text key={i} x={x} y={H - 8} fontSize="10" textAnchor="middle" fill="#666">
              {s.label.slice(5)}{/* 只顯示 MM/DD */}
            </text>
          ) : null;
        })}
        {/* 折線 */}
        <path d={path} fill="none" stroke="#111" strokeWidth="2" />
        {/* 點 */}
        {xs.map((x, i) => (
          <circle key={i} cx={PAD.l + x} cy={PAD.t + ys[i]} r="3" fill="#111" />
        ))}
      </svg>
    </div>
  );
}
