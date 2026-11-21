import Foundation

setvbuf(stdout, nil, _IOLBF, 0)

let arguments = CommandLine.arguments.dropFirst()
let url = URL(string: arguments.first { !$0.hasPrefix("--") } ?? "https://example.com/")!
let assumesHTTP3 = arguments.contains("--h3")

final class ProtocolReporter: NSObject, URLSessionTaskDelegate {
    func urlSession(_ session: URLSession, task: URLSessionTask, didFinishCollecting metrics: URLSessionTaskMetrics) {
        let protocols = metrics.transactionMetrics.map { $0.networkProtocolName ?? "?" }
        print("protocol \(protocols.joined(separator: ", "))")
    }
}

let configuration = URLSessionConfiguration.ephemeral
configuration.urlCache = nil
let session = URLSession(configuration: configuration, delegate: ProtocolReporter(), delegateQueue: nil)

print("pid \(ProcessInfo.processInfo.processIdentifier), fetching \(url) every 2 s\(assumesHTTP3 ? ", assuming HTTP/3" : "")")

func fetch() {
    var request = URLRequest(url: url, cachePolicy: .reloadIgnoringLocalCacheData)
    request.assumesHTTP3Capable = assumesHTTP3
    session.dataTask(with: request) { data, response, error in
        if let error {
            print("error: \(error.localizedDescription)")
        } else if let response = response as? HTTPURLResponse {
            print("\(response.statusCode), \(data?.count ?? 0) bytes")
        }
    }.resume()
}

fetch()
Timer.scheduledTimer(withTimeInterval: 2, repeats: true) { _ in fetch() }
RunLoop.main.run()
