import unittest
from unittest.mock import MagicMock, patch

from live_avatar_api import LiveAvatarAPI


def fake_response(status_code=200, text='{"data": {"session_token": "t"}}'):
    response = MagicMock()
    response.status_code = status_code
    response.text = text
    return response


class GetSessionTest(unittest.TestCase):
    def setUp(self):
        self.api = LiveAvatarAPI(api_url="http://example.test", api_key="test")

    def sent_payload(self, mock_post):
        return mock_post.call_args.kwargs["json"]

    @patch("live_avatar_api.requests.post")
    def test_default_omits_max_session_duration(self, mock_post):
        mock_post.return_value = fake_response()
        self.api.get_session(avatar_id="a", voice_id="v", context_id="c")
        self.assertNotIn("max_session_duration", self.sent_payload(mock_post))

    @patch("live_avatar_api.requests.post")
    def test_positive_int_is_sent(self, mock_post):
        mock_post.return_value = fake_response()
        self.api.get_session(max_session_duration=600)
        self.assertEqual(self.sent_payload(mock_post)["max_session_duration"], 600)

    @patch("live_avatar_api.requests.post")
    def test_zero_and_none_are_omitted(self, mock_post):
        mock_post.return_value = fake_response()
        for value in (0, None):
            self.api.get_session(max_session_duration=value)
            self.assertNotIn("max_session_duration", self.sent_payload(mock_post))

    @patch("live_avatar_api.requests.post")
    def test_non_2xx_raises_with_status_code(self, mock_post):
        mock_post.return_value = fake_response(401, '{"message": "bad key"}')
        with self.assertRaises(Exception) as ctx:
            self.api.get_session()
        self.assertIn("401", str(ctx.exception))
        self.assertIn("bad key", str(ctx.exception))


if __name__ == "__main__":
    unittest.main()
