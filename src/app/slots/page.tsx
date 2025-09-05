'use client';

import { useEffect, useMemo, useState } from 'react';
import { auth, db } from '@/lib/firebase.client';
import { onAuthStateChanged, signInAnonymously, User } from 'firebase/auth';
import {
  collection,
  getDoc,
  doc,
  getDocs,
  addDoc,
  limit,
  orderBy,
  query,
  Timestamp,
  where,
  serverTimestamp,
  runTransaction,
  setDoc,
} from 'firebase/firestore';

type SlotDoc = {
  resourceId: string;
  serviceId: string;
  startAt: Timestamp;
  endAt: Timestamp;
  status?: 'OPEN' | 'CLOSED' | 'FULL';
  capacity?: number;
};
type ServiceDoc = { name: string };
type ResourceDoc = { name: string };

type EnrichedSlot = {
  id: string;
  startAt: Date;
  endAt: Date;
  serviceId: string;
  resourceId: string;
  serviceName: string;
  resourceName: string;
  capacity?: number;
  status?: string;
};

export default function SlotsPage() {
  const [user, setUser] = useState<User | null>(null);
  const [loading, setLoading] = useState(false);
  const [slots, setSlots] = useState<EnrichedSlot[]>([]);
  const [msg, setMsg] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    const unsub = onAuthStateChanged(auth, (u) => setUser(u));
    return () => unsub();
  }, []);

  const ensureSignedIn = async () => {
    if (!auth.currentUser) await signInAnonymously(auth);
  };

  const loadSlots = async () => {
    setLoading(true);
    setError(null);
    try {
      await ensureSignedIn();

      const now = Timestamp.now();
      const sevenDaysLater = Timestamp.fromDate(
        new Date(Date.now() + 7 * 24 * 60 * 60 * 1000),
      );

      const q = query(
        collection(db, 'slots'),
        where('startAt', '>=', now),
        where('startAt', '<=', sevenDaysLater),
        orderBy('startAt', 'asc'),
        limit(50),
      );

      const snap = await getDocs(q);

      const results: EnrichedSlot[] = await Promise.all(
        snap.docs.map(async (d) => {
          const data = d.data() as SlotDoc;

          const [serviceSnap, resourceSnap] = await Promise.all([
            getDoc(doc(db, 'services', data.serviceId)),
            getDoc(doc(db, 'resources', data.resourceId)),
          ]);

          const serviceName = serviceSnap.exists()
            ? ((serviceSnap.data() as ServiceDoc).name ?? '(未知服務)')
            : '(未知服務)';
          const resourceName = resourceSnap.exists()
            ? ((resourceSnap.data() as ResourceDoc).name ?? '(未知資源)')
            : '(未知資源)';

          return {
            id: d.id,
            startAt: data.startAt.toDate(),
            endAt: data.endAt.toDate(),
            serviceId: data.serviceId,
            resourceId: data.resourceId,
            serviceName,
            resourceName,
            capacity: data.capacity,
            status: data.status ?? 'OPEN',
          };
        }),
      );

      setSlots(results);
    } catch (e: any) {
      setError(e?.message ?? String(e));
    } finally {
      setLoading(false);
    }
  };

  useEffect(() => {
    loadSlots();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

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

  // 伺服器端推播：不影響主流程（失敗就忽略）
  const notifyAdmin = async (message: string) => {
    try {
      await fetch('/api/line/notify-admin', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ message }),
      });
    } catch {
      // ignore
    }
  };

  // 對學員本人的推播（先從 userProfiles 取 lineUserId；本機也能送）
  const notifyUser = async (uid: string, message: string) => {
    try {
      // 讀自己 profile 的 lineUserId（規則允許本人讀）
      const snap = await getDoc(doc(db, 'userProfiles', uid));
      const toLineUserId = snap.exists() ? (snap.data() as any)?.lineUserId ?? null : null;

      await fetch('/api/line/notify-user', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        // 兩個都傳：遠端會用 uid 查；本機沒有 Admin 金鑰就用 toLineUserId 直接推
        body: JSON.stringify({ uid, toLineUserId, message }),
      });
    } catch {
      // 忽略錯誤，不影響主要流程
    }
  };

  // 加入候補（以固定 docId 防重複：waitlists/{slotId}_{uid}）
  const waitlist = async (s: EnrichedSlot) => {
    try {
      await ensureSignedIn();
      const uid = auth.currentUser?.uid;
      if (!uid) throw new Error('尚未登入');

      // 先看是否已在候補
      const ref = doc(db, 'waitlists', `${s.id}_${uid}`);
      const snap = await getDoc(ref);
      if (snap.exists()) {
        setMsg('你已在候補名單');
        return;
      }

      await setDoc(ref, {
        slotId: s.id,
        uid,
        createdAt: serverTimestamp(),
      });
      setMsg('已加入候補名單 ✅');
    } catch (e: any) {
      setError(e?.message ?? String(e));
    }
  };

  // 交易版預約：容量遞減 + 防重複（bookingKeys/{slotId}_{uid}）
  const book = async (s: EnrichedSlot) => {
    try {
      setMsg(null);
      setError(null);
      await ensureSignedIn();
      
      if (!uid) throw new Error('尚未登入');

      await runTransaction(db, async (tx) => {
        const slotRef = doc(db, 'slots', s.id);
        const keyRef = doc(db, 'bookingKeys', `${s.id}_${uid}`);
        const slotSnap = await tx.get(slotRef);

        if (!slotSnap.exists()) throw new Error('時段不存在');
        const slot = slotSnap.data() as SlotDoc;
        const currentCap = slot.capacity ?? 1;
        const status = slot.status ?? 'OPEN';

        if (status !== 'OPEN') throw new Error('此時段不可預約');
        if (currentCap <= 0) throw new Error('此時段名額已滿');

        const keySnap = await tx.get(keyRef);
        if (keySnap.exists()) throw new Error('你已預約過此時段');

        const newCap = currentCap - 1;
        tx.update(slotRef, {
          capacity: newCap,
          status: newCap <= 0 ? 'FULL' : status,
        });

        const bookingRef = doc(collection(db, 'bookings'));
        tx.set(bookingRef, {
          slotId: s.id,
          serviceId: s.serviceId,
          resourceId: s.resourceId,
          uid,
          status: 'PENDING',
          source: 'PUBLIC',
          createdAt: serverTimestamp(),
        });

        tx.set(keyRef, {
          uid,
          slotId: s.id,
          bookingId: bookingRef.id,
          createdAt: serverTimestamp(),
        });
      });

      setMsg('預約已送出 ✅（容量已同步遞減）');

      // ➜ 通知管理員
      const adminMsg =
        `📌 新預約\n` +
        `服務：${s.serviceName}\n` +
        `資源：${s.resourceName}\n` +
        `時間：${fmt(s.startAt)} - ${fmt(s.endAt)}\n` +
        `UID：${auth.currentUser?.uid ?? ''}`;
      notifyAdmin(adminMsg);

      // ➜ 通知學員本人（若已綁定 lineUserId 才會送出）
const userMsg =
        `✅ 預約成立\n` +
        `服務：${s.serviceName}\n` +
        `資源：${s.resourceName}\n` +
        `時間：${fmt(s.startAt)} - ${fmt(s.endAt)}\n` +
        `查詢：/me/bookings`;
      notifyUser(uid, userMsg);

      await loadSlots(); // 重新讀取，看到容量/狀態變化
    } catch (e: any) {
      setError(e?.message ?? String(e));
    }
  };

  const hasData = useMemo(() => slots.length > 0, [slots]);

  return (
    <main className="p-6 space-y-4">
      <h1 className="text-2xl font-bold">可預約時段</h1>
      <div className="text-sm text-gray-600">
        目前 UID：{user?.uid ?? '(未登入)'}
      </div>

      <div className="flex gap-2">
        <button
          onClick={loadSlots}
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
        <div className="text-gray-500">未找到未來 7 天的可預約時段。</div>
      )}

      <ul className="divide-y">
        {slots.map((s) => {
          const cap = s.capacity ?? 0;
          const isOpen = s.status === 'OPEN' && cap > 0;
          return (
            <li
              key={s.id}
              className="py-3 flex flex-col sm:flex-row sm:items-center sm:justify-between gap-2"
            >
              <div className="space-y-1">
                <div className="font-medium">
                  {fmt(s.startAt)} — {fmt(s.endAt)}
                </div>
                <div className="text-sm text-gray-600">
                  服務：{s.serviceName}　資源：{s.resourceName}
                </div>
                <div className="text-xs text-gray-500">
                  狀態：{s.status}　容量：{cap}
                </div>
              </div>

              {isOpen ? (
                <button
                  onClick={() => book(s)}
                  className="px-4 py-2 rounded text-white bg-black"
                  title="預約這個時段"
                >
                  預約
                </button>
              ) : (
                <button
                  onClick={() => waitlist(s)}
                  className="px-4 py-2 rounded text-white bg-black"
                  title="加入候補名單"
                >
                  加入候補
                </button>
              )}
            </li>
          );
        })}
      </ul>
    </main>
  );
}
