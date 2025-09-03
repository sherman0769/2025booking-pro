'use client';

import { useEffect, useState } from 'react';
import app, { auth, db } from '@/lib/firebase.client';
import { User, onAuthStateChanged, signInAnonymously } from 'firebase/auth';
import {
  addDoc, collection, getDocs, limit, orderBy, query, serverTimestamp,
} from 'firebase/firestore';

export default function FirestoreDebugPage() {
  const [user, setUser] = useState<User | null>(null);
  const [status, setStatus] = useState<string>('就緒');

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

  const writeOnce = async () => {
    await ensureSignedIn();
    setStatus('寫入中…');
    await addDoc(collection(db, '_health'), {
      note: 'ok',
      now: new Date().toISOString(),
      ts: serverTimestamp(),
      uid: auth.currentUser?.uid ?? null,
    });
    setStatus('寫入完成');
  };

  const readLatest = async () => {
    await ensureSignedIn();
    setStatus('讀取中…');
    const q = query(collection(db, '_health'), orderBy('ts', 'desc'), limit(1));
    const snap = await getDocs(q);
    const data = snap.docs[0]?.data() ?? null;
    setStatus('最新一筆：' + JSON.stringify(data));
  };

  return (
    <main className="p-6 space-y-4">
      <h1 className="text-2xl font-bold">Firestore Debug</h1>
      <div>目前 UID：{user?.uid ?? '(未登入)'}</div>
      <div className="flex gap-2">
        <button onClick={ensureSignedIn} className="px-3 py-2 rounded bg-black text-white">
          匿名登入
        </button>
        <button onClick={writeOnce} className="px-3 py-2 rounded bg-black text-white">
          寫入一筆
        </button>
        <button onClick={readLatest} className="px-3 py-2 rounded bg-black text-white">
          讀取最新一筆
        </button>
      </div>
      <pre className="bg-gray-100 p-3 rounded">{status}</pre>
    </main>
  );
}