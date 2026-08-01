"""Facade for model-related services."""

from ..routes.context import RouteContext
from .civitai_search_service import CivitAISearchService
from .custom_url_service import CustomUrlService
from .model_details_service import ModelDetailsService


class ModelService:
    """Expose model operations through the route-facing service API."""

    def __init__(self, context: RouteContext):
        self.civitai_search_service = CivitAISearchService(context)
        self.custom_url_service = CustomUrlService(context)
        self.model_details_service = ModelDetailsService(context)
        self.logger = self.civitai_search_service.logger

    async def civitai_search(self, request):
        """Delegate CivitAI search to its specialized service."""
        return await self.civitai_search_service.civitai_search(request)

    async def custom_url(self, request):
        """Delegate custom URL resolution to its specialized service."""
        return await self.custom_url_service.custom_url(request)

    async def model_details(self, request):
        """Delegate model details loading to its specialized service."""
        return await self.model_details_service.model_details(request)
