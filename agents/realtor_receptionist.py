"""
Mia — voice AI receptionist for the demo Realtor.

Single-agent pattern from livekit-agents SDK. Tools are stubbed for the in-browser
demo (they log + return success); production deployment swaps in real CRM/calendar
integrations. The `search_properties` tool is live — it queries our Next.js API
which reads a per-domain catalog from Vercel KV (Upstash Redis).
"""

import json
import logging
import os

import httpx
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


SEARCH_API_BASE = os.environ.get(
    "SEARCH_API_BASE", "https://realestate.voiceaireceptionists.com"
)


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
    def __init__(
        self,
        instructions: str = SYSTEM_PROMPT,
        greeting: str = DEFAULT_GREETING,
        domain: str = "",
    ):
        super().__init__(instructions=instructions)
        self._greeting = greeting
        self._domain = domain

    async def on_enter(self):
        # Kept for compatibility; primary greeting is fired explicitly after
        # session.start() in entrypoint below. This is a no-op safety net —
        # generating twice would talk over itself.
        pass

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
        """Book a property showing or CMA appointment into the agent's calendar."""
        log.info(
            "DEMO STUB schedule_showing: %s %s @ %s on %s %s (type=%s)",
            contact_name, contact_phone, property_address, date, time, showing_type,
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
        return "I'm connecting you to the agent now — please hold for just a moment."

    @function_tool()
    async def send_followup_sms(
        self, context: RunContext, phone: str, message: str
    ) -> str:
        """Send the caller a text message confirming next steps."""
        log.info("DEMO STUB send_followup_sms: %s -> %s", phone, message)
        return f"Text sent to {phone}."

    @function_tool()
    async def search_properties(
        self,
        context: RunContext,
        location: str | None = None,
        min_price: int | None = None,
        max_price: int | None = None,
        bedrooms: int | None = None,
        currency: str | None = None,
    ) -> str:
        """Search the brokerage's active inventory for matching properties.

        Use this whenever a caller mentions a location, price range, bedroom count,
        or property type. Pass only the fields you heard explicitly — leave the
        rest as None. Returns a short prose summary you can speak aloud. If the
        search finds nothing, offer to take a message for the team.

        Args:
            location: City or neighborhood the caller mentioned (e.g. "Marbella")
            min_price: Lower bound of their budget in whole units (no cents)
            max_price: Upper bound of their budget in whole units
            bedrooms: Minimum number of bedrooms
            currency: Three-letter code if the caller gave one (EUR, USD, GBP, etc.)
        """
        if not self._domain:
            return (
                "No brokerage inventory is indexed for this demo session. "
                "Offer to take the caller's details and have the team follow up."
            )

        payload = {"domain": self._domain}
        if location: payload["location"] = location
        if min_price is not None: payload["minPrice"] = min_price
        if max_price is not None: payload["maxPrice"] = max_price
        if bedrooms is not None: payload["bedrooms"] = bedrooms
        if currency: payload["currency"] = currency

        url = f"{SEARCH_API_BASE}/api/search-properties"
        log.info("search_properties → %s %s", url, payload)

        try:
            async with httpx.AsyncClient(timeout=5.0) as client:
                resp = await client.post(url, json=payload)
                resp.raise_for_status()
                data = resp.json()
            prose = (data.get("prose") or "").strip()
            if prose:
                return prose
            return (
                "Couldn't pull anything back from the inventory right now. "
                "Offer to take their details and circle back."
            )
        except Exception as err:
            log.warning("search_properties failed: %s", err)
            return (
                "The inventory system isn't responding right now. Take the caller's "
                "preferences and let them know someone will reach out."
            )


server = AgentServer()


def _build_personalized_instructions(brand: str, brief: str, has_catalog: bool) -> tuple[str, str]:
    """Turn the scraped website brief into a custom system prompt + greeting for this session."""
    brand_clean = (brand or "").strip() or "your brokerage"
    search_guidance = (
        "\n\nYou have a live `search_properties` tool wired to the brokerage's actual inventory. "
        "When a caller mentions a location, price range, or bedroom count, call the tool with "
        "the fields you heard (leave others blank). Describe the top match(es) naturally — give "
        "address or neighborhood, price, and bedrooms. Offer to book a viewing. If the search "
        "returns nothing, take a message and promise the team will follow up. NEVER invent "
        "listings that the tool didn't return."
    ) if has_catalog else ""

    personalized_prompt = (
        SYSTEM_PROMPT
        + "\n\n---\n"
        + f"PERSONALIZATION OVERRIDE:\n"
        + f"For this session, you are the AI receptionist for {brand_clean}. "
        + "Use the brand name, style, and information below to answer questions naturally. "
        + "If asked about a specific property or service mentioned on their website, cite details "
        + "from the brief. If asked about something NOT in the brief, say honestly that you'd need "
        + "to pass that on to the agent and offer to take a message."
        + search_guidance
        + "\n\nWEBSITE BRIEF (this is cheat-sheet context, NOT a script):\n"
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
    # Per-session data travels on the agent dispatch, read via ctx.job.metadata.
    # Also fall back to room metadata for safety.
    instructions = SYSTEM_PROMPT
    greeting = DEFAULT_GREETING
    domain = ""
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
            brief = (meta.get("brief") or "").strip()
            brand = (meta.get("brand") or "").strip()
            domain = (meta.get("domain") or "").strip()
            if brief:
                instructions, greeting = _build_personalized_instructions(
                    brand, brief, has_catalog=bool(domain)
                )
                log.info(
                    "Personalized session: brand=%r brief=%d domain=%r",
                    brand, len(brief), domain,
                )
        except Exception as err:
            log.warning("Failed to parse metadata: %s", err)
    else:
        log.info("No session metadata found — using default Sunbelt persona")

    session = AgentSession(
        stt="deepgram/flux-general",
        llm="openai/gpt-5-mini",
        tts="cartesia/sonic-3:9626c31c-bec5-4cca-baa8-f8ba9e84c8bc",
        vad=silero.VAD.load(),
        turn_handling=TurnHandlingOptions(turn_detection=MultilingualModel()),
    )
    await session.start(
        room=ctx.room,
        agent=RealtorReceptionist(
            instructions=instructions, greeting=greeting, domain=domain
        ),
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
    # Explicit greeting after start — matches the livekit-agents SKILL pattern.
    # The on_enter hook isn't firing reliably on v1.5.4 + gpt-5-mini with long prompts;
    # calling generate_reply here ensures speech scheduling is active.
    await session.generate_reply(instructions=greeting)


if __name__ == "__main__":
    from livekit.agents import cli
    cli.run_app(server)
