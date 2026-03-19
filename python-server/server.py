#!/usr/bin/env python3

import asyncio
import json
import logging
import os
from dotenv import load_dotenv
import websockets
from websockets.legacy.server import WebSocketServerProtocol, serve
from websockets.legacy.client import connect

logging.basicConfig(
    level=logging.INFO, format="%(asctime)s - %(levelname)s - %(message)s"
)
logger = logging.getLogger(__name__)

load_dotenv()
PORT = int(os.getenv("PORT", 3000))
OPENAI_API_KEY = os.getenv("OPENAI_API_KEY")

if not OPENAI_API_KEY:
    raise ValueError("OPENAI_API_KEY must be set in .env file")


async def connect_to_openai():
    """Connect to OpenAI's WebSocket endpoint."""
    uri = "wss://api.openai.com/v1/realtime?model=gpt-realtime"

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
                raise Exception(f"Expected session.created, got {event.get('type')}")
            logger.info("Received session.created response")

            update_session = {
                "type": "session.update",
                "session": {
                    "type": "realtime",
                    "model": "gpt-realtime",
                    "audio": {
                        "output": {
                            "voice": "alloy",
                        }
                    },
                },
            }
            await ws.send(json.dumps(update_session))
            logger.info("Sent session.create message")

            return (
                ws,
                event,
            )
        except json.JSONDecodeError:
            raise Exception(f"Invalid JSON response from OpenAI: {response}")

    except Exception as e:
        logger.error(f"Failed to connect to OpenAI: {str(e)}")
        raise


class WebSocketRelay:
    def __init__(self):
        """Initialize the WebSocket relay server."""
        self.connections = {}
        self.message_queues = {}

    async def handle_browser_connection(
        self, websocket: WebSocketServerProtocol, path: str
    ):
        """
        Handle a connection from the browser.
        Validate the path and establish a connection to OpenAI, then relay messages between the browser and OpenAI.
        """
        base_path = path.split("?")[0]
        if base_path != "/":
            logger.error(f"Invalid path: {path}")
            await websocket.close(1008, "Invalid path")
            return

        logger.info(f"Browser connected from {websocket.remote_address}")
        self.message_queues[websocket] = []
        openai_ws = None

        try:
            # Connect to OpenAI
            openai_ws, session_created = await connect_to_openai()
            self.connections[websocket] = openai_ws

            logger.info("Connected to OpenAI successfully!")

            await websocket.send(json.dumps(session_created))
            logger.info("Forwarded session.created to browser")

            # Relay any queued messages from the browser to OpenAI
            while self.message_queues[websocket]:
                message = self.message_queues[websocket].pop(0)
                try:
                    event = json.loads(message)
                    logger.info(f'Relaying "{event.get("type")}" to OpenAI')
                    await openai_ws.send(message)
                except json.JSONDecodeError:
                    logger.error(f"Invalid JSON from browser: {message}")

            async def handle_browser_messages():
                """
                Handle incoming messages from the browser and relay them to OpenAI.
                """

                try:
                    while True:
                        # Wait for a message from the browser
                        message = await websocket.recv()
                        try:
                            # Attempt to parse the message as JSON to log the event type
                            event = json.loads(message)
                            logger.info(f'Relaying "{event.get("type")}" to OpenAI')
                            # Relay the raw message to OpenAI
                            await openai_ws.send(message)
                        except json.JSONDecodeError:
                            logger.error(f"Invalid JSON from browser: {message}")
                except websockets.exceptions.ConnectionClosed as e:
                    logger.info(
                        f"Browser connection closed normally: code={e.code}, reason={e.reason}"
                    )
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
                                f'Relaying "{event.get("type")}" from OpenAI: {message}'
                            )
                            # Relay the raw message to the browser
                            await websocket.send(message)
                        except json.JSONDecodeError:
                            logger.error(f"Invalid JSON from OpenAI: {message}")
                except websockets.exceptions.ConnectionClosed as e:
                    logger.info(
                        f"OpenAI connection closed normally: code={e.code}, reason={e.reason}"
                    )
                    raise

            try:
                # Run both message handlers concurrently until one of them raises a ConnectionClosed exception
                await asyncio.gather(
                    handle_browser_messages(), handle_openai_messages()
                )
            except websockets.exceptions.ConnectionClosed:
                logger.info("One of the connections closed, cleaning up")

        except Exception as e:
            logger.error(f"Error handling connection: {str(e)}")
            if not websocket.closed:
                await websocket.close(1011, str(e))
        finally:
            # Clean up connections and message queues
            if websocket in self.connections:
                if openai_ws and not openai_ws.closed:
                    await openai_ws.close(1000, "Normal closure")
                del self.connections[websocket]
            if websocket in self.message_queues:
                del self.message_queues[websocket]
            if not websocket.closed:
                await websocket.close(1000, "Normal closure")

    async def serve(self):
        """
        Start the WebSocket relay server.
        """
        async with serve(
            self.handle_browser_connection,
            "0.0.0.0",
            PORT,
            ping_interval=20,
            ping_timeout=20,
            subprotocols=["realtime"],
        ):
            logger.info(f"WebSocket relay server started on ws://0.0.0.0:{PORT}")
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
