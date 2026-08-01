"""Facade for remote model source search."""

from ..routes.context import RouteContext
from .search_orchestrator import SearchOrchestrator


class SearchService:
    """Keep the route-facing search API stable while delegating orchestration."""

    def __init__(self, context: RouteContext):
        self._orchestrator = SearchOrchestrator(context)

    async def search_sources(self, request):
        """Search configured sources and return the HTTP response payload."""
        return await self._orchestrator.search_sources(request)
