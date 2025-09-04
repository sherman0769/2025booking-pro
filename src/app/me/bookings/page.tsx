'use client';

import { useEffect, useMemo, useState } from 'react';
import { auth, db } from '@/lib/firebase.client';
import { onAuthStateChanged, signInAnonymously, User } from 'firebase/auth';
import {
  collection,
  doc,
  getDoc,
  getDocs,
  query,
  where,
  limit,
  Timestamp,
  runTransaction,
  serverTimestamp,
} from 'firebase/firestore';

type BookingDoc = {
  slotId: string;
  serviceId: string;
  resourceId: string;
  uid: string;
  status: 'PENDING' | 'CONFIRMED' | 'CANCELED' | 'NO_SHOW' | 'COMPLETED';
  source?: 'PUBLIC' | 'ADMIN' | 'IMPORT';
  createdAt?: Timestamp;
};

type SlotDoc = {
  startAt: Timestamp;
  endAt: Timestamp;
  serviceId: string;
  resourceId: string;
  status?: 'OPEN' | 'CLOSED' | 'FULL';
  capacity?: number;
};

export default function MyBookingsPage() {
  const [user, setUser] = useState<User | null>(null);
  const [rows, setRows] = useState<any[]>([]);
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
      const uid = auth.currentUser!.uid;

      // 只用 where 避免需要複合索引，再在前端排序
      const qy = query(
        collection(db, 'bookings'),
        where('uid', '==', uid),
        limit(50),
      );
      const snap = await getDocs(qy);

      const items = await Promise.all(
        snap.docs.map(async (d) => {
          const b = d.data() as BookingDoc;
          const slotSnap = await getDoc(doc(db, 'slots', b.slotId));
          const slot = slotSnap.exists() ? (slotSnap.data() as SlotDoc) : null;

          const serviceSnap = b.serviceId
            ? await getDoc(doc(db, 'services', b.serviceId))
            : null;
          const resourceSnap = b.resourceId
            ? await getDoc(doc(db, 'resources', b.resourceId))
            : null;

          return {
            id: d.id,
            status: b.status,
            createdAt: b.createdAt ?? null,
            slotId: b.slotId,
            startAt: slot ? slot.startAt.toDate() : null,
            endAt: slot ? slot.endAt.toDate() : null,
            serviceName:
              serviceSnap?.exists() ? (serviceSnap.data() as any).name : '',
            resourceName:
              resourceSnap?.exists() ? (resourceSnap.data() as any).name : '',
          };
        }),
      );

      // 依 createdAt DESC 排序（null 放最後）
      items.sort(
        (a, b) =>
          (b.createdAt?.toMillis?.() ?? 0) - (a.createdAt?.toMillis?.() ?? 0),
      );

      setRows(items);
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

  const fmt = (d: Date | null) =>
    d
      ? d.toLocaleString('zh-TW', {
          timeZone: 'Asia/Taipei',
          year: 'numeric',
          month: '2-digit',
          day: '2-digit',
          hour: '2-digit',
          minute: '2-digit',
          hour12: false,
        })
      : '(無資料)';

  const cancelBooking = async (row: any) => {
    setMsg(null);
    setError(null);
    try {
      await ensureSignedIn();
      const uid = auth.currentUser!.uid;

      await runTransaction(db, async (tx) => {
        const bookingRef = doc(db, 'bookings', row.id);
        const bookingSnap = await tx.get(bookingRef);
        if (!bookingSnap.exists()) throw new Error('預約不存在');

        const b = bookingSnap.data() as BookingDoc;
        if (b.uid !== uid) throw new Error('無權操作此預約');
        if (b.status !== 'PENDING' && b.status !== 'CONFIRMED')
          throw new Error('此狀態不可取消');

        const slotRef = doc(db, 'slots', b.slotId);
        const slotSnap = await tx.get(slotRef);
        if (!slotSnap.exists()) throw new Error('時段不存在');

        const slot = slotSnap.data() as SlotDoc;
        const cap = slot.capacity ?? 0;
        const newCap = cap + 1;

        // 1) 回存 slot 容量與狀態
        tx.update(slotRef, {
          capacity: newCap,
          status: 'OPEN',
        });

        // 2) 標示 booking 已取消
        tx.update(bookingRef, {
          status: 'CANCELED',
          canceledAt: serverTimestamp(),
        });

        // 3) 刪除唯一鍵（讓同人可重新預約）
        const keyRef = doc(db, 'bookingKeys', `${b.slotId}_${uid}`);
        tx.delete(keyRef);
      });

      setMsg('已取消預約 ✅（名額已釋回）');
      await load();
    } catch (e: any) {
      setError(e?.message ?? String(e));
    }
  };

  const hasData = useMemo(() => rows.length > 0, [rows]);

  return (
    <main className="p-6 space-y-4">
      <h1 className="text-2xl font-bold">我的預約</h1>
      <div className="text-sm text-gray-600">
        目前 UID：{user?.uid ?? '(未登入)'}
      </div>

      <div className="flex gap-2">
        <button
          onClick={load}
          className="px-4 py-2 rounded bg-black text-white disabled:opacity-50"
          disabled={loading}
        >
          {loading ? '載入中…' : '重新整理'}
        </button>
      </div>

      {msg && (
        <div className="p-3 bg-green-50 text-green-700 rounded border border-green-200">
          {msg}
        </div>
      )}
      {error && (
        <div className="p-3 bg-red-50 text-red-700 rounded border border-red-200">
          {error}
        </div>
      )}

      {!hasData && !loading && (
        <div className="text-gray-500">目前沒有預約。</div>
      )}

      <ul className="divide-y">
        {rows.map((r) => {
          const canCancel = r.status === 'PENDING' || r.status === 'CONFIRMED';
          return (
            <li
              key={r.id}
              className="py-3 flex flex-col sm:flex-row sm:items-center sm:justify-between gap-2"
            >
              <div className="space-y-1">
                <div className="font-medium">
                  {fmt(r.startAt)} — {fmt(r.endAt)}
                </div>
                <div className="text-sm text-gray-600">
                  服務：{r.serviceName}　資源：{r.resourceName}
                </div>
                <div className="text-xs text-gray-500">
                  狀態：{r.status}
                </div>
              </div>

              <button
                onClick={() => cancelBooking(r)}
                disabled={!canCancel}
                className="px-4 py-2 rounded text-white disabled:opacity-50 disabled:cursor-not-allowed bg-black"
                title={canCancel ? '取消這筆預約' : '此狀態不可取消'}
              >
                取消預約
              </button>
            </li>
          );
        })}
      </ul>
    </main>
  );
}