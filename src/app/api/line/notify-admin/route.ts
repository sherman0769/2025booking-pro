// src/app/api/line/notify-admin/route.ts
export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';

import { getApps, initializeApp, cert } from 'firebase-admin/app';
import { getFirestore, FieldValue } from 'firebase-admin/firestore';

async function logNotify(data: any) {
  try {
    const svcJson = process.env.FIREBASE_SERVICE_ACCOUNT;
    if (!svcJson) return; // 沒金鑰就不記錄
    if (!getApps().length) {
      const svc = JSON.parse(svcJson);
      if (typeof svc.private_key === 'string') {
        svc.private_key = svc.private_key.replace(/\\n/g, '\n');
      }
      initializeApp({ credential: cert(svc) });
    }
    const db = getFirestore();
    await db.collection('notifyLogs').add({
      ...data,
      ts: FieldValue.serverTimestamp(),
      env: process.env.VERCEL_ENV ?? process.env.NODE_ENV ?? 'local',
    });
  } catch { /* 忽略 */ }
}

export async function POST(req: Request) {
  const token = process.env.LINE_CHANNEL_ACCESS_TOKEN;
  const to = process.env.LINE_ADMIN_USER_ID;
  if (!token || !to) {
    await logNotify({
      kind: 'admin',
      ok: false,
      error: 'Missing LINE_CHANNEL_ACCESS_TOKEN or LINE_ADMIN_USER_ID',
    });
    return Response.json(
      { ok: false, error: 'Missing LINE_CHANNEL_ACCESS_TOKEN or LINE_ADMIN_USER_ID' },
      { status: 500 }
    );
  }
  try {
    const { message } = await req.json().catch(() => ({ message: '' }));
    if (!message || typeof message !== 'string') {
      return Response.json({ ok: false, error: 'message is required (string)' }, { status: 400 });
    }

    const res = await fetch('https://api.line.me/v2/bot/message/push', {
      method: 'POST',
      headers: {
        Authorization: `Bearer ${token}`,
        'Content-Type': 'application/json',
      },
      body: JSON.stringify({
        to,
        messages: [{ type: 'text', text: message }],
      }),
    });

    const text = await res.text();

    await logNotify({
      kind: 'admin',
      toLineUserId: to,
      ok: res.ok,
      status: res.status,
      body: text.slice(0, 200),
      preview: message.slice(0, 80),
    });

    if (!res.ok) {
      return Response.json({ ok: false, status: res.status, body: text }, { status: 502 });
    }
    return Response.json({ ok: true, status: res.status, body: text });
  } catch (err: any) {
    await logNotify({ kind: 'admin', ok: false, error: String(err?.message ?? err) });
    return Response.json({ ok: false, error: String(err?.message ?? err) }, { status: 500 });
  }
}
