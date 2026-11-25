import Cocoa
import FlutterMacOS

class MainFlutterWindow: NSWindow {
  var channels: HostChannels?

  override func awakeFromNib() {
    let flutterViewController = FlutterViewController()
    let windowFrame = self.frame
    self.contentViewController = flutterViewController
    self.setFrame(windowFrame, display: true)

    RegisterGeneratedPlugins(registry: flutterViewController)
    flutterViewController.engine.run(withEntrypoint: nil)
    channels = HostChannels(messenger: flutterViewController.engine.binaryMessenger)

    super.awakeFromNib()
  }

  override var canBecomeKey: Bool { false }
  override var canBecomeMain: Bool { false }
  override func makeKeyAndOrderFront(_ sender: Any?) {}
  override func orderFront(_ sender: Any?) {}
  override func orderFrontRegardless() {}
  override func order(_ place: NSWindow.OrderingMode, relativeTo otherWin: Int) {}
}

class HostChannels: NSObject, FlutterStreamHandler {
  let methods: FlutterMethodChannel
  let json: FlutterMethodChannel
  let events: FlutterEventChannel
  let strings: FlutterBasicMessageChannel
  let jsonMessages: FlutterBasicMessageChannel
  let standardMessages: FlutterBasicMessageChannel
  let binary: FlutterBasicMessageChannel
  var sink: FlutterEventSink?
  var ticks = 0
  var timer: Timer?

  init(messenger: FlutterBinaryMessenger) {
    methods = FlutterMethodChannel(name: "luma.test/methods", binaryMessenger: messenger)
    json = FlutterMethodChannel(name: "luma.test/json", binaryMessenger: messenger, codec: FlutterJSONMethodCodec.sharedInstance())
    events = FlutterEventChannel(name: "luma.test/events", binaryMessenger: messenger)
    strings = FlutterBasicMessageChannel(name: "luma.test/strings", binaryMessenger: messenger, codec: FlutterStringCodec.sharedInstance())
    jsonMessages = FlutterBasicMessageChannel(name: "luma.test/json-messages", binaryMessenger: messenger, codec: FlutterJSONMessageCodec.sharedInstance())
    standardMessages = FlutterBasicMessageChannel(name: "luma.test/standard-messages", binaryMessenger: messenger, codec: FlutterStandardMessageCodec.sharedInstance())
    binary = FlutterBasicMessageChannel(name: "luma.test/binary", binaryMessenger: messenger, codec: FlutterBinaryCodec.sharedInstance())
    super.init()

    methods.setMethodCallHandler { call, result in
      switch call.method {
      case "echo":
        result(call.arguments)
      case "fail":
        result(FlutterError(code: "E_TEST", message: "Failed on purpose", details: ["attempt": 3]))
      default:
        result(FlutterMethodNotImplemented)
      }
    }
    json.setMethodCallHandler { call, result in
      result(["method": call.method, "arguments": call.arguments ?? NSNull(), "host": "macos"])
    }
    events.setStreamHandler(self)
    strings.setMessageHandler { message, reply in
      reply("host got \(message ?? "nothing")")
    }
    jsonMessages.setMessageHandler { message, reply in
      reply(["received": message ?? NSNull()])
    }
    standardMessages.setMessageHandler { message, reply in
      reply(["received": message ?? NSNull(), "bytes": FlutterStandardTypedData(bytes: Data([1, 2, 3]))])
    }
    binary.setMessageHandler { message, reply in
      reply(Data((message as? Data ?? Data()).reversed()))
    }

    timer = Timer.scheduledTimer(withTimeInterval: 1.0, repeats: true) { [weak self] _ in self?.tick() }
  }

  func tick() {
    ticks += 1
    sink?(["tick": ticks, "label": "host tick"])
    if ticks % 5 == 0 {
      sink?(FlutterError(code: "E_EVENT", message: "Event error on purpose", details: nil))
    }
    methods.invokeMethod("fromHost", arguments: ["tick": ticks, "ratio": 0.5]) { _ in }
    strings.sendMessage("host says \(ticks)") { _ in }
  }

  func onListen(withArguments arguments: Any?, eventSink events: @escaping FlutterEventSink) -> FlutterError? {
    sink = events
    return nil
  }

  func onCancel(withArguments arguments: Any?) -> FlutterError? {
    sink = nil
    return nil
  }
}
