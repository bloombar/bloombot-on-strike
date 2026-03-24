import { useState, useEffect, useRef, useMemo, useCallback } from 'react'
import useWebSocket, { ReadyState } from 'react-use-websocket'
import { SessionInteractivityMode } from '@heygen/liveavatar-web-sdk'
import { LiveAvatarSession } from './LiveAvatarSession'
import './App.css'

export type SessionMode = 'FULL' | 'FULL_PTT' | 'LITE'

export function App() {
  const params = new URLSearchParams(window.location.search)
  const RELAY_SERVER_URL = params.get('wss')
  //const COURSE_URL = 'https://knowledge.kitchen/content/courses/software-engineering/slides/continuous-integration/'
  //const COURSE_URL = 'http://127.0.0.1:4000/content/courses/software-engineering/slides/continuous-integration/'
  const COURSE_URL = 'https://knowledge.kitchen/content/courses/software-engineering/slides/build-tools/'
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
  const [textToSpeak, setTextToSpeak] = useState('')
  const [mode, setMode] = useState<SessionMode>('FULL')
  const lectureReadyRef = useRef(false)
  const lectureStartedRef = useRef(false)
  const isReconnectingRef = useRef(false)
  const handshakeSentRef = useRef(false)
  const silenceTimeoutRef = useRef<number>(0)

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

  const onSessionStopped = () => {
    console.log('LiveAvatar session stopped, requesting new token to reconnect...')
    isReconnectingRef.current = true
    setLiveAvatarSessionToken('') // unmount old session
    sendJsonMessage({
      type: 'request_liveavatar_token',
      data: null,
    })
  }

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

  useEffect(() => {
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
    // only request a LiveAvatar token once per connection
    if (!handshakeSentRef.current) {
      handshakeSentRef.current = true
      sendJsonMessage({
        type: 'request_liveavatar_token',
        data: null,
      })
      console.log('client requested liveavatar token')
    }
  }, [markdownSource])

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
        setLiveAvatarSessionToken(data?.token) // store the token in state to pass to the LiveAvatarSession component
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
    <div className="app-container">
      <iframe ref={iframeRef} onLoad={() => setIFrameLoaded(true)} className="course-frame" src={COURSE_URL} />

      {liveAvatarSessionToken && (
        <div className="avatar-container">
          <LiveAvatarSession
            mode={mode}
            sessionAccessToken={liveAvatarSessionToken}
            voiceChatConfig={voiceChatConfig}
            onSessionStopped={onSessionStopped}
            textToSpeak={textToSpeak}
            onSpeakingDone={onSpeakingDone}
            isReconnect={isReconnectingRef.current}
          />
        </div>
      )}

      <div className="status-indicator">
        <div className={`status-dot ${errorMessage ? 'disconnected' : connectionStatus}`} />
        <div className="status-text">
          <div className="status-label">
            {errorMessage
              ? 'Error:'
              : connectionStatus === 'connecting'
                ? 'Connecting to:'
                : connectionStatus === 'connected'
                  ? 'Connected to:'
                  : 'Failed to connect to:'}
          </div>
          <div className="status-url">{errorMessage || RELAY_SERVER_URL}</div>
        </div>
      </div>
    </div>
  )
}

export default App
