import json
import os
from dotenv import load_dotenv
import requests

load_dotenv()

# get LiveAvatar API URL from .env file
LIVEAVATAR_API_URL = os.getenv(
    "LIVEAVATAR_API_URL", "https://api.liveavatar.com"
).rstrip("/")


class LiveAvatarAPI:
    def __init__(self, api_url=None, api_key=None):
        self.api_url = (
            api_url or os.getenv("LIVEAVATAR_API_URL", "https://api.liveavatar.com")
        ).rstrip("/")
        self.api_key = api_key or os.getenv("LIVEAVATAR_API_KEY")

    def get_session(
        self, avatar_id=None, voice_id=None, context_id=None, sandbox_mode=True
    ):
        """
        Get a session token from LiveAvatar API.
        """
        if not self.api_key:
            raise ValueError("Missing LiveAvatar API KEY.")

        url = f"{self.api_url}/v1/sessions/token"
        payload = {
            "mode": "FULL",
            "avatar_id": avatar_id,
            "is_sandbox": sandbox_mode,
            "video_settings": {"quality": "very_high", "encoding": "VP8"},
            "max_session_duration": 0,
            "avatar_persona": {
                "voice_id": voice_id,
                "context_id": context_id,
                "language": "en",
            },
            "interactivity_type": "CONVERSATIONAL",
        }
        headers = {
            "accept": "application/json",
            "content-type": "application/json",
            "X-API-KEY": self.api_key,
        }
        response = requests.post(url, json=payload, headers=headers, timeout=10)
        response = json.loads(response.text)
        print(f"LiveAvatar API response: {response}")
        return response["data"]

    def start_session(self, token):
        """
        Start a LiveAvatar session via the API.
        """
        url = f"{self.api_url}/v1/sessions/start"
        headers = {"accept": "application/json", "authorization": f"Bearer {token}"}
        response = requests.post(url, headers=headers, timeout=10)
        print(response.text)

    def close_session(self, token):
        """
        Close a LiveAvatar session via the API.
        """
        url = f"{self.api_url}/v1/sessions/close"
        headers = {"accept": "application/json", "authorization": f"Bearer {token}"}
        response = requests.post(url, headers=headers, timeout=10)
        print(f"Close session response: {response.text}")
        return response.json()
