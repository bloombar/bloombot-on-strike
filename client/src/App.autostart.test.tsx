import { StrictMode, type ReactElement } from 'react'
import { act, cleanup, fireEvent, render, screen } from '@testing-library/react'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'

// Controlled stand-in for the relay websocket: tests flip `ws.readyState` and re-render.
// `connection` counts socket opens, and each sent message is logged with the connection it went out on, because the
// relay keeps handshake state per connection.
const ws = vi.hoisted(() => ({
  readyState: 1,
  connection: 0,
  log: [] as { type: string; conn: number }[],
  sendJsonMessage: vi.fn(),
}))

vi.mock('react-use-websocket', () => ({
  default: () => ({ sendJsonMessage: ws.sendJsonMessage, lastJsonMessage: null, readyState: ws.readyState }),
  ReadyState: { CONNECTING: 0, OPEN: 1, CLOSING: 2, CLOSED: 3, UNINSTANTIATED: -1 },
}))
vi.mock('./LiveAvatarSession', () => ({ LiveAvatarSession: () => <div data-testid="session" /> }))

import { App } from './App'

const OPEN = 1
const CONNECTING = 0

const sentTypes = () => ws.log.map((m) => m.type)
const tokenRequests = () => sentTypes().filter((t) => t === 'request_liveavatar_token').length

/** Simulate the slide deck iframe replying to getMarkdownSource. */
const deliverSlides = () =>
  act(() => {
    window.dispatchEvent(
      new MessageEvent('message', { data: { type: 'response:getMarkdownSource', data: '# slides' } }),
    )
  })

const advance = (ms: number) =>
  act(() => {
    vi.advanceTimersByTime(ms)
  })

const strict = (ui: ReactElement) => <StrictMode>{ui}</StrictMode>

const setSocket = (readyState: number) => {
  if (readyState === OPEN && ws.readyState !== OPEN) ws.connection += 1
  ws.readyState = readyState
}

const mount = (query: string, readyState = OPEN) => {
  window.history.replaceState({}, '', `/?wss=wss://relay.example:8001${query}`)
  setSocket(readyState)
  const utils = render(
    <StrictMode>
      <App />
    </StrictMode>,
  )
  return utils
}

beforeEach(() => {
  vi.useFakeTimers()
  ws.log = []
  ws.connection = 0
  ws.readyState = CONNECTING
  ws.sendJsonMessage.mockReset()
  ws.sendJsonMessage.mockImplementation((m: { type: string }) => ws.log.push({ type: m.type, conn: ws.connection }))
  vi.spyOn(console, 'log').mockImplementation(() => {})
  // jsdom does not implement cross-origin iframe postMessage replies; the deck's answer is simulated by deliverSlides
  vi.spyOn(HTMLIFrameElement.prototype, 'contentWindow', 'get').mockReturnValue({
    postMessage: vi.fn(),
  } as unknown as Window)
})

afterEach(() => {
  cleanup()
  vi.useRealTimers()
  vi.restoreAllMocks()
})

