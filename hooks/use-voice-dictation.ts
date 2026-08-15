'use client'

// Mic memo → WAV → Whisper. Levels from AnalyserNode (ScriptProcessor stays silent in Chromium).
import { useCallback, useEffect, useRef, useState } from 'react'

const WAVE_BARS = 48
const MIN_SPEECH_PEAK = 0.02
const TARGET_SAMPLE_RATE = 16000
const ANALYSER_SIZE = 2048

function formatElapsed(ms: number): string {
  const totalSec = Math.floor(ms / 1000)
  const m = Math.floor(totalSec / 60)
  const s = totalSec % 60
  return `${m}:${s.toString().padStart(2, '0')}`
}

function isLikelyHallucination(text: string): boolean {
  const t = text.trim().toLowerCase().replace(/[.?!,]+$/g, '')
  return (
    t === 'you' ||
    t === 'thank you' ||
    t === 'thanks for watching' ||
    t === 'bye' ||
    t === '.' ||
    t === ''
  )
}

function downsample(input: Float32Array, inRate: number, outRate: number): Float32Array {
  if (outRate >= inRate) return input
  const ratio = inRate / outRate
  const outLen = Math.floor(input.length / ratio)
  const out = new Float32Array(outLen)
  for (let i = 0; i < outLen; i++) {
    const start = Math.floor(i * ratio)
    const end = Math.floor((i + 1) * ratio)
    let sum = 0
    let n = 0
    for (let j = start; j < end && j < input.length; j++) {
      sum += input[j]
      n++
    }
    out[i] = n ? sum / n : 0
  }
  return out
}

function encodeWav(samples: Float32Array, sampleRate: number): Blob {
  const dataSize = samples.length * 2
  const buffer = new ArrayBuffer(44 + dataSize)
  const view = new DataView(buffer)
  const writeStr = (offset: number, str: string) => {
    for (let i = 0; i < str.length; i++) view.setUint8(offset + i, str.charCodeAt(i))
  }
  writeStr(0, 'RIFF')
  view.setUint32(4, 36 + dataSize, true)
  writeStr(8, 'WAVE')
  writeStr(12, 'fmt ')
  view.setUint32(16, 16, true)
  view.setUint16(20, 1, true)
  view.setUint16(22, 1, true)
  view.setUint32(24, sampleRate, true)
  view.setUint32(28, sampleRate * 2, true)
  view.setUint16(32, 2, true)
  view.setUint16(34, 16, true)
  writeStr(36, 'data')
  view.setUint32(40, dataSize, true)
  let offset = 44
  for (let i = 0; i < samples.length; i++) {
    const s = Math.max(-1, Math.min(1, samples[i]))
    view.setInt16(offset, s < 0 ? s * 0x8000 : s * 0x7fff, true)
    offset += 2
  }
  return new Blob([buffer], { type: 'audio/wav' })
}

async function queryMicPermission(): Promise<PermissionState | 'unknown'> {
  try {
    const status = await navigator.permissions.query({
      name: 'microphone' as PermissionName,
    })
    return status.state
  } catch {
    return 'unknown'
  }
}

/** Virtual loopbacks (BlackHole, etc.) never hear your voice — skip them. */
function isVirtualAudioInput(label: string): boolean {
  const l = label.toLowerCase()
  return (
    l.includes('blackhole') ||
    l.includes('soundflower') ||
    l.includes('loopback') ||
    l.includes('vb-cable') ||
    l.includes('vb cable') ||
    l.includes('cable input') ||
    l.includes('virtual') ||
    l.includes('aggregate device') ||
    l.includes('multi-output') ||
    l.includes('zoomaudio') ||
    l.includes('microsoft teams audio')
  )
}

function scoreMicLabel(label: string): number {
  const l = label.toLowerCase()
  if (isVirtualAudioInput(label)) return -1000
  let score = 0
  if (l.includes('microphone') || l.includes('mic')) score += 50
  if (l.includes('built-in') || l.includes('macbook') || l.includes('imac')) score += 40
  if (l.includes('airpods') || l.includes('headset') || l.includes('headphones')) score += 30
  if (l.includes('usb') || l.includes('external')) score += 20
  if (l.includes('default')) score -= 5
  return score
}

