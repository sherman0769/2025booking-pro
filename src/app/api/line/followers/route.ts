// src/app/api/line/followers/route.ts
export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';

export async function GET() {
  const token = process.env.LINE_CHANNEL_ACCESS_TOKEN;
  if (!token) {
    return Response.json({ ok: false, error: 'Missing LINE_CHANNEL_ACCESS_TOKEN' }, { status: 500 });
  }
  try {
    // 取前 200 筆追蹤者 ID（若需要更多，可用 next 標記分頁）
    const res = await fetch('https://api.line.me/v2/bot/followers/ids?limit=200', {
      headers: { Authorization: `Bearer ${token}` },
    });
    const data = await res.json();
    if (!res.ok) {
      return Response.json({ ok: false, status: res.status, body: data }, { status: 502 });
    }
    return Response.json({ ok: true, ...data }); // { userIds: string[], next?: string }
  } catch (err: any) {
    return Response.json({ ok: false, error: String(err?.message ?? err) }, { status: 500 });
  }
}