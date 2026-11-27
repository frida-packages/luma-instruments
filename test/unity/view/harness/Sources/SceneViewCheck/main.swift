import Foundation
import LumaCore
import SwiftyPharo

let arguments = CommandLine.arguments
guard arguments.count == 6 else {
    FileHandle.standardError.write(Data("usage: SceneViewCheck <instrument dir> <SceneCheck.class.st> <hierarchy.tsv> <object name> <inspection.json>\n".utf8))
    exit(2)
}
let instrumentDirectory = arguments[1]
let harnessSource = try String(contentsOfFile: arguments[2], encoding: .utf8)
let hierarchyPath = arguments[3]
let openedName = arguments[4]
let inspection = try String(contentsOfFile: arguments[5], encoding: .utf8)
let state = try String(contentsOfFile: URL(fileURLWithPath: hierarchyPath).deletingPathExtension().appendingPathExtension("json").path, encoding: .utf8)

PharoWorkspace.boot()
try await PharoRuntime.shared.runningState()
try await PharoLumaBindings.install(into: PharoRuntime.shared)

final class HostLog: @unchecked Sendable {
    var operations: [String: Int] = [:]
    var sent: [String] = []
}
let host = HostLog()
PharoAsyncBridge.shared.serve { request in
    let operation = request["op"] as? String ?? "?"
    host.operations[operation, default: 0] += 1
    if operation == "view_send", let json = request["json"] as? String {
        host.sent.append(json)
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

say(await smalltalk("""
    (TonelParser parseString: \(literal(harnessSource))) do: [ :each | each load ].
    'harness loaded'
    """))
say(await smalltalk("SceneCheck load: \(literal(instrumentDirectory))"))
print("== before any state")
say(await smalltalk("SceneCheck open"))

let data = try Data(contentsOf: URL(fileURLWithPath: hierarchyPath))
let blob = PharoBlobRegistry.shared.lend(SharedBytes(copying: data), to: UUID())
print("== state, \(data.count) bytes")
say(await smalltalk("SceneCheck feed: \(literal(state)) blob: \(blob) size: \(data.count)"))
say(await smalltalk("SceneCheck reportView"))

print("== opening \(openedName)")
say(await smalltalk("SceneCheck openNamed: \(literal(openedName))"))
print("sent to the agent: \(host.sent.joined(separator: ", "))")

print("== inspection arrives")
say(await smalltalk("SceneCheck inspection: \(literal(inspection))"))
say(await smalltalk("SceneCheck reportComponents"))

print("== a missing GameObject")
say(await smalltalk("SceneCheck inspection: '{\"inspected\": -1, \"components\": null, \"shortened\": false}'"))

print("== cleared")
say(await smalltalk("SceneCheck clear"))
print("host requests: \(host.operations.sorted { $0.key < $1.key }.map { "\($0.key) \($0.value)" }.joined(separator: ", "))")
exit(0)
