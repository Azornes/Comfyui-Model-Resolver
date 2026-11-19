"""
Unit tests for core/services/placement_service.py and placement routes.
"""

import json
import os
import shutil
import tempfile
import unittest
from unittest.mock import AsyncMock, MagicMock, patch

from aiohttp import web
from core.routes.context import RouteContext
from core.services.placement_service import PlacementService


class PlacementServiceTests(unittest.IsolatedAsyncioTestCase):
    def setUp(self):
        self.temp_dir = tempfile.mkdtemp()
        self.context = MagicMock(spec=RouteContext)
        import asyncio

        self.context.require.side_effect = lambda key: {
            "asyncio": asyncio,
            "web": web,
        }.get(key)
        self.service = PlacementService(self.context)

    def tearDown(self):
        shutil.rmtree(self.temp_dir, ignore_errors=True)

    async def test_check_placement_route(self):
        req = MagicMock()
        req.query = {"rescan": "false"}

        with patch("core.services.placement_service.scan_misplaced_models") as mock_scan:
            mock_scan.return_value = {
                "misplaced": [
                    {
                        "path": "/models/checkpoints/my_lora.safetensors",
                        "filename": "my_lora.safetensors",
                        "current_category": "checkpoints",
                        "detected_category": "loras",
                        "base_model": "SDXL",
                        "sure": True,
                        "works_anyway": False,
                        "is_misplaced": True,
                        "target_category": "loras",
                        "target_path": "/models/loras/my_lora.safetensors",
                    }
                ],
                "total_scanned": 10,
                "misplaced_count": 1,
            }
            resp = await self.service.check_placement(req)
            self.assertEqual(resp.status, 200)
            data = json.loads(resp.text)
            self.assertEqual(data["misplaced_count"], 1)
            self.assertEqual(data["misplaced"][0]["filename"], "my_lora.safetensors")

    async def test_look_placement_route(self):
        req = MagicMock()
        req.query = {"path": "/models/checkpoints/my_lora.safetensors"}

        with patch("core.path_utils.is_path_in_configured_model_roots", return_value=True), \
             patch("core.services.placement_service.classify_model_file") as mock_classify, \
             patch("core.services.placement_service.check_model_misplacement") as mock_misplace:
            mock_classify.return_value = {
                "kind": "loras",
                "base": "SDXL",
                "sure": True,
                "format": "safetensors",
                "form": "",
            }
            mock_misplace.return_value = {
                "path": "/models/checkpoints/my_lora.safetensors",
                "is_misplaced": True,
                "detected_category": "loras",
            }
            resp = await self.service.look_placement(req)
            self.assertEqual(resp.status, 200)
            data = json.loads(resp.text)
            self.assertEqual(data["classification"]["kind"], "loras")
            self.assertTrue(data["misplacement"]["is_misplaced"])

    async def test_move_model_route(self):
        req = MagicMock()
        payload = {
            "path": "/models/checkpoints/my_lora.safetensors",
            "target_category": "loras",
        }
        req.json = AsyncMock(return_value=payload)

        with patch("core.services.placement_service.move_misplaced_model") as mock_move:
            mock_move.return_value = {
                "success": True,
                "source_path": "/models/checkpoints/my_lora.safetensors",
                "target_path": "/models/loras/my_lora.safetensors",
                "target_category": "loras",
                "moved_files": ["my_lora.safetensors"],
                "left_behind": [],
            }
            resp = await self.service.move_model(req)
            self.assertEqual(resp.status, 200)
            data = json.loads(resp.text)
            self.assertTrue(data["success"])
            self.assertEqual(data["target_category"], "loras")


if __name__ == "__main__":
    unittest.main()
