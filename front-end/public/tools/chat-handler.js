const confirmZoomExists = () => {
  // check that Zoom is defined globally by their CDN script imported into cdn.html
  const isZoomMtgEmbeddedDefined =
    typeof window !== "undefined" &&
    typeof window.ZoomMtgEmbedded !== "undefined";

  // output
  console.log(
    `ZoomMtgEmbedded is ${
      isZoomMtgEmbeddedDefined ? "defined" : "not defined"
    } in chat-handler.js.`,
  );
};

const registerChatListeners = () => {
  console.log("Registering chat listener...");
  try {
    console.log("Registering chat message listener");
    ZoomMtgEmbedded.inMeetingServiceListener("onReceiveChat", function (data) {
      postChatMessage("onReceiveChat", data);
    });
  } catch (_error) {
    console.log("Failed to register chat message listener");
    // Listener APIs can vary across SDK versions.
  }
};

const sayHello = () => {
  ZoomMtgEmbedded.sendChat({
    message: "Hello world!",
  });
};

async function postChatMessage(eventName, data) {
  const payload = {
    event: eventName,
    meetingNumber,
    sender:
      data?.displayName || data?.sender || data?.userName || data?.name || null,
    recipient:
      data?.toContact || data?.recipient || data?.receiver || data?.to || null,
    message:
      data?.message || data?.text || data?.msgBody || data?.content || null,
    raw: data,
  };

  try {
    await fetch("/api/chat", {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify(payload),
    });
  } catch (error) {
    console.error("Failed to post chat event", error);
  }
}

// run when loads
(function () {
  sayHello();
  confirmZoomExists();
  registerChatListeners();
})();
