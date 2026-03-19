#!/usr/bin/env python3

import asyncio
import json
import logging
import os

from aiohttp import ClientSession, WSMsgType, web
from dotenv import load_dotenv
import websockets
from websockets.legacy.client import connect

logging.basicConfig(
    level=logging.INFO, format="%(asctime)s - %(levelname)s - %(message)s"
)
logger = logging.getLogger(__name__)

load_dotenv()
PORT = int(os.getenv("PORT", "3000"))
OPENAI_API_KEY = os.getenv("OPENAI_API_KEY")
ALLOWED_ORIGIN = os.getenv("ALLOWED_ORIGIN", "*")
REALTIME_MODEL = os.getenv("OPENAI_REALTIME_MODEL", "gpt-realtime")

if not OPENAI_API_KEY:
    raise ValueError("OPENAI_API_KEY must be set in .env file")


CORS_HEADERS = {
    "Access-Control-Allow-Origin": ALLOWED_ORIGIN,
    "Access-Control-Allow-Methods": "POST, OPTIONS",
    "Access-Control-Allow-Headers": "Content-Type, Authorization",
}


async def connect_to_openai():
    """Connect to OpenAI's WebSocket endpoint."""
    uri = f"wss://api.openai.com/v1/realtime?model={REALTIME_MODEL}"

    try:
        ws = await connect(
            uri,
            extra_headers={
                "Authorization": f"Bearer {OPENAI_API_KEY}",
                "Content-Type": "application/json",
                # "OpenAI-Beta": "realtime=v1", //for beta only
            },
            subprotocols=["realtime"],
        )
        logger.info("Successfully connected to OpenAI")

        response = await ws.recv()
        try:
            event = json.loads(response)
            if event.get("type") != "session.created":
                raise RuntimeError(f"Expected session.created, got {event.get('type')}")
            logger.info("Received session.created response")

            return (
                ws,
                event,
            )
        except json.JSONDecodeError as exc:
            raise RuntimeError(
                f"Invalid JSON response from OpenAI: {response}"
            ) from exc

    except Exception as e:
        logger.error("Failed to connect to OpenAI: %s", e)
        raise


class WebSocketRelay:
    def __init__(self):
        """Initialize the WebSocket relay server."""
        self.connections = {}

    async def create_ephemeral_key(self, session_payload: dict | None = None):
        request_body = {
            "expires_after": {
                "anchor": "created_at",
                "seconds": 60,
            },
            "session": session_payload
            or {
                "type": "realtime",
                "model": REALTIME_MODEL,
            },
        }

        async with ClientSession() as http_session:
            async with http_session.post(
                "https://api.openai.com/v1/realtime/client_secrets",
                headers={
                    "Authorization": f"Bearer {OPENAI_API_KEY}",
                    "Content-Type": "application/json",
                },
                json=request_body,
            ) as response:
                data = await response.json()
                return response.status, data

    async def handle_session_options(self, _request: web.Request):
        return web.Response(status=204, headers=CORS_HEADERS)

    async def handle_session_create(self, request: web.Request):
        try:
            payload = await request.json() if request.can_read_body else {}
        except json.JSONDecodeError:
            return web.json_response(
                {"error": "Invalid JSON body"}, status=400, headers=CORS_HEADERS
            )

        status, data = await self.create_ephemeral_key(payload.get("session"))
        return web.json_response(data, status=status, headers=CORS_HEADERS)

    async def handle_browser_connection(self, request: web.Request):
        """
        Handle a connection from the browser.
        Validate the path and establish a connection to OpenAI, then relay messages between the browser and OpenAI.
        """
        websocket = web.WebSocketResponse(protocols=("realtime",))
        await websocket.prepare(request)

        logger.info("Browser connected from %s", request.remote)
        openai_ws = None

        try:
            # Connect to OpenAI
            openai_ws, session_created = await connect_to_openai()
            self.connections[websocket] = openai_ws

            logger.info("Connected to OpenAI successfully!")

            await websocket.send_str(json.dumps(session_created))
            logger.info("Forwarded session.created to browser")

            async def handle_browser_messages():
                """
                Handle incoming messages from the browser and relay them to OpenAI.
                """

                try:
                    async for message in websocket:
                        if message.type == WSMsgType.TEXT:
                            try:
                                event = json.loads(message.data)
                                logger.info(
                                    'Relaying "%s" to OpenAI', event.get("type")
                                )
                                await openai_ws.send(message.data)
                            except json.JSONDecodeError:
                                logger.error(
                                    "Invalid JSON from browser: %s", message.data
                                )
                        elif message.type == WSMsgType.ERROR:
                            raise websocket.exception()
                except Exception as e:
                    logger.info("Browser connection closed normally: %s", e)
                    raise

            async def handle_openai_messages():
                """
                Handle incoming messages from OpenAI and relay them to the browser.
                """
                try:
                    while True:
                        # Wait for a message from OpenAI
                        message = await openai_ws.recv()
                        try:
                            # Attempt to parse the message as JSON to log the event type
                            event = json.loads(message)
                            logger.info(
                                'Relaying "%s" from OpenAI: %s',
                                event.get("type"),
                                message,
                            )
                            # Relay the raw message to the browser
                            await websocket.send_str(message)
                        except json.JSONDecodeError:
                            logger.error("Invalid JSON from OpenAI: %s", message)
                except websockets.exceptions.ConnectionClosed as e:
                    logger.info(
                        "OpenAI connection closed normally: code=%s, reason=%s",
                        e.code,
                        e.reason,
                    )
                    raise

            try:
                # Run both message handlers concurrently until one of them raises a ConnectionClosed exception
                await asyncio.gather(
                    handle_browser_messages(), handle_openai_messages()
                )
            except websockets.exceptions.ConnectionClosed:
                logger.info("One of the connections closed, cleaning up")

        except (RuntimeError, OSError, websockets.exceptions.WebSocketException) as e:
            logger.error("Error handling connection: %s", e)
            if not websocket.closed:
                await websocket.close(code=1011, message=str(e).encode())
        finally:
            # Clean up connections
            if websocket in self.connections:
                if openai_ws and not openai_ws.closed:
                    await openai_ws.close(1000, "Normal closure")
                del self.connections[websocket]
            if not websocket.closed:
                await websocket.close(code=1000, message=b"Normal closure")

        return websocket

    async def serve(self):
        """
        Start the WebSocket relay server.
        """
        app = web.Application()
        app.router.add_route("OPTIONS", "/session", self.handle_session_options)
        app.router.add_post("/session", self.handle_session_create)
        app.router.add_get("/", self.handle_browser_connection)

        runner = web.AppRunner(app)
        await runner.setup()
        site = web.TCPSite(runner, "0.0.0.0", PORT)
        await site.start()

        logger.info("Relay server started on http://0.0.0.0:%s", PORT)
        await asyncio.Future()


def main():
    """
    Main entry point for the WebSocket relay server.
    """
    relay = WebSocketRelay()
    try:
        asyncio.run(relay.serve())
    except KeyboardInterrupt:
        logger.info("Server shutdown requested")
    finally:
        logger.info("Server shutdown complete")


if __name__ == "__main__":
    main()
