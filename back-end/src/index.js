import cors from 'cors'
import dotenv from 'dotenv'
import express from 'express'
import { KJUR } from 'jsrsasign'
import { inNumberArray, isBetween, isRequiredAllOrNone, validateRequest } from './validations.js'

dotenv.config()
const app = express()
const port = process.env.SERVER_PORT || 4000

app.use(express.json(), cors())
app.options('*', cors())

const propValidations = {
  role: inNumberArray([0, 1]),
  expirationSeconds: isBetween(1800, 172800),
  videoWebRtcMode: inNumberArray([0, 1])
}

const schemaValidations = [isRequiredAllOrNone(['meetingNumber', 'role'])]

const coerceRequestBody = (body) => ({
  ...body,
  ...['role', 'expirationSeconds', 'videoWebRtcMode'].reduce(
    (acc, cur) => ({ ...acc, [cur]: typeof body[cur] === 'string' ? parseInt(body[cur]) : body[cur] }),
    {}
  )
})

app.post('/', (req, res) => {
  /**
   * Authorization endpoint for Zoom meeting join.
   * Request body should include:
   * {
   *   meetingNumber: string | number (required)
   *   role: 0 for attendee, 1 for host (required)
   *   expirationSeconds: number of seconds after which the signature expires, between 1800 and 172800 (optional, defaults to 2 hours)
   *   videoWebRtcMode: 0 for default Zoom video, 1 for WebRTC video (optional, defaults to 0)
   * }
   */

  const requestBody = coerceRequestBody(req.body)
  const validationErrors = validateRequest(requestBody, propValidations, schemaValidations)

  if (validationErrors.length > 0) {
    return res.status(400).json({ errors: validationErrors })
  }

  const { meetingNumber, role, expirationSeconds, videoWebRtcMode } = requestBody
  const iat = Math.floor(Date.now() / 1000)
  const exp = expirationSeconds ? iat + expirationSeconds : iat + 60 * 60 * 2
  const oHeader = { alg: 'HS256', typ: 'JWT' }

  const oPayload = {
    appKey: process.env.ZOOM_OAUTH_CLIENT_ID,
    sdkKey: process.env.ZOOM_OAUTH_CLIENT_ID,
    mn: meetingNumber,
    role,
    iat,
    exp,
    tokenExp: exp,
    video_webrtc_mode: videoWebRtcMode
  }

  const sHeader = JSON.stringify(oHeader)
  const sPayload = JSON.stringify(oPayload)
  const sdkJWT = KJUR.jws.JWS.sign('HS256', sHeader, sPayload, process.env.ZOOM_OAUTH_CLIENT_SECRET)
  return res.json({ signature: sdkJWT, sdkKey: process.env.ZOOM_OAUTH_CLIENT_ID })
})

app.post('/api/chat', (req, res) => {
  console.log(`Received chat event: ${JSON.stringify(req.body)}`)

  try {
    // ensureParentDirectory(config.chatLogPath)

    const body = req.body || {}
    const payload = {
      recordedAt: new Date().toISOString(),
      meetingNumber: body.meetingNumber || process.env.ZOOM_MEETING_NUMBER || null,
      event: body.event || 'onReceiveChatMsg',
      sender: body.sender || body.displayName || body.userName || body.name || null,
      recipient: body.recipient || body.toContact || body.receiver || body.to || null,
      message: body.message || body.text || body.msgBody || body.content || null,
      raw: body.raw || body
    }

    console.log('Received chat message event:', JSON.stringify(payload))

    // appendLine(config.chatLogPath, payload)
    return res.status(202).json({ accepted: true })
  } catch (error) {
    return res.status(500).json({ error: error.message || 'Failed to write chat message' })
  }
})

app.listen(port, () => console.log(`Zoom Meeting SDK Auth Endpoint Sample Node.js, listening on port ${port}!`))
