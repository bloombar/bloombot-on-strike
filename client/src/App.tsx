import { useState, useEffect, useRef, useCallback } from 'react'
import { RealtimeClient } from '@openai/realtime-api-beta'
// @ts-expect-error - External library without type definitions
import { WavRecorder, WavStreamPlayer } from './lib/wavtools/index.js'
import { instructions } from './llm-config.js'
import './App.css'

const clientRef = { current: null as RealtimeClient | null }
const wavRecorderRef = { current: null as WavRecorder | null }
const wavStreamPlayerRef = { current: null as WavStreamPlayer | null }

export function App() {
  const params = new URLSearchParams(window.location.search)
  const RELAY_SERVER_URL = params.get('wss')
  const [connectionStatus, setConnectionStatus] = useState<'disconnected' | 'connecting' | 'connected'>('disconnected')
  const iframeRef = useRef<HTMLIFrameElement | null>(null)
  const COURSE_URL = 'https://knowledge.kitchen/content/courses/software-engineering/slides/continuous-integration/'
  const COURSE_ORIGIN = new URL(COURSE_URL).origin
  console.log('COURSE_ORIGIN:', COURSE_ORIGIN)
  let client: RealtimeClient | null = null

  if (!clientRef.current) {
    clientRef.current = new RealtimeClient({
      url: RELAY_SERVER_URL || undefined,
    })
  }
  if (!wavRecorderRef.current) {
    wavRecorderRef.current = new WavRecorder({ sampleRate: 24000 })
  }
  if (!wavStreamPlayerRef.current) {
    wavStreamPlayerRef.current = new WavStreamPlayer({ sampleRate: 24000 })
  }
  const isConnectedRef = useRef(false)
  const connectConversation = useCallback(async () => {
    if (isConnectedRef.current) return
    isConnectedRef.current = true
    setConnectionStatus('connecting')
    client = clientRef.current
    const wavRecorder = wavRecorderRef.current
    const wavStreamPlayer = wavStreamPlayerRef.current
    if (!client || !wavRecorder || !wavStreamPlayer) return

    try {
      // Connect to microphone
      await wavRecorder.begin()

      // Connect to audio output
      await wavStreamPlayer.connect()

      // Connect to realtime API
      await client.connect()

      setConnectionStatus('connected')

      client.on('error', (event: any) => {
        console.error(event)
        setConnectionStatus('disconnected')
      })

      client.on('disconnected', () => {
        setConnectionStatus('disconnected')
      })

      client.sendUserMessageContent([
        {
          type: `input_text`,
          text: `Hello!`,
        },
      ])

      // Always use VAD mode
      client.updateSession({
        turn_detection: { type: 'server_vad' },
      })

      // Check if we're already recording before trying to pause
      if (wavRecorder.recording) {
        await wavRecorder.pause()
      }

      // Check if we're already paused before trying to record
      if (!wavRecorder.recording) {
        await wavRecorder.record((data: { mono: Float32Array }) => client?.appendInputAudio(data.mono))
      }
    } catch (error) {
      console.error('Connection error:', error)
      setConnectionStatus('disconnected')
    }
  }, [])

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

  /**
   * Core RealtimeClient and audio capture setup
   * Set all of our instructions, tools, events and more
   */
  useEffect(() => {
    // Only run the effect if there's no error
    if (!errorMessage) {
      connectConversation()
      const wavStreamPlayer = wavStreamPlayerRef.current
      const client = clientRef.current
      if (!client || !wavStreamPlayer) return

      // Set instructions
      client.updateSession({ instructions: instructions })

      // handle realtime events from client + server for event logging
      client.on('error', (event: any) => console.error(event))
      client.on('conversation.interrupted', async () => {
        const trackSampleOffset = await wavStreamPlayer.interrupt()
        if (trackSampleOffset?.trackId) {
          const { trackId, offset } = trackSampleOffset
          await client.cancelResponse(trackId, offset)
        }
      })
      client.on('conversation.updated', async ({ item, delta }: any) => {
        client.conversation.getItems()
        if (delta?.audio) {
          wavStreamPlayer.add16BitPCM(delta.audio, item.id)
        }
        if (item.status === 'completed' && item.formatted.audio?.length) {
          const wavFile = await WavRecorder.decode(item.formatted.audio, 24000, 24000)
          item.formatted.file = wavFile
        }
      })

      return () => {
        client.reset()
      }
    }
  }, [errorMessage])

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

      console.log(`Received postMessage: type=${type}, data=${data}`)
      if (type === 'response:keypress') {
        console.log(`Received keypress response: ${data}`)

        ///start
        console.log(`Received keypress response: ${data}`)
        const iframe = iframeRef.current
        if (!iframe) return

        const iframeWindow = iframe.contentWindow
        if (!iframeWindow) return

        iframeWindow.postMessage(
          {
            type: 'getContent',
            data: '.remark-visible',
          },
          COURSE_ORIGIN,
        )

        ///end
      } else if (type === 'response:getContent') {
        console.log(`Received content response: ${data}`)
        client?.sendUserMessageContent([
          {
            type: `input_text`,
            text: `Explain the new text in this slide: ${data}`,
          },
        ])
      }
    })
  }, [])

  useEffect(() => {
    const rightArrowKeyCode = 39

    const triggerRightArrow = () => {
      const iframe = iframeRef.current
      if (!iframe) return

      const iframeWindow = iframe.contentWindow
      if (!iframeWindow) return

      iframeWindow.postMessage(
        {
          type: 'keypress',
          data: rightArrowKeyCode,
        },
        COURSE_ORIGIN,
      )
    }

    const intervalId = window.setInterval(triggerRightArrow, 15000)
    return () => {
      window.clearInterval(intervalId)
    }
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
