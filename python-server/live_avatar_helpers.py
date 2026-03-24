import json
import requests


def get_liveavatar_session(
    api_key=None, avatar_id=None, voice_id=None, context_id=None, sandbox_mode=True
):
    """
    Get a session token from LiveAvatar API.
    """
    # raise error if no api_key
    if not api_key:
        raise ValueError("Missing LiveAvatar API KEY.")

    url = "https://api.liveavatar.com/v1/sessions/token"
    # body of request
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
        "X-API-KEY": api_key,
    }
    response = requests.post(url, json=payload, headers=headers)
    response = json.loads(response.text)
    print(f"LiveAvatar API response: {response}")
    return response["data"]


def start_liveavatar_session(token):
    url = "https://api.liveavatar.com/v1/sessions/start"
    headers = {"accept": "application/json", "authorization": f"Bearer {token}"}
    response = requests.post(url, headers=headers)
    print(response.text)
