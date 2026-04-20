"""
Mia — voice AI receptionist for the demo Realtor.

Single-agent pattern from livekit-agents SDK. Tools are stubbed for the in-browser
demo (they log + return success); production deployment swaps in real CRM/calendar
integrations.
"""

import json
import logging
from livekit import rtc
from livekit.agents import (
    Agent,
    AgentServer,
    AgentSession,
    RunContext,
    TurnHandlingOptions,
    function_tool,
    room_io,
)
from livekit.plugins import noise_cancellation, silero
from livekit.plugins.turn_detector.multilingual import MultilingualModel

log = logging.getLogger("realtor-receptionist")
logging.basicConfig(level=logging.INFO)


SYSTEM_PROMPT = """\
You are Mia, the AI receptionist for a busy real estate agent in the United States.

Your job is to:
1. Answer every inbound call in under one ring with warmth and professionalism.
2. Qualify the caller — buyer, seller, renter, or vendor — and gather:
   - Full name and best callback number
   - Property address (if calling about a specific listing)
   - Buying timeline OR selling timeline
   - Pre-approval status (buyers) OR home value expectations (sellers)
3. If the caller is a qualified buyer, propose 2-3 showing time slots and book
   one using the `schedule_showing` tool.
4. If they are a qualified seller, book a CMA appointment with the agent using
   the `schedule_showing` tool with type="cma".
5. If you genuinely cannot help (legal questions, contract negotiation, hostile
   callers), use `transfer_to_human` and explain you're connecting them.
6. Always confirm details verbally before logging anything.

Voice principles:
- Speak naturally. Use contractions. Vary sentence length.
- Never use markdown, asterisks, or formatting characters. You are heard, not read.
- Keep responses under two sentences unless the caller explicitly asks for detail.
- If the caller interrupts, stop talking immediately and listen.
- Never claim to be human. If asked, say: "I'm Mia, an AI receptionist working
  with [Agent Name] — I can answer questions and book showings just like a person
  on the team would."

You are demonstrating the product on the website voiceaireceptionists.com.
The demo Realtor is "Jordan from Sunbelt Realty" in Austin, TX — UNLESS
personalization overrides are supplied below.
"""


DEFAULT_GREETING = (
    "Greet the caller warmly. Say: 'Sunbelt Realty, this is Mia — "
    "how can I help you today?' Keep it under one breath."
)


class RealtorReceptionist(Agent):
    def __init__(self, instructions: str = SYSTEM_PROMPT, greeting: str = DEFAULT_GREETING):
        super().__init__(instructions=instructions)
        self._greeting = greeting

    async def on_enter(self):
        await self.session.generate_reply(instructions=self._greeting)

    @function_tool()
    async def schedule_showing(
        self,
        context: RunContext,
        contact_name: str,
        contact_phone: str,
        property_address: str,
        date: str,
        time: str,
        showing_type: str = "buyer",
    ) -> str:
        """Book a property showing or CMA appointment into the agent's calendar.

        Args:
            contact_name: Full name of the caller
            contact_phone: Best callback number
            property_address: Street address of the property (or 'TBD' for CMA)
            date: ISO date YYYY-MM-DD
            time: Time in HH:MM format, 24h
            showing_type: 'buyer', 'seller', or 'cma'
        """
        log.info(
            "DEMO STUB schedule_showing: %s %s @ %s for %s on %s %s (type=%s)",
            contact_name, contact_phone, property_address,
            contact_name, date, time, showing_type,
        )
        return (
            f"Showing booked for {contact_name} at {property_address} on "
            f"{date} at {time}. The agent will receive a calendar invite."
        )

    @function_tool()
    async def qualify_lead(
        self,
        context: RunContext,
        name: str,
        phone: str,
        intent: str,
        timeline: str,
        financing: str = "unknown",
    ) -> str:
        """Log a qualified lead into the CRM (stubbed for demo)."""
        log.info(
            "DEMO STUB qualify_lead: %s | %s | intent=%s | timeline=%s | financing=%s",
            name, phone, intent, timeline, financing,
        )
        return f"Lead logged: {name} ({phone}) — {intent}, timeline {timeline}."

    @function_tool()
    async def transfer_to_human(self, context: RunContext, reason: str) -> str:
        """Warmly transfer the caller to the live agent."""
        log.info("DEMO STUB transfer_to_human: reason=%s", reason)
        return (
            "I'm connecting you to the agent now — please hold for just a moment."
        )

    @function_tool()
    async def send_followup_sms(
        self, context: RunContext, phone: str, message: str
    ) -> str:
        """Send the caller a text message confirming next steps."""
        log.info("DEMO STUB send_followup_sms: %s -> %s", phone, message)
        return f"Text sent to {phone}."


server = AgentServer()


def _build_personalized_instructions(brand: str, brief: str) -> tuple[str, str]:
    """Turn the scraped website brief into a custom system prompt + greeting for this session."""
    brand_clean = (brand or "").strip() or "your brokerage"
    personalized_prompt = (
        SYSTEM_PROMPT
        + "\n\n---\n"
        + f"PERSONALIZATION OVERRIDE:\n"
        + f"For this session, you are the AI receptionist for {brand_clean}. "
        + "Use the brand name, style, and information below to answer questions naturally. "
        + "If asked about a specific property or service mentioned on their website, cite details "
        + "from the brief. If asked about something NOT in the brief, say honestly that you'd need "
        + "to pass that on to the agent and offer to take a message.\n\n"
        + "WEBSITE BRIEF (this is cheat-sheet context, NOT a script):\n"
        + brief.strip()
    )
    personalized_greeting = (
        f"Greet the caller warmly as the receptionist for {brand_clean}. "
        f"Say something like '{brand_clean}, this is Mia — how can I help you today?' "
        "Keep it under one breath."
    )
    return personalized_prompt, personalized_greeting


@server.rtc_session(agent_name="mia-realtor")
async def entrypoint(ctx):
    # Read personalization from room metadata if the token endpoint set it.
    instructions = SYSTEM_PROMPT
    greeting = DEFAULT_GREETING
    raw_metadata = getattr(ctx.room, "metadata", "") or ""
    if raw_metadata:
        try:
            meta = json.loads(raw_metadata)
            brief = (meta.get("brief") or "").strip()
            brand = (meta.get("brand") or "").strip()
            if brief:
                instructions, greeting = _build_personalized_instructions(brand, brief)
                log.info("Personalized session for brand=%r (brief chars=%d)", brand, len(brief))
        except Exception as err:
            log.warning("Failed to parse room metadata: %s", err)

    session = AgentSession(
        stt="deepgram/flux-general",
        llm="openai/gpt-5-mini",
        tts="cartesia/sonic-3:9626c31c-bec5-4cca-baa8-f8ba9e84c8bc",
        vad=silero.VAD.load(),
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


if __name__ == "__main__":
    from livekit.agents import cli
    cli.run_app(server)
