// src/app/api/version/route.ts
export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';

export async function GET() {
  const sha = process.env.VERCEL_GIT_COMMIT_SHA || null;
  const ref = process.env.VERCEL_GIT_COMMIT_REF || null;
  const msg = process.env.VERCEL_GIT_COMMIT_MESSAGE || null;
  const env = process.env.VERCEL_ENV || (process.env.NODE_ENV ?? null);
  const region = process.env.VERCEL_REGION || null;

  return Response.json({
    ok: true,
    commit: sha ? sha.slice(0, 7) : null,
    branch: ref,
    message: msg,
    env,
    region,
    now: new Date().toISOString(),
  });
}