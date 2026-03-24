'use client'

import React, { useEffect, useRef, useState } from 'react'
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
}> = ({ mode, onSessionStopped, textToSpeak, onSpeakingDone }) => {
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

  useEffect(() => {
    if (!isStreamReady) return
    const interval = setInterval(() => {
      keepAlive()
    }, 30000)
    return () => clearInterval(interval)
  }, [isStreamReady, keepAlive])

  useEffect(() => {
    if (sessionState === SessionState.INACTIVE) {
      startSession()
    }
  }, [startSession, sessionState])

  useEffect(() => {
    if (textToSpeak && isStreamReady) {
      repeat(textToSpeak)
    }
  }, [textToSpeak, isStreamReady, repeat])

  const wasTalkingRef = useRef(false)
  useEffect(() => {
    if (isAvatarTalking) {
      wasTalkingRef.current = true
    } else if (wasTalkingRef.current) {
      wasTalkingRef.current = false
      onSpeakingDone?.()
    }
  }, [isAvatarTalking, onSpeakingDone])

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
}> = ({ mode, sessionAccessToken, onSessionStopped, voiceChatConfig = true, textToSpeak, onSpeakingDone }) => {
  return (
    <LiveAvatarContextProvider sessionAccessToken={sessionAccessToken} voiceChatConfig={voiceChatConfig}>
      <LiveAvatarSessionComponent
        mode={mode}
        onSessionStopped={onSessionStopped}
        textToSpeak={textToSpeak}
        onSpeakingDone={onSpeakingDone}
      />
    </LiveAvatarContextProvider>
  )
}
