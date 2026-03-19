import { useState, useEffect, useRef, useCallback } from 'react'
import { RealtimeAgent, RealtimeSession } from '@openai/agents/realtime'
// @ts-expect-error - External library without type definitions
import { WavPacker, WavRecorder, WavStreamPlayer } from './lib/wavtools/index.js'
import { instructions } from './llm-config.js'
import './App.css'

const sessionRef = { current: null as RealtimeSession | null }
const wavRecorderRef = { current: null as WavRecorder | null }
const wavStreamPlayerRef = { current: null as WavStreamPlayer | null }

export function App() {
  const params = new URLSearchParams(window.location.search)
  const RELAY_SERVER_URL = params.get('wss')
  const COURSE_URL = 'https://knowledge.kitchen/content/courses/software-engineering/slides/continuous-integration/'
  const COURSE_ORIGIN = new URL(COURSE_URL).origin
  const [connectionStatus, setConnectionStatus] = useState<'disconnected' | 'connecting' | 'connected'>('disconnected')
  const iframeRef = useRef<HTMLIFrameElement | null>(null)
  const listenersBoundRef = useRef(false)

  if (!sessionRef.current) {
    const agent = new RealtimeAgent({
      name: 'Bloombot-on-Strike',
      instructions,
    })
    sessionRef.current = new RealtimeSession(agent, {
      transport: 'websocket',
      model: 'gpt-realtime',
      config: {
        audio: {
          input: {
            turnDetection: { type: 'server_vad' },
            format: { type: 'audio/pcm', rate: 24000 },
          },
          output: {
            format: { type: 'audio/pcm', rate: 24000 },
          },
        },
      },
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
    if (!RELAY_SERVER_URL) return
    isConnectedRef.current = true
    setConnectionStatus('connecting')
    const session = sessionRef.current
    const wavRecorder = wavRecorderRef.current
    const wavStreamPlayer = wavStreamPlayerRef.current
    if (!session || !wavRecorder || !wavStreamPlayer) return

    try {
      // Connect to microphone
      await wavRecorder.begin()

      // Connect to audio output
      await wavStreamPlayer.connect()

      if (!listenersBoundRef.current) {
        session.on('error', (event) => {
          console.error(event)
          setConnectionStatus('disconnected')
          isConnectedRef.current = false
        })

        session.on('audio_interrupted', async () => {
          await wavStreamPlayer.interrupt()
        })

        session.on('audio', (event) => {
          wavStreamPlayer.add16BitPCM(event.data)
        })
        listenersBoundRef.current = true
      }

      // Connect to realtime API through relay websocket
      await session.connect({
        apiKey: 'relay-session-token',
        url: RELAY_SERVER_URL,
        model: 'gpt-realtime',
      })

      setConnectionStatus('connected')

      session.sendMessage('Hello!')

      // Check if we're already recording before trying to pause
      if (wavRecorder.recording) {
        await wavRecorder.pause()
      }

      // Check if we're already paused before trying to record
      if (!wavRecorder.recording) {
        await wavRecorder.record((data: { mono: Float32Array }) => {
          session.sendAudio(WavPacker.floatTo16BitPCM(data.mono))
        })
      }
    } catch (error) {
      console.error('Connection error:', error)
      setConnectionStatus('disconnected')
      isConnectedRef.current = false
    }
  }, [RELAY_SERVER_URL])

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
   * Core RealtimeSession and audio capture setup
   * Set all of our instructions, tools, events and more
   */
  useEffect(() => {
    // Only run the effect if there's no error
    if (!errorMessage) {
      connectConversation()
      return () => {
        sessionRef.current?.close()
        isConnectedRef.current = false
      }
    }
  }, [connectConversation, errorMessage])

  useEffect(() => {
    const rightArrowKeyCode = 39
    const intervalMs = 15000

    const onWindowMessage = (event: MessageEvent) => {
      if (event.origin !== COURSE_ORIGIN) return
      const payload = event.data as { type?: string; data?: string }
      if (payload.type === 'response:getContent' && typeof payload.data === 'string') {
        sessionRef.current?.sendMessage(
          `Explain the current new part of the current slide content within 10 seconds: ${payload.data}`,
        )
      } else if (payload.type === 'request:keypress') {
        console.log('Received keypress response from child:', payload.data)
      }
    }

    window.addEventListener('message', onWindowMessage)

    const getIFrameWindow = () => {
      const iframe = iframeRef.current
      if (!iframe) return null
      return iframe.contentWindow
    }

    const triggerRightArrow = () => {
      /**
       * This function simulates a right arrow key press in the iframe to advance to the next slide
       */
      const iFrameWindow = getIFrameWindow()
      if (!iFrameWindow) return

      // simulate a right arrow key press to advance to the next slide
      iFrameWindow.postMessage(
        {
          action: 'keypress',
          key: rightArrowKeyCode,
        },
        COURSE_ORIGIN,
      )
    }

    const intervalId = window.setInterval(triggerRightArrow, intervalMs)
    return () => {
      window.clearInterval(intervalId)
      window.removeEventListener('message', onWindowMessage)
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
