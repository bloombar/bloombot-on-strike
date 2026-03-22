import { useState, useEffect, useRef, useCallback } from 'react'
import useWebSocket, { ReadyState } from 'react-use-websocket'
// import { instructions } from './llm-config.js'
import './App.css'

export function App() {
  const params = new URLSearchParams(window.location.search)
  const RELAY_SERVER_URL = params.get('wss')
  const COURSE_URL = 'https://knowledge.kitchen/content/courses/software-engineering/slides/continuous-integration/'
  const COURSE_ORIGIN = new URL(COURSE_URL).origin
  const COURSE_TITLE = params.get('course') || 'Software Engineering' // should come from query string
  const [markdownSource, setMarkdownSource] = useState<string>('')
  const iframeRef = useRef<HTMLIFrameElement | null>(null)
  const [iFrameLoaded, setIFrameLoaded] = useState(false)
  const slidesContentRef = useRef<string[]>([])
  const [messageHistory, setMessageHistory] = useState<{}[]>([])

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

  //open websocket connection to server
  const { sendJsonMessage, lastJsonMessage, readyState } = useWebSocket(RELAY_SERVER_URL, {
    onOpen: () => {
      console.log('client: websocket opened')
      // send confirmation message to server on connection open
      sendJsonMessage({
        type: 'handshake',
        data: {
          client_url: COURSE_URL,
          // instructions: instructions,
          course_title: COURSE_TITLE,
          lecture_notes: 'twas brilllig and the slithy toves did gyre and gimble in the wabe',
        },
      })
    },
    //Will attempt to reconnect on all close events, such as server shutting down
    shouldReconnect: (closeEvent) => true,
  })

  // connectionStatus is human-readable version of readystate
  const connectionStatus = {
    [ReadyState.CONNECTING]: 'connecting',
    [ReadyState.OPEN]: 'connected',
    [ReadyState.CLOSING]: 'closing',
    [ReadyState.CLOSED]: 'closed',
    [ReadyState.UNINSTANTIATED]: 'uninstantiated',
  }[readyState]

  useEffect(() => {
    if (lastJsonMessage !== null && lastJsonMessage !== undefined) {
      setMessageHistory((prev) => prev.concat(lastJsonMessage))
      console.log('client received message:', JSON.stringify(lastJsonMessage, null, 2))
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
    iframeWindow.postMessage(
      {
        type: 'getMarkdownSource',
        data: null,
      },
      COURSE_ORIGIN,
    )
  }, [iFrameLoaded])

  useEffect(() => {
    // look out for responses to postMessages from a child window
    window.addEventListener('message', function (event) {
      /**
       * Expected message format in event.data:
       * {
       *   type: "response:keypress" | "response:getContent",
       *   data: any
       * }
       */
      const { type, data } = event.data

      // console.log(`Received postMessage: type=${type}, data=${data}`)
      if (type === 'response:keypress') {
        // console.log(`Received keypress response: ${data}`)

        ///start
        // console.log(`Received keypress response: ${data}`)
        const iframe = iframeRef.current
        if (!iframe) return

        const iframeWindow = iframe.contentWindow
        if (!iframeWindow) return

        iframeWindow.postMessage(
          {
            type: 'getContent',
            data: '.remark-visible .remark-slide-content', // CSS selector for the content we want to read from the slide
          },
          COURSE_ORIGIN,
        )

        ///end
      } else if (type === 'response:getContent') {
        // console.log(`Received content response: ${data}`)
        const previousSlideContent = slidesContentRef.current[slidesContentRef.current.length - 1] ?? null
        const slideDiff = previousSlideContent ? data.replace(previousSlideContent, '').trim() : data
      }
    })
  }, [])

  useEffect(() => {
    gotoNextSlide()
  }, [COURSE_ORIGIN])

  return (
    <div className="app-container">
      <iframe ref={iframeRef} className="course-frame" src={COURSE_URL} title="Continuous Integration Course Slides" />
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
