export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';

export const WEBHOOK_VERSION = 'no-fallback-1'; // ← 版本標記，方便你核對是否已上線

import crypto from 'crypto';
import { getApps, initializeApp, cert } from 'firebase-admin/app';
import { getFirestore } from 'firebase-admin/firestore';

function verifySignature(rawBody: string, signature: string | null, secret: string) {
  const hmac = crypto.createHmac('sha256', secret).update(rawBody).digest('base64');
  return signature === hmac;
}

// 用來給 LINE「Verify」和你手動檢查
export async function GET()  { return Response.json({ ok: true, route: '/api/line/webhook', version: WEBHOOK_VERSION }); }
export async function HEAD() { return new Response(null, { status: 200 }); }

async function replyMessage(replyToken: string, text: string) {
  const token = process.env.LINE_CHANNEL_ACCESS_TOKEN!;
  await fetch('https://api.line.me/v2/bot/message/reply', {
    method: 'POST',
    headers: { Authorization: `Bearer ${token}`, 'Content-Type': 'application/json' },
    body: JSON.stringify({ replyToken, messages: [{ type: 'text', text }] }),
  });
}

export async function POST(req: Request) {
  const secret = process.env.LINE_CHANNEL_SECRET;
  if (!secret) return new Response('Missing LINE_CHANNEL_SECRET', { status: 500 });

  // 1) 驗簽（要用 raw body）
  const signature = req.headers.get('x-line-signature');
  const raw = await req.text();
  if (!verifySignature(raw, signature, secret)) return new Response('Bad signature', { status: 401 });

  // 2) 解析事件
  const body = JSON.parse(raw);
  const events = Array.isArray(body.events) ? body.events : [];

  // 3) 初始化 Admin SDK（用 Vercel 的 FIREBASE_SERVICE_ACCOUNT）
  const svcJson = process.env.FIREBASE_SERVICE_ACCOUNT;
  if (!svcJson) return new Response('Missing FIREBASE_SERVICE_ACCOUNT', { status: 500 });
  const svc = JSON.parse(svcJson);
  if (svc.private_key && typeof svc.private_key === 'string') svc.private_key = svc.private_key.replace(/\\n/g, '\n');
  if (!getApps().length) initializeApp({ credential: cert(svc) });
  const db = getFirestore();

  // 4) 僅處理「綁定 6 碼」；其他訊息不回覆（但回 200）
  for (const ev of events) {
    try {
      if (ev.type !== 'message' || ev.message?.type !== 'text') continue;

      const text = String(ev.message.text || '').trim();
      const replyToken: string | undefined = ev.replyToken;
      const userId: string | undefined = ev.source?.userId; // Uxxxxxxxx...
      if (!replyToken || !userId) continue;

      // 支援「綁定 ABC123」或直接「ABC123」
      const m = text.match(/(?:綁定\s*)?([A-Z0-9]{6})$/i);
      if (!m) continue; // ← 不再有任何 fallback 回覆

      const code = m[1].toUpperCase();

      const snap = await db.collection('userProfiles').where('bindCode', '==', code).limit(1).get();
      if (snap.empty) {
        await replyMessage(replyToken, '綁定碼無效或已使用，請回網站重新產生綁定碼。');
        continue;
      }

      const uid = snap.docs[0].id;
      await db.collection('userProfiles').doc(uid)
        .set({ lineUserId: userId, bindCode: null, boundAt: new Date() }, { merge: true });

      await replyMessage(replyToken, '綁定成功！之後預約通知會傳到這裡 ✅');
    } catch {
      try { if (ev?.replyToken) await replyMessage(ev.replyToken, '系統忙線中，請稍後再試或重新產生綁定碼。'); } catch {}
    }
  }

  return new Response('OK', { status: 200 });
}
