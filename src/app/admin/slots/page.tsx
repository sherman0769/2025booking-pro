"use client";

import { useEffect, useMemo, useState } from "react";
import { auth, db } from "@/lib/firebase.client";
import { onAuthStateChanged, signInAnonymously, User } from "firebase/auth";
import {
  collection,
  doc,
  getDoc,
  getDocs,
  limit,
  orderBy,
  query,
  runTransaction,
  Timestamp,
  updateDoc,
  where,
  serverTimestamp,
} from "firebase/firestore";

type SlotDoc = {
  resourceId: string;
  serviceId: string;
  startAt: Timestamp;
  endAt: Timestamp;
  status?: "OPEN" | "CLOSED" | "FULL";
  capacity?: number;
};

type Row = {
  id: string;
  startAt: Date;
  endAt: Date;
  serviceName: string;
  resourceName: string;
  capacity: number;
  status: "OPEN" | "CLOSED" | "FULL";
};

export default function AdminSlotManagePage() {
  const [user, setUser] = useState<User | null>(null);
  const [rows, setRows] = useState<Row[]>([]);
  const [loading, setLoading] = useState(false);
  const [msg, setMsg] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    const unsub = onAuthStateChanged(auth, (u) => setUser(u));
    return () => unsub();
  }, []);

  const ensureSignedIn = async () => {
    if (!auth.currentUser) await signInAnonymously(auth);
  };

  const load = async () => {
    setLoading(true);
    setMsg(null);
    setError(null);
    try {
      await ensureSignedIn();

      const now = Timestamp.now();
      const sevenDaysLater = Timestamp.fromDate(
        new Date(Date.now() + 7 * 24 * 60 * 60 * 1000)
      );

      const qy = query(
        collection(db, "slots"),
        where("startAt", ">=", now),
        where("startAt", "<=", sevenDaysLater),
        orderBy("startAt", "asc"),
        limit(100)
      );
      const snap = await getDocs(qy);

      const list: Row[] = await Promise.all(
        snap.docs.map(async (d) => {
          const s = d.data() as SlotDoc;
          const [svcSnap, resSnap] = await Promise.all([
            getDoc(doc(db, "services", s.serviceId)),
            getDoc(doc(db, "resources", s.resourceId)),
          ]);
          return {
            id: d.id,
            startAt: s.startAt.toDate(),
            endAt: s.endAt.toDate(),
            serviceName: svcSnap.exists() ? ((svcSnap.data() as any).name ?? "") : "",
            resourceName: resSnap.exists() ? ((resSnap.data() as any).name ?? "") : "",
            capacity: s.capacity ?? 1,
            status: (s.status ?? "OPEN") as Row["status"],
          };
        })
      );

      setRows(list);
    } catch (e: any) {
      setError(e?.message ?? String(e));
    } finally {
      setLoading(false);
    }
  };

  useEffect(() => {
    load();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  const fmt = (d: Date) =>
    d.toLocaleString("zh-TW", {
      timeZone: "Asia/Taipei",
      year: "numeric",
      month: "2-digit",
      day: "2-digit",
      hour: "2-digit",
      minute: "2-digit",
      hour12: false,
    });

  const toggleStatus = async (r: Row) => {
    setMsg(null);
    setError(null);
    try {
      await ensureSignedIn();
      const ref = doc(db, "slots", r.id);
      if (r.status === "CLOSED") {
        await updateDoc(ref, {
          status: "OPEN",
          capacity: r.capacity > 0 ? r.capacity : 1,
        });
        setMsg("已開啟此時段 ✅");
      } else {
        await updateDoc(ref, { status: "CLOSED" });
        setMsg("已關閉此時段 ✅");
      }
      await load();
    } catch (e: any) {
      setError(e?.message ?? String(e));
    }
  };

  const changeCapacity = async (r: Row, delta: number) => {
    setMsg(null);
    setError(null);
    try {
      await ensureSignedIn();
      await runTransaction(db, async (tx) => {
        const ref = doc(db, "slots", r.id);
        const snap = await tx.get(ref);
        if (!snap.exists()) throw new Error("時段不存在");
        const s = snap.data() as SlotDoc;
        const cap = Math.max(0, (s.capacity ?? 1) + delta);
        let status: Row["status"] = (s.status ?? "OPEN") as Row["status"];
        if (cap === 0) status = "FULL";
        else if (status !== "CLOSED") status = "OPEN";
        tx.update(ref, { capacity: cap, status });
      });
      setMsg("容量已更新 ✅");
      await load();
    } catch (e: any) {
      setError(e?.message ?? String(e));
    }
  };

  /**
   * 從候補補位（優先使用需要索引的查詢；若拋出 requires index，就改用「無排序查詢 → 前端排序」的備援）
   */
  const fillFromWaitlist = async (r: Row) => {
    setMsg(null);
    setError(null);
    try {
      await ensureSignedIn();

      // 1) 嘗試：依 createdAt ASC 取最早一位（需要複合索引：slotId ASC + createdAt ASC）
      let wlDocId: string | null = null;
      let wlUid: string | null = null;

      try {
        const wlQ = query(
          collection(db, "waitlists"),
          where("slotId", "==", r.id),
          orderBy("createdAt", "asc"),
          limit(1)
        );
        const wlSnap = await getDocs(wlQ);
        if (!wlSnap.empty) {
          wlDocId = wlSnap.docs[0].id;
          wlUid = (wlSnap.docs[0].data() as any).uid ?? null;
        }
      } catch (err: any) {
        // 備援路徑：只用 where(slotId==)（不需要索引），取前 50 筆後用前端排序
        const wlQ2 = query(
          collection(db, "waitlists"),
          where("slotId", "==", r.id),
          limit(50)
        );
        const wlSnap2 = await getDocs(wlQ2);
        const list = wlSnap2.docs
          .map((d) => ({ id: d.id, ...(d.data() as any) }))
          .sort(
            (a, b) =>
              (a.createdAt?.toMillis?.() ?? 0) -
              (b.createdAt?.toMillis?.() ?? 0)
          );
        if (list.length > 0) {
          wlDocId = list[0].id;
          wlUid = list[0].uid ?? null;
        }
      }

      if (!wlDocId || !wlUid) throw new Error("此時段沒有候補名單");

      // 2) 進行補位（交易：容量 -1、建立 booking、建立唯一鍵、刪除候補）
      await runTransaction(db, async (tx) => {
        const slotRef = doc(db, "slots", r.id);
        const keyRef = doc(db, "bookingKeys", `${r.id}_${wlUid}`);
        const slotSnap = await tx.get(slotRef);
        if (!slotSnap.exists()) throw new Error("時段不存在");

        const s = slotSnap.data() as SlotDoc;
        const cap = s.capacity ?? 0;
        const status = s.status ?? "OPEN";
        if (status !== "OPEN") throw new Error("此時段非開放狀態");
        if (cap <= 0) throw new Error("此時段目前沒有可用名額");

        const keySnap = await tx.get(keyRef);
        if (keySnap.exists()) throw new Error("此用戶已有預約");

        const newCap = cap - 1;
        tx.update(slotRef, {
          capacity: newCap,
          status: newCap <= 0 ? "FULL" : status,
        });

        const bookingRef = doc(collection(db, "bookings"));
        tx.set(bookingRef, {
          slotId: r.id,
          serviceId: s.serviceId,
          resourceId: s.resourceId,
          uid: wlUid,
          status: "PENDING",
          source: "ADMIN",
          createdAt: serverTimestamp(),
        });

        tx.set(keyRef, {
          uid: wlUid,
          slotId: r.id,
          bookingId: bookingRef.id,
          createdAt: serverTimestamp(),
        });

        tx.delete(doc(db, "waitlists", wlDocId!));
      });

      setMsg("已從候補補位一人 ✅");
      await load();
    } catch (e: any) {
      setError(e?.message ?? String(e));
    }
  };

  const hasData = useMemo(() => rows.length > 0, [rows]);

  return (
    <main className="p-6 space-y-4">
      <h1 className="text-2xl font-bold">管理端｜時段管理</h1>
      <div className="text-sm text-gray-600">目前 UID：{user?.uid ?? "(未登入)"}</div>

      <div className="flex gap-2">
        <button
          onClick={load}
          className="px-4 py-2 rounded bg-black text-white disabled:opacity-50"
          disabled={loading}
        >
          {loading ? "載入中…" : "重新整理"}
        </button>
      </div>

      {msg && (
        <div className="p-3 bg-green-50 text-green-700 rounded border border-green-200">{msg}</div>
      )}
      {error && (
        <div className="p-3 bg-red-50 text-red-700 rounded border border-red-200">{error}</div>
      )}
      {!hasData && !loading && (
        <div className="text-gray-500">未來 7 天沒有時段。</div>
      )}

      <ul className="divide-y">
        {rows.map((r) => (
          <li key={r.id} className="py-3 flex flex-col gap-2">
            <div className="font-medium">
              {fmt(r.startAt)} — {fmt(r.endAt)}
            </div>
            <div className="text-sm text-gray-600">
              服務：{r.serviceName}　資源：{r.resourceName}
            </div>
            <div className="flex flex-wrap items-center gap-3 text-sm">
              <span>狀態：{r.status}</span>
              <button onClick={() => toggleStatus(r)} className="px-3 py-1 rounded bg-black text-white">
                {r.status === "CLOSED" ? "開啟" : "關閉"}
              </button>

              <span className="ml-2">容量：{r.capacity}</span>
              <div className="inline-flex gap-1">
                <button onClick={() => changeCapacity(r, -1)} className="px-2 py-1 rounded bg-black text-white">-1</button>
                <button onClick={() => changeCapacity(r, +1)} className="px-2 py-1 rounded bg-black text-white">+1</button>
              </div>

              <button onClick={() => fillFromWaitlist(r)} className="ml-4 px-3 py-1 rounded bg-black text-white">
                從候補補位
              </button>
            </div>
          </li>
        ))}
      </ul>

      <p className="text-xs text-gray-500">
        注意：目前規則允許任何已登入者（含匿名）操作資料，僅供開發測試；上線前會加入角色保護與更嚴格規則。
      </p>
    </main>
  );
}
