# Bloombot-on-Strike (Front-End)

Based on Zoom's [Web Meeting-SDK Component View Sample App](https://developers.zoom.us/docs/meeting-sdk/web/component-view/)

[API reference](https://developers.zoom.us/docs/meeting-sdk/web/component-view/reference/)

## How to run

```
cd front-end
npm install
npm run start
```

Add your SDK KEY and SDK SECRET in `tools/nav.js`,

Update your server's authorization route in `tools/nav.js`,

```js
const authEndpoint = "http://localhost:3010"; // replace with your server authorization route
```

- Open [http://localhost:3000](http://localhost:3010) in your web browser
- Navigate using `public/nav.html`

## Basics

- After initializing with a container (typically a `<div>`) of your choice, the client will be embedded in said container and be usable just like any other Zoom client
- APIs are provided to programmatically access information and attributes about the meeting, current user, etc.
- Customization options are available to vary the look-and-feel of the client

Please refer to the official SDK documentation for more details

```js
// Import the SDK
import ZoomMtgEmbedded from "@zoomus/websdk/embedded";

// Select the root element you want to embed the client inside
const rootElement = document.getElementById("my_root");

// Create the client
const client = ZoomMtgEmbedded.createClient();

// Set your init parameters
const initParams = {
  zoomAppRoot: rootElement,
  // ...
};

// Set your join params
const joinParams = {
  // ...
};

// Init client
client.init(initParams);

// Join the meeting
client
  .join(joinParams)
  .then((e) => {
    // Execute post join-meeting logic accordingly
  })
  .catch((e) => {
    // Handle join-meeting errors accordingly
  });
```

## update

npx npm-check -u
