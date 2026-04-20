"use client";

import { useEffect, useRef, useState } from "react";
import {
  Room,
  RoomEvent,
  Track,
  ConnectionState,
  createLocalAudioTrack,
} from "livekit-client";
import AudioVisualizer from "./AudioVisualizer";

const STATES = {
  IDLE: "idle",
  CONNECTING: "connecting",
  ACTIVE: "active",
  ENDED: "ended",
  ERROR: "error",
};

export default function LiveKitDemo({ brand = "", brief = "" }) {
  const [state, setState] = useState(STATES.IDLE);
  const [agentSpeaking, setAgentSpeaking] = useState(false);
  const [errorMsg, setErrorMsg] = useState("");
  const [duration, setDuration] = useState(0);

  const roomRef = useRef(null);
  const audioElRef = useRef(null);
  const startTimeRef = useRef(0);

  // duration ticker
  useEffect(() => {
    if (state !== STATES.ACTIVE) return;
    const id = setInterval(() => {
      setDuration(Math.floor((Date.now() - startTimeRef.current) / 1000));
    }, 500);
    return () => clearInterval(id);
  }, [state]);

  async function startCall() {
    setState(STATES.CONNECTING);
    setErrorMsg("");
    setDuration(0);

    try {
      // 1. Fetch token from our Next.js API route
      const tokenRes = await fetch("/api/livekit-token", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(brief ? { brand, brief } : {}),
      });
      if (!tokenRes.ok) throw new Error(`Token request failed (${tokenRes.status})`);
      const { serverUrl, participantToken } = await tokenRes.json();
      if (!serverUrl || !participantToken) throw new Error("Missing token in response");

      // 2. Create + connect to LiveKit room
      const room = new Room({ adaptiveStream: true, dynacast: true });
      roomRef.current = room;

      room.on(RoomEvent.TrackSubscribed, (track) => {
        if (track.kind === Track.Kind.Audio && audioElRef.current) {
          track.attach(audioElRef.current);
        }
      });

      room.on(RoomEvent.ActiveSpeakersChanged, (speakers) => {
        const agentTalking = speakers.some(
          (p) => p.identity !== room.localParticipant.identity
        );
        setAgentSpeaking(agentTalking);
      });

      room.on(RoomEvent.Disconnected, () => {
        setAgentSpeaking(false);
        setState((prev) => (prev === STATES.ACTIVE ? STATES.ENDED : prev));
      });

      room.on(RoomEvent.ConnectionStateChanged, (cs) => {
        if (cs === ConnectionState.Connected) {
          startTimeRef.current = Date.now();
          setState(STATES.ACTIVE);
        }
      });

      await room.connect(serverUrl, participantToken);

      // 3. Publish microphone
      const micTrack = await createLocalAudioTrack({
        echoCancellation: true,
        noiseSuppression: true,
      });
      await room.localParticipant.publishTrack(micTrack, {
        source: Track.Source.Microphone,
      });
    } catch (err) {
      console.error("LiveKit demo error", err);
      setErrorMsg(err?.message || "Could not start the call");
      setState(STATES.ERROR);
      if (roomRef.current) {
        try { await roomRef.current.disconnect(); } catch {}
      }
    }
  }

  async function endCall() {
    if (roomRef.current) {
      try { await roomRef.current.disconnect(); } catch {}
      roomRef.current = null;
    }
    setAgentSpeaking(false);
    setState(STATES.ENDED);
  }

  function reset() {
    setState(STATES.IDLE);
    setErrorMsg("");
    setDuration(0);
  }

  // tear down on unmount
  useEffect(() => {
    return () => {
      if (roomRef.current) {
        try { roomRef.current.disconnect(); } catch {}
      }
    };
  }, []);

  const mm = String(Math.floor(duration / 60)).padStart(2, "0");
  const ss = String(duration % 60).padStart(2, "0");

  return (
    <div className="w-full max-w-md mx-auto p-8 rounded-3xl border border-[#1A1A1F] bg-[#0E0E12]">
      <audio ref={audioElRef} autoPlay playsInline />

      {/* Status pill */}
      <div className="flex items-center justify-center mb-8 h-6">
        {state === STATES.IDLE && (
          <span className="text-[11px] font-bold tracking-[0.12em] uppercase text-[#44444D]">Idle</span>
        )}
        {state === STATES.CONNECTING && (
          <span className="text-[11px] font-bold tracking-[0.12em] uppercase text-[#A0A0AB] animate-pulse">Connecting…</span>
        )}
        {state === STATES.ACTIVE && (
          <span className="inline-flex items-center gap-2 text-[11px] font-bold tracking-[0.12em] uppercase text-[#2DD4BF]">
            <span className="relative flex h-2 w-2">
              <span className="absolute inline-flex h-full w-full rounded-full bg-[#2DD4BF] opacity-40" style={{ animation: "ring-pulse 2s ease-out infinite" }} />
              <span className="relative inline-flex rounded-full h-2 w-2 bg-[#2DD4BF]" />
            </span>
            Live · {mm}:{ss}
          </span>
        )}
        {state === STATES.ENDED && (
          <span className="text-[11px] font-bold tracking-[0.12em] uppercase text-[#6B6B76]">Call ended · {mm}:{ss}</span>
        )}
        {state === STATES.ERROR && (
          <span className="text-[11px] font-bold tracking-[0.12em] uppercase text-[#F87171]">Error</span>
        )}
      </div>

      {/* Visualizer */}
      <div className="mb-8 flex items-center justify-center h-16">
        <AudioVisualizer isAgentTalking={agentSpeaking} />
      </div>

      {/* Action button */}
      <div className="flex flex-col items-center gap-3">
        {state === STATES.IDLE && (
          <button
            onClick={startCall}
            className="w-full px-6 py-4 rounded-xl bg-[#2DD4BF] hover:bg-[#5EEAD4] text-[#07070A] text-[15px] font-bold tracking-[-0.01em] transition-all hover:shadow-[0_0_30px_rgba(45,212,191,0.3)]"
          >
            Talk to Mia
          </button>
        )}
        {state === STATES.CONNECTING && (
          <button
            disabled
            className="w-full px-6 py-4 rounded-xl bg-[#1A1A1F] text-[#6B6B76] text-[15px] font-bold cursor-not-allowed"
          >
            Connecting…
          </button>
        )}
        {state === STATES.ACTIVE && (
          <button
            onClick={endCall}
            className="w-full px-6 py-4 rounded-xl bg-[#F87171]/10 border border-[#F87171]/30 hover:bg-[#F87171]/20 text-[#F87171] text-[15px] font-bold transition-colors"
          >
            End call
          </button>
        )}
        {(state === STATES.ENDED || state === STATES.ERROR) && (
          <>
            {errorMsg && (
              <div className="text-[12px] text-[#F87171] text-center mb-1 px-2">{errorMsg}</div>
            )}
            <button
              onClick={reset}
              className="w-full px-6 py-4 rounded-xl border border-[#2DD4BF]/30 hover:bg-[#2DD4BF]/5 text-[#2DD4BF] text-[15px] font-bold transition-colors"
            >
              {state === STATES.ENDED ? "Try another call" : "Try again"}
            </button>
          </>
        )}
        <div className="text-[11px] text-[#44444D] text-center mt-1">
          By starting, you allow microphone access. Calls last up to 10 minutes.
        </div>
      </div>
    </div>
  );
}