/** Prefer a physical mic once labels are available (needs prior mic permission). */
async function pickPhysicalMicId(): Promise<{ deviceId: string; label: string } | null> {
  try {
    const devices = await navigator.mediaDevices.enumerateDevices()
    const inputs = devices.filter((d) => d.kind === 'audioinput' && d.deviceId)
    if (inputs.length === 0) return null
    const ranked = [...inputs].sort(
      (a, b) => scoreMicLabel(b.label || '') - scoreMicLabel(a.label || '')
    )
    const best = ranked[0]
    if (!best || scoreMicLabel(best.label || '') < 0) return null
    return { deviceId: best.deviceId, label: best.label || 'Microphone' }
  } catch {
    return null
  }
}

async function openMicStream(): Promise<MediaStream> {
  const baseAudio: MediaTrackConstraints = {
    echoCancellation: false,
    noiseSuppression: false,
    autoGainControl: true,
    channelCount: 1,
  }

  // Unlock device labels if needed, then prefer a real mic over BlackHole/etc.
  let probe: MediaStream | null = null
  try {
    probe = await navigator.mediaDevices.getUserMedia({ audio: true, video: false })
  } catch {
    probe = null
  }
  const preferred = await pickPhysicalMicId()
  if (probe) {
    // If probe already grabbed the right device, keep it
    const probeLabel = probe.getAudioTracks()[0]?.label || ''
    if (preferred && !isVirtualAudioInput(probeLabel) && scoreMicLabel(probeLabel) >= 0) {
      return probe
    }
    probe.getTracks().forEach((t) => t.stop())
  }

  if (preferred) {
    try {
      return await navigator.mediaDevices.getUserMedia({
        audio: { ...baseAudio, deviceId: { exact: preferred.deviceId } },
        video: false,
      })
    } catch {
      // Fall through to default
    }
  }

  return navigator.mediaDevices.getUserMedia({
    audio: baseAudio,
    video: false,
  })
}

