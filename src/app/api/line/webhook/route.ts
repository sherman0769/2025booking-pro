// src/app/api/line/webhook/route.ts
export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';

import crypto from 'crypto';
import { initializeApp, getApps, getApp } from 'firebase/app';
import {
  getFirestore, collection, query, where, limit, getDocs,
  doc, setDoc, serverTimestamp,
} from 'firebase/firestore';

function verifySignature(rawBody: string, signature: string | null, secret: string) {
  const hmac = crypto.createHmac('sha256', secret).update(rawBody).digest('base64');
  return signature === hmac;
}

// for LINE "Verify"
export async function GET()  { return new Response('OK', { status: 200 }); }
export async function HEAD() { return new Response(null,   { status: 200 }); }

async function replyMessage(replyToken: string, text: string) {
  const token = process.env.LINE_CHANNEL_ACCESS_TOKEN!;
  await fetch('https://api.line.me/v2/bot/message/reply', {
    method: 'POST',
    headers: {
      Authorization: `Bearer ${token}`,
      'Content-Type': 'application/json',
    },
    body: JSON.stringify({ replyToken, messages: [{ type: 'text', text }] }),
  });
}

export async function POST(req: Request) {
  const secret = process.env.LINE_CHANNEL_SECRET;
  if (!secret) return new Response('Missing LINE_CHANNEL_SECRET', { status: 500 });

  // 1) 取 raw body 驗簽
  const signature = req.headers.get('x-line-signature');
  const raw = await req.text();
  if (!verifySignature(raw, signature, secret)) return new Response('Bad signature', { status: 401 });

  // 2) 解析事件
  const body = JSON.parse(raw);
  const events = Array.isArray(body.events) ? body.events : [];

  // 3) 初始化 Firestore（用前端 SDK 即可）
  const app = getApps().length ? getApp() : initializeApp({
    apiKey: process.env.NEXT_PUBLIC_FIREBASE_API_KEY!,
    authDomain: process.env.NEXT_PUBLIC_FIREBASE_AUTH_DOMAIN!,
    projectId: process.env.NEXT_PUBLIC_FIREBASE_PROJECT_ID!,
    storageBucket: process.env.NEXT_PUBLIC_FIREBASE_STORAGE_BUCKET!,
    appId: process.env.NEXT_PUBLIC_FIREBASE_APP_ID!,
    messagingSenderId: process.env.NEXT_PUBLIC_FIREBASE_MESSAGING_SENDER_ID!,
  });
  const db = getFirestore(app);

  // 4) 處理每一則訊息
  for (const ev of events) {
    try {
      if (ev.type !== 'message' || ev.message?.type !== 'text') continue;
      const text = String(ev.message.text || '').trim();
      const replyToken: string | undefined = ev.replyToken;
      const userId: string | undefined = ev.source?.userId; // Uxxxxxxxx...

      if (!replyToken || !userId) continue;

      // 擷取 6 碼（支援「綁定 123ABC」或直接傳 123ABC）
      const m = text.match(/(?:綁定\s*)?([A-Z0-9]{6})$/i);

      if (m) {
        const code = m[1].toUpperCase();

        // 找 userProfiles 中 bindCode = code 的文件
        const qy = query(
          collection(db, 'userProfiles'),
          where('bindCode', '==', code),
          limit(1)
        );
        const snap = await getDocs(qy);

        if (snap.empty) {
          await replyMessage(replyToken, '綁定碼無效或已使用，請回網站「綁定 LINE」頁重新產生 6 碼。');
        } else {
          const uid = snap.docs[0].id;
          await setDoc(
            doc(db, 'userProfiles', uid),
            { lineUserId: userId, bindCode: null, boundAt: serverTimestamp() },
            { merge: true }
          );
          await replyMessage(replyToken, '綁定成功！之後預約通知會傳到這裡 ✅');
        }
      } else {
        // 保險回覆：讓你確認 webhook 已收到訊息
        await replyMessage(
          replyToken,
          'Webhook OK ✅\n請輸入：「綁定 你的6碼」\n範例：綁定 ABC123\n（先到網站 /me/line 產生 6 碼）'
        );
      }
    } catch (err) {
      // 出錯也回一句，避免沉默
      try {
        if (ev?.replyToken) {
          await replyMessage(ev.replyToken, '系統忙線中，請稍後再試或重新產生綁定碼。');
        }
      } catch {}
    }
  }

  return new Response('OK', { status: 200 });
}
