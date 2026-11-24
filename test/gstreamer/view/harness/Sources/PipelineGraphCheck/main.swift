import Foundation
import LumaCore
import SwiftyPharo

let arguments = CommandLine.arguments
guard arguments.count >= 5 else {
    FileHandle.standardError.write(Data("usage: PipelineGraphCheck <instrument dir> <GstCheck.class.st> <out dir> <dot>...\n".utf8))
    exit(2)
}
let instrumentDirectory = arguments[1]
let harnessSource = try String(contentsOfFile: arguments[2], encoding: .utf8)
let outDirectory = arguments[3]
let dots = Array(arguments[4...])
let width = 960
let height = 480
try FileManager.default.createDirectory(atPath: outDirectory, withIntermediateDirectories: true)

CoreTextGlyphAtlas.install()
PharoWorkspace.boot()
try await PharoRuntime.shared.runningState()
try await PharoLumaBindings.install(into: PharoRuntime.shared)

final class HostLog: @unchecked Sendable {
    var operations: [String: Int] = [:]
    var spawned: [PharoObject] = []
}
let host = HostLog()
PharoAsyncBridge.shared.serve { request in
    let operation = request["op"] as? String ?? "?"
    host.operations[operation, default: 0] += 1
    if operation == "view_spawn" {
        let described = try JSONSerialization.data(withJSONObject: request["object"] as! [String: Any])
        host.spawned.append(try JSONDecoder().decode(PharoObject.self, from: described))
    }
    return true
}

func smalltalk(_ source: String) async -> String {
    do {
        return try await PharoRuntime.shared.evaluate(source).printString
    } catch {
        return "ERROR: \(error)"
    }
}

func literal(_ text: String) -> String {
    "'" + text.replacingOccurrences(of: "'", with: "''") + "'"
}

func say(_ text: String) {
    let unquoted = text.hasPrefix("'") && text.hasSuffix("'") ? String(text.dropFirst().dropLast()).replacingOccurrences(of: "''", with: "'") : text
    print(unquoted)
}

let renderer = OffscreenRenderer()
let renderScale = Int(ProcessInfo.processInfo.environment["RENDER_SCALE"] ?? "2") ?? 2

func render(_ name: String) async {
    let handle = Int(await smalltalk("GstCheck sceneHandle")) ?? -1
    for dark in [false, true] {
        let path = "\(outDirectory)/\(name)-\(dark ? "dark" : "light").png"
        print("render " + renderer.render(scene: handle, points: (width, height), scale: renderScale, dark: dark, to: path))
    }
}

func feed(_ path: String, pipeline: String) async {
    let data = try! Data(contentsOf: URL(fileURLWithPath: path))
    let blob = PharoBlobRegistry.shared.lend(SharedBytes(copying: data), to: UUID())
    let takenAt = Int(Date().timeIntervalSince1970 * 1000)
    let state = "{\"pipeline\":\(pipeline),\"details\":\"all\",\"takenAt\":\(takenAt)}"
    say(await smalltalk("GstCheck feed: \(literal(state)) blob: \(blob) size: \(data.count)"))
}

func event(_ kind: String, x: Double, y: Double, buttons: Int = 0, dx: Double = 0, dy: Double = 0, factor: Double = 1, key: Int = 0) -> String {
    "{\"kind\":\"\(kind)\",\"x\":\(x),\"y\":\(y),\"buttons\":\(buttons),\"dx\":\(dx),\"dy\":\(dy),\"factor\":\(factor),\"key\":\(key),\"width\":\(width),\"height\":\(height)}"
}

func input(_ json: String) async {
    say(await smalltalk("GstCheck input: \(literal(json))"))
}

say(await smalltalk("""
    (TonelParser parseString: \(literal(harnessSource))) do: [ :each | each load ].
    'harness loaded'
    """))
say(await smalltalk("GstCheck load: \(literal(instrumentDirectory))"))
say(await smalltalk("GstCheck open"))
await render("placeholder")

for (index, dot) in dots.enumerated() {
    let name = URL(fileURLWithPath: dot).deletingPathExtension().lastPathComponent
    let id = ProcessInfo.processInfo.environment["SAME_ID"] != nil ? 1 : index + 1
    let pipeline = "{\"id\":\"0x\(String(id, radix: 16))000\",\"name\":\"\(name)\",\"type\":\"GstPipeline\",\"state\":\"playing\",\"pending\":\"void-pending\"}"
    print("== \(name) (\((try? Data(contentsOf: URL(fileURLWithPath: dot)).count) ?? 0) bytes)")
    await feed(dot, pipeline: pipeline)
    say(await smalltalk("GstCheck profile"))
    say(await smalltalk("GstCheck counts"))
    say(await smalltalk("GstCheck geometry"))
    say(await smalltalk("GstCheck report"))
    await render(name)
    print("again, same bytes:")
    await feed(dot, pipeline: pipeline)
}

if let last = dots.last {
    let name = URL(fileURLWithPath: last).deletingPathExtension().lastPathComponent
    print("== steering \(name)")
    await input(event("zoom", x: 0.2, y: 0.1, factor: 2.5))
    await input(event("down", x: 0.2, y: 0.1, buttons: 1))
    await input(event("move", x: 0.0, y: 0.0, buttons: 1))
    await input(event("up", x: 0.0, y: 0.0))
    await render("\(name)-zoomed")
    await input(event("scroll", x: 0, y: 0, dx: -120, dy: 40))
    await render("\(name)-scrolled")
    await input(event("keyDown", x: 0, y: 0, key: Int(Character("f").asciiValue!)))
    await render("\(name)-fitted")
    for target in ProcessInfo.processInfo.environment["CLICK"]?.split(separator: ";").map(String.init) ?? [] {
        say(await smalltalk("GstCheck clickOn: \(literal(target)) width: \(width) height: \(height)"))
        await render("\(name)-clicked-\(target.prefix(24).replacingOccurrences(of: " ", with: "_").replacingOccurrences(of: "/", with: "_"))")
    }
    if let extra = ProcessInfo.processInfo.environment["EVAL"] {
        say(await smalltalk(extra))
    }
    for (label, x, y) in [("caption", 40, 15), ("empty canvas", width / 2, height - 6)] {
        say(await smalltalk("GstCheck clickScreen: \(x) @ \(y) width: \(width) height: \(height)"))
        print("(that was the \(label))")
    }
    for focus in ProcessInfo.processInfo.environment["FOCUS"]?.split(separator: ";").map(String.init) ?? [] {
        let parts = focus.split(separator: "@").map(String.init)
        say(await smalltalk("GstCheck focus: \(literal(parts[0])) zoom: \(parts[1])"))
        await render("\(name)-focus-\(parts[0])")
    }
    for object in host.spawned {
        print("spawned \(object.printString) (\(object.className)), the inspector would show:")
        do {
            for declaration in try await PharoRuntime.shared.views(of: object) {
                print("  \(declaration.viewName) '\(declaration.title)'")
            }
        } catch {
            print("ERROR: the inspector could not read its views: \(error)")
        }
    }
    print("host requests: \(host.operations.sorted { $0.key < $1.key }.map { "\($0.key) \($0.value)" }.joined(separator: ", "))")
    print("== clear")
    say(await smalltalk("GstCheck clear"))
    await render("cleared")
}
exit(0)
