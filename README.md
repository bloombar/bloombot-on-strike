# Bloombot-on-Strike (a.k.a ScabBot)

This application is specifically designed to replace a university faculty member [who is on strike](https://www.nyu.edu/about/news-publications/news/2026/march/statement-on-cfu-uaw-strike.html). In other words, it is a **ScabBot**. It uses AI and code spit to automatically deliver lectures on Zoom in an equally- or more-compelling fashion than a typical lecturer.

## Prerequisites

Basic operation requires:

1. [Python 3.8+](https://www.python.org/downloads/)
1. [HeyGen LiveAvatar API Key](https://www.liveavatar.com/) for avatar generation
1. [OpenAI API Key](https://platform.openai.com/docs/overview) for spoken text generation

Integration into Zoom calls requires additionally:

1. [Recall.ai API Key](https://www.recall.ai/)

## Installation

### Clone the Repository

```bash
git clone ...
```

### Install Dependencies

#### Client (Node.js)

```bash
cd client
npm install
```

#### Server (Python)

The server implementation is available in Python.

##### Python Implementation

Assuming [pipenv](https://pipenv.pypa.io/en/latest/installation.html) is installed...

```bash
cd python-server
pipenv install
pipenv shell
```

## Configuration

### API Keys

Note: You **must** have API keys and some credits in your **OpenAI** and **LiveAvatar** accounts before running this demo. If your account has no credits, the demo may connect successfully, but the bot will not respond to anything you say in the meeting.

#### Client configuration

In the `client` directory, copy the `.env.example` file and rename it to `.env`. Then modify the settings therein.

#### Python Server Configuration

In the `python-server` directory, copy the `.env.example` file and rename it to `.env`. Then, add your keys.

Update the `bot-config.yml` with details about your course(s). Include any OpenAI Responses API [Chat Prompts](https://developers.openai.com/api/docs/guides/prompting#create-a-prompt) that you have set up and [vector store files](https://developers.openai.com/api/reference/resources/vector_stores/subresources/files/methods/create) you have uploaded.

## Quickstart

1. Start your backend server:

Python:

```bash
cd python-server
pipenv shell
python ./server.py
```

Then in a separate terminal, use `ngrok` to create a public URL that tunnels to your local server:

```bash
ngrok http 8001
```

2. Start your front-end development web server using `vite`:

```bash
cd client
npm run dev
```

This will output the URL of your local web server, e.g. `http://localhost:5173`.

3. Load this client URL in web browser with the parameters it needs, including `wss` that shows where to find the server (using the ngrok URL or raw localhost server URL), the `course` title of the course that matches one of your courses listed in your `bot_config.yml`, and the `url` of a slide deck you'd like the bot to present on your behalf (defaults to example slide deck we have created).

```txt
http://localhost:5173/?wss=ws://localhost:8001&course=Software+Engineering
```

## Attach to Zoom call

`client/run.py` sends a [Recall.ai](https://www.recall.ai/) bot into a Zoom, Google Meet or Teams meeting. The bot shows the deployed client page, with the avatar starting automatically, as its camera. Set `RECALLAI_API_URL`, `RECALLAI_API_TOKEN`, `MEETING_URL`, `VITE_BOT_NAME` and `SCREENSHARE_WEBPAGE_URL` in `client/.env`, then run:

```bash
cd client
pipenv run python run.py
```

See [DEVELOPMENT.md, section 6.7](DEVELOPMENT.md#67-putting-the-bot-in-a-zoom-call-recallai) for setup, the settings, how to remove the bot, costs, and what to check on a first run.

If you'd like to customize the webpage shown by the bot, or change the interaction with the OpenAI agent, follow the complete setup instructions below.

## Customizing the Webpage

### Local Development Setup

Navigate to the client directory and start the development server:

```bash
cd client
npm run dev
```

The client will be available at `http://localhost:5173`.

### Building for Production

Build the client application:

```bash
npm run build
```

The built files will be in the `dist` directory, ready to be deployed to your hosting service.

Once the frontend is deployed on a hosting service, update your bot configuration to use your custom webpage URL and the course title that matches one of the courses in the `bot-config.yml`.

```json
{
  "output_media": {
    "kind": "webpage",
    "config": {
      "url": "https://your-custom-url.com?wss=wss://your-server.com&course=Software+Engineering"
    }
  }
}
```

Using this, you will be able to interact with a customized voice agent via Zoom.
