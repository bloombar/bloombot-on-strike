import { StrictMode, useContext } from 'react'
import { act, cleanup, render } from '@testing-library/react'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { SessionDisconnectReason, SessionEvent, SessionState } from '@heygen/liveavatar-web-sdk'
import { LiveAvatarContext, LiveAvatarContextProvider } from './context'

// Fake SDK: real enums, fake session. `created` records every construction.
const created = vi.hoisted(() => [] as unknown[])

// Minimal emitter (no @types/node in the app tsconfig). Like Node's EventEmitter it keeps
// duplicate registrations: emit calls each one, off removes a single one.
const Emitter = vi.hoisted(
  () =>
    class Emitter {
      private handlers = new Map<string, Array<(...args: unknown[]) => void>>()
      on(event: string, fn: (...args: unknown[]) => void) {
        this.handlers.set(event, [...(this.handlers.get(event) ?? []), fn])
        return this
      }
      off(event: string, fn: (...args: unknown[]) => void) {
        const list = [...(this.handlers.get(event) ?? [])]
        const i = list.lastIndexOf(fn)
        if (i >= 0) list.splice(i, 1)
        this.handlers.set(event, list)
        return this
      }
      emit(event: string, ...args: unknown[]) {
        ;[...(this.handlers.get(event) ?? [])].forEach((fn) => fn(...args))
      }
      listenerCount(event: string) {
        return this.handlers.get(event)?.length ?? 0
      }
      removeAllListeners() {
        this.handlers.clear()
        return this
      }
    },
)
type EventEmitter = InstanceType<typeof Emitter>

vi.mock('@heygen/liveavatar-web-sdk', async () => {
  const actual = await vi.importActual<typeof import('@heygen/liveavatar-web-sdk')>('@heygen/liveavatar-web-sdk')
  class FakeVoiceChat extends Emitter {
    state = 'INACTIVE'
  }
  class LiveAvatarSession extends Emitter {
    state = 'INACTIVE'
    connectionQuality = 'UNKNOWN'
    voiceChat = new FakeVoiceChat()
    constructor() {
      super()
      created.push(this)
    }
    // Real API is on/off/removeAllListeners; EventEmitter provides all three.
  }
  return { ...actual, LiveAvatarSession }
})

type Ctx = React.ContextType<typeof LiveAvatarContext>

const Probe = ({ onCtx }: { onCtx: (ctx: Ctx) => void }) => {
  onCtx(useContext(LiveAvatarContext))
  return null
}

const setup = (strict: boolean) => {
  let ctx!: Ctx
  const ui = (label: string) => {
    const tree = (
      <LiveAvatarContextProvider sessionAccessToken="tok">
        <Probe onCtx={(c) => (ctx = c)} />
        <span>{label}</span>
      </LiveAvatarContextProvider>
    )
    return strict ? <StrictMode>{tree}</StrictMode> : tree
  }
  const view = render(ui('0'))
  return { view, ui, getCtx: () => ctx }
}

const session = (ctx: Ctx) => ctx.sessionRef.current as unknown as EventEmitter

describe('LiveAvatarContextProvider', () => {
  beforeEach(() => {
    created.length = 0
  })
  afterEach(() => {
    cleanup()
    vi.restoreAllMocks()
  })

  it('constructs one session per mounted instance across re-renders', () => {
    const { view, ui, getCtx } = setup(false)
    const first = getCtx().sessionRef.current
    for (let i = 1; i <= 4; i++) view.rerender(ui(String(i)))
    expect(created).toHaveLength(1)
    expect(getCtx().sessionRef.current).toBe(first)
  })

  it('keeps the same session across re-renders under StrictMode', () => {
    const { view, ui, getCtx } = setup(true)
    const first = getCtx().sessionRef.current
    for (let i = 1; i <= 4; i++) view.rerender(ui(String(i)))
    expect(created.length).toBeLessThanOrEqual(2)
    expect(getCtx().sessionRef.current).toBe(first)
  })

  it('logs a disconnect reason exactly once under StrictMode', () => {
    const warn = vi.spyOn(console, 'warn').mockImplementation(() => {})
    const { getCtx } = setup(true)
    act(() => {
      session(getCtx()).emit(SessionEvent.SESSION_DISCONNECTED, SessionDisconnectReason.SESSION_START_FAILED)
    })
    expect(warn).toHaveBeenCalledTimes(1)
    expect(warn).toHaveBeenCalledWith('LiveAvatar session disconnected:', SessionDisconnectReason.SESSION_START_FAILED)
  })

  it('removes the disconnect listener on unmount', () => {
    const warn = vi.spyOn(console, 'warn').mockImplementation(() => {})
    const { view, getCtx } = setup(false)
    const s = session(getCtx())
    expect(s.listenerCount(SessionEvent.SESSION_DISCONNECTED)).toBe(1)
    view.unmount()
    expect(s.listenerCount(SessionEvent.SESSION_DISCONNECTED)).toBe(0)
    s.emit(SessionEvent.SESSION_DISCONNECTED, SessionDisconnectReason.SESSION_START_FAILED)
    expect(warn).not.toHaveBeenCalled()
  })

  it('reflects state changes and stream readiness in context', () => {
    const { getCtx } = setup(false)
    expect(getCtx().isStreamReady).toBe(false)
    act(() => {
      session(getCtx()).emit(SessionEvent.SESSION_STATE_CHANGED, SessionState.CONNECTED)
    })
    expect(getCtx().sessionState).toBe(SessionState.CONNECTED)
    act(() => {
      session(getCtx()).emit(SessionEvent.SESSION_STREAM_READY)
    })
    expect(getCtx().isStreamReady).toBe(true)
  })
})
