"use client";

import { useEffect, useState } from "react";
import { auth, db } from "@/lib/firebase.client";
import { onAuthStateChanged, signInAnonymously, User } from "firebase/auth";
import { doc, getDoc, setDoc, serverTimestamp } from "firebase/firestore";

const ALPH = "ABCDEFGHJKLMNPQRSTUVWXYZ23456789"; // 去除易混淆字元

function genCode(n = 6) {
  let s = "";
  for (let i = 0; i < n; i++) s += ALPH[Math.floor(Math.random() * ALPH.length)];
  return s;
}

export default function BindLinePage() {
  const [user, setUser] = useState<User | null>(null);
  const [lineUserId, setLineUserId] = useState<string | null>(null);
  const [bindCode, setBindCode] = useState<string | null>(null);
  const [note, setNote] = useState("");

  useEffect(() => {
    const unsub = onAuthStateChanged(auth, async (u) => {
      setUser(u);
      if (!u) { await signInAnonymously(auth).catch(() => {}); return; }
      await reloadProfile(u.uid);
    });
    if (!auth.currentUser) signInAnonymously(auth).catch(() => {});
    return () => unsub();
  }, []);

  const reloadProfile = async (uid?: string) => {
    setNote("載入中…");
    try {
      const id = uid ?? auth.currentUser?.uid;
      if (!id) return;
      const snap = await getDoc(doc(db, "userProfiles", id));
      if (snap.exists()) {
        const data = snap.data() as any;
        setLineUserId(typeof data.lineUserId === "string" ? data.lineUserId : null);
        setBindCode(typeof data.bindCode === "string" ? data.bindCode : null);
      } else {
        setLineUserId(null);
        setBindCode(null);
      }
    } finally {
      setNote("");
    }
  };

  const makeCode = async () => {
    setNote("產生中…");
    try {
      if (!auth.currentUser) throw new Error("尚未登入");
      const code = genCode(6);
      await setDoc(
        doc(db, "userProfiles", auth.currentUser.uid),
        { bindCode: code, bindCodeCreatedAt: serverTimestamp() },
        { merge: true }
      );
      setBindCode(code);
      setNote("已產生綁定碼 ✅");
    } catch (e: any) {
      setNote("產生失敗：" + (e?.message ?? e));
    }
  };

  return (
    <main className="p-6 space-y-4">
      <h1 className="text-2xl font-bold">綁定 LINE 通知（免貼 userId）</h1>
      <div className="text-sm text-gray-600">目前 UID：{user?.uid ?? "(未登入)"}</div>

      {lineUserId ? (
        <div className="p-3 rounded border bg-green-50 text-green-700">
          已綁定 LINE（userId: {lineUserId}）
        </div>
      ) : (
        <>
          <div className="space-y-2">
            <div className="text-sm">
              步驟：
              <ol className="list-decimal list-inside space-y-1">
                <li>先把你的 LINE 機器人加為好友（LINE Developers 的 QR Code）。</li>
                <li>按下方「產生綁定碼」，把 6 碼記下來。</li>
                <li>到 LINE 與機器人的聊天視窗，傳送：<code>綁定 你的6碼</code></li>
                <li>回到本頁按「重新整理」，看到「已綁定」就完成。</li>
              </ol>
            </div>
            <div className="flex items-center gap-3">
              <button onClick={makeCode} className="px-4 py-2 rounded bg-black text-white">產生綁定碼</button>
              <button onClick={() => reloadProfile()} className="px-4 py-2 rounded bg-black text-white">重新整理</button>
            </div>
            {bindCode && (
              <div className="p-3 rounded border font-mono text-lg">
                你的綁定碼：<span className="font-bold">{bindCode}</span>
              </div>
            )}
          </div>
        </>
      )}

      {note && <div className="text-sm text-gray-700">{note}</div>}

      <p className="text-xs text-gray-500">
        備註：綁定過程會把你的 LINE userId 安全地儲存在雲端，日後可用於預約通知；你可隨時請管理者刪除綁定。
      </p>
    </main>
  );
}