'use client'

import { useEffect, useRef, useState } from 'react'
import {
  FaceLandmarker,
  FilesetResolver,
  type FaceLandmarkerResult,
} from '@mediapipe/tasks-vision'

type RavenVisionProps = {
  enabled: boolean
  onDepthChange: (depth: { x: number; y: number }) => void
  onPresenceChange: (present: boolean) => void
}

const WASM_PATH =
  'https://cdn.jsdelivr.net/npm/@mediapipe/tasks-vision@1.0.1/wasm'

const MODEL_PATH =
  'https://storage.googleapis.com/mediapipe-models/face_landmarker/face_landmarker/float16/1/face_landmarker.task'

export default function RavenVision({
  enabled,
  onDepthChange,
  onPresenceChange,
}: RavenVisionProps) {
  const videoRef = useRef<HTMLVideoElement | null>(null)
  const landmarkerRef = useRef<FaceLandmarker | null>(null)
  const streamRef = useRef<MediaStream | null>(null)
  const animationRef = useRef<number | null>(null)
  const lastVideoTimeRef = useRef(-1)
  const runningRef = useRef(false)

  const [status, setStatus] = useState<
    'OFFLINE' | 'STARTING' | 'SEARCHING' | 'LOCKED' | 'ERROR' | 'UNSUPPORTED'
  >('OFFLINE')
  const [errorMessage, setErrorMessage] = useState('')

  useEffect(() => {
    if (!enabled) {
      stopVision()
      return
    }

    let cancelled = false

    const start = async () => {
      try {
        setStatus('STARTING')
        setErrorMessage('')

        const video = videoRef.current
        if (!video) throw new Error('Camera element is unavailable.')

        if (!navigator.mediaDevices?.getUserMedia) {
          setStatus('UNSUPPORTED')
          throw new Error('Camera vision is not supported by this browser.')
        }

        const stream = await navigator.mediaDevices.getUserMedia({
          video: {
            facingMode: 'user',
            width: { ideal: 640 },
            height: { ideal: 480 },
            frameRate: { ideal: 30, max: 30 },
          },
          audio: false,
        })

        if (cancelled) {
          stream.getTracks().forEach((track) => track.stop())
          return
        }

        streamRef.current = stream
        video.srcObject = stream
        await video.play()

        const vision = await FilesetResolver.forVisionTasks(WASM_PATH)

        let landmarker: FaceLandmarker

        try {
          landmarker = await FaceLandmarker.createFromOptions(vision, {
 baseOptions: {
              modelAssetPath: MODEL_PATH,
              delegate: 'GPU',
            },
            runningMode: 'VIDEO',
            numFaces: 1,
            minFaceDetectionConfidence: 0.5,
            minFacePresenceConfidence: 0.5,
            minTrackingConfidence: 0.5,
          })
        } catch (gpuError) {
          console.warn('RAVEN vision GPU unavailable, falling back to CPU.', gpuError)

          landmarker = await FaceLandmarker.createFromOptions(vision, {
            baseOptions: {
              modelAssetPath: MODEL_PATH,
              delegate: 'CPU',
            },
            runningMode: 'VIDEO',
            numFaces: 1,
            minFaceDetectionConfidence: 0.5,
            minFacePresenceConfidence: 0.5,
            minTrackingConfidence: 0.5,
          })
        }

        if (cancelled) {
          landmarker.close()
          return
        }

        landmarkerRef.current = landmarker
        runningRef.current = true
        setStatus('SEARCHING')
        processFrame()
      } catch (error) {
        console.error('RAVEN vision initialization failed:', error)
        if (!cancelled) {
          setStatus(status === 'UNSUPPORTED' ? 'UNSUPPORTED' : 'ERROR')
          setErrorMessage(
            error instanceof Error
              ? error.message
              : 'Unable to initialize camera vision.',
          )
          onPresenceChange(false)
        }
      }
    }

    const handleResult = (result: FaceLandmarkerResult) => {
      const faces = result.faceLandmarks

      if (!faces?.length) {
        onPresenceChange(false)
        setStatus('SEARCHING')
        onDepthChange({ x: 0, y: 0 })
        return
      }

      const nose = faces[0]?.[1]
      if (!nose) return

      const x = Math.max(-9, Math.min(9, (0.5 - nose.x) * 18))
      const y = Math.max(-6, Math.min(6, (0.5 - nose.y) * 12))

      onDepthChange({ x, y })
      onPresenceChange(true)
      setStatus('LOCKED')
    }

    const processFrame = () => {
      if (cancelled || !runningRef.current) return

      const video = videoRef.current
      const landmarker = landmarkerRef.current

      if (
        video &&
        landmarker &&
        video.readyState >= HTMLMediaElement.HAVE_CURRENT_DATA &&
        video.currentTime !== lastVideoTimeRef.current
      ) {
        lastVideoTimeRef.current = video.currentTime
        try {
          const result = landmarker.detectForVideo(video, performance.now())
          if (result) handleResult(result)
        } catch (err) {
          // Frame skip handling so dropped detection frame never crashes app
          console.warn('RAVEN vision frame dropped:', err)
        }
      }

      animationRef.current = requestAnimationFrame(processFrame)
    }

    start()

    return () => {
      cancelled = true
      stopVision()
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [enabled])

  function stopVision() {
    runningRef.current = false

    if (animationRef.current !== null) {
      cancelAnimationFrame(animationRef.current)
      animationRef.current = null
    }

    if (landmarkerRef.current) {
      try {
        landmarkerRef.current.close()
      } catch {
        // Ignore already closed landmarker
      }
      landmarkerRef.current = null
    }

    if (streamRef.current) {
      streamRef.current.getTracks().forEach((track) => track.stop())
      streamRef.current = null
    }

    if (videoRef.current) {
      videoRef.current.pause()
      videoRef.current.srcObject = null
    }

    onPresenceChange(false)
    onDepthChange({ x: 0, y: 0 })
    setStatus('OFFLINE')
  }

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
      >
        <span className="raven-vision-dot" />
        <span>
          {status === 'LOCKED'
            ? 'VISION: ACTIVE (FACE LOCKED)'
            : status === 'SEARCHING'
              ? 'VISION: SEARCHING FOR FACE'
              : status === 'STARTING'
                ? 'REQUESTING CAMERA'
                : status === 'UNSUPPORTED'
                  ? 'VISION UNSUPPORTED'
                  : status === 'ERROR'
                    ? 'VISION ERROR'
                    : 'VISION OFFLINE'}
        </span>

        {status === 'ERROR' && errorMessage ? (
          <span className="raven-vision-error">{errorMessage}</span>
        ) : null}
      </div>
    </>
  )
}
