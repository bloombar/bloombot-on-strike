import { useState, useEffect, useRef, useMemo, useCallback } from 'react'
// Simple spinner component
function Spinner() {
  return (
    <div className="flex items-center justify-center w-full h-full">
      <svg
        className="animate-spin h-12 w-12 text-gray-400"
        xmlns="http://www.w3.org/2000/svg"
        fill="none"
        viewBox="0 0 24 24"
      >
        <circle className="opacity-25" cx="12" cy="12" r="10" stroke="currentColor" strokeWidth="4"></circle>
        <path className="opacity-75" fill="currentColor" d="M4 12a8 8 0 018-8v4a4 4 0 00-4 4H4z"></path>
      </svg>
    </div>
  )
}
import Draggable from 'react-draggable'
import useWebSocket, { ReadyState } from 'react-use-websocket'
import { SessionInteractivityMode } from '@heygen/liveavatar-web-sdk'
import { LiveAvatarSession } from './LiveAvatarSession'
import './index.css'

export type SessionMode = 'FULL' | 'FULL_PTT' | 'LITE'

/** Minimum milliseconds between LiveAvatar token requests */
const RECONNECT_COOLDOWN_MS = 10_000

export function App() {
  const params = new URLSearchParams(window.location.search)
  const RELAY_SERVER_URL = params.get('wss')
  //const COURSE_URL = 'https://knowledge.kitchen/content/courses/software-engineering/slides/continuous-integration/'
  // const COURSE_URL = 'http://127.0.0.1:4000/content/courses/software-engineering/slides/continuous-integration/'
  const COURSE_URL =
    params.get('url') || 'https://knowledge.kitchen/content/courses/software-engineering/slides/continuous-integration/'
  const COURSE_ORIGIN = new URL(COURSE_URL).origin
  const COURSE_TITLE = params.get('course') || 'Software Engineering' // should come from query string
  const [markdownSource, setMarkdownSource] = useState<string>('')
  const iframeRef = useRef<HTMLIFrameElement | null>(null)
  const [iFrameLoaded, setIFrameLoaded] = useState(false)
  const slidesContentRef = useRef<string[]>([])
  const slidesTimeoutRef = useRef<number>(0)
  const [messageHistory, setMessageHistory] = useState<{}[]>([])
  const [awaitingTextToSpeak, setAwaitingTextToSpeak] = useState(false)
  const [liveAvatarSessionToken, setLiveAvatarSessionToken] = useState('')
  const [sessionActive, setSessionActive] = useState(false)
  const [textToSpeak, setTextToSpeak] = useState('')
  // Track loading state for avatar session
  const [avatarLoading, setAvatarLoading] = useState(false)
  const [mode, setMode] = useState<SessionMode>('FULL')
  const lectureReadyRef = useRef(false)
  const lectureStartedRef = useRef(false)
  const isReconnectingRef = useRef(false)
  const handshakeSentRef = useRef(false)
  const silenceTimeoutRef = useRef<number>(0)
  const lastTokenRequestTimeRef = useRef<number>(0)
  const tokenRequestPendingRef = useRef(false)

  // Draggable avatar state (react-draggable)
  // Ensure avatar starts within visible area, with a minimum margin
  const AVATAR_WIDTH = 240
  const AVATAR_HEIGHT = 240
  const MARGIN = 32
  const [avatarPos, setAvatarPos] = useState({
    x: Math.max(window.innerWidth - AVATAR_WIDTH - MARGIN, MARGIN),
    y: Math.max(window.innerHeight - AVATAR_HEIGHT - MARGIN, MARGIN),
  })
  const handleDrag = (e: any, data: any) => {
    setAvatarPos({ x: data.x, y: data.y })
  }

  // require a valid URL for the websocket relay server
  const errorMessage = !RELAY_SERVER_URL
    ? 'Missing required "wss" parameter in URL'
    : (() => {
        try {
          new URL(RELAY_SERVER_URL)
          return null
        } catch {
          return 'Invalid URL format for "wss" parameter'
        }
      })()

  const onSpeakingDone = useCallback(() => {
    if (isReconnectingRef.current) {
      // reconnect recovery: welcome message finished, resume was already triggered
      isReconnectingRef.current = false
      console.log('Avatar reconnected and finished re-speaking interrupted text, advancing...')
      goToNextSlide()
    } else if (!lectureStartedRef.current && lectureReadyRef.current) {
      // welcome message finished — start the lecture by advancing to the first content slide
      lectureStartedRef.current = true
      console.log('Avatar welcome message finished, starting lecture...')
      goToNextSlide()
    } else if (lectureStartedRef.current) {
      // subsequent slide narration finished — advance to next slide
      console.log('Avatar finished speaking, advancing to next slide...')
      goToNextSlide()
    }
    // start silence timeout — if no new speech within 10s, advance
    window.clearTimeout(silenceTimeoutRef.current)
    silenceTimeoutRef.current = window.setTimeout(() => {
      console.log('10s silence timeout — advancing to next slide...')
      goToNextSlide()
    }, 10000)
  }, [])

  const voiceChatConfig = useMemo(() => {
    if (mode === 'FULL_PTT') {
      return {
        mode: SessionInteractivityMode.PUSH_TO_TALK,
      }
    }
    return true
  }, [mode])

  //open websocket connection to server
  const { sendJsonMessage, lastJsonMessage, readyState } = useWebSocket(RELAY_SERVER_URL, {
    onOpen: () => {
      console.log('client: websocket opened')
    },
    //Will attempt to reconnect on all close events, such as server shutting down
    shouldReconnect: (closeEvent) => true,
  })

  const onSessionStopped = useCallback(() => {
    // skip if a token request is already in flight
    if (tokenRequestPendingRef.current) {
      console.log('LiveAvatar token request already pending, skipping duplicate')
      return
    }

    // enforce cooldown between token requests
    const elapsed = Date.now() - lastTokenRequestTimeRef.current
    if (elapsed < RECONNECT_COOLDOWN_MS) {
      console.log(`LiveAvatar reconnect cooldown active (${RECONNECT_COOLDOWN_MS - elapsed}ms remaining), skipping`)
      return
    }

    console.log('LiveAvatar session stopped, requesting new token to reconnect...')
    isReconnectingRef.current = true
    tokenRequestPendingRef.current = true
    lastTokenRequestTimeRef.current = Date.now()
    setLiveAvatarSessionToken('') // unmount old session
    sendJsonMessage({
      type: 'request_liveavatar_token',
      data: null,
    })
  }, [sendJsonMessage])

  useEffect(() => {
    // wait until we actually have lecture content before handshaking
    if (!markdownSource) return

    // send confirmation message to server once we have the lecture content
    sendJsonMessage({
      type: 'handshake',
      data: {
        client_url: COURSE_URL,
        // instructions: instructions,
        course_title: COURSE_TITLE,
        lecture_notes: markdownSource,
      },
    })
    // Do not request a LiveAvatar token by default
  }, [markdownSource])

  // Start a new session by requesting a token
  const handleStartSession = () => {
    if (!handshakeSentRef.current) {
      handshakeSentRef.current = true
    }
    tokenRequestPendingRef.current = true
    lastTokenRequestTimeRef.current = Date.now()
    setAvatarLoading(true)
    sendJsonMessage({
      type: 'request_liveavatar_token',
      data: null,
    })
    setSessionActive(true)
  }

  // Stop the session by sending a close request
  const handleStopSession = () => {
    if (liveAvatarSessionToken) {
      sendJsonMessage({
        type: 'close_liveavatar_session',
        data: { token: liveAvatarSessionToken },
      })
    }
    setLiveAvatarSessionToken('')
    setSessionActive(false)
  }

  // connectionStatus is human-readable version of readystate
  const connectionStatus = {
    [ReadyState.CONNECTING]: 'connecting',
    [ReadyState.OPEN]: 'connected',
    [ReadyState.CLOSING]: 'closing',
    [ReadyState.CLOSED]: 'closed',
    [ReadyState.UNINSTANTIATED]: 'uninstantiated',
  }[readyState]

  useEffect(() => {
    /**
     * Handle incoming messages from the server via websockets.
     */
    if (lastJsonMessage !== null && lastJsonMessage !== undefined) {
      setMessageHistory((prev) => prev.concat(lastJsonMessage))
      console.log('client received message:', JSON.stringify(lastJsonMessage, null, 2))

      const { type, data } = lastJsonMessage

      if (lastJsonMessage.type === 'response_spoken_text') {
        setAwaitingTextToSpeak(false) // mark we are no longer awaiting a response from the server for this slide
        console.log(`Received text to speak for current slide: ${data?.response}`)
        if (data?.response) {
          window.clearTimeout(silenceTimeoutRef.current) // cancel silence timeout — avatar will speak
          setTextToSpeak(data.response)
        }
      } else if (lastJsonMessage.type === 'response_liveavatar_token') {
        console.log(`Received LiveAvatar token: ${data?.token}`)
        tokenRequestPendingRef.current = false
        setLiveAvatarSessionToken(data?.token) // store the token in state to pass to the LiveAvatarSession component
        setSessionActive(true)
        setAvatarLoading(false)
      } else if (lastJsonMessage.type === 'response_close_liveavatar_session') {
        setLiveAvatarSessionToken('')
        setSessionActive(false)
      }
    }
  }, [lastJsonMessage])

  const getIFrameWindow = (): Window => {
    /**
     * Get the contentWindow of the iframe, if it exists.
     */
    const iframe = iframeRef.current
    if (!iframe) throw new Error('iFrame not found')

    const iframeWindow = iframe.contentWindow
    if (!iframeWindow) throw new Error('iFrame contentWindow not found')
    return iframeWindow
  }

  const goToNextSlide = () => {
    console.log('Triggering next slide...')
    const iframeWindow = getIFrameWindow()
    iframeWindow.postMessage(
      {
        type: 'nextSlide',
        data: null,
      },
      COURSE_ORIGIN,
    )
  }

  useEffect(() => {
    // once iframe has loaded, get all slides content from textarea markdown source data
    const iframeWindow = getIFrameWindow()

    // generate version of the slideshow with incremental slides removed
    iframeWindow.postMessage(
      {
        type: 'removeIncrementalSlides',
        data: null,
      },
      COURSE_ORIGIN,
    )

    // get the markdown source for all slides to pass to the LLM for processing
    iframeWindow.postMessage(
      {
        type: 'getMarkdownSource',
        data: null,
      },
      COURSE_ORIGIN,
    )
  }, [iFrameLoaded])

  useEffect(() => {
    /**
     * Set up event listeners.
     */

    // look out for responses to postMessages from a child window
    window.addEventListener('message', function (event) {
      /**
       * Look out for incoming response messages.
       * Expected message format in event.data:
       * {
       *   type: "responses:nextSlide | responses:previousSlide | responses:goToSlide | response:keypress" | "response:getContent",
       *   data: any
       * }
       */

      // destructure the data coming in from postMessage
      const { type, data } = event.data

      // console.log(`Received postMessage: type=${type}, data=${data}`)
      if (type === 'response:keypress') {
        // console.log(`Received keypress response: ${data}`)

        const iframeWindow = getIFrameWindow()
        iframeWindow.postMessage(
          {
            type: 'getContent',
            data: '.remark-visible .remark-slide-content', // CSS selector for the content we want to read from the slide
          },
          COURSE_ORIGIN,
        )

        ///end
      } else if (type === 'response:removeIncrementalSlides') {
        console.log(`Incremental slides removed.`)
      } else if (type === 'response:getMarkdownSource') {
        console.log(`All slide markdown source loaded. Total length: ${data.length} characters.`)
        setMarkdownSource(data)
        // mark lecture content as ready — first slide will advance once avatar welcome message finishes
        lectureReadyRef.current = true
        console.log('Lecture content ready, waiting for avatar welcome message to finish...')
      } else if (type === 'response:nextSlide') {
        // we have transitioned to a new slide... get its content
        const iframeWindow = getIFrameWindow()
        iframeWindow.postMessage(
          {
            type: 'getContent',
            data: '.remark-visible .remark-slide-content', // CSS selector for the content we want to read from the slide
          },
          COURSE_ORIGIN,
        )
      } else if (type === 'response:getContent') {
        // we have new slide content...
        if (!data || data.trim() == '') return
        // get the difference between this slide and the previous
        const previousSlideContent = slidesContentRef.current[slidesContentRef.current.length - 1] ?? null
        const slideDiff = previousSlideContent ? data.replace(previousSlideContent, '').trim() : data
        if (!slideDiff) return
        slidesContentRef.current.push(data) // store latest slide content for future diffing

        // slide carousel has transitioned... get the text to speak about the new slide from the server
        sendJsonMessage({
          type: 'request_spoken_text',
          data: slideDiff,
        })
        setAwaitingTextToSpeak(true) // mark we are awaiting a response from the server for this slide
      }
    })
  }, [iFrameLoaded])

  return (
    <div className="relative w-screen h-screen overflow-hidden font-sans">
      <iframe
        ref={iframeRef}
        onLoad={() => setIFrameLoaded(true)}
        className="fixed inset-0 w-screen h-screen border-0 z-0"
        src={COURSE_URL}
      />

      <Draggable handle=".avatar-wrapper" position={avatarPos} onDrag={handleDrag} bounds="parent">
        <div
          className="avatar-wrapper draggable-avatar flex flex-col items-center max-w-full max-h-full absolute"
          style={{ zIndex: 20 }}
        >
          <div
            className={
              'avatar-container w-[240px] h-[240px] rounded-full overflow-hidden shadow-lg border-4 border-white/10 flex items-center justify-center relative bg-white'
            }
          >
            {!sessionActive ? (
              avatarLoading ? (
                <Spinner />
              ) : (
                <button
                  onClick={handleStartSession}
                  className="px-6 py-2 text-base rounded bg-green-600 hover:bg-green-700 text-white font-semibold shadow absolute left-1/2 top-1/2 -translate-x-1/2 -translate-y-1/2"
                >
                  {`Start ${import.meta.env.VITE_BOT_NAME || 'ScabBot'}`}
                </button>
              )
            ) : (
              liveAvatarSessionToken && (
                <LiveAvatarSession
                  mode={mode}
                  sessionAccessToken={liveAvatarSessionToken}
                  voiceChatConfig={voiceChatConfig}
                  onSessionStopped={onSessionStopped}
                  textToSpeak={textToSpeak}
                  onSpeakingDone={onSpeakingDone}
                  isReconnect={isReconnectingRef.current}
                />
              )
            )}
          </div>
          {sessionActive && (
            <div className="mt-4 text-center">
              <button
                onClick={handleStopSession}
                className="px-6 py-2 text-base rounded bg-red-600 hover:bg-red-700 text-white font-semibold shadow"
              >
                {`Stop ${import.meta.env.VITE_BOT_NAME || 'ScabBot'}`}
              </button>
            </div>
          )}
        </div>
      </Draggable>

      <div className="fixed left-1/2 bottom-3 -translate-x-1/2 z-10 flex items-center gap-3 px-4 py-2 bg-black/80 rounded-xl shadow-lg backdrop-blur w-[min(96vw,780px)]">
        <div
          className={`inline-block w-3 h-3 rounded-full flex-shrink-0 transition-colors duration-300 ${
            errorMessage
              ? 'bg-red-500'
              : connectionStatus === 'connecting'
                ? 'bg-yellow-400 animate-pulse'
                : connectionStatus === 'connected'
                  ? 'bg-green-500 animate-pulse-slow'
                  : 'bg-gray-400'
          }`}
        />
        <div className="flex items-center gap-2 text-sm min-w-0">
          <div className="font-semibold text-gray-100 whitespace-nowrap">
            {errorMessage
              ? 'Error:'
              : connectionStatus === 'connecting'
                ? 'Connecting to:'
                : connectionStatus === 'connected'
                  ? 'Connected to:'
                  : 'Failed to connect to:'}
          </div>
          <div className="text-gray-300 truncate">{errorMessage || RELAY_SERVER_URL}</div>
        </div>
      </div>
      <style>{`
        @keyframes animate-pulse-slow {
          0% { opacity: 1; }
          50% { opacity: 0.4; }
          100% { opacity: 1; }
        }
        .animate-pulse-slow {
          animation: animate-pulse-slow 2s infinite;
        }
      `}</style>
    </div>
  )
}

export default App
