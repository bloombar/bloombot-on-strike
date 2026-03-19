# Python WebSocket Relay Server

This is a Python implementation of the WebSocket relay server that connects to OpenAI's realtime API.

## Setup

1. Create a virtual environment (recommended):

```bash
python -m venv venv
source venv/bin/activate  # On Windows, use: venv\Scripts\activate
```

2. Install dependencies:

```bash
pip install -r requirements.txt
```

3. Create a `.env` file in the python-server directory with your OpenAI API key:

```
OPENAI_API_KEY=your_api_key_here
PORT=3000
```

## Running the Server

To start the server, run:

```bash
python server.py
```

The server will start on the specified port (default: 3000) and relay WebSocket connections between the client and OpenAI's realtime API.

## Features

- WebSocket relay server implementation
- Secure API key handling through environment variables
- Automatic reconnection handling
- Logging for debugging and monitoring
