// src/app/api/line/notify-admin/route.ts
export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';

export async function POST(req: Request) {
  const token = process.env.LINE_CHANNEL_ACCESS_TOKEN;
  const to = process.env.LINE_ADMIN_USER_ID;
  if (!token || !to) {
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
    if (!res.ok) {
      return Response.json({ ok: false, status: res.status, body: text }, { status: 502 });
    }
    return Response.json({ ok: true, status: res.status, body: text });
  } catch (err: any) {
    return Response.json({ ok: false, error: String(err?.message ?? err) }, { status: 500 });
  }
}