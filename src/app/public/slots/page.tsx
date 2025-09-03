'use client';

import { useEffect, useMemo, useState } from 'react';
import { auth, db } from '@/lib/firebase.client';
import { onAuthStateChanged, signInAnonymously, User } from 'firebase/auth';
import {
  collection,
  getDoc,
  doc,
  getDocs,
  limit,
  orderBy,
  query,
  Timestamp,
  where,
} from 'firebase/firestore';

type SlotDoc = {
  resourceId: string;
  serviceId: string;
  startAt: Timestamp;
  endAt: Timestamp;
  status?: 'OPEN' | 'CLOSED' | 'FULL';
  capacity?: number;
};

type EnrichedSlot = {
  id: string;
  startAt: Date;
  endAt: Date;
  serviceName: string;
  resourceName: string;
  capacity?: number;
  status?: string;
};

export default function PublicSlotsPage() {
  const [user, setUser] = useState<User | null>(null);
  const [loading, setLoading] = useState(false);
  const [slots, setSlots] = useState<EnrichedSlot[]>([]);
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

      // 查未來 7 天的時段（只用 startAt 避免複合索引需求）
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

      // 依序把 service/resource 名稱補上
      const results: EnrichedSlot[] = await Promise.all(
        snap.docs.map(async (d) => {
          const data = d.data() as SlotDoc;

          const [serviceSnap, resourceSnap] = await Promise.all([
            getDoc(doc(db, 'services', data.serviceId)),
            getDoc(doc(db, 'resources', data.resourceId)),
          ]);

          const serviceName = serviceSnap.exists()
            ? (serviceSnap.data() as any).name
            : '(未知服務)';
          const resourceName = resourceSnap.exists()
            ? (resourceSnap.data() as any).name
            : '(未知資源)';

          return {
            id: d.id,
            startAt: data.startAt.toDate(),
            endAt: data.endAt.toDate(),
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
    // 首次進頁就載入
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

      {error && (
        <div className="p-3 bg-red-50 text-red-700 rounded border border-red-200">
          {error}
        </div>
      )}

      {!hasData && !loading && (
        <div className="text-gray-500">未找到未來 7 天的可預約時段。</div>
      )}

      <ul className="divide-y">
        {slots.map((s) => (
          <li key={s.id} className="py-3 flex flex-col sm:flex-row sm:items-center sm:justify-between">
            <div className="space-y-1">
              <div className="font-medium">
                {fmt(s.startAt)} — {fmt(s.endAt)}
              </div>
              <div className="text-sm text-gray-600">
                服務：{s.serviceName}　資源：{s.resourceName}
              </div>
              <div className="text-xs text-gray-500">
                狀態：{s.status}　容量：{s.capacity ?? 1}
              </div>
            </div>
            {/* 下一步才會接「預約」按鈕 */}
          </li>
        ))}
      </ul>
    </main>
  );
}