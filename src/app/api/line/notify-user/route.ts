export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';

import { getApps, initializeApp, cert } from 'firebase-admin/app';
import { getFirestore } from 'firebase-admin/firestore';

export async function GET() {
  return Response.json({ ok: true, route: '/api/line/notify-user', method: 'GET' });
}

export async function POST(req: Request) {
  try {
    const token = process.env.LINE_CHANNEL_ACCESS_TOKEN;
    if (!token) {
      return Response.json({ ok: false, error: 'Missing LINE_CHANNEL_ACCESS_TOKEN' }, { status: 500 });
    }

    const { uid, toLineUserId, message } = await req.json().catch(() => ({} as any));
    if (!message || typeof message !== 'string') {
      return Response.json({ ok: false, error: 'message is required (string)' }, { status: 400 });
    }

    // 先用參數直接推：本機沒有 Admin 金鑰也可用
    let lineUserId: string | undefined = toLineUserId;

    // 若沒帶 toLineUserId 且有 uid，嘗試用 Admin SDK 從 userProfiles 讀
    if (!lineUserId && uid && process.env.FIREBASE_SERVICE_ACCOUNT) {
      if (!getApps().length) {
        const svc = JSON.parse(process.env.FIREBASE_SERVICE_ACCOUNT as string);
        if (svc.private_key && typeof svc.private_key === 'string') {
          svc.private_key = svc.private_key.replace(/\\n/g, '\n');
        }
        initializeApp({ credential: cert(svc) });
      }
      const db = getFirestore();
      const snap = await db.collection('userProfiles').doc(uid).get();
      if (snap.exists) lineUserId = (snap.data() as any)?.lineUserId;
    }

    // 沒綁定就視為略過（不報錯）
    if (!lineUserId) {
      return Response.json({ ok: true, skipped: true, reason: 'no lineUserId' });
    }

    // 送 LINE 推播
    const res = await fetch('https://api.line.me/v2/bot/message/push', {
      method: 'POST',
      headers: { Authorization: `Bearer ${token}`, 'Content-Type': 'application/json' },
      body: JSON.stringify({ to: lineUserId, messages: [{ type: 'text', text: message }] }),
    });

    const text = await res.text();
    return Response.json({ ok: res.ok, status: res.status, body: text });
  } catch (err: any) {
    return Response.json({ ok: false, error: String(err?.message ?? err) }, { status: 500 });
  }
}