describe('autostart', () => {
  it('a: does nothing without the autostart param', () => {
    mount('')
    deliverSlides()
    advance(120_000)
    expect(sentTypes()).toContain('handshake')
    expect(tokenRequests()).toBe(0)
  })

  it('a: treats non-truthy values as off', () => {
    mount('&autostart=0')
    deliverSlides()
    advance(120_000)
    expect(tokenRequests()).toBe(0)
  })

  it('b: starts exactly once, after the default 3s delay (rendered inside StrictMode)', () => {
    const { rerender } = mount('&autostart=1')
    advance(10_000)
    expect(tokenRequests()).toBe(0) // slides not loaded yet
    deliverSlides()
    advance(2_900)
    expect(tokenRequests()).toBe(0)
    advance(200)
    expect(tokenRequests()).toBe(1)
    advance(30_000)
    rerender(
      <StrictMode>
        <App />
      </StrictMode>,
    )
    deliverSlides()
    advance(30_000)
    expect(tokenRequests()).toBe(1)
  })

  it('b: accepts TRUE and yes case-insensitively', () => {
    mount('&autostart=TRUE&autostart_delay=0')
    deliverSlides()
    advance(10)
    expect(tokenRequests()).toBe(1)
  })

  it('c: honours a decimal delay', () => {
    mount('&autostart=1&autostart_delay=0.5')
    deliverSlides()
    advance(400)
    expect(tokenRequests()).toBe(0)
    advance(200)
    expect(tokenRequests()).toBe(1)
  })

  it('c: falls back to 3s for a non-numeric delay', () => {
    mount('&autostart=1&autostart_delay=abc')
    deliverSlides()
    advance(2_900)
    expect(tokenRequests()).toBe(0)
    advance(200)
    expect(tokenRequests()).toBe(1)
  })

  it('c: clamps the delay to 60s', () => {
    mount('&autostart=1&autostart_delay=999')
    deliverSlides()
    advance(59_000)
    expect(tokenRequests()).toBe(0)
    advance(1_500)
    expect(tokenRequests()).toBe(1)
  })

  it('d: waits for the websocket to be OPEN, then starts after the delay', () => {
    const { rerender } = mount('&autostart=1', CONNECTING)
    deliverSlides()
    advance(60_000)
    expect(tokenRequests()).toBe(0)
    setSocket(OPEN)
    rerender(
      <StrictMode>
        <App />
      </StrictMode>,
    )
    advance(2_900)
    expect(tokenRequests()).toBe(0)
    advance(200)
    expect(tokenRequests()).toBe(1)
  })

  it('d: a websocket drop during the delay cancels, and re-arms once open again, still one start', () => {
    const { rerender } = mount('&autostart=1')
    deliverSlides()
    advance(2_000)
    setSocket(CONNECTING)
    rerender(
      <StrictMode>
        <App />
      </StrictMode>,
    )
    advance(10_000)
    expect(tokenRequests()).toBe(0)
    setSocket(OPEN)
    rerender(
      <StrictMode>
        <App />
      </StrictMode>,
    )
    advance(3_100)
    expect(tokenRequests()).toBe(1)
    advance(60_000)
    expect(tokenRequests()).toBe(1)
  })

  it('d: after the start, a websocket drop and reopen never starts a second session', () => {
    // fails if autostartDoneRef is dropped: the reopen re-arms the timer
    const { rerender } = mount('&autostart=1')
    deliverSlides()
    advance(3_100)
    expect(tokenRequests()).toBe(1)
    setSocket(CONNECTING)
    rerender(strict(<App />))
    setSocket(OPEN)
    rerender(strict(<App />))
    advance(60_000)
    expect(tokenRequests()).toBe(1)
  })

  it('d: a drop and reopen inside the delay re-handshakes on the new connection before the token request', () => {
    const { rerender } = mount('&autostart=1')
    deliverSlides()
    advance(1_000)
    setSocket(CONNECTING)
    rerender(strict(<App />))
    advance(1_000)
    setSocket(OPEN) // relay restarted: a fresh connection that has not seen our handshake
    rerender(strict(<App />))
    advance(3_100)
    const handshakeOnNew = ws.log.findIndex((m) => m.type === 'handshake' && m.conn === 2)
    const token = ws.log.findIndex((m) => m.type === 'request_liveavatar_token')
    expect(handshakeOnNew).toBeGreaterThanOrEqual(0)
    expect(handshakeOnNew).toBeLessThan(token)
    expect(ws.log[token].conn).toBe(2)
    expect(tokenRequests()).toBe(1)
  })

  it('e: a manual Start click during the delay leaves exactly one token request', () => {
    mount('&autostart=1')
    deliverSlides()
    advance(1_000)
    fireEvent.click(screen.getByText('Start'))
    expect(tokenRequests()).toBe(1)
    advance(60_000)
    expect(tokenRequests()).toBe(1)
  })

  it('f: sends the handshake before the token request', () => {
    mount('&autostart=1')
    deliverSlides()
    advance(4_000)
    const types = sentTypes()
    expect(types.indexOf('handshake')).toBeGreaterThanOrEqual(0)
    expect(types.indexOf('handshake')).toBeLessThan(types.indexOf('request_liveavatar_token'))
  })
})
