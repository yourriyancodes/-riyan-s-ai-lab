'use client'

import { useCallback, useEffect, useRef, useState } from 'react'
import {
  FaceLandmarker,
  FilesetResolver,
  type FaceLandmarkerResult,
} from '@mediapipe/tasks-vision'

/**
 * RAVEN camera tracking.
 *
 * This component is deliberately non-critical: every failure mode (insecure
 * origin, denied permission, blocked CDN, TFLite GPU delegate failure,
 * detectForVideo throwing mid-stream) degrades to "vision unavailable" without
 * rejecting out of an effect, and without ever claiming a lock it does not have.
 */

export type VisionStatus =
  | 'OFFLINE'
  | 'STARTING'
  | 'SEARCHING'
  | 'LOCKED'
  | 'RECOVERING'
  | 'UNAVAILABLE'
  | 'UNSUPPORTED'

export type RavenVisionProps = {
  enabled: boolean
  onDepthChange: (depth: { x: number; y: number }) => void
  onPresenceChange: (present: boolean) => void
  /** Honest status for HUD/labelling, plus a reason when unavailable. */
  onStatusChange?: (status: VisionStatus, message?: string) => void
  /** Called when vision had to switch itself off after repeated failures. */
  onDisable?: () => void
}

// Keep the WASM build in lockstep with the installed @mediapipe/tasks-vision
// version — a mismatch is what makes TFLite abort at runtime.
const MEDIAPIPE_VERSION = '1.0.1'
const WASM_PATH =
  process.env.NEXT_PUBLIC_MEDIAPIPE_WASM_URL ||
  `https://cdn.jsdelivr.net/npm/@mediapipe/tasks-vision@${MEDIAPIPE_VERSION}/wasm`
const MODEL_PATH =
  process.env.NEXT_PUBLIC_FACE_LANDMARKER_URL ||
  'https://storage.googleapis.com/mediapipe-models/face_landmarker/face_landmarker/float16/1/face_landmarker.task'

const DETECT_INTERVAL_MS = 45 // ~22fps is plenty for gaze
const MAX_CONSECUTIVE_FAILURES = 6
const STALE_AFTER_MS = 2500
const LOG_THROTTLE_MS = 5000

// Guards against two stages opening the same camera (double getUserMedia +
// double TFLite context is a real crash source, and StrictMode double-mounts).
let cameraOwner: symbol | null = null

const describeError = (error: unknown): string => {
  if (!error) return 'Unknown error'
  if (error instanceof DOMException) {
    switch (error.name) {
      case 'NotAllowedError':
      case 'SecurityError':
        return 'Camera permission was denied.'
      case 'NotFoundError':
      case 'OverconstrainedError':
        return 'No usable camera was found.'
      case 'NotReadableError':
        return 'The camera is busy in another application.'
      default:
        return error.message || error.name
    }
  }
  if (error instanceof Error) return error.message
  return String(error)
}

const isNotSupported = () =>
  typeof window === 'undefined' || typeof navigator === 'undefined' || !navigator.mediaDevices?.getUserMedia

const insecureOrigin = () => typeof window !== 'undefined' && window.isSecureContext === false

