import unittest
from unittest.mock import MagicMock

from core.download.orchestrator import format_huggingface_auth_error


class TestGatedRepoErrors(unittest.TestCase):
    def test_gated_error_with_token(self):
        url = "https://huggingface.co/black-forest-labs/FLUX.1-dev/resolve/main/flux1-dev.safetensors"
        exc = Exception("403 Client Error: Forbidden for url: https://huggingface.co/...")
        mock_resp = MagicMock()
        mock_resp.text = (
            "Cannot access gated repo for url https://huggingface.co/api/models/black-forest-labs/FLUX.1-dev. "
            "Access to model black-forest-labs/FLUX.1-dev is restricted and you are not in the authorized list. "
            "Visit https://huggingface.co/black-forest-labs/FLUX.1-dev to ask for access."
        )
        exc.response = mock_resp

        msg = format_huggingface_auth_error(
            url, 403, exc, headers={"Authorization": "Bearer hf_testtoken"}
        )

        self.assertIn("black-forest-labs/FLUX.1-dev", msg)
        self.assertIn("https://huggingface.co/black-forest-labs/FLUX.1-dev", msg)
        self.assertIn("license agreement", msg.lower())
        self.assertNotIn("configure your hugging face token", msg.lower())

    def test_gated_error_without_token(self):
        url = "https://huggingface.co/black-forest-labs/FLUX.1-dev/resolve/main/flux1-dev.safetensors"
        exc = Exception("401 Client Error: Unauthorized")
        mock_resp = MagicMock()
        mock_resp.text = "Access to model black-forest-labs/FLUX.1-dev is restricted. You must be authenticated."
        exc.response = mock_resp

        msg = format_huggingface_auth_error(url, 401, exc, headers={})

        self.assertIn("black-forest-labs/FLUX.1-dev", msg)
        self.assertIn("https://huggingface.co/black-forest-labs/FLUX.1-dev", msg)
        self.assertIn("token", msg.lower())
        self.assertIn("settings", msg.lower())

    def test_non_gated_unauthorized_error(self):
        url = "https://huggingface.co/private-user/private-model/resolve/main/model.safetensors"
        exc = Exception("401 Client Error: Unauthorized")
        mock_resp = MagicMock()
        mock_resp.text = "Invalid credentials"
        exc.response = mock_resp

        msg = format_huggingface_auth_error(
            url, 401, exc, headers={"Authorization": "Bearer hf_test"}
        )

        self.assertIn("private-user/private-model", msg)
        self.assertIn("settings/tokens", msg)


if __name__ == "__main__":
    unittest.main()
