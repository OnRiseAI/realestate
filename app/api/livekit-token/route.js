import { AccessToken } from "livekit-server-sdk";

export const runtime = "nodejs";

export async function POST(req) {
  const apiKey = process.env.LIVEKIT_API_KEY;
  const apiSecret = process.env.LIVEKIT_API_SECRET;
  const livekitUrl = process.env.LIVEKIT_URL;

  if (!apiKey || !apiSecret || !livekitUrl) {
    return Response.json(
      { error: "LiveKit env vars missing on server" },
      { status: 500 }
    );
  }

  const body = await req.json().catch(() => ({}));
  const roomName = body.room_name || `realtor-demo-${Date.now()}`;
  const identity = body.participant_identity || `caller-${Date.now()}`;
  const participantName = body.participant_name || "Demo Caller";

  const at = new AccessToken(apiKey, apiSecret, {
    identity,
    name: participantName,
    ttl: "10m",
  });

  at.addGrant({
    room: roomName,
    roomJoin: true,
    canPublish: true,
    canSubscribe: true,
    canPublishData: true,
  });

  at.roomConfig = {
    agents: [{ agentName: "mia-realtor" }],
  };

  return Response.json({
    serverUrl: livekitUrl,
    participantToken: await at.toJwt(),
    roomName,
  });
}
