"""MCP server exposing ja.is lookups as tools."""

from typing import Annotated, Literal

from mcp.server.mcpserver import MCPServer
from mcp.server.mcpserver.exceptions import ToolError
from mcp.types import ToolAnnotations
from pydantic import Field

from . import service
from .client import JaClient
from .models import Entity, SearchResponse

INSTRUCTIONS = """\
Look up people and businesses in Já (ja.is), the Icelandic phone directory.

Start with `search_phonebook`. Each hit has an `id` (and businesses a `cluster_key`);
pass those to `get_person` or `get_business` to get phone numbers, email, website,
kennitala, coordinates, opening hours and branches.

Phones with `marketing_ban: true` are marked "bannmerkt": the owner has opted out of
marketing contact, so they must not be used for sales or marketing.

Searching:
- Search names in the nominative (nefnifall): "Jón Jónsson", not "Jóni Jónssyni".
  Other cases still match, but the exact person ranks lower.
- Most Icelanders have a patronymic (-son/-dóttir), not a family name, so search by
  full name rather than surname alone. Narrow common names with a place or
  occupation: "Jón Jónsson Akureyri", "Jón Jónsson pípari".
- Missing accents are fine ("Gudrun Thordardottir"). Phone numbers work in any
  format, with or without +354. A kennitala can be searched directly.
- Businesses can be found by trade and place ("pizza Akureyri", "píparar"). Icelandic
  trade words match best.

Results are in Icelandic as ja.is shows them: day names (Mánudagur … Sunnudagur),
"Lokað" = closed, "og" = and, and `fields` keys such as Heimilisfang (address),
Staður (postcode and town) and Sími (phone). `open_status` was true when the page was
fetched, which may be a few minutes ago. Answer in the user's language, and don't
translate names or addresses.
"""

READ_ONLY = ToolAnnotations(readOnlyHint=True, openWorldHint=True)


def build_mcp(ja: JaClient) -> MCPServer:
    mcp = MCPServer(name="ja-is", title="Já phone directory", instructions=INSTRUCTIONS)

    async def call(coro):
        try:
            return await coro
        except (service.InvalidInput, service.EntityNotFound, service.UpstreamError) as exc:
            raise ToolError(str(exc)) from exc

    @mcp.tool(annotations=READ_ONLY)
    async def search_phonebook(
        query: Annotated[
            str,
            Field(
                description=(
                    "Name (in the nominative, e.g. 'Jón Jónsson'), company, trade, address, "
                    "phone number or kennitala; may include a place, e.g. 'pizza Akureyri'"
                )
            ),
        ],
        type: Annotated[
            Literal["people", "businesses"] | None,
            Field(description="Restrict to one section. Required for paging with `start`."),
        ] = None,
        start: Annotated[
            int | None,
            Field(description="1-based item to start from; use `next_start` from a previous result", ge=1),
        ] = None,
    ) -> SearchResponse:
        """Search Já, the Icelandic phone directory (símaskrá), for people and businesses (einstaklingar og fyrirtæki).

        Without `type`, returns the first page of both sections. Results include
        name, address and occupation but not phone numbers; use get_person or
        get_business for those.
        """
        return await call(service.search(ja, query, type, start))

    @mcp.tool(annotations=READ_ONLY)
    async def get_person(
        id: Annotated[str, Field(description="Person `id` from search_phonebook")],
    ) -> Entity:
        """Get a person's listing: phone numbers (símanúmer), address (heimilisfang), email and location."""
        return await call(service.get_person(ja, id))

    @mcp.tool(annotations=READ_ONLY)
    async def get_business(
        cluster_key: Annotated[str, Field(description="Business `cluster_key` from search_phonebook")],
        branch_id: Annotated[
            str | None,
            Field(description="Branch `id`, for results with `is_branch: true` or from a business's `branches`"),
        ] = None,
    ) -> Entity:
        """Get a business listing (fyrirtæki): phones, website, kennitala, opening hours (opnunartími), location and branches (útibú)."""
        return await call(service.get_business(ja, cluster_key, branch_id))

    return mcp
