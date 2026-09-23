/**
 * The voice transport. Mic in, voice out, events on a data channel.
 *
 * This file knows about WebRTC and about OpenAI's event names, and nothing at
 * all about acts, slots or committing. That separation is the point: swapping
 * OpenAI for another realtime provider, or for a local recognizer, should touch
 * only this file.
 *
 * EVENT NAMES ARE THE ONE FRAGILE PART. They are all in EVENTS below so that
 * fixing a rename is one edit, not a search. Check them against the current
 * Realtime docs before the first live run.
 */

export const EVENTS = {
  // inbound
  sessionCreated: 'session.created',
  transcriptDelta: 'conversation.item.input_audio_transcription.delta',
  transcriptDone: 'conversation.item.input_audio_transcription.completed',
  speechStarted: 'input_audio_buffer.speech_started',
  speechStopped: 'input_audio_buffer.speech_stopped',
  fnArgsDone: 'response.function_call_arguments.done',
  responseDone: 'response.done',
  error: 'error',
  // outbound
  sessionUpdate: 'session.update',
  itemCreate: 'conversation.item.create',
  responseCreate: 'response.create',
  responseCancel: 'response.cancel',
};

export class RealtimeVoice {
  /**
   * @param {{
   *   endpoint?: string,
   *   instructions: string,
   *   tools: unknown[],
   *   onTranscript: (text: string, final: boolean) => void,
   *   onToolCall: (name: string, args: string, callId: string) => void,
   *   onSpeechStart?: () => void,
   *   onSpeechStop?: () => void,
   *   onStatus?: (s: 'idle'|'connecting'|'live'|'error', detail?: string) => void,
   * }} opts
   */
  constructor(opts) {
    this.opts = { endpoint: '/realtime', ...opts };
    this.pc = null;
    this.dc = null;
    this.stream = null;
    this.audio = null;
    this.partial = '';
  }

  get live() {
    return this.dc?.readyState === 'open';
  }

  status(s, detail) {
    this.opts.onStatus?.(s, detail);
  }

  async start() {
    this.status('connecting');
    try {
      this.stream = await navigator.mediaDevices.getUserMedia({
        audio: { echoCancellation: true, noiseSuppression: true, autoGainControl: true },
      });
    } catch (err) {
      this.status('error', 'microphone refused');
      throw err;
    }

    const pc = new RTCPeerConnection();
    this.pc = pc;

    // Its voice, played back. Echo cancellation above is what stops the mic
    // hearing it and treating the assistant as a second speaker.
    this.audio = new Audio();
    this.audio.autoplay = true;
    pc.ontrack = (e) => { this.audio.srcObject = e.streams[0]; };

    for (const track of this.stream.getTracks()) pc.addTrack(track, this.stream);

    const dc = pc.createDataChannel('oai-events');
    this.dc = dc;
    dc.onopen = () => { this.configure(); this.status('live'); };
    dc.onclose = () => this.status('idle');
    dc.onmessage = (e) => this.handle(e.data);

    const offer = await pc.createOffer();
    await pc.setLocalDescription(offer);

    const res = await fetch(this.opts.endpoint, {
      method: 'POST',
      headers: { 'content-type': 'application/sdp' },
      body: offer.sdp ?? '',
    });
    if (!res.ok) {
      this.status('error', `${res.status}: ${(await res.text()).slice(0, 200)}`);
      throw new Error('realtime handshake failed');
    }
    await pc.setRemoteDescription({ type: 'answer', sdp: await res.text() });
  }

  stop() {
    try { this.dc?.close(); } catch { /* already gone */ }
    try { this.pc?.close(); } catch { /* already gone */ }
    for (const t of this.stream?.getTracks() ?? []) t.stop();
    this.dc = this.pc = this.stream = null;
    this.status('idle');
  }

  send(obj) {
    if (this.dc?.readyState === 'open') this.dc.send(JSON.stringify(obj));
  }

  configure() {
    this.send({
      type: EVENTS.sessionUpdate,
      session: {
        instructions: this.opts.instructions,
        tools: this.opts.tools,
        tool_choice: 'auto',
        // Server-side turn detection gives us speech_started / speech_stopped,
        // which is what Hepta needs to know when the tongue stops turning.
        turn_detection: { type: 'server_vad', threshold: 0.5, silence_duration_ms: 500 },
        input_audio_transcription: { model: 'gpt-4o-mini-transcribe' },
      },
    });
  }

  /** Tell the model what is on the stage. It is behind, and will contradict it otherwise. */
  reportState(state) {
    this.send({
      type: EVENTS.itemCreate,
      item: {
        type: 'message',
        role: 'system',
        content: [{ type: 'input_text', text: 'STAGE ' + JSON.stringify(state) }],
      },
    });
  }

  /** Hand a tool result back so the model can speak about what happened. */
  reportToolResult(callId, result) {
    this.send({
      type: EVENTS.itemCreate,
      item: { type: 'function_call_output', call_id: callId, output: JSON.stringify(result) },
    });
    this.send({ type: EVENTS.responseCreate });
  }

  /** The user started talking over it. Stop speaking rather than talking through them. */
  bargeIn() {
    this.send({ type: EVENTS.responseCancel });
  }

  handle(raw) {
    let e;
    try { e = JSON.parse(raw); } catch { return; }

    switch (e.type) {
      case EVENTS.speechStarted:
        this.partial = '';
        this.opts.onSpeechStart?.();
        break;

      case EVENTS.speechStopped:
        this.opts.onSpeechStop?.();
        break;

      case EVENTS.transcriptDelta:
        this.partial += e.delta ?? '';
        if (this.partial.trim()) this.opts.onTranscript(this.partial, false);
        break;

      case EVENTS.transcriptDone: {
        const text = (e.transcript ?? this.partial).trim();
        this.partial = '';
        if (text) this.opts.onTranscript(text, true);
        break;
      }

      case EVENTS.fnArgsDone:
        this.opts.onToolCall(e.name, e.arguments ?? '{}', e.call_id);
        break;

      case EVENTS.error:
        this.status('error', e.error?.message ?? 'unknown realtime error');
        break;

      default:
        break;
    }
  }
}