export function useVoiceDictation(opts: {
  onTranscript: (text: string) => void
}) {
  const onTranscriptRef = useRef(opts.onTranscript)
  onTranscriptRef.current = opts.onTranscript

  const [listening, setListening] = useState(false)
  const [transcribing, setTranscribing] = useState(false)
  const [supported, setSupported] = useState(false)
  const [error, setError] = useState<string | null>(null)
  const [elapsedMs, setElapsedMs] = useState(0)
  const [levels, setLevels] = useState<number[]>(() => Array(WAVE_BARS).fill(0.12))

  const streamRef = useRef<MediaStream | null>(null)
  const audioCtxRef = useRef<AudioContext | null>(null)
  const analyserRef = useRef<AnalyserNode | null>(null)
  const rafRef = useRef<number | null>(null)
  const tickRef = useRef<number | null>(null)
  const startedAtRef = useRef(0)
  const peakRef = useRef(0)
  const cancelledRef = useRef(false)
  const pcmChunksRef = useRef<Float32Array[]>([])
  const sampleRateRef = useRef(44100)
  const timeDataRef = useRef<Float32Array | null>(null)

  useEffect(() => {
    const hasMic =
      typeof navigator !== 'undefined' && !!navigator.mediaDevices?.getUserMedia
    const hasAudio =
      typeof window !== 'undefined' &&
      !!(
        window.AudioContext ||
        (window as unknown as { webkitAudioContext?: typeof AudioContext }).webkitAudioContext
      )
    setSupported(hasMic && hasAudio)
  }, [])

  const teardownGraph = useCallback(() => {
    if (rafRef.current != null) {
      cancelAnimationFrame(rafRef.current)
      rafRef.current = null
    }
    analyserRef.current = null
    timeDataRef.current = null
    const ctx = audioCtxRef.current
    audioCtxRef.current = null
    if (ctx) void ctx.close().catch(() => undefined)
  }, [])

  const stopTracks = useCallback(() => {
    try {
      streamRef.current?.getTracks().forEach((t) => t.stop())
    } catch {
      /* ignore */
    }
    streamRef.current = null
  }, [])

  const clearTimer = useCallback(() => {
    if (tickRef.current != null) {
      window.clearInterval(tickRef.current)
      tickRef.current = null
    }
  }, [])

  const resetUi = useCallback(() => {
    setListening(false)
    setTranscribing(false)
    setElapsedMs(0)
    setLevels(Array(WAVE_BARS).fill(0.12))
    peakRef.current = 0
    pcmChunksRef.current = []
    clearTimer()
    teardownGraph()
    stopTracks()
  }, [clearTimer, stopTracks, teardownGraph])

  useEffect(() => {
    return () => {
      cancelledRef.current = true
      clearTimer()
      teardownGraph()
      stopTracks()
    }
  }, [clearTimer, stopTracks, teardownGraph])

  const startPump = useCallback(() => {
    const paint = () => {
      const analyser = analyserRef.current
      const buf = timeDataRef.current
      if (!analyser || !buf) return

      analyser.getFloatTimeDomainData(buf)

      // Keep PCM for WAV (copy — Analyser reuses the buffer)
      pcmChunksRef.current.push(new Float32Array(buf))

      let peak = 0
      for (let i = 0; i < buf.length; i++) {
        const v = Math.abs(buf[i])
        if (v > peak) peak = v
      }
      if (peak > peakRef.current) peakRef.current = peak
      // Clear the "still silent" hint once levels move
      if (peak >= MIN_SPEECH_PEAK) setError(null)

      const next: number[] = []
      const step = Math.max(1, Math.floor(buf.length / WAVE_BARS))
      for (let i = 0; i < WAVE_BARS; i++) {
        let bar = 0
        for (let j = 0; j < step; j++) {
          const v = Math.abs(buf[i * step + j] || 0)
          if (v > bar) bar = v
        }
        next.push(Math.max(0.08, Math.min(1, bar * 4)))
      }
      setLevels(next)
      rafRef.current = requestAnimationFrame(paint)
    }
    rafRef.current = requestAnimationFrame(paint)
  }, [])

  const start = useCallback(async () => {
    if (!navigator.mediaDevices?.getUserMedia) {
      setError('Voice input is not supported in this browser')
      return
    }

    const perm = await queryMicPermission()
    if (perm === 'denied') {
      setError(
        'Microphone is blocked — lock icon in the address bar → Microphone → Allow, then reload'
      )
      return
    }

    setError(null)
    cancelledRef.current = false
    pcmChunksRef.current = []
    peakRef.current = 0
    setElapsedMs(0)
    teardownGraph()
    stopTracks()

    let stream: MediaStream
    try {
      stream = await openMicStream()
    } catch (err) {
      const name = err instanceof DOMException ? err.name : ''
      if (name === 'NotAllowedError' || name === 'PermissionDeniedError') {
        setError(
          'Microphone permission denied — lock icon → Site settings → allow Microphone'
        )
      } else if (name === 'NotFoundError') {
        setError('No microphone found')
      } else {
        setError('Could not open microphone')
      }
      return
    }

    const track = stream.getAudioTracks()[0]
    if (!track) {
      stream.getTracks().forEach((t) => t.stop())
      setError('No audio track from microphone')
      return
    }
    if (isVirtualAudioInput(track.label || '')) {
      stream.getTracks().forEach((t) => t.stop())
      setError(
        `“${track.label}” is a virtual device and can’t hear you — set Input to your MacBook/AirPods mic in macOS Sound (or the address-bar mic picker)`
      )
      return
    }
    track.enabled = true
    if (track.muted) {
      // Wait briefly — Chrome can report muted until the device wakes
      await new Promise((r) => setTimeout(r, 150))
    }
    if (track.readyState !== 'live') {
      stream.getTracks().forEach((t) => t.stop())
      setError('Microphone track is not live — check OS input device')
      return
    }

    streamRef.current = stream

    const AudioCtx =
      window.AudioContext ||
      (window as unknown as { webkitAudioContext: typeof AudioContext }).webkitAudioContext
    const ctx = new AudioCtx()
    sampleRateRef.current = ctx.sampleRate
    audioCtxRef.current = ctx
    if (ctx.state === 'suspended') {
      await ctx.resume().catch(() => undefined)
    }

    const source = ctx.createMediaStreamSource(stream)
    const analyser = ctx.createAnalyser()
    analyser.fftSize = ANALYSER_SIZE
    analyser.smoothingTimeConstant = 0
    source.connect(analyser)

    // Keep the graph pulled without playing mic into speakers:
    // MediaStreamDestination is a real sink Chromium will process.
    const sink = ctx.createMediaStreamDestination()
    analyser.connect(sink)

    analyserRef.current = analyser
    timeDataRef.current = new Float32Array(analyser.fftSize)

    startPump()

    startedAtRef.current = Date.now()
    tickRef.current = window.setInterval(() => {
      setElapsedMs(Date.now() - startedAtRef.current)
    }, 250)

    setListening(true)

    // If analyser stays flat, permission was granted but the wrong/muted device is active
    window.setTimeout(() => {
      if (cancelledRef.current || !audioCtxRef.current) return
      if (peakRef.current >= MIN_SPEECH_PEAK) return
      const label = track.label || 'default device'
      setError(
        `Still silent from “${label}” — switch Input away from BlackHole/virtual devices to your real mic`
      )
    }, 2500)
  }, [startPump, stopTracks, teardownGraph])

  const cancel = useCallback(() => {
    cancelledRef.current = true
    resetUi()
  }, [resetUi])

  const confirm = useCallback(async () => {
    cancelledRef.current = false
    setTranscribing(true)
    clearTimer()

    const chunks = pcmChunksRef.current
    const inRate = sampleRateRef.current
    const peak = peakRef.current

    teardownGraph()
    stopTracks()
    pcmChunksRef.current = []

    if (cancelledRef.current) {
      resetUi()
      return
    }

    if (chunks.length === 0) {
      setError('No audio captured — try again')
      resetUi()
      return
    }

    if (peak < MIN_SPEECH_PEAK) {
      setError(
        'Mic opened but levels stayed flat — wrong input device or muted in macOS Sound settings'
      )
      resetUi()
      return
    }

    let total = 0
    for (const c of chunks) total += c.length
    const merged = new Float32Array(total)
    let offset = 0
    for (const c of chunks) {
      merged.set(c, offset)
      offset += c.length
    }
    const pcm = downsample(merged, inRate, TARGET_SAMPLE_RATE)
    const wav = encodeWav(pcm, TARGET_SAMPLE_RATE)

    if (wav.size < 1000) {
      setError('Recording too short')
      resetUi()
      return
    }

    try {
      const file = new File([wav], 'memo.wav', { type: 'audio/wav' })
      const form = new FormData()
      form.append('audio', file)
      const res = await fetch('/api/ai/transcribe', { method: 'POST', body: form })
      if (!res.ok) throw new Error(await res.text().catch(() => 'Transcription failed'))
      const data = (await res.json()) as { text?: string }
      const text = (data.text || '').trim()
      if (cancelledRef.current) {
        resetUi()
        return
      }
      resetUi()
      if (!text || isLikelyHallucination(text)) {
        setError('No speech detected — try again')
        return
      }
      onTranscriptRef.current(text)
    } catch (err) {
      console.error(err)
      setError('Could not transcribe audio')
      resetUi()
    }
  }, [clearTimer, resetUi, stopTracks, teardownGraph])

  return {
    listening,
    transcribing,
    supported,
    error,
    levels,
    elapsedLabel: formatElapsed(elapsedMs),
    start,
    cancel,
    confirm,
  }
}
