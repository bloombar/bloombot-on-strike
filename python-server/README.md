# Python Relay Server

This is a Python implementation of the relay server that connects to OpenAI's realtime API.
It now serves both:

- a WebSocket relay at `/`
- an ephemeral key endpoint at `/session`

## Setup

1. Create a virtual environment (recommended):

```bash
python -m venv venv
source venv/bin/activate  # On Windows, use: venv\Scripts\activate
```

1. Install dependencies:

```bash
pip install -r requirements.txt
```

1. Create a `.env` file in the python-server directory with your OpenAI API key:

```env
OPENAI_API_KEY=your_api_key_here
PORT=3000
ALLOWED_ORIGIN=*
```

`ALLOWED_ORIGIN` controls the CORS header for `POST /session`. Set it to your frontend origin for tighter security.

## Running the Server

To start the server, run:

```bash
python server.py
```

The server will start on the specified port (default: 3000).

Endpoints:

- `GET /` upgrades to a WebSocket relay between the browser and OpenAI's realtime API
- `POST /session` creates a short-lived OpenAI Realtime client secret for browser clients

## Features

- WebSocket relay server implementation
- Ephemeral key minting for browser clients
- CORS support for cross-origin frontend requests to `/session`
- Secure API key handling through environment variables
- Logging for debugging and monitoring
