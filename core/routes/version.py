"""Version endpoint registration."""

import asyncio

from .. import version as version_service


def register_version_routes(routes, web, json_api_endpoint):
    """Register the endpoint exposing local and remote project versions."""

    @routes.get("/model_resolver/version")
    @json_api_endpoint("version")
    async def get_project_version(request):
        """Return the installed version and the latest GitHub version."""
        return web.json_response(
            await asyncio.to_thread(version_service._get_project_version_info)
        )