export default function RavenVision({
  enabled,
  onDepthChange,
  onPresenceChange,
  onStatusChange,
  onDisable,
}: RavenVisionProps) {
  const videoRef = useRef<HTMLVideoElement | null>(null)
  const landmarkerRef = useRef<FaceLandmarker | null>(null)
  const streamRef = useRef<MediaStream | null>(null)
  const loopRef = useRef<number | null>(null)
  const delegateRef = useRef<'GPU' | 'CPU'>('GPU')

  const lastVideoTimeRef = useRef(-1)
  const lastStampRef = useRef(-1)
  const lastDetectAtRef = useRef(0)
  const lastGoodFrameAtRef = useRef(0)
  const failureCountRef = useRef(0)
  const suppressedLogsRef = useRef(0)
  const lastLogAtRef = useRef(0)
  const backoffUntilRef = useRef(0)
  const recoveredWithCpuRef = useRef(false)
  const statusRef = useRef<VisionStatus>('OFFLINE')
  const cancelledRef = useRef(false)
  const mountedRef = useRef(true)

  const callbacksRef = useRef({ onDepthChange, onPresenceChange, onStatusChange, onDisable })
  useEffect(() => {
    callbacksRef.current = { onDepthChange, onPresenceChange, onStatusChange, onDisable }
  })

  const [status, setStatusState] = useState<VisionStatus>('OFFLINE')
  const [message, setMessage] = useState('')

  const setStatus = useCallback((next: VisionStatus, detail?: string) => {
    if (!mountedRef.current) return
    statusRef.current = next
    setStatusState(next)
    setMessage(detail ?? '')
    callbacksRef.current.onStatusChange?.(next, detail)
  }, [])

  const emit = useCallback((depth: { x: number; y: number }, present: boolean) => {
    if (!mountedRef.current) return
    callbacksRef.current.onDepthChange(depth)
    callbacksRef.current.onPresenceChange(present)
  }, [])

  const logFailure = useCallback((label: string, error: unknown) => {
    const now = Date.now()
    if (now - lastLogAtRef.current < LOG_THROTTLE_MS) {
      suppressedLogsRef.current += 1
      return
    }
    if (suppressedLogsRef.current > 0) {
      console.warn(
        `RAVEN vision: ${label} — ${describeError(error)} (suppressed ${suppressedLogsRef.current} similar message${
          suppressedLogsRef.current === 1 ? '' : 's'
        })`,
      )
      suppressedLogsRef.current = 0
    } else {
      console.warn(`RAVEN vision: ${label} — ${describeError(error)}`)
    }
    lastLogAtRef.current = now
  }, [])

  const releaseCamera = useCallback(() => {
    const stream = streamRef.current
    if (stream) {
      for (const track of stream.getTracks()) {
        try {
          track.stop()
        } catch {
          /* already stopped */
        }
      }
      streamRef.current = null
    }
    const video = videoRef.current
    if (video) {
      try {
        video.pause()
      } catch {
        /* ignore */
      }
      video.srcObject = null
    }
  }, [])

  const closeLandmarker = useCallback(() => {
    const landmarker = landmarkerRef.current
    landmarkerRef.current = null
    if (landmarker) {
      try {
        landmarker.close()
      } catch {
        /* already closed */
      }
    }
  }, [])

  const stopLoop = useCallback(() => {
    if (loopRef.current !== null) {
      cancelAnimationFrame(loopRef.current)
      loopRef.current = null
    }
  }, [])

  /** Tear everything down and switch vision off for this session. */
  const teardown = useCallback(
    (finalStatus: VisionStatus, detail: string, notifyParent: boolean) => {
      stopLoop()
      closeLandmarker()
      releaseCamera()
      if (!mountedRef.current) return
      emit({ x: 0, y: 0 }, false)
      setStatus(finalStatus, detail)
      if (notifyParent) callbacksRef.current.onDisable?.()
    },
    [closeLandmarker, emit, releaseCamera, setStatus, stopLoop],
  )

  const tokenRef = useRef<symbol | null>(null)
  const rebuildingRef = useRef(false)

  useEffect(() => {
    mountedRef.current = true
    return () => {
      mountedRef.current = false
      cancelledRef.current = true
      stopLoop()
      closeLandmarker()
      releaseCamera()
      if (cameraOwner === tokenRef.current) cameraOwner = null
      tokenRef.current = null
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [])

  // A failure the user should still be able to read about survives the toggle
  // going back to false; it is cleared when a new attempt starts.
  const statusIsSticky = (value: VisionStatus) => value === 'UNAVAILABLE' || value === 'UNSUPPORTED'

  useEffect(() => {
    if (!enabled) {
      if (statusRef.current !== 'OFFLINE' && !statusIsSticky(statusRef.current)) {
        stopLoop()
        closeLandmarker()
        releaseCamera()
        if (cameraOwner === tokenRef.current) cameraOwner = null
        tokenRef.current = null
        setStatus('OFFLINE')
      }
      return
    }

    if (cameraOwner !== null) {
      // Another stage already owns the camera; stay passive rather than
      // requesting a second stream.
      setStatus('UNSUPPORTED', 'Another RAVEN stage already owns the camera.')
      return
    }

    const token = Symbol('raven-vision')
    tokenRef.current = token
    cameraOwner = token

    cancelledRef.current = false
    failureCountRef.current = 0
    backoffUntilRef.current = 0
    recoveredWithCpuRef.current = false
    delegateRef.current = 'GPU'
    lastGoodFrameAtRef.current = 0

    const handleResult = (result: FaceLandmarkerResult) => {
      const faces = result?.faceLandmarks
      if (!faces?.length) {
        lastGoodFrameAtRef.current = performance.now()
        emit({ x: 0, y: 0 }, false)
        if (statusRef.current !== 'SEARCHING') setStatus('SEARCHING')
        return
      }

      const nose = faces[0]?.[1]
      if (!nose) {
        setStatus('SEARCHING')
        return
      }

      const x = Math.max(-9, Math.min(9, (0.5 - nose.x) * 18))
      const y = Math.max(-6, Math.min(6, (0.5 - nose.y) * 12))
      emit({ x, y }, true)
      lastGoodFrameAtRef.current = performance.now()
      failureCountRef.current = 0
      if (statusRef.current !== 'LOCKED') setStatus('LOCKED')
    }

    const processFrame = () => {
      loopRef.current = null
      if (cancelledRef.current) return

      if (rebuildingRef.current) return

      const video = videoRef.current
      const landmarker = landmarkerRef.current
      if (!video || !landmarker) {
        teardown('UNAVAILABLE', 'Vision session ended unexpectedly.', true)
        if (cameraOwner === token) {
          cameraOwner = null
          tokenRef.current = null
        }
        return
      }

      loopRef.current = requestAnimationFrame(processFrame)

      const now = performance.now()
      if (now < backoffUntilRef.current) return
      if (now - lastDetectAtRef.current < DETECT_INTERVAL_MS) return

      // Never lose the lock silently: a stalled pipeline is not "locked".
      if (statusRef.current === 'LOCKED' && now - lastGoodFrameAtRef.current > STALE_AFTER_MS) {
        setStatus('SEARCHING', 'Tracking paused — looking for a face again.')
      }

      if (
        video.readyState < 2 /* HAVE_CURRENT_DATA */ ||
        video.currentTime === lastVideoTimeRef.current
      ) {
        return
      }

      lastVideoTimeRef.current = video.currentTime
      lastDetectAtRef.current = now

      try {
        // MediaPipe rejects duplicate/rewound timestamps.
        const stamp = Math.max(now, lastStampRef.current + 1)
        lastStampRef.current = stamp
        const result = landmarker.detectForVideo(video, stamp)
        if (result) handleResult(result)
      } catch (error) {
        failureCountRef.current += 1
        logFailure(`frame detection failed (${failureCountRef.current}/${MAX_CONSECUTIVE_FAILURES})`, error)

        // Exponential backoff keeps a broken TFLite pipeline from flooding the
        // main thread and the console.
        const delay = Math.min(700, 150 * 2 ** (failureCountRef.current - 1))
        backoffUntilRef.current = performance.now() + delay
        // A failing delegate is usually a poisoned GPU context: rebuild on CPU
        // once before giving up entirely.
        if (delegateRef.current === 'GPU' && !recoveredWithCpuRef.current) {
          recoveredWithCpuRef.current = true
          closeLandmarker()
          void rebuildWithCpu(error)
          return
        }

        if (failureCountRef.current >= MAX_CONSECUTIVE_FAILURES) {
          teardown(
            'UNAVAILABLE',
            `Camera tracking stopped after ${MAX_CONSECUTIVE_FAILURES} consecutive runtime failures.`,
            true,
          )
          if (cameraOwner === token) {
            cameraOwner = null
            tokenRef.current = null
          }
        }
      }
    }

    const rebuildWithCpu = async (cause: unknown) => {
      rebuildingRef.current = true
      setStatus('RECOVERING', 'Recovering camera tracking on the CPU backend.')
      try {
        const vision = await FilesetResolver.forVisionTasks(WASM_PATH)
        const landmarker = await createLandmarker(vision, 'CPU')
        if (cancelledRef.current) {
          try {
            landmarker.close()
          } catch {
            /* ignore */
          }
          return
        }
        landmarkerRef.current = landmarker
        delegateRef.current = 'CPU'
        rebuildingRef.current = false
        failureCountRef.current = 0
        backoffUntilRef.current = 0
        lastVideoTimeRef.current = -1
        logFailure('recovered on CPU delegate after ' + describeError(cause), null)
        if (statusRef.current !== 'LOCKED') setStatus('SEARCHING')
      } catch (error) {
        rebuildingRef.current = false
        teardown('UNAVAILABLE', 'Camera tracking is unavailable on this device.', true)
        if (cameraOwner === token) {
          cameraOwner = null
          tokenRef.current = null
        }
        logFailure('CPU recovery failed', error)
      }
    }

    const createLandmarker = async (vision: Awaited<ReturnType<typeof FilesetResolver.forVisionTasks>>, delegate: 'GPU' | 'CPU') => {
      const landmarker = await FaceLandmarker.createFromOptions(vision, {
        baseOptions: { modelAssetPath: MODEL_PATH, delegate },
        runningMode: 'VIDEO',
        numFaces: 1,
        minFaceDetectionConfidence: 0.5,
        minFacePresenceConfidence: 0.5,
        minTrackingConfidence: 0.5,
      })
      delegateRef.current = delegate
      return landmarker
    }

    const start = async () => {
      try {
        setStatus('STARTING')
        setMessage('')

        if (isNotSupported()) {
          teardown(
            'UNSUPPORTED',
            insecureOrigin()
              ? 'Camera tracking needs an https or localhost origin on this browser.'
              : 'This browser exposes no camera API (getUserMedia).',
            false,
          )
          return
        }

        const video = videoRef.current
        if (!video) {
          teardown('UNAVAILABLE', 'Camera element is unavailable.', false)
          return
        }

        let stream: MediaStream
        try {
          stream = await navigator.mediaDevices.getUserMedia({
            video: {
              facingMode: 'user',
              width: { ideal: 640 },
              height: { ideal: 480 },
              frameRate: { ideal: 30, max: 30 },
            },
            audio: false,
          })
        } catch (error) {
          teardown('UNAVAILABLE', describeError(error), false)
          return
        }

        if (cancelledRef.current || cameraOwner !== token) {
          for (const track of stream.getTracks()) track.stop()
          return
        }

        streamRef.current = stream
        video.srcObject = stream

        try {
          if (video.readyState < 1) {
            await new Promise<void>((resolve) => {
              const done = () => resolve()
              video.addEventListener('loadedmetadata', done, { once: true })
              window.setTimeout(done, 3000)
            })
          }
          await video.play()
        } catch (error) {
          // AbortError from a re-entrant play() is harmless; anything else is not.
          if ((error as DOMException)?.name !== 'AbortError') {
            teardown('UNAVAILABLE', 'The camera stream could not be started.', false)
            return
          }
        }

        let vision: Awaited<ReturnType<typeof FilesetResolver.forVisionTasks>>
        try {
          vision = await FilesetResolver.forVisionTasks(WASM_PATH)
        } catch (error) {
          logFailure('MediaPipe WASM could not be loaded', error)
          teardown('UNAVAILABLE', 'The vision runtime could not be downloaded (offline or blocked CDN).', false)
          return
        }

        let landmarker: FaceLandmarker
        try {
          landmarker = await createLandmarker(vision, 'GPU')
        } catch (gpuError) {
          logFailure('GPU delegate unavailable, falling back to CPU', gpuError)
          setStatus('RECOVERING', 'GPU delegate unavailable — starting the CPU backend.')
          try {
            landmarker = await createLandmarker(vision, 'CPU')
          } catch (cpuError) {
            logFailure('CPU delegate also failed', cpuError)
            teardown('UNAVAILABLE', 'Camera tracking is unavailable on this device.', false)
            return
          }
        }

        if (cancelledRef.current || cameraOwner !== token) {
          try {
            landmarker.close()
          } catch {
            /* ignore */
          }
          releaseCamera()
          return
        }

        landmarkerRef.current = landmarker
        if (cancelledRef.current) return
        setStatus('SEARCHING')
        lastGoodFrameAtRef.current = performance.now()
        if (loopRef.current === null) loopRef.current = requestAnimationFrame(processFrame)
      } catch (error) {
        // Nothing below may throw out of an effect: the app must keep running.
        logFailure('initialization failed', error)
        teardown('UNAVAILABLE', 'Camera tracking could not start.', false)
      }
    }

    void start()

    return () => {
      cancelledRef.current = true
      stopLoop()
      closeLandmarker()
      releaseCamera()
      if (cameraOwner === token) {
        cameraOwner = null
        tokenRef.current = null
      }
      if (mountedRef.current) {
        emit({ x: 0, y: 0 }, false)
        if (!statusIsSticky(statusRef.current)) setStatus('OFFLINE')
      }
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [enabled])

  const label =
    status === 'LOCKED'
      ? 'VISION: ACTIVE (FACE LOCKED)'
      : status === 'SEARCHING'
        ? 'VISION: SEARCHING FOR FACE'
        : status === 'STARTING'
          ? 'REQUESTING CAMERA'
          : status === 'RECOVERING'
            ? 'VISION: RECOVERING'
            : status === 'UNSUPPORTED'
              ? 'VISION UNSUPPORTED'
              : status === 'UNAVAILABLE'
                ? 'VISION UNAVAILABLE'
                : 'VISION OFFLINE'

  return (
    <>
      <video
        ref={videoRef}
        className="raven-vision-video hidden"
        playsInline
        muted
        autoPlay
        aria-hidden="true"
      />

      <div
        className={`raven-vision-indicator vision-${status.toLowerCase()}`}
        aria-live="polite"
        data-vision-status={status}
      >
        <span className="raven-vision-dot" />
        <span>{label}</span>

        {message ? <span className="raven-vision-error">{message}</span> : null}
      </div>
    </>
  )
}
