"use client";

import { useEffect, useState } from "react";
import { auth, db } from "@/lib/firebase.client";
import { onAuthStateChanged, signInAnonymously, User } from "firebase/auth";
import { doc, getDoc, setDoc, deleteDoc, serverTimestamp } from "firebase/firestore";

export default function GrantAdminPage() {
  const [user, setUser] = useState<User | null>(null);
  const [role, setRole] = useState<string>("(未知)");
  const [msg, setMsg] = useState("");

  const loadRole = async () => {
    if (!auth.currentUser) return;
    const snap = await getDoc(doc(db, "userRoles", auth.currentUser.uid));
    setRole(snap.exists() ? (snap.data() as any).role ?? "(未設定)" : "(未設定)");
  };

  useEffect(() => {
    const unsub = onAuthStateChanged(auth, async (u) => {
      setUser(u);
      if (!u) await signInAnonymously(auth);
      else await loadRole();
    });
    if (!auth.currentUser) signInAnonymously(auth).catch(() => {});
    return () => unsub();
  }, []);

  const grant = async () => {
    if (!auth.currentUser) return;
    setMsg("授權中…");
    await setDoc(
      doc(db, "userRoles", auth.currentUser.uid),
      { role: "ADMIN", updatedAt: serverTimestamp() },
      { merge: true }
    );
    await loadRole();
    setMsg("已將自己設為 ADMIN ✅");
  };

  const revoke = async () => {
    if (!auth.currentUser) return;
    setMsg("取消中…");
    // 你可以選擇刪除或降級為 MEMBER；這裡示範降級
    await setDoc(
      doc(db, "userRoles", auth.currentUser.uid),
      { role: "MEMBER", updatedAt: serverTimestamp() },
      { merge: true }
    );
    await loadRole();
    setMsg("已將自己降級為 MEMBER ✅（非管理者）");
  };

  return (
    <main className="p-6 space-y-4">
      <h1 className="text-2xl font-bold">授權自己為 ADMIN / 取消</h1>
      <div className="text-sm text-gray-600">目前 UID：{user?.uid ?? "(未登入)"}</div>
      <div className="text-sm">目前角色：<span className="font-semibold">{role}</span></div>

      <div className="flex gap-2">
        <button onClick={grant} className="px-4 py-2 rounded bg-black text-white">授予自己 ADMIN</button>
        <button onClick={revoke} className="px-4 py-2 rounded bg-black text-white">取消自己 ADMIN（設為 MEMBER）</button>
      </div>

      <div className="text-sm">{msg}</div>
      <p className="text-xs text-gray-500">
        這頁僅供開發測試。上線後請改由真正的後台介面或管理員審批流程來調整角色。
      </p>
    </main>
  );
}
