"""Draft a bundle's title or description with the host LLM, using the
titles and descriptions of the bundle's own members as context.

The completion runs through the host's `/api/apps-sdk/llm` endpoint, which
uses whatever provider the user has configured in OpenSwarm (their Claude
subscription, an API key, etc.), so nothing here needs its own key.
"""
from __future__ import annotations

from typing import List

from backend.apps.openswarm_host import openswarm_host

_MAX_MEMBERS = 40
_MAX_MEMBER_DESC = 240
_MAX_TITLE_CHARS = 80
_MAX_DESC_CHARS = 320

_TITLE_SYSTEM = (
    "You name a bundle: a small collection of apps, skills, and other bundles.\n"
    "Given the members it contains, return a short, human title of at most about\n"
    "five words that captures what they have in common.\n"
    "Rules: return the title only, no quotes, no trailing period, no preamble\n"
    "like 'Here is', no emojis."
)

_DESC_SYSTEM = (
    "You describe a bundle: a small collection of apps, skills, and other bundles.\n"
    "Given the members it contains, return ONE concise sentence summarizing what\n"
    "the bundle groups together and what it is for.\n"
    "Rules: return the sentence only, no quotes, no preamble like 'Here is',\n"
    "no bullet points, no emojis."
)


def _member_block(members: List[dict]) -> str:
    lines: List[str] = []
    for m in members[:_MAX_MEMBERS]:
        kind = str(m.get("kind", "") or "item").strip()
        name = str(m.get("name", "") or "").strip()
        if not name:
            continue
        desc = " ".join(str(m.get("description", "") or "").split())
        if len(desc) > _MAX_MEMBER_DESC:
            desc = desc[:_MAX_MEMBER_DESC].rstrip() + "…"
        lines.append(f"- ({kind}) {name}" + (f": {desc}" if desc else ""))
    return "\n".join(lines)


def _clean(text: str, cap: int) -> str:
    text = (text or "").strip()
    # Models sometimes wrap the answer in quotes despite instructions.
    if len(text) >= 2 and text[0] in "\"'“‘" and text[-1] in "\"'”’":
        text = text[1:-1].strip()
    if len(text) > cap:
        text = text[:cap].rstrip()
    return text


def suggest_field(field: str, members: List[dict], title: str = "", description: str = "") -> str:
    """Return a drafted `title` or `description` for a bundle from its members.

    Raises RuntimeError when there is nothing to work from or the LLM returns
    an empty completion.
    """
    block = _member_block(members)
    if not block:
        raise RuntimeError("This bundle has no members to describe yet.")

    if field == "title":
        system = _TITLE_SYSTEM
        hint = f"\n\nThe current description is: {description.strip()}" if description.strip() else ""
        prompt = f"The bundle contains these members:\n{block}{hint}\n\nSuggest a title."
        cap = _MAX_TITLE_CHARS
    else:
        system = _DESC_SYSTEM
        hint = f"\n\nThe current title is: {title.strip()}" if title.strip() else ""
        prompt = f"The bundle contains these members:\n{block}{hint}\n\nSuggest a description."
        cap = _MAX_DESC_CHARS

    reply = openswarm_host.llm(prompt, system=system, max_tokens=256)
    text = _clean(reply, cap)
    if not text:
        raise RuntimeError("The model returned an empty result. Try again.")
    return text
