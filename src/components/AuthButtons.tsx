'use client';

import { useEffect, useState } from 'react';
import { auth } from '@/lib/firebase.client';
import {
  GoogleAuthProvider,
  signInWithRedirect,
  linkWithRedirect,
  getRedirectResult,
  signOut,
  onAuthStateChanged,
} from 'firebase/auth';

export default function AuthButtons() {
  const [uid, setUid] = useState<string | null>(null);
  const [displayName, setDisplayName] = useState<string | null>(null);
  const [isAnon, setIsAnon] = useState<boolean>(false);
  const [note, setNote] = useState<string>('');

  useEffect(() => {
    const unsub = onAuthStateChanged(auth, (u) => {
      setUid(u?.uid ?? null);
      setDisplayName(u?.displayName ?? u?.email ?? null);
      setIsAnon(!!u?.isAnonymous);
    });
    return () => unsub();
  }, []);

  // 手機 Redirect 回來後拿結果（登入或連結），失敗就顯示訊息
  useEffect(() => {
    getRedirectResult(auth).catch((e) => {
      setNote(`登入回跳錯誤：${e?.message ?? e}`);
      setTimeout(() => setNote(''), 3000);
    });
  }, []);

  const googleProvider = new GoogleAuthProvider();

  // 未登入：直接用 Google 登入
  const loginGoogle = async () => {
    setNote('前往 Google 登入…');
    await signInWithRedirect(auth, googleProvider);
  };

  // 目前是匿名：把匿名帳號升級綁定到 Google（保留現有資料與 UID）
  const upgradeToGoogle = async () => {
    if (!auth.currentUser) return loginGoogle();
    setNote('前往 Google 綁定…');
    await linkWithRedirect(auth.currentUser, googleProvider);
  };

  const logout = async () => {
    await signOut(auth);
    setNote('已登出');
    setTimeout(() => setNote(''), 1500);
  };

  return (
    <div className="space-y-2">
      {/* 情況 1：未登入 → 顯示 Google 登入 */}
      {!uid && (
        <button
          onClick={loginGoogle}
          className="w-full px-4 py-3 rounded-2xl bg-black text-white text-base"
        >
          使用 Google 登入
        </button>
      )}

      {/* 情況 2：已登入匿名 → 顯示帳號卡片 + 「升級為 Google 登入」 */}
      {uid && isAnon && (
        <div className="space-y-2">
          <div className="flex items-center justify-between rounded-2xl border p-3">
            <div className="text-sm">
              <div className="text-gray-600">目前為匿名使用者</div>
              <div className="font-mono text-xs">{uid}</div>
            </div>
            <button onClick={logout} className="px-3 py-2 rounded-2xl bg-black text-white">
              登出
            </button>
          </div>
          <button
            onClick={upgradeToGoogle}
            className="w-full px-4 py-3 rounded-2xl bg-black text-white text-base"
          >
            升級為 Google 登入（保留資料）
          </button>
        </div>
      )}

      {/* 情況 3：已登入且非匿名（Google 等提供者） → 顯示帳號卡片 + 登出 */}
      {uid && !isAnon && (
        <div className="flex items-center justify-between rounded-2xl border p-3">
          <div className="text-sm">
            <div className="text-gray-600">已登入</div>
            <div className="font-medium">{displayName ?? uid}</div>
          </div>
          <button onClick={logout} className="px-4 py-2 rounded-2xl bg-black text-white">
            登出
          </button>
        </div>
      )}

      {note && <div className="text-xs text-gray-600">{note}</div>}
    </div>
  );
}
