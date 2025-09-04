// src/app/api/line/push/route.ts
export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';

export async function POST(req: Request) {
  const token = process.env.LINE_CHANNEL_ACCESS_TOKEN;
  if (!token) {
    return Response.json({ ok: false, error: 'Missing LINE_CHANNEL_ACCESS_TOKEN' }, { status: 500 });
  }
  try {
    const { to, message } = await req.json();
    if (typeof to !== 'string' || !to) {
      return Response.json({ ok: false, error: '`to` (userId) is required' }, { status: 400 });
    }
    if (typeof message !== 'string' || !message) {
      return Response.json({ ok: false, error: '`message` is required' }, { status: 400 });
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
    if (!res.ok) {
      return Response.json({ ok: false, status: res.status, body: text }, { status: 502 });
    }
    return Response.json({ ok: true, status: res.status, body: text });
  } catch (err: any) {
    return Response.json({ ok: false, error: String(err?.message ?? err) }, { status: 500 });
  }
}