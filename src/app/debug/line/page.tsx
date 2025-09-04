'use client';

import { useEffect, useState } from 'react';

export default function LineDebugPage() {
  const [followers, setFollowers] = useState<string[]>([]);
  const [userId, setUserId] = useState<string>(''); // 可手動貼上
  const [message, setMessage] = useState(
    `BookingPro 測試訊息：${new Date().toLocaleString('zh-TW', { timeZone: 'Asia/Taipei' })}`
  );
  const [note, setNote] = useState<string>('');
  const [resp, setResp] = useState<string>('');

  const loadFollowers = async () => {
    setNote('取得追蹤者中…');
    try {
      const r = await fetch('/api/line/followers');
      const j = await r.json();
      if (!j.ok) {
        // 多數帳號會 403：此 API 不可用 → 引導改用手動貼上 userId
        setNote(
          j.status === 403
            ? '你的 Channel 無法使用 followers API，請改用下方「手動輸入 userId」。'
            : '取得追蹤者失敗：' + JSON.stringify(j)
        );
        return;
      }
      setFollowers(j.userIds ?? []);
      if (j.userIds?.length) setUserId(j.userIds[0]);
      setNote(`已載入追蹤者 ${j.userIds?.length ?? 0} 位`);
    } catch (e: any) {
      setNote('取得追蹤者失敗：' + (e?.message ?? e));
    }
  };

  const push = async () => {
    setResp('推播中…');
    try {
      if (!userId.trim()) {
        setResp('請先輸入 userId（LINE Developers 的「Your user ID」）');
        return;
      }
      const r = await fetch('/api/line/push', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ to: userId.trim(), message }),
      });
      const j = await r.json();
      setResp(JSON.stringify(j, null, 2));
    } catch (e: any) {
      setResp('推播失敗：' + (e?.message ?? e));
    }
  };

  useEffect(() => {
    // 嘗試載入一次（若 403 會提示改用手動）
    loadFollowers();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  return (
    <main className="p-6 space-y-4">
      <h1 className="text-2xl font-bold">LINE Messaging API 測試</h1>

      <div className="space-y-2">
        <div className="text-sm text-gray-700">
          1) 先在手機<strong>加入機器人為好友</strong>，並對它說「嗨」。<br />
          2) 到 Developers Console「Messaging API」頁面複製<strong>Your user ID</strong>。
        </div>

        <button onClick={loadFollowers} className="px-4 py-2 rounded bg-black text-white">
          重新載入追蹤者 IDs（若 403 請用手動方式）
        </button>
        <div className="text-sm text-gray-600">{note}</div>

        <div className="space-y-1">
          <div className="text-sm">手動輸入收件者（userId）</div>
          <input
            className="border p-2 rounded w-full"
            placeholder="貼上 U 開頭的 Your user ID"
            value={userId}
            onChange={(e) => setUserId(e.target.value)}
          />
        </div>

        <div className="space-y-1">
          <div className="text-sm">訊息內容</div>
          <textarea
            className="w-full border rounded p-2 h-28"
            value={message}
            onChange={(e) => setMessage(e.target.value)}
          />
        </div>

        <button onClick={push} className="px-4 py-2 rounded bg-black text-white">
          發送推播
        </button>
      </div>

      <pre className="bg-gray-100 p-3 rounded text-sm whitespace-pre-wrap">{resp}</pre>
    </main>
  );
}
