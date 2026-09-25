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
  // inbound — all verified against the GA reference, Sept 2026
  sessionCreated: 'session.created',
  transcriptDelta: 'conversation.item.input_audio_transcription.delta',
  transcriptDone: 'conversation.item.input_audio_transcription.completed',
  speechStarted: 'input_audio_buffer.speech_started',
  speechStopped: 'input_audio_buffer.speech_stopped',
  responseDone: 'response.done',
  responseCreated: 'response.created',
  error: 'error',
  /**
   * Supplementary only. The `.delta` sibling is documented in GA prose; the
   * `.done` variant is not linked anywhere official, and the function-calling
   * guide tells you to read the call off `response.done` instead. So this is a
   * second listener, never the trigger — see `handle()`.
   */
  fnArgsDone: 'response.function_call_arguments.done',
  // outbound
  sessionUpdate: 'session.update',
  itemCreate: 'conversation.item.create',
  responseCreate: 'response.create',
  responseCancel: 'response.cancel',
  audioClear: 'output_audio_buffer.clear',
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
    /** call_ids already handed to the contract. Two events can carry the same one. */
    this.seenCalls = new Set();
    this.responding = false;
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
    this.seenCalls.clear();
    this.status('idle');
  }

  send(obj) {
    if (this.dc?.readyState === 'open') this.dc.send(JSON.stringify(obj));
  }

  /**
   * The GA session shape. Three things here are not the beta shape, and the
   * beta shape has been rejected outright since 2026-05-12:
   *
   *   session.type            new, required discriminator
   *   audio.input.turn_detection   moved; the inner fields are unchanged
   *   audio.input.transcription    moved from top-level input_audio_transcription
   *
   * `instructions`, `tools` and `tool_choice` stay top-level.
   *
   * The transcription path is the one claim I could not find documented for a
   * speech-to-speech session rather than a transcription-only one. It is set
   * explicitly because in the beta it was opt-in, and a session that silently
   * does not transcribe hands Hepta nothing to speculate on. If the delta
   * events never arrive, this is the first line to suspect.
   */
  configure() {
    this.send({
      type: EVENTS.sessionUpdate,
      session: {
        type: 'realtime',
        instructions: this.opts.instructions,
        tools: this.opts.tools,
        tool_choice: 'auto',
        audio: {
          input: {
            // Server-side turn detection gives us speech_started /
            // speech_stopped, which is what Hepta needs to know when the
            // tongue stops turning.
            turn_detection: {
              type: 'server_vad',
              threshold: 0.5,
              prefix_padding_ms: 300,
              silence_duration_ms: 500,
              // The server would otherwise cut the model off at the first
              // sound you make, "yeah" included. Off, so the decision is
              // Hepta's: a nod keeps the floor, "wait" takes it. See lines.ts.
              interrupt_response: false,
            },
            transcription: { model: 'gpt-4o-mini-transcribe' },
          },
        },
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

  /** True between response.created and response.done: the model has the floor. */
  get speaking() {
    return this.responding;
  }

  /**
   * They took the turn. Stop generating AND drop what is already buffered —
   * over WebRTC, cancelling the response alone leaves queued audio playing,
   * which sounds like talking over someone who has just said "wait".
   */
  stopSpeaking() {
    this.send({ type: EVENTS.responseCancel });
    this.send({ type: EVENTS.audioClear });
    this.responding = false;
  }

  /** Kept for callers that want the old behaviour: stop on any sound. */
  bargeIn() {
    this.stopSpeaking();
  }

  /**
   * Take the floor with one point from a line of thought.
   *
   * UNVERIFIED LIVE: whether the model begins speaking while input audio is
   * still arriving. The API accepts response.create at any time; whether a
   * turn-based model will talk over an open input buffer is the thing the
   * first live run has to answer. If it waits for silence, this still lands —
   * as the first thing said when they pause, which is a queued point, not a
   * cut-in. Full-duplex models (Moshi-class) do this natively, and this call
   * is the same either way.
   */
  interject(point, mode = 'cut') {
    const how = mode === 'cut'
      ? 'Cut in now, the way a person would: one short sentence, then stop and let them answer.'
      : 'When they finish, raise this first, in one short sentence.';
    this.send({
      type: EVENTS.itemCreate,
      item: { type: 'message', role: 'system', content: [{ type: 'input_text', text: `${how} Point: ${point}` }] },
    });
    if (mode === 'cut') this.send({ type: EVENTS.responseCreate });
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

      // The documented path. A response carrying a function call arrives as
      // response.done with the call in output[], and that is what is wired to
      // the contract.
      case EVENTS.responseCreated:
        this.responding = true;
        break;

      case EVENTS.responseDone: {
        this.responding = false;
        for (const item of e.response?.output ?? []) {
          if (item?.type !== 'function_call') continue;
          if (this.seenCalls.has(item.call_id)) continue;
          this.seenCalls.add(item.call_id);
          this.opts.onToolCall(item.name, item.arguments ?? '{}', item.call_id);
        }
        break;
      }

      // If this event does still exist it fires first, which gets the card up
      // sooner. Either way the call runs once: whichever arrives first claims
      // the call_id.
      case EVENTS.fnArgsDone:
        if (e.call_id && !this.seenCalls.has(e.call_id)) {
          this.seenCalls.add(e.call_id);
          this.opts.onToolCall(e.name, e.arguments ?? '{}', e.call_id);
        }
        break;

      case EVENTS.error:
        this.status('error', e.error?.message ?? 'unknown realtime error');
        break;

      default:
        break;
    }
  }
}
