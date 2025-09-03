'use client';

import { useEffect, useState } from 'react';
import { auth, db } from '@/lib/firebase.client';
import { User, onAuthStateChanged, signInAnonymously } from 'firebase/auth';
import {
  addDoc,
  collection,
  doc,
  serverTimestamp,
  Timestamp,
} from 'firebase/firestore';

export default function SeedPage() {
  const [user, setUser] = useState<User | null>(null);
  const [status, setStatus] = useState<string>('就緒');
  const [ids, setIds] = useState<Record<string, string>>({});

  useEffect(() => {
    const unsub = onAuthStateChanged(auth, (u) => setUser(u));
    return () => unsub();
  }, []);

  const ensureSignedIn = async () => {
    if (!auth.currentUser) {
      setStatus('匿名登入中…');
      await signInAnonymously(auth);
      setStatus('已登入（匿名）');
    }
  };

  const seed = async () => {
    await ensureSignedIn();
    setStatus('建立範例資料中…');

    // 1) Org
    const orgRef = await addDoc(collection(db, 'orgs'), {
      name: '示範健身房',
      timeZone: 'Asia/Taipei',
      createdAt: serverTimestamp(),
      ownerUids: [auth.currentUser?.uid ?? null].filter(Boolean),
    });

    // 2) Location
    const locRef = await addDoc(collection(db, 'locations'), {
      orgId: orgRef.id,
      name: '台北總店',
      address: '台北市信義區示範路 1 號',
      createdAt: serverTimestamp(),
    });

    // 3) Resource（教練）
    const coachRef = await addDoc(collection(db, 'resources'), {
      locationId: locRef.id,
      type: 'COACH', // COACH | ROOM | EQUIPMENT
      name: 'Coach Ken',
      capacity: 1,
      createdAt: serverTimestamp(),
    });

    // 4) Service（服務）
    const svcRef = await addDoc(collection(db, 'services'), {
      orgId: orgRef.id,
      name: '一對一私人訓練',
      durationMin: 60,
      priceNTD: 1200,
      createdAt: serverTimestamp(),
    });

    // 5) Slot（明天 10:00–11:00）
    const now = new Date();
    const tomorrow = new Date(
      now.getFullYear(),
      now.getMonth(),
      now.getDate() + 1,
      10,
      0,
      0,
    );
    const end = new Date(
      now.getFullYear(),
      now.getMonth(),
      now.getDate() + 1,
      11,
      0,
      0,
    );

    const slotRef = await addDoc(collection(db, 'slots'), {
      resourceId: coachRef.id,
      serviceId: svcRef.id,
      startAt: Timestamp.fromDate(tomorrow),
      endAt: Timestamp.fromDate(end),
      status: 'OPEN', // OPEN | CLOSED | FULL
      capacity: 1,
      createdAt: serverTimestamp(),
    });

    const newIds = {
      orgId: orgRef.id,
      locationId: locRef.id,
      resourceId: coachRef.id,
      serviceId: svcRef.id,
      slotId: slotRef.id,
    };
    setIds(newIds);
    setStatus('完成 ✅（下方列出各 ID）');
  };

  return (
    <main className="p-6 space-y-4">
      <h1 className="text-2xl font-bold">Seed 範例資料</h1>
      <div>目前 UID：{user?.uid ?? '(未登入)'}</div>
      <button onClick={seed} className="px-4 py-2 rounded bg-black text-white">
        一鍵建立範例資料
      </button>
      <div className="space-y-1">
        <div className="font-mono text-sm">狀態：{status}</div>
        {Object.keys(ids).length > 0 && (
          <pre className="bg-gray-100 p-3 rounded font-mono text-sm">
            {JSON.stringify(ids, null, 2)}
          </pre>
        )}
      </div>
      <p className="text-xs text-gray-500">
        提醒：這是開發用工具頁，之後會移除或加上管理者保護。
      </p>
    </main>
  );
}