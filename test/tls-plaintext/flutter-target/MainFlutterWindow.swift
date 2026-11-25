import Cocoa
import FlutterMacOS

class MainFlutterWindow: NSWindow {
  override func awakeFromNib() {
    let flutterViewController = FlutterViewController()
    let windowFrame = self.frame
    self.contentViewController = flutterViewController
    self.setFrame(windowFrame, display: true)

    RegisterGeneratedPlugins(registry: flutterViewController)
    flutterViewController.engine.run(withEntrypoint: nil)

    super.awakeFromNib()
  }

  override var canBecomeKey: Bool { false }
  override var canBecomeMain: Bool { false }
  override func makeKeyAndOrderFront(_ sender: Any?) {}
  override func orderFront(_ sender: Any?) {}
  override func orderFrontRegardless() {}
  override func order(_ place: NSWindow.OrderingMode, relativeTo otherWin: Int) {}
}
