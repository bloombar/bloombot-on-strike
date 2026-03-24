import { useCallback } from 'react'
import { SessionState } from '@heygen/liveavatar-web-sdk'
import { useLiveAvatarContext } from './context'

export const useSession = () => {
  const { sessionRef, sessionState, isStreamReady, connectionQuality } = useLiveAvatarContext()

  const startSession = useCallback(async () => {
    const liveState = sessionRef.current?.state ?? sessionState
    if (liveState !== SessionState.INACTIVE && liveState !== SessionState.DISCONNECTED) {
      return
    }
    return await sessionRef.current.start()
  }, [sessionRef, sessionState])

  const stopSession = useCallback(async () => {
    return await sessionRef.current.stop()
  }, [sessionRef])

  const keepAlive = useCallback(async () => {
    return await sessionRef.current.keepAlive()
  }, [sessionRef])

  const attachElement = useCallback(
    (element: HTMLMediaElement) => {
      return sessionRef.current.attach(element)
    },
    [sessionRef],
  )

  return {
    sessionState,
    isStreamReady,
    connectionQuality,
    startSession,
    stopSession,
    keepAlive,
    attachElement,
  }
}
