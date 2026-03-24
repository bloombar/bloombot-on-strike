import json
import requests


def get_liveavatar_session(api_key=None):
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
        "avatar_id": "dd73ea75-1218-4ef3-92ce-606d5f7fbc0a",
        "is_sandbox": True,
        "video_settings": {"quality": "very_high", "encoding": "VP8"},
        "max_session_duration": 0,
        "avatar_persona": {
            "voice_id": "864a26b8-bfba-4435-9cc5-1dd593de5ca7",
            "context_id": "ce85226d-1d53-48a8-9b56-efccce8c0f90",
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
