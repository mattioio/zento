import Capacitor
import AVFoundation

@objc(AudioSessionPlugin)
public class AudioSessionPlugin: CAPPlugin, CAPBridgedPlugin {
    public let identifier = "AudioSessionPlugin"
    public let jsName = "AudioSession"
    public let pluginMethods: [CAPPluginMethod] = [
        CAPPluginMethod(name: "isOtherAudioPlaying", returnType: CAPPluginReturnPromise)
    ]

    override public func load() {
        let center = NotificationCenter.default
        // Fired when another app starts/stops PRIMARY audio while ours is the
        // secondary (ambient) session — the system's hint to duck our music.
        center.addObserver(self,
                           selector: #selector(handleSecondaryAudioHint(_:)),
                           name: AVAudioSession.silenceSecondaryAudioHintNotification,
                           object: nil)
        // Fired on interruptions (phone call, Siri, alarms, etc.).
        center.addObserver(self,
                           selector: #selector(handleInterruption(_:)),
                           name: AVAudioSession.interruptionNotification,
                           object: nil)
    }

    deinit {
        NotificationCenter.default.removeObserver(self)
    }

    @objc func isOtherAudioPlaying(_ call: CAPPluginCall) {
        call.resolve(["playing": AVAudioSession.sharedInstance().isOtherAudioPlaying])
    }

    @objc private func handleSecondaryAudioHint(_ notification: Notification) {
        guard let info = notification.userInfo,
              let raw = info[AVAudioSessionSilenceSecondaryAudioHintTypeKey] as? UInt,
              let type = AVAudioSession.SilenceSecondaryAudioHintType(rawValue: raw) else { return }
        // .begin → other app started primary audio (duck ours)
        // .end   → other app stopped (we may resume)
        let playing = (type == .begin)
        DispatchQueue.main.async {
            self.notifyListeners("otherAudioChanged", data: ["playing": playing])
        }
    }

    @objc private func handleInterruption(_ notification: Notification) {
        guard let info = notification.userInfo,
              let raw = info[AVAudioSessionInterruptionTypeKey] as? UInt,
              let type = AVAudioSession.InterruptionType(rawValue: raw) else { return }
        if type == .began {
            DispatchQueue.main.async {
                self.notifyListeners("interruption", data: ["state": "began"])
            }
        } else if type == .ended {
            var shouldResume = false
            if let optRaw = info[AVAudioSessionInterruptionOptionKey] as? UInt {
                shouldResume = AVAudioSession.InterruptionOptions(rawValue: optRaw).contains(.shouldResume)
            }
            DispatchQueue.main.async {
                self.notifyListeners("interruption", data: ["state": "ended", "shouldResume": shouldResume])
            }
        }
    }
}
