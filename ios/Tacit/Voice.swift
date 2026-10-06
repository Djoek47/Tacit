import AVFoundation
import Speech

/// Ears and a mouth.
///
/// Rules that matter in a conversation:
///   - It never listens while it speaks, so it cannot hear itself and answer itself.
///   - A turn ends after a short silence, the way a person yields the floor.
///   - Recognition stays on the iPhone when the iPhone can do it.
///   - Hands-free: after Tacit finishes speaking, the microphone opens again.
final class Voice: NSObject, AVSpeechSynthesizerDelegate {
    var onHeard: ((String, Bool) -> Void)?
    var onState: ((String) -> Void)?
    var handsFree = false

    private let synth = AVSpeechSynthesizer()
    private let engine = AVAudioEngine()
    private let recognizer = SFSpeechRecognizer(locale: Locale(identifier: Locale.preferredLanguages.first ?? "en-CA"))
        ?? SFSpeechRecognizer(locale: Locale(identifier: "en-US"))
    private var request: SFSpeechAudioBufferRecognitionRequest?
    private var task: SFSpeechRecognitionTask?
    private var silence: Timer?
    private var latest = ""
    /// How long a pause ends the person's turn.
    private let yieldAfter: TimeInterval = 1.4

    override init() {
        super.init()
        synth.delegate = self
    }

    // MARK: speaking

    func speak(_ text: String) {
        guard !text.isEmpty else { return }
        stopListening(deliver: false)
        try? AVAudioSession.sharedInstance().setCategory(.playAndRecord, mode: .voiceChat, options: [.defaultToSpeaker, .allowBluetooth])
        try? AVAudioSession.sharedInstance().setActive(true)
        let u = AVSpeechUtterance(string: text)
        u.voice = AVSpeechSynthesisVoice(language: Locale.preferredLanguages.first) ?? AVSpeechSynthesisVoice(language: "en-CA")
        u.rate = AVSpeechUtteranceDefaultSpeechRate * 1.02
        onState?("speaking")
        synth.speak(u)
    }

    func speechSynthesizer(_ s: AVSpeechSynthesizer, didFinish u: AVSpeechUtterance) {
        onState?("idle")
        if handsFree && !s.isSpeaking { DispatchQueue.main.asyncAfter(deadline: .now() + 0.25) { self.listen() } }
    }

    // MARK: listening

    func listen() {
        if synth.isSpeaking { synth.stopSpeaking(at: .word) }
        SFSpeechRecognizer.requestAuthorization { status in
            AVAudioApplication.requestRecordPermission { granted in
                DispatchQueue.main.async {
                    guard status == .authorized, granted else { self.onState?("denied"); return }
                    self.start()
                }
            }
        }
    }

    private func start() {
        guard !engine.isRunning, let recognizer, recognizer.isAvailable else { return }
        do {
            let session = AVAudioSession.sharedInstance()
            try session.setCategory(.playAndRecord, mode: .measurement, options: [.defaultToSpeaker, .allowBluetooth])
            try session.setActive(true, options: .notifyOthersOnDeactivation)
        } catch { onState?("idle"); return }

        let req = SFSpeechAudioBufferRecognitionRequest()
        req.shouldReportPartialResults = true
        if recognizer.supportsOnDeviceRecognition { req.requiresOnDeviceRecognition = true }
        request = req
        latest = ""

        let input = engine.inputNode
        input.removeTap(onBus: 0)
        input.installTap(onBus: 0, bufferSize: 1024, format: input.outputFormat(forBus: 0)) { buf, _ in req.append(buf) }
        engine.prepare()
        do { try engine.start() } catch { onState?("idle"); return }
        onState?("listening")

        task = recognizer.recognitionTask(with: req) { [weak self] result, error in
            guard let self else { return }
            if let result {
                self.latest = result.bestTranscription.formattedString
                self.onHeard?(self.latest, false)
                self.armSilence()
                if result.isFinal { self.stopListening(deliver: true) }
            } else if error != nil {
                self.stopListening(deliver: !self.latest.isEmpty)
            }
        }
        armSilence(initial: true)
    }

    /// The person's turn ends after a pause; with nothing said at all, give up after a while.
    private func armSilence(initial: Bool = false) {
        DispatchQueue.main.async {
            self.silence?.invalidate()
            self.silence = Timer.scheduledTimer(withTimeInterval: initial ? 8 : self.yieldAfter, repeats: false) { [weak self] _ in
                self?.stopListening(deliver: true)
            }
        }
    }

    private func stopListening(deliver: Bool) {
        silence?.invalidate(); silence = nil
        guard engine.isRunning || task != nil else { return }
        engine.stop()
        engine.inputNode.removeTap(onBus: 0)
        request?.endAudio()
        task?.cancel()
        task = nil; request = nil
        let said = latest.trimmingCharacters(in: .whitespacesAndNewlines)
        latest = ""
        onState?("idle")
        if deliver && !said.isEmpty { onHeard?(said, true) }
    }

    func stopAll() {
        handsFree = false
        synth.stopSpeaking(at: .immediate)
        stopListening(deliver: false)
    }
}
