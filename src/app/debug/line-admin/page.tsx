'use client';

import { useState } from 'react';

export default function LineAdminDebug() {
  const [msg, setMsg] = useState(
    `管理員測試通知：${new Date().toLocaleString('zh-TW', { timeZone: 'Asia/Taipei' })}`
  );
  const [resp, setResp] = useState<string>('');

  const send = async () => {
    setResp('傳送中…');
    try {
      const r = await fetch('/api/line/notify-admin', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ message: msg }),
      });
      const j = await r.json();
      setResp(JSON.stringify(j, null, 2));
    } catch (e: any) {
      setResp(String(e?.message ?? e));
    }
  };

  return (
    <main className="p-6 space-y-4">
      <h1 className="text-2xl font-bold">LINE 管理員通知測試</h1>
      <textarea className="w-full border rounded p-2 h-28" value={msg} onChange={(e) => setMsg(e.target.value)} />
      <button onClick={send} className="px-4 py-2 rounded bg-black text-white">送出給管理員</button>
      <pre className="bg-gray-100 p-3 rounded text-sm whitespace-pre-wrap">{resp}</pre>
      <p className="text-xs text-gray-500">管理員的 userId 只在伺服器端環境變數中，不會暴露到前端。</p>
    </main>
  );
}