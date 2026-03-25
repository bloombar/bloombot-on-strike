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
cd ../python-server
pipenv install
pipenv shell
```

## Configuration

### OpenAI API Key

Note: You **must** add credits to your OpenAI account before running this demo. If your account has no credits, the demo will connect successfully, but the bot will not respond to anything you say in the meeting.

#### Client configuration

In the `client` directory, copy the `.env.example` file and rename it to `.env`. Then modify the settings therein.

#### Python Server Configuration

In the `python-server` directory, copy the `.env.example` file and rename it to `.env`. Then, add your keys. The PORT is optional and defaults to `8001` if not specified.

Update the `bot-config.yml` with details about your course(s). Include any OpenAI Responses API [Chat Prompts](https://developers.openai.com/api/docs/guides/prompting#create-a-prompt) that you have set up and [vector store files](https://developers.openai.com/api/reference/resources/vector_stores/subresources/files/methods/create) you have uploaded.

## Quickstart

1. Start your backend server and expose it using ngrok:

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

http://localhost:5173/?wss=ws://localhost:8001&course=Software+Engineering

## Attach to Zoom call

1. Add the bot to a Zoom acll by sending the following curl request, replacing `YOUR_RECALL_TOKEN`, `YOUR_NGROK_SERVER_URL`, and other placeholders with your values:

```bash
curl --request POST \
  --url https://us-east-1.recall.ai/api/v1/bot/ \
  --header 'Authorization: YOUR_RECALL_TOKEN' \
  --header 'accept: application/json' \
  --header 'content-type: application/json' \
  --data '{
    "meeting_url": "YOUR_MEETING_URL",
    "bot_name": "Recall.ai Notetaker",
    "output_media": {
      "camera": {
        "kind": "webpage",
        "config": {
          "url": "https://recallai-demo.netlify.app?wss=wss://YOUR_NGROK_SERVER_URL&course=YOUR_COURSE_TITLE"
        }
      }
    },
    "variant": {
      "zoom": "web_4_core",
      "google_meet": "web_4_core",
      "microsoft_teams": "web_4_core"
    }
  }'
```

This command has been automated in the `run.py` script, using settings in the `.env` file. Take a look and update as necessary. Execute that:

```python
python run.py
```

The bot will join your meeting URL and stream the demo webpage's content directly to your meeting.

If you'd like to customize the webpage shown by the bot, or change the interaction with the OpenAI agent, follow the complete setup instructions below.

## Customizing the Webpage

### Local Development Setup

Navigate to the client directory and start the development server:

```bash
cd client
npm install
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

Using this, you will be able to interact with a customized voice agent.

## Acknowledgements

This project incorporates code from [OpenAI's real-time API demo](https://github.com/openai/openai-realtime-console), which is under the MIT License.

## FAQ

### The webpage shows that my bot is connected, why isn't it replying to me in the meeting?

If the webpage is showing a successful connection but the bot isn't speaking, it's likely that you need to add credits to your OpenAI account. If your account has no credits, the demo will connect successfully, but the bot will not respond to anything you say in the meeting.
