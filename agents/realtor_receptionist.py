"""
Mia — voice AI receptionist for the demo Realtor.

Single-agent pattern from livekit-agents SDK. Tools are stubbed for the in-browser
demo (they log + return success); production deployment swaps in real CRM/calendar
integrations.
"""

import json
import logging
import re
from pathlib import Path

from livekit import rtc
from livekit.agents import (
    Agent,
    AgentServer,
    AgentSession,
    TurnHandlingOptions,
    room_io,
)
from livekit.plugins import noise_cancellation, silero
from livekit.plugins.turn_detector.multilingual import MultilingualModel

log = logging.getLogger("realtor-receptionist")
logging.basicConfig(level=logging.INFO)


# ────────────────────────────────────────────────────────────────────
# Prompt files live alongside this script in ./prompts/
# Edit the .md files, redeploy with `lk agent deploy`. No Python needed.
# ────────────────────────────────────────────────────────────────────

_PROMPTS_DIR = Path(__file__).parent / "prompts"


def _read_prompt_file(filename: str) -> str:
    try:
        return (_PROMPTS_DIR / filename).read_text(encoding="utf-8").strip()
    except FileNotFoundError:
        log.warning("Prompt file missing: %s", filename)
        return ""


def _parse_greetings(raw: str) -> tuple[str, str]:
    """Pull default + personalized greeting lines out of greeting.md.
    The file has two markdown sections; we grab the first non-header line under each H2."""
    default, personalized = "", ""
    current = None
    for line in raw.splitlines():
        s = line.strip()
        if s.lower().startswith("## default"):
            current = "default"
            continue
        if s.lower().startswith("## personalized"):
            current = "personalized"
            continue
        if s.startswith("#") or s.startswith("---") or not s:
            continue
        # Skip lines that are obviously instruction text, not the greeting itself.
        if "`{name}`" in s or "placeholder" in s.lower() or "replaced" in s.lower():
            continue
        if current == "default" and not default:
            default = s
        elif current == "personalized" and not personalized:
            personalized = s
    return default, personalized


SYSTEM_PROMPT = _read_prompt_file("system.md")
_GREETING_RAW = _read_prompt_file("greeting.md")
DEFAULT_GREETING_TEXT, PERSONALIZED_GREETING_TEMPLATE = _parse_greetings(_GREETING_RAW)
PERSONALIZATION_OVERRIDE = _read_prompt_file("personalization.md")

# Fallbacks if any file is missing or malformed.
if not DEFAULT_GREETING_TEXT:
    DEFAULT_GREETING_TEXT = "Sunbelt Realty, this is Mia — how can I help you today?"
if not PERSONALIZED_GREETING_TEMPLATE:
    PERSONALIZED_GREETING_TEMPLATE = "{name}, this is Mia — how can I help you today?"

DEFAULT_GREETING = f"Greet the caller warmly. Say: '{DEFAULT_GREETING_TEXT}' Keep it under one breath."


class RealtorReceptionist(Agent):
    """Simple voice receptionist. Reads prompts from markdown, echoes the
    business name in the greeting. No function tools, no CRM writes, no
    scheduling — just conversation."""

    def __init__(self, instructions: str = SYSTEM_PROMPT, greeting: str = DEFAULT_GREETING):
        super().__init__(instructions=instructions)
        self._greeting = greeting

    async def on_enter(self):
        # Primary greeting fires explicitly after session.start in entrypoint.
        pass


def prewarm(proc):
    """Load the silero VAD model once per worker process instead of once per call.
    Cuts 3-5s off cold-start latency for the first greeting."""
    proc.userdata["vad"] = silero.VAD.load()


server = AgentServer(setup_fnc=prewarm)


def _build_personalized_instructions(business_name: str) -> tuple[str, str, str]:
    """Session-specific system prompt + greeting + direct greeting text.
    Pulls templates from prompts/personalization.md and prompts/greeting.md,
    substituting `{name}` with the typed brokerage name."""
    name = (business_name or "").strip() or "your brokerage"
    override_text = PERSONALIZATION_OVERRIDE.replace("{name}", name) if PERSONALIZATION_OVERRIDE else ""
    personalized_prompt = (
        SYSTEM_PROMPT
        + "\n\n---\n"
        + f"PERSONALIZATION OVERRIDE:\n"
        + override_text
    )
    greeting_text = PERSONALIZED_GREETING_TEMPLATE.replace("{name}", name)
    personalized_greeting_instr = (
        f"Greet the caller warmly as the receptionist for {name}. "
        f"Say: '{greeting_text}' Keep it under one breath."
    )
    return personalized_prompt, personalized_greeting_instr, greeting_text


@server.rtc_session(agent_name="mia-realtor")
async def entrypoint(ctx):
    # Per-session data travels on the agent dispatch, read via ctx.job.metadata.
    # Also fall back to room metadata for safety.
    instructions = SYSTEM_PROMPT
    greeting = DEFAULT_GREETING
    greeting_text = DEFAULT_GREETING_TEXT
    raw_metadata = ""
    for source in ("job", "room"):
        obj = ctx.job if source == "job" else getattr(ctx, "room", None)
        val = getattr(obj, "metadata", "") if obj is not None else ""
        if val:
            raw_metadata = val
            log.info("Using %s metadata (%d chars)", source, len(val))
            break

    if raw_metadata:
        try:
            meta = json.loads(raw_metadata)
            business_name = (meta.get("business_name") or "").strip()
            if business_name:
                instructions, greeting, greeting_text = _build_personalized_instructions(business_name)
                log.info("Personalized session: business_name=%r", business_name)
        except Exception as err:
            log.warning("Failed to parse metadata: %s", err)
    else:
        log.info("No session metadata — using default Sunbelt persona")

    session = AgentSession(
        stt="deepgram/flux-general",
        llm="openai/gpt-5-mini",
        tts="cartesia/sonic-3:9626c31c-bec5-4cca-baa8-f8ba9e84c8bc",
        vad=ctx.proc.userdata.get("vad") or silero.VAD.load(),
        turn_handling=TurnHandlingOptions(turn_detection=MultilingualModel()),
    )
    await session.start(
        room=ctx.room,
        agent=RealtorReceptionist(instructions=instructions, greeting=greeting),
        room_options=room_io.RoomOptions(
            audio_input=room_io.AudioInputOptions(
                noise_cancellation=lambda p: (
                    noise_cancellation.BVCTelephony()
                    if p.participant.kind
                    == rtc.ParticipantKind.PARTICIPANT_KIND_SIP
                    else noise_cancellation.BVC()
                ),
            ),
        ),
    )
    # Greeting via generate_reply — session.say() was hanging silently on
    # livekit-agents 1.5.4 (no logs, no speech, no error). Fallback pattern
    # works reliably even if slightly slower. greeting_text is embedded in
    # the instructions so the LLM still says the exact brokerage name.
    await session.generate_reply(instructions=greeting)


if __name__ == "__main__":
    from livekit.agents import cli
    cli.run_app(server)
