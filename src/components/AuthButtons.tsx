'use client';

import { useEffect, useState } from 'react';
import { auth } from '@/lib/firebase.client';
import {
  GoogleAuthProvider,
  signInWithRedirect,
  signInWithPopup,
  linkWithRedirect,
  linkWithPopup,
  getRedirectResult,
  signOut,
  onAuthStateChanged,
} from 'firebase/auth';

function isMobileUA() {
  if (typeof navigator === 'undefined') return false;
  return /Android|iPhone|iPad|iPod/i.test(navigator.userAgent);
}

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

  // Redirect 回跳後處理（成功/失敗都清旗標）
  useEffect(() => {
    getRedirectResult(auth)
      .then((cred) => {
        if (cred?.user) {
          setNote(`歡迎回來，${cred.user.displayName ?? cred.user.email ?? ''}`);
          setTimeout(() => setNote(''), 2000);
        }
      })
      .catch((e) => {
        setNote(`登入回跳錯誤：${e?.code ?? ''} ${e?.message ?? e}`);
        // 若 link 失敗（常見：account-exists-with-different-credential），可以讓使用者再按一次「使用 Google 登入」
      })
      .finally(() => {
        try { sessionStorage.removeItem('auth:redirect'); } catch {}
      });
  }, []);

  const provider = new GoogleAuthProvider();

  // 未登入：Google 登入（桌機先用 Popup，手機用 Redirect）
  const loginGoogle = async () => {
    try { sessionStorage.setItem('auth:redirect', '1'); } catch {}
    setNote(isMobileUA() ? '前往 Google 登入…' : '彈出 Google 登入視窗…');
    try {
      if (isMobileUA()) {
        await signInWithRedirect(auth, provider);
      } else {
        await signInWithPopup(auth, provider);
      }
    } catch (e: any) {
      setNote(`登入失敗：${e?.code ?? ''} ${e?.message ?? e}`);
      setTimeout(() => setNote(''), 3000);
    }
  };

  // 已匿名：把匿名帳號升級（link）→ 若 link 失敗，自動 fallback 成「直接 Google 登入」
  const upgradeToGoogle = async () => {
    if (!auth.currentUser) return loginGoogle();
    try { sessionStorage.setItem('auth:redirect', '1'); } catch {}
    setNote(isMobileUA() ? '前往 Google 綁定…' : '彈出 Google 綁定視窗…');
    try {
      if (isMobileUA()) {
        await linkWithRedirect(auth.currentUser, provider);
      } else {
        await linkWithPopup(auth.currentUser, provider);
      }
    } catch (e: any) {
      // 常見：auth/account-exists-with-different-credential 等，直接改走登入取代綁定
      try {
        if (isMobileUA()) {
          await signInWithRedirect(auth, provider);
        } else {
          await signInWithPopup(auth, provider);
        }
      } catch (e2: any) {
        setNote(`綁定/登入失敗：${e2?.code ?? ''} ${e2?.message ?? e2}`);
        setTimeout(() => setNote(''), 3000);
      }
    }
  };

  const logout = async () => {
    await signOut(auth);
    setNote('已登出');
    setTimeout(() => setNote(''), 1500);
  };

  return (
    <div className="space-y-2">
      {!uid && (
        <button onClick={loginGoogle} className="w-full px-4 py-3 rounded-2xl bg-black text-white text-base">
          使用 Google 登入
        </button>
      )}

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
          <button onClick={upgradeToGoogle} className="w-full px-4 py-3 rounded-2xl bg-black text-white text-base">
            升級為 Google 登入（保留資料）
          </button>
        </div>
      )}

      {uid && !isAnon && (
        <div className="flex items-center justify-between rounded-2xl border p-3">
          <div className="text-sm">
            <div className="text-gray-600">已登入</div>
            <div className="font-medium">{displayName ?? uid}</div>
          </div>
          <button onClick={logout} className="px-4 py-2 rounded-2xl bg-black text-white">登出</button>
        </div>
      )}

      {note && <div className="text-xs text-gray-600">{note}</div>}
    </div>
  );
}
