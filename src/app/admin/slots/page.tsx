"use client";

import { useEffect, useMemo, useState } from "react";
import { auth, db } from "@/lib/firebase.client";
import { onAuthStateChanged, signInAnonymously, User } from "firebase/auth";
import { collection, getDocs, doc, getDoc, setDoc, serverTimestamp, Timestamp } from "firebase/firestore";

type Option = { id: string; name: string };

function combineDateTime(date: string, time: string) {
  const [y, m, d] = date.split("-").map(Number);
  const [hh, mm] = time.split(":").map(Number);
  return new Date(y, m - 1, d, hh, mm, 0);
}

export default function AdminSlotsGenerator() {
  const [user, setUser] = useState<User | null>(null);
  const [role, setRole] = useState<string | null>(null); // "ADMIN" | "MEMBER" | null
  const [resources, setResources] = useState<Option[]>([]);
  const [services, setServices] = useState<Option[]>([]);
  const [resourceId, setResourceId] = useState("");
  const [serviceId, setServiceId] = useState("");

  const todayISO = new Date().toISOString().slice(0, 10);
  const [startDate, setStartDate] = useState(todayISO);
  const [endDate, setEndDate] = useState(todayISO);
  const [startTime, setStartTime] = useState("10:00");
  const [endTime, setEndTime] = useState("18:00");
  const [durationMin, setDurationMin] = useState(60);
  const [gapMin, setGapMin] = useState(0);
  const [capacity, setCapacity] = useState(1);
  const [dow, setDow] = useState<Set<number>>(new Set([0,1,2,3,4,5,6]));

  const [status, setStatus] = useState<string>("就緒");
  const [error, setError] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);

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
        const snap = await getDoc(doc(db, "userRoles", u.uid));
        setRole(snap.exists() ? ((snap.data() as any).role ?? "MEMBER") : "MEMBER");
      } catch {
        setRole("MEMBER");
      }
    });
    return () => unsub();
  }, []);

  const ensureSignedIn = async () => { if (!auth.currentUser) await signInAnonymously(auth); };

  // 載入選項
  useEffect(() => {
    (async () => {
      await ensureSignedIn();
      const [resSnap, svcSnap] = await Promise.all([
        getDocs(collection(db, "resources")),
        getDocs(collection(db, "services")),
      ]);
      const res: Option[] = resSnap.docs.map(d => ({ id: d.id, name: (d.data() as any).name ?? d.id }));
      const svc: Option[] = svcSnap.docs.map(d => ({ id: d.id, name: (d.data() as any).name ?? d.id }));
      setResources(res);
      setServices(svc);
      if (!resourceId && res[0]) setResourceId(res[0].id);
      if (!serviceId && svc[0]) setServiceId(svc[0].id);
    })().catch(e => setError(e?.message ?? String(e)));
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  const toggleDow = (d: number) => {
    const next = new Set(dow);
    next.has(d) ? next.delete(d) : next.add(d);
    setDow(next);
  };

  const generate = async () => {
    try {
      setBusy(true); setError(null); setStatus("產生中…");
      if (!resourceId || !serviceId) throw new Error("請選擇資源與服務");
      if (durationMin <= 0) throw new Error("時段長度需大於 0");
      const start = new Date(startDate); const end = new Date(endDate);
      if (isNaN(start.getTime()) || isNaN(end.getTime())) throw new Error("日期不正確");
      if (start > end) throw new Error("起訖日期不正確");
      const stepMs = (durationMin + gapMin) * 60 * 1000;

      let created = 0, skipped = 0;

      for (let day = new Date(start.getFullYear(), start.getMonth(), start.getDate());
           day <= end;
           day = new Date(day.getFullYear(), day.getMonth(), day.getDate() + 1)) {
        if (!dow.has(day.getDay())) continue;

        const dateISO = day.toISOString().slice(0,10);
        const dayStart = combineDateTime(dateISO, startTime);
        const dayEnd   = combineDateTime(dateISO, endTime);
        if (dayStart >= dayEnd) continue;

        for (let cur = dayStart; cur < dayEnd; cur = new Date(cur.getTime() + stepMs)) {
          const slotStart = cur;
          const slotEnd = new Date(cur.getTime() + durationMin * 60 * 1000);
          if (slotEnd > dayEnd) break;

          const slotId = `${resourceId}_${slotStart.getTime()}`;
          const ref = doc(db, "slots", slotId);
          const exists = await getDoc(ref);
          if (exists.exists()) { skipped++; continue; }

          await setDoc(ref, {
            resourceId, serviceId,
            startAt: Timestamp.fromDate(slotStart),
            endAt:   Timestamp.fromDate(slotEnd),
            status: "OPEN", capacity,
            createdAt: serverTimestamp(),
          });
          created++;
        }
      }

      setStatus(`完成：建立 ${created} 筆，略過 ${skipped} 筆 ✅`);
    } catch (e: any) {
      setError(e?.message ?? String(e));
    } finally {
      setBusy(false);
    }
  };

  const fmtDow = (d: number) => ["日","一","二","三","四","五","六"][d];
  const canSubmit = useMemo(() => !!resourceId && !!serviceId && !busy, [resourceId, serviceId, busy]);

  // —— 權限保護（403） ——
  if (role === null) return <main className="p-6">載入權限中…</main>;
  if (role !== "ADMIN") {
    return (
      <main className="p-6 space-y-3">
        <h1 className="text-2xl font-bold">管理端｜排程產生器</h1>
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
    <main className="p-6 space-y-4">
      <h1 className="text-2xl font-bold">管理端｜排程產生器</h1>
      <div className="text-sm text-gray-600">目前 UID：{user?.uid ?? "(未登入)"}　角色：{role}</div>

      <div className="grid gap-4 sm:grid-cols-2">
        <label className="space-y-1">
          <div className="text-sm">資源（教練/房間）</div>
          <select className="border p-2 rounded w-full" value={resourceId} onChange={e=>setResourceId(e.target.value)}>
            {resources.map(r => <option key={r.id} value={r.id}>{r.name}</option>)}
          </select>
        </label>

        <label className="space-y-1">
          <div className="text-sm">服務</div>
          <select className="border p-2 rounded w-full" value={serviceId} onChange={e=>setServiceId(e.target.value)}>
            {services.map(s => <option key={s.id} value={s.id}>{s.name}</option>)}
          </select>
        </label>

        <label className="space-y-1">
          <div className="text-sm">起始日期</div>
          <input type="date" className="border p-2 rounded w-full" value={startDate} onChange={e=>setStartDate(e.target.value)} />
        </label>
        <label className="space-y-1">
          <div className="text-sm">結束日期（含）</div>
          <input type="date" className="border p-2 rounded w-full" value={endDate} onChange={e=>setEndDate(e.target.value)} />
        </label>

        <label className="space-y-1">
          <div className="text-sm">每日開始時間</div>
          <input type="time" className="border p-2 rounded w-full" value={startTime} onChange={e=>setStartTime(e.target.value)} />
        </label>
        <label className="space-y-1">
          <div className="text-sm">每日結束時間</div>
          <input type="time" className="border p-2 rounded w-full" value={endTime} onChange={e=>setEndTime(e.target.value)} />
        </label>

        <label className="space-y-1">
          <div className="text-sm">時段長度（分鐘）</div>
          <input type="number" className="border p-2 rounded w-full" value={durationMin} onChange={e=>setDurationMin(parseInt(e.target.value||"0"))} />
        </label>
        <label className="space-y-1">
          <div className="text-sm">時段間隔（分鐘）</div>
          <input type="number" className="border p-2 rounded w-full" value={gapMin} onChange={e=>setGapMin(parseInt(e.target.value||"0"))} />
        </label>

        <label className="space-y-1">
          <div className="text-sm">容量（每時段可預約人數）</div>
          <input type="number" className="border p-2 rounded w-full" value={capacity} onChange={e=>setCapacity(parseInt(e.target.value||"1"))} />
        </label>
      </div>

      <div className="space-y-2">
        <div className="text-sm">適用星期</div>
        <div className="flex flex-wrap gap-2">
          {[0,1,2,3,4,5,6].map(d => (
            <label key={d} className="inline-flex items-center gap-1">
              <input type="checkbox" checked={dow.has(d)} onChange={()=>toggleDow(d)} />
              <span>週{fmtDow(d)}</span>
            </label>
          ))}
        </div>
      </div>

      <button
        onClick={generate}
        disabled={!canSubmit}
        className="px-4 py-2 rounded text-white bg-black disabled:opacity-50 disabled:cursor-not-allowed"
      >
        {busy ? "產生中…" : "批量產生時段"}
      </button>

      {error && <div className="p-3 bg-red-50 text-red-700 rounded border border-red-200">{error}</div>}
      <div className="text-sm text-gray-700">{status}</div>

      <p className="text-xs text-gray-500">
        備註：為避免重複，系統用「resourceId + 開始時間毫秒」作為 slot docId；已存在則略過。
      </p>
    </main>
  );
}
