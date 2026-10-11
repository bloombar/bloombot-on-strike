#!/usr/bin/env python3
"""
Launch the front-end client into a Zoom call using the Recall AI API
"""

# curl --request POST \
#   --url https://us-west-2.recall.ai/api/v1/bot/ \
#   --header 'Authorization: 94cb6c4416a42d52d9d90bf8e4c0f2ab9e6ac16d' \
#   --header 'accept: application/json' \
#   --header 'content-type: application/json' \
#   --data '{
#     "meeting_url": "https://us05web.zoom.us/j/87596751787?pwd=bgKLDL6day8RiNtgTLzxfrDtt1MDNu.1",
#     "bot_name": "Bloombot-on-Strike",
#     "output_media": {
#       "camera": {
#         "kind": "webpage",
#         "config": {
#           "url": "https://recallai-demo.netlify.app?wss=wss://309a-173-68-85-115.ngrok-free.app"
#         }
#       }
#     },
#     "variant": {
#       "zoom": "web_4_core",
#       "google_meet": "web_4_core",
#       "microsoft_teams": "web_4_core"
#     }
#   }'

import json
import os
import sys
from pathlib import Path
from urllib.parse import parse_qsl, urlencode, urlsplit, urlunsplit

import requests
from dotenv import load_dotenv

load_dotenv()

CONFIG_PATH = Path(__file__).with_name("recallai-config.json")
API_URL = os.getenv("RECALLAI_API_URL", "https://us-west-2.recall.ai/api/v1/bot/")
API_TOKEN = os.getenv("RECALLAI_API_TOKEN")  # RECALLAI_API_TOKEN="your-token"
MEETING_URL = os.getenv("MEETING_URL")  # MEETING_URL="https://zoom.us/..."
VITE_BOT_NAME = os.getenv("VITE_BOT_NAME", "Bloombot-on-Strike")

# the web page the bot will screenshare in the meeting
SCREENSHARE_WEBPAGE_URL = os.getenv(
    "SCREENSHARE_WEBPAGE_URL",
    "https://recallai-demo.netlify.app?wss=wss://bloombar.github.io/bloombot-on-strike/",
)

def with_autostart(url: str, delay: str | None = None) -> str:
    """
    Return `url` with `autostart=1` added (and `autostart_delay` if given), keeping its other query params.
    Params already present in the URL are left alone. The Recall bot has no human to click Start, so the
    client starts the avatar by itself when it sees `autostart`.
    """
    parts = urlsplit(url)
    query = parse_qsl(parts.query, keep_blank_values=True)
    present = {key for key, _ in query}
    if "autostart" not in present:
        query.append(("autostart", "1"))
    if delay and "autostart_delay" not in present:
        query.append(("autostart_delay", delay))
    # safe=":/" keeps values such as wss=wss://host:8001 readable instead of percent-encoding them
    return urlunsplit(parts._replace(query=urlencode(query, safe=":/")))


def mask(secret: str | None) -> str:
    """Show only the last 4 characters of a secret; short secrets are hidden entirely."""
    if not secret:
        return "None"
    if len(secret) <= 8:
        return "****"
    return "****" + secret[-4:]


def main() -> int:
    if not API_TOKEN:
        print("Missing RECALLAI_API_TOKEN environment variable.", file=sys.stderr)
        return 1

    if not MEETING_URL:
        print("Missing MEETING_URL environment variable.", file=sys.stderr)
        return 1

    screenshare_url = with_autostart(SCREENSHARE_WEBPAGE_URL, os.getenv("AUTOSTART_DELAY_SECONDS"))
    print(
        f"""
Recall AI Bot Configuration:
- API_URL: {API_URL}
- API_TOKEN: {mask(API_TOKEN)}
- MEETING_URL: {MEETING_URL}
- VITE_BOT_NAME: {VITE_BOT_NAME}
- SCREENSHARE_WEBPAGE_URL: {screenshare_url}
"""
    )

    # Recall.ai config data
    payload = {
        "meeting_url": MEETING_URL,
        "bot_name": VITE_BOT_NAME,
        "output_media": {
            "camera": {
                "kind": "webpage",
                "config": {"url": screenshare_url},
            }
        },
        "variant": {
            "zoom": "web_4_core",
            "google_meet": "web_4_core",
            "microsoft_teams": "web_4_core",
        },
    }

    # http headers
    headers = {
        "Authorization": API_TOKEN,
        "accept": "application/json",
        "content-type": "application/json",
    }

    # send request to Recall AI
    print(f"Sending request to Recall AI at {API_URL}...")
    response = requests.post(API_URL, headers=headers, json=payload, timeout=30)

    print(f"HTTP {response.status_code}")
    try:
        print(json.dumps(response.json(), indent=2))
    except ValueError:
        print(response.text)

    return 0 if response.ok else 1


if __name__ == "__main__":
    raise SystemExit(main())
