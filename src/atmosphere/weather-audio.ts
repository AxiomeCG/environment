type ThunderVoice = {
  sources: AudioScheduledSourceNode[]
  nodes: AudioNode[]
}

export type ThunderAudioOwner = symbol

type ThunderSession = {
  context: AudioContext
  noise: AudioBuffer
  voices: Map<ThunderVoice, ThunderAudioOwner>
  timers: Map<number, ThunderAudioOwner>
}

let session: ThunderSession | null = null
let consented = false
const consentListeners = new Set<() => void>()
const thunderOwners = new Map<ThunderAudioOwner, boolean>()

function notifyConsent(): void {
  for (const listener of consentListeners) listener()
}

function createNoise(context: AudioContext): AudioBuffer {
  const duration = 2.5
  const buffer = context.createBuffer(
    1,
    Math.ceil(context.sampleRate * duration),
    context.sampleRate,
  )
  const samples = buffer.getChannelData(0)
  let state = 0x63d83595
  for (let index = 0; index < samples.length; index += 1) {
    state ^= state << 13
    state ^= state >>> 17
    state ^= state << 5
    samples[index] = ((state >>> 0) / 0x80000000 - 1) * (1 - index / samples.length)
  }
  return buffer
}

function disposeVoice(active: ThunderSession, voice: ThunderVoice): void {
  if (!active.voices.delete(voice)) return
  for (const source of voice.sources) {
    source.onended = null
    try {
      source.stop()
    } catch {
      // The source already reached its scheduled end.
    }
    source.disconnect()
  }
  for (const node of voice.nodes) node.disconnect()
}

function beginThunder(active: ThunderSession, owner: ThunderAudioOwner, strength: number): void {
  if (
    session !== active ||
    !consented ||
    thunderOwners.get(owner) !== true ||
    active.context.state !== 'running'
  ) {
    return
  }
  const context = active.context
  const now = context.currentTime
  const boundedStrength = Math.max(0.2, Math.min(1, strength))

  const noise = context.createBufferSource()
  noise.buffer = active.noise
  const noiseFilter = context.createBiquadFilter()
  noiseFilter.type = 'lowpass'
  noiseFilter.frequency.setValueAtTime(720, now)
  noiseFilter.frequency.exponentialRampToValueAtTime(95, now + 2.2)
  const noiseGain = context.createGain()
  noiseGain.gain.setValueAtTime(0.0001, now)
  noiseGain.gain.exponentialRampToValueAtTime(0.11 * boundedStrength, now + 0.035)
  noiseGain.gain.exponentialRampToValueAtTime(0.0001, now + 2.35)

  const rumble = context.createOscillator()
  rumble.type = 'triangle'
  rumble.frequency.setValueAtTime(46, now)
  rumble.frequency.exponentialRampToValueAtTime(29, now + 2.1)
  const rumbleGain = context.createGain()
  rumbleGain.gain.setValueAtTime(0.0001, now)
  rumbleGain.gain.exponentialRampToValueAtTime(0.048 * boundedStrength, now + 0.12)
  rumbleGain.gain.exponentialRampToValueAtTime(0.0001, now + 2.3)

  noise.connect(noiseFilter).connect(noiseGain).connect(context.destination)
  rumble.connect(rumbleGain).connect(context.destination)
  const voice: ThunderVoice = {
    sources: [noise, rumble],
    nodes: [noiseFilter, noiseGain, rumbleGain],
  }
  active.voices.set(voice, owner)
  noise.onended = () => disposeVoice(active, voice)
  noise.start(now)
  noise.stop(now + 2.4)
  rumble.start(now)
  rumble.stop(now + 2.35)
}
function silenceThunderAudioOwner(owner: ThunderAudioOwner): void {
  const active = session
  if (!active) return
  for (const [timer, timerOwner] of active.timers) {
    if (timerOwner !== owner) continue
    window.clearTimeout(timer)
    active.timers.delete(timer)
  }
  for (const [voice, voiceOwner] of active.voices) {
    if (voiceOwner === owner) disposeVoice(active, voice)
  }
}

function hasEnabledThunderOwner(): boolean {
  for (const enabled of thunderOwners.values()) {
    if (enabled) return true
  }
  return false
}

export function createThunderAudioOwner(): ThunderAudioOwner {
  return Symbol('environment-weather')
}

export function acquireThunderAudioOwner(owner: ThunderAudioOwner): () => void {
  thunderOwners.set(owner, false)
  return () => {
    silenceThunderAudioOwner(owner)
    thunderOwners.delete(owner)
    if (!hasEnabledThunderOwner()) resetThunderAudioSession()
  }
}

export function setThunderAudioOwnerEnabled(owner: ThunderAudioOwner, enabled: boolean): void {
  if (!thunderOwners.has(owner)) return
  thunderOwners.set(owner, enabled)
  if (!enabled) silenceThunderAudioOwner(owner)
  if (!hasEnabledThunderOwner()) resetThunderAudioSession()
}

export function subscribeThunderAudioConsent(listener: () => void): () => void {
  consentListeners.add(listener)
  return () => consentListeners.delete(listener)
}

export function isThunderAudioConsented(): boolean {
  return consented
}

export async function enableThunderAudioFromGesture(): Promise<boolean> {
  if (session?.context.state === 'running') {
    if (!consented) {
      consented = true
      notifyConsent()
    }
    return true
  }

  resetThunderAudioSession()
  if (typeof window === 'undefined' || !window.AudioContext) return false
  const context = new window.AudioContext()
  const active: ThunderSession = {
    context,
    noise: createNoise(context),
    voices: new Map(),
    timers: new Map(),
  }
  session = active
  try {
    await context.resume()
  } catch {
    if (session === active) resetThunderAudioSession()
    return false
  }
  if (session !== active || context.state !== 'running') {
    if (session === active) resetThunderAudioSession()
    return false
  }
  consented = true
  notifyConsent()
  return true
}

export function playThunderAfter(
  owner: ThunderAudioOwner,
  delayMs: number,
  strength: number,
): void {
  const active = session
  if (
    !active ||
    !consented ||
    thunderOwners.get(owner) !== true ||
    active.context.state !== 'running'
  ) {
    return
  }
  const timer = window.setTimeout(
    () => {
      active.timers.delete(timer)
      beginThunder(active, owner, strength)
    },
    Math.max(250, Math.min(1600, delayMs)),
  )
  active.timers.set(timer, owner)
}

export function resetThunderAudioSession(): void {
  const active = session
  session = null
  if (active) {
    for (const timer of active.timers.keys()) window.clearTimeout(timer)
    active.timers.clear()
    for (const voice of [...active.voices.keys()]) disposeVoice(active, voice)
    if (active.context.state !== 'closed') void active.context.close().catch(() => undefined)
  }
  if (consented) {
    consented = false
    notifyConsent()
  }
}
