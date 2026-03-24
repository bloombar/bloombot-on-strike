#!/usr/bin/env python3

import asyncio
import json
import re
import logging
import os
from pathlib import Path
import yaml
from dotenv import load_dotenv
from websockets.asyncio.server import serve
from live_avatar_helpers import *

import websockets
import openai
from openai import OpenAI

logging.basicConfig(
    level=logging.INFO, format="%(asctime)s - %(levelname)s - %(message)s"
)
logger = logging.getLogger(__name__)

load_dotenv()
PORT = int(os.getenv("PORT", "8001"))
CONFIG_FILE = Path("bot_config.yml").resolve()  # path to the configuration file
OPENAI_API_KEY = os.getenv("OPENAI_API_KEY")  # from .env file
OPENAI_DEFAULT_MODEL = os.getenv("OPENAI_DEFAULT_MODEL", "gpt-4o")
LIVEAVATAR_API_KEY = os.getenv("LIVEAVATAR_API_KEY")  # from .env file

if not OPENAI_API_KEY:
    raise ValueError("OPENAI_API_KEY must be set in .env file")

# create OpenAI client
openai_conversations = {}  # will hold separate threads keyed by client browser URL
openai_client = OpenAI()

# start HeyGen LiveAvatar session
# liveavatar_session = get_liveavatar_session(LIVEAVATAR_API_KEY)
# start_liveavatar_session(liveavatar_session["session_token"])

# load the config data from file
with open(CONFIG_FILE, encoding="utf-8", mode="r") as f:
    config = yaml.safe_load(f)
    # get server name
    SERVER_NAME = config["server"]["name"]
    courses = config["server"]["courses"]


async def handler(websocket):
    """
    Handle incoming websocket messages from client.
    """
    try:
        async for message in websocket:
            event = json.loads(message)  # parse message as JSON
            print(f"server received websocket message: {message}")

            # do basic setup if starting conversation
            if event["type"] == "handshake":
                data = event["data"]

                # data expected from client:
                # instructions = data["instructions"]
                client_url = data["client_url"]
                course_title = data["course_title"]
                lecture_notes = data["lecture_notes"]

                # get the OpenAI Responses API Prompt for this course
                oa_prompt_id = None
                oa_conversation_id = None
                for course in courses:
                    if course["title"] == course_title:
                        oa_config = course.get("openai_assistant", {})
                        oa_prompt_id = oa_config.get("prompt_id", None)
                        logger.info(
                            f"Using OpenAI Prompt ID: {oa_prompt_id} for course '{course_title}'"
                        )
                if not oa_prompt_id:
                    logger.warning(
                        f"No OpenAI Prompt configured for '{course_title}' course."
                    )
                continue
                        # {
                        #     "role": "system",
                        #     "content": f"General instructions: {instructions}",
                        # },
                        {
                            "role": "system",
                            "content": f'Today, you are a bot named "ScabBot" who is a scab covering for Professor Amos Bloomberg. Prof. Bloomberg is currently on strike with the NYU Contract Faculty Union. You will be delivering lecture on his behalf to the class today, showing how the situation can be handled through education automation.',
                        },
                    ],
                    metadata={"client_url": f"{client_url}"},
                )
                # save conversation ID for later reference
                oa_converstion_id = openai_conversations[client_url].id

                logger.debug(
                    f"OpenAI Conversation #{oa_conversation_id} for URL {client_url}"
                )

                # send a handshake confirmation back to client
                await websocket.send(
                    json.dumps(
                        {
                            "type": "handshake",
                            "data": {
                                "message": "websocket handshake success",
                                "server": SERVER_NAME,
                                "course": course_title,
                                "openai_prompt_id": oa_prompt_id,
                            },
                        }
                    )
                )

                # Ask openAI to generate first welcome message
                try:
                    # try to get response from OpenAI API
                    openai_response = openai_client.responses.create(
                        model=oa_config.get("model", OPENAI_DEFAULT_MODEL),
                        prompt={
                            "id": oa_config.get(
                                "prompt_id", None
                            ),  # get prompt ID from config
                        },
                        input=[
                            {
                                "role": "system",
                                "content": f"In this conversation, you will speak exclusively about these Markdown lecture notes: {lecture_notes}",
                            },
                            {
                                "role": "system",
                                "content": "Explain who you are and briefly summarize what you will cover today, based on the lecture notes given in the previous input.",
                            },
                        ],
                        conversation=oa_conversation_id,
                        # tools=[
                        #     {
                        #         "type": "file_search",
                        #         "vector_store_ids": [
                        #             oa_config.get("vector_store_id", None)
                        #         ],
                        #     }
                        # ],
                        max_output_tokens=2048,
                        store=True,
                    )

                    # extract the text from the response
                    openai_response = openai_response.output_text.strip()

                except Exception as e:
                    logger.error(f"Error from OpenAI API: {e}")
                    openai_response = f"Sorry, I can't respond intelligently right now. Please see {course_title} admins for help."

                # get first output response
                logger.info(f"OpenAI response: {openai_response}")

                # clean up the response by removing any 【source】 references
                openai_response = re.sub(r"【.*?】", "", openai_response).strip()

            # handle requests for text to speak
            elif event["type"] == "request_spoken_text":
                data = event["data"]

                # ensure data is present
                if (not data) or data.strip() == "":
                    continue

                # get the conversation ID for this URL
                oa_conversation_id = openai_conversations[client_url].id

                # ask OpenAI to generate text to explain the new slide content
                try:
                    openai_response = openai_client.responses.create(
                        model=oa_config.get("model", OPENAI_DEFAULT_MODEL),
                        prompt={
                            "id": oa_config.get(
                                "prompt_id", None
                            ),  # get prompt ID from config
                        },
                        input=[
                            {
                                "role": "system",
                                "content": f"Act like a professor and explain this slide to students. Keep it under 2 sentences. Do not mention that the information is from a slide. Here is the slide contents: {data}",
                            }
                        ],
                        conversation=oa_conversation_id,
                        max_output_tokens=2048,
                        store=True,
                    )

                    # extract the text from the response
                    openai_response = openai_response.output_text.strip()

                except Exception as e:
                    logger.error(f"Error from OpenAI API: {e}")
                    openai_response = f"Sorry, I can't respond intelligently right now. Please see {course_title} admins for help."

                # clean up the response by removing any 【source】 references
                openai_response = re.sub(r"【.*?】", "", openai_response).strip()

                logger.info(
                    f"OpenAI response to request for text to speak: {openai_response}"
                )

                # send the response back to client
                await websocket.send(
                    json.dumps(
                        {
                            "type": "response_spoken_text",
                            "data": {
                                "response": openai_response,
                            },
                        }
                    )
                )
            elif event["type"] == "request_liveavatar_token":
                # get a session token from LiveAvatar API (client SDK will start the session)
                liveavatar_session = get_liveavatar_session(LIVEAVATAR_API_KEY)
                logger.info(
                    f"LiveAvatar session token obtained: {liveavatar_session['session_token']}"
                )

                # send the response back to client
                await websocket.send(
                    json.dumps(
                        {
                            "type": "response_liveavatar_token",
                            "data": {
                                "token": liveavatar_session["session_token"],
                            },
                        }
                    )
                )
    except websockets.exceptions.ConnectionClosedError:
        logger.info("Client disconnected unexpectedly")


async def main():
    """
    Start websocket server.
    """
    async with serve(handler, "", PORT) as server:
        await server.serve_forever()


if __name__ == "__main__":
    asyncio.run(main())
