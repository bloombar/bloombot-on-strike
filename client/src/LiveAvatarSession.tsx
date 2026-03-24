'use client'

import React, { useCallback, useEffect, useRef, useState } from 'react'
import { LiveAvatarContextProvider, useSession, useTextChat, useVoiceChat, useChatHistory } from './liveavatar'
import { SessionState, VoiceChatConfig } from '@heygen/liveavatar-web-sdk'
import { useAvatarActions } from './liveavatar/useAvatarActions'
import { SessionMode } from './LiveAvatarDemo'

const StatusDot: React.FC<{ active: boolean; label: string }> = ({ active, label }) => (
  <div className="flex items-center gap-1.5 text-xs text-gray-400">
    <div className={`w-2 h-2 rounded-full ${active ? 'bg-green-400' : 'bg-gray-600'}`} />
    {label}
  </div>
)

const ActionButton: React.FC<{
  onClick: () => void
  disabled?: boolean
  variant?: 'primary' | 'secondary' | 'danger'
  size?: 'sm' | 'md'
  children: React.ReactNode
}> = ({ onClick, disabled, variant = 'secondary', size = 'md', children }) => {
  const base = 'font-medium rounded-lg transition-all disabled:opacity-40 disabled:cursor-not-allowed'
  const sizes = {
    sm: 'px-4 py-2 text-sm',
    md: 'px-5 py-2.5 text-sm',
  }
  const variants = {
    primary: 'bg-white text-black hover:bg-gray-100 active:bg-gray-200',
    secondary: 'bg-white/10 text-white border border-white/10 hover:bg-white/15 active:bg-white/20',
    danger: 'bg-red-500/10 text-red-400 border border-red-500/20 hover:bg-red-500/20 active:bg-red-500/30',
  }

  return (
    <button onClick={onClick} disabled={disabled} className={`${base} ${sizes[size]} ${variants[variant]}`}>
      {children}
    </button>
  )
}

const LiveAvatarSessionComponent: React.FC<{
  mode: SessionMode
  onSessionStopped: () => void
  textToSpeak?: string
  onSpeakingDone?: () => void
  isReconnect?: boolean
}> = ({ mode, onSessionStopped, textToSpeak, onSpeakingDone, isReconnect }) => {
  const [message, setMessage] = useState('')
  const { sessionState, isStreamReady, startSession, stopSession, connectionQuality, keepAlive, attachElement } =
    useSession()
  const {
    isAvatarTalking,
    isUserTalking,
    isMuted,
    isActive,
    isLoading,
    start,
    stop,
    mute,
    unmute,
    startPushToTalk,
    stopPushToTalk,
    error: voiceChatError,
  } = useVoiceChat()

  const avatarActionsMode = mode === 'FULL_PTT' ? 'FULL' : mode
  const { interrupt, repeat, startListening, stopListening } = useAvatarActions(avatarActionsMode)

  const textChatMode = mode === 'FULL_PTT' ? 'FULL' : mode
  const { sendMessage } = useTextChat(textChatMode)
  const chatMessages = useChatHistory()
  const videoRef = useRef<HTMLVideoElement>(null)
  const chatEndRef = useRef<HTMLDivElement>(null)
  const [videoHeight, setVideoHeight] = useState<number>(0)
  const hasConnectedRef = useRef(false)

  useEffect(() => {
    if (sessionState !== SessionState.DISCONNECTED) {
      hasConnectedRef.current = true
    } else if (hasConnectedRef.current) {
      onSessionStopped()
    }
  }, [sessionState, onSessionStopped])

  useEffect(() => {
    chatEndRef.current?.scrollIntoView({ behavior: 'smooth' })
  }, [chatMessages])

  useEffect(() => {
    const el = videoRef.current
    if (!el) return
    const observer = new ResizeObserver((entries) => {
      for (const entry of entries) {
        setVideoHeight(entry.contentRect.height)
      }
    })
    observer.observe(el)
    return () => observer.disconnect()
  }, [isStreamReady])

  useEffect(() => {
    if (isStreamReady && videoRef.current) {
      attachElement(videoRef.current)
    }
  }, [attachElement, isStreamReady])

  const triggerRecovery = useCallback(() => {
    if (hasConnectedRef.current) {
      hasConnectedRef.current = false
      console.log('Session not connected, triggering recovery...')
      onSessionStopped()
    }
  }, [onSessionStopped])

  useEffect(() => {
    if (!isStreamReady) return
    const interval = setInterval(async () => {
      try {
        await keepAlive()
      } catch {
        triggerRecovery()
      }
    }, 30000)
    return () => clearInterval(interval)
  }, [isStreamReady, keepAlive, triggerRecovery])

  useEffect(() => {
    if (sessionState === SessionState.INACTIVE) {
      startSession()
    }
  }, [startSession, sessionState])

  const lastSpokenRef = useRef('')
  const welcomeHandledRef = useRef(isReconnect ? true : false)
  useEffect(() => {
    if (textToSpeak && isStreamReady && textToSpeak !== lastSpokenRef.current) {
      lastSpokenRef.current = textToSpeak
      try {
        repeat(textToSpeak)
      } catch {
        triggerRecovery()
      }
    }
  }, [textToSpeak, isStreamReady, repeat, triggerRecovery])

  // On reconnect, re-speak the current textToSpeak once the stream is ready
  useEffect(() => {
    if (isReconnect && isStreamReady && textToSpeak) {
      lastSpokenRef.current = textToSpeak
      try {
        repeat(textToSpeak)
      } catch {
        triggerRecovery()
      }
    }
  }, [isReconnect, isStreamReady, triggerRecovery])

  const wasTalkingRef = useRef(false)
  useEffect(() => {
    if (isAvatarTalking) {
      wasTalkingRef.current = true
    } else if (wasTalkingRef.current) {
      wasTalkingRef.current = false
      if (!welcomeHandledRef.current) {
        // This is the welcome message finishing — skip calling onSpeakingDone on reconnect
        welcomeHandledRef.current = true
        if (!isReconnect) {
          onSpeakingDone?.()
        }
        return
      }
      onSpeakingDone?.()
    }
  }, [isAvatarTalking, onSpeakingDone, isReconnect])

  const qualityColor =
    connectionQuality === 'GOOD' ? 'text-green-400' : connectionQuality === 'BAD' ? 'text-red-400' : 'text-gray-500'

  return <video ref={videoRef} autoPlay playsInline style={{ width: '100%', height: '100%', objectFit: 'cover' }} />
}

export const LiveAvatarSession: React.FC<{
  mode: SessionMode
  sessionAccessToken: string
  onSessionStopped: () => void
  voiceChatConfig?: boolean | VoiceChatConfig
  textToSpeak?: string
  onSpeakingDone?: () => void
  isReconnect?: boolean
}> = ({
  mode,
  sessionAccessToken,
  onSessionStopped,
  voiceChatConfig = true,
  textToSpeak,
  onSpeakingDone,
  isReconnect,
}) => {
  return (
    <LiveAvatarContextProvider sessionAccessToken={sessionAccessToken} voiceChatConfig={voiceChatConfig}>
      <LiveAvatarSessionComponent
        mode={mode}
        onSessionStopped={onSessionStopped}
        textToSpeak={textToSpeak}
        onSpeakingDone={onSpeakingDone}
        isReconnect={isReconnect}
      />
    </LiveAvatarContextProvider>
  )
}
