import { NextResponse } from "next/server";

export const dynamic = "force-dynamic";

/**
 * Camera Proxy Endpoint — proxies ESP32-CAM MJPEG streams and JPEG snapshots.
 * Streams res.body continuously without timeout aborts so browser <img />
 * can play the camera feed seamlessly.
 */
export async function GET(req: Request) {
  const { searchParams } = new URL(req.url);
  const targetUrl = searchParams.get("url");

  if (!targetUrl) {
    return NextResponse.json({ error: "Missing url parameter" }, { status: 400 });
  }

  try {
    const res = await fetch(targetUrl, {
      cache: "no-store",
      headers: {
        "Accept": "*/*",
      },
    });

    if (!res.ok) {
      return NextResponse.json({ error: `Camera HTTP ${res.status}` }, { status: res.status });
    }

    const contentType = res.headers.get("content-type") ?? "image/jpeg";
    return new Response(res.body, {
      status: 200,
      headers: {
        "content-type": contentType,
        "cache-control": "no-cache, no-store, must-revalidate",
        "access-control-allow-origin": "*",
      },
    });
  } catch (err: any) {
    return NextResponse.json(
      { error: `Camera unreachable: ${err.message ?? "connection failed"}` },
      { status: 502 }
    );
  }
}
