import Capacitor
import AVFoundation

@objc(AudioSessionPlugin)
public class AudioSessionPlugin: CAPPlugin, CAPBridgedPlugin {
    public let identifier = "AudioSessionPlugin"
    public let jsName = "AudioSession"
    public let pluginMethods: [CAPPluginMethod] = [
        CAPPluginMethod(name: "isOtherAudioPlaying", returnType: CAPPluginReturnPromise)
    ]

    // Reports whether another app (Music, Spotify, a podcast, etc.) is currently
    // playing audio, so the web layer can avoid auto-starting our music over it.
    @objc func isOtherAudioPlaying(_ call: CAPPluginCall) {
        call.resolve(["playing": AVAudioSession.sharedInstance().isOtherAudioPlaying])
    }
}
