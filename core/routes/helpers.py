"""Shared helpers used by the HTTP route modules."""

import asyncio
import threading
from functools import wraps

from ..request_utils import read_optional_object_payload


def register_service_route(
    context,
    *,
    path,
    methods=("post",),
    error_prefix,
    operation,
    return_success_on_error=False,
):
    """Register JSON routes for a bound service operation."""
    json_api_endpoint = context.get("json_api_endpoint")
    routes = context.get("routes")

    async def service_route(request):
        return await operation(request)

    service_route.__name__ = getattr(operation, "__name__", "service_route")
    endpoint = (
        json_api_endpoint(
            error_prefix,
            return_success_on_error=True,
        )
        if return_success_on_error
        else json_api_endpoint(error_prefix)
    )
    decorated_route = endpoint(service_route)
    method_names = (methods,) if isinstance(methods, str) else methods
    for method in method_names:
        getattr(routes, method.lower())(path)(decorated_route)


def create_route_helpers(web, logger, load_settings, hash_calculation_cancelled):
    """Create route helpers bound to the current ComfyUI server context."""

    def json_api_endpoint(error_prefix, return_success_on_error=False):
        def decorator(func):
            @wraps(func)
            async def wrapper(request, *args, **kwargs):
                try:
                    return await func(request, *args, **kwargs)
                except Exception as exc:
                    logger.error(
                        f"Model Resolver {error_prefix} error: {exc}",
                        exc_info=True,
                    )
                    status = 500
                    error_message = str(exc)
                    if isinstance(exc, web.HTTPException):
                        status = exc.status
                        error_message = exc.reason or error_message
                    response_data = {"error": error_message}
                    if return_success_on_error:
                        response_data["success"] = False
                    return web.json_response(response_data, status=status)

            return wrapper

        return decorator

    def _get_required_match_param(request, param_name):
        value = request.match_info.get(param_name, "").strip()
        return value or None

    def get_progress_response(
        tracker,
        request,
        param_name="progress_id",
        not_found_payload=None,
        not_found_status=200,
        found_wrapper=None,
    ):
        job_id = _get_required_match_param(request, param_name)
        if not job_id:
            return web.json_response(
                {"error": f"{param_name} is required"},
                status=400,
            )
        tracker.cleanup()
        progress = tracker.get(job_id)
        if not progress:
            payload = not_found_payload or {"error": "progress not found"}
            return web.json_response(payload, status=not_found_status)
        if found_wrapper:
            return web.json_response(found_wrapper(progress))
        return web.json_response(progress)

    def cancel_progress_response(
        tracker,
        request,
        param_name="progress_id",
        cancel_message="Cancelled",
    ):
        job_id = _get_required_match_param(request, param_name)
        if not job_id:
            return web.json_response(
                {"error": f"{param_name} is required"},
                status=400,
            )
        cancelled = tracker.mark_cancelled(job_id, cancel_message)
        return web.json_response(
            {
                "success": True,
                "cancelled": cancelled,
                "progress_id": job_id,
            }
        )

    def run_in_background_thread(
        tracker,
        progress_id,
        task_func,
        on_success,
        on_cancel=None,
        on_error=None,
        error_log_msg="Background task failed",
    ):
        def wrapper():
            try:
                result = task_func()
                if tracker.is_cancelled(progress_id):
                    if on_cancel:
                        on_cancel(result)
                    else:
                        tracker.update(
                            progress_id,
                            status="cancelled",
                            stage="cancelled",
                            message="Task cancelled",
                        )
                    return
                on_success(result)
            except (hash_calculation_cancelled, asyncio.CancelledError):
                if on_cancel:
                    on_cancel()
                else:
                    tracker.update(
                        progress_id,
                        status="cancelled",
                        stage="cancelled",
                        message="Task cancelled",
                    )
            except Exception as exc:
                logger.exception(f"{error_log_msg}: {exc}")
                if on_error:
                    on_error(exc)
                else:
                    tracker.update(
                        progress_id,
                        status="error",
                        stage="error",
                        message=str(exc) or "Task failed",
                        percent=100,
                        error=str(exc) or "Task failed",
                    )

        threading.Thread(target=wrapper, daemon=True).start()

    async def get_override_settings_from_request(request):
        settings = await asyncio.to_thread(load_settings)
        if request.method == "POST":
            payload = await read_optional_object_payload(request)
            if "aria2c_path" in payload:
                settings = dict(settings)
                settings["aria2c_path"] = payload.get("aria2c_path", "")
        return settings

    return (
        json_api_endpoint,
        get_progress_response,
        cancel_progress_response,
        run_in_background_thread,
        get_override_settings_from_request,
    )
