import Foundation

enum SessionStatus: String, Codable { case recording, finished, interrupted }

struct SessionMetadata: Codable, Identifiable {
    var id = UUID()
    var participantID: String
    var batch: String
    var route: String
    var direction: String
    var deviceID: String
    var deviceName: String
    var source: String
    var startedAt: Date
    var endedAt: Date?
    var status: SessionStatus = .recording
    var timeZoneIdentifier: String
    var utcOffsetSeconds: Int
    var formatVersion = 2
    var hrvAlgorithm = "RMSSD-60s-v1"
    var hrvWindowSeconds = 60
    var hrvRules = "RR 300–2000 ms; successive change <=20%; >=30 valid beats, >=20 adjacent valid pairs, valid fraction >=0.8; reset on contact loss, reconnect or receive gap >5 s. Exploratory, not clinically validated."
}

struct HeartMeasurement: Equatable {
    var bpm: Int
    var contact: Bool?
    var rrMilliseconds: [Double]
}

struct HeartSample: Codable {
    var bpm: Int
    var contact: Bool?
    var packetID: UUID
    var rrCount: Int
    var rawHex: String
}

struct RRSample: Codable {
    var packetID: UUID
    var index: Int
    var milliseconds: Double
    // Relative position only: BLE HR packets do not carry absolute beat timestamps.
    var offsetFromPacketEndMs: Double
    var valid: Bool
    var exclusion: String?
}

struct GPSPoint: Codable {
    var sampledAt: Date
    // Optional to preserve decoding of v1 sessions already recorded on the phone.
    var sampledAtBeijing: String?
    var sampledUnixMilliseconds: Int64?
    var latitude: Double
    var longitude: Double
    var altitude: Double
    var horizontalAccuracy: Double
    var speed: Double?
    var usable: Bool
    var source: String
}

struct HRVSample: Codable {
    var rmssdMs: Double?
    var windowSeconds: Double
    var validFraction: Double
    var totalBeats: Int
    var validBeats: Int
    var pairs: Int
    var state: String
}

struct StudyEvent: Codable, Identifiable {
    var id = UUID()
    var code: String
    var label: String
    var note: String
    var location: GPSPoint?
    var locationAgeSeconds: Double?
}

struct StudyRecord: Codable {
    var sequence: Int = 0
    var kind: String
    var timestamp: Date
    var timestampBeijing: String?
    var timestampUnixMilliseconds: Int64?
    var elapsedSeconds: Double
    var heart: HeartSample?
    var rr: RRSample?
    var gps: GPSPoint?
    var hrv: HRVSample?
    var event: StudyEvent?
    var message: String?
}

enum Stage: Int, CaseIterable {
    case ready, baseline, baselineDone, walking, done
    var nextCode: String? { ["A", "B", "C", "D", nil][rawValue] }
    var nextLabel: String? { ["基线开始", "基线结束", "步行开始", "步行结束", nil][rawValue] }
    var label: String { ["准备基线", "基线采集中", "基线已结束", "步行采集中", "步行已结束"][rawValue] }
    var advanced: Stage { Stage(rawValue: min(rawValue + 1, 4))! }
}

enum HeartPacketParser {
    enum ParseError: Error { case truncated, invalidRR }

    /// Bluetooth SIG HRS 0x2A37; RR integers are 1/1024 seconds, not milliseconds.
    static func parse(_ data: Data) throws -> HeartMeasurement {
        let bytes = [UInt8](data)
        guard bytes.count >= 2 else { throw ParseError.truncated }
        let flags = bytes[0]
        var index = 1
        func read16() throws -> Int {
            guard index + 1 < bytes.count else { throw ParseError.truncated }
            let value = Int(bytes[index]) | (Int(bytes[index + 1]) << 8)
            index += 2
            return value
        }
        let bpm: Int
        if flags & 1 != 0 { bpm = try read16() }
        else { bpm = Int(bytes[index]); index += 1 }
        let contact: Bool? = flags & 4 != 0 ? flags & 2 != 0 : nil
        if flags & 8 != 0 { _ = try read16() }
        var rr: [Double] = []
        if flags & 16 != 0 {
            guard (bytes.count - index).isMultiple(of: 2), index < bytes.count else {
                throw ParseError.invalidRR
            }
            while index < bytes.count { rr.append(Double(try read16()) * 1000 / 1024) }
        }
        return HeartMeasurement(bpm: bpm, contact: contact, rrMilliseconds: rr)
    }
}

enum HRVMath {
    static func rmssd(_ intervals: [Double]) -> Double? {
        guard intervals.count >= 2 else { return nil }
        let sum = zip(intervals.dropFirst(), intervals).reduce(0.0) { $0 + pow($1.0 - $1.1, 2) }
        return sqrt(sum / Double(intervals.count - 1))
    }
}

struct HRVWindow {
    struct Beat { var time: Double; var rr: Double; var valid: Bool }
    private(set) var beats: [Beat] = []
    private var segmentStart: Double?
    private var lastReceive: Double?
    private var previousRawRR: Double?
    var windowSeconds: Double = 60

    mutating func reset() {
        beats.removeAll(); segmentStart = nil; lastReceive = nil; previousRawRR = nil
    }

    mutating func ingest(_ intervals: [Double], elapsed: Double, contact: Bool?, packet: UUID) -> ([RRSample], HRVSample) {
        if let last = lastReceive, elapsed - last > 5 { reset() }
        if contact == false { reset() }
        if !intervals.isEmpty { lastReceive = elapsed }
        var offset = -intervals.dropFirst().reduce(0, +)
        var samples: [RRSample] = []
        for (index, rr) in intervals.enumerated() {
            var exclusion: String?
            if contact == false { exclusion = "no_skin_contact" }
            else if !(300...2000).contains(rr) { exclusion = "outside_300_2000_ms" }
            else if let previous = previousRawRR, previous > 0, abs(rr - previous) / previous > 0.2 {
                exclusion = "successive_change_over_20_percent"
            }
            let sample = RRSample(packetID: packet, index: index, milliseconds: rr,
                                  offsetFromPacketEndMs: offset, valid: exclusion == nil, exclusion: exclusion)
            samples.append(sample)
            let beatTime = elapsed + offset / 1000
            if segmentStart == nil, contact != false { segmentStart = beatTime }
            beats.append(Beat(time: beatTime, rr: rr, valid: sample.valid))
            previousRawRR = rr
            if index + 1 < intervals.count { offset += intervals[index + 1] }
        }
        beats.removeAll { $0.time < elapsed - windowSeconds }
        let valid = beats.filter(\.valid).count
        let fraction = beats.isEmpty ? 0 : Double(valid) / Double(beats.count)
        let pairs = zip(beats.dropFirst(), beats).filter { $0.valid && $1.valid }
        let warm = segmentStart.map { elapsed - $0 >= windowSeconds } ?? false
        let ready = warm && !intervals.isEmpty && valid >= 30 && pairs.count >= 20 && fraction >= 0.8 && contact != false
        let rmssd = ready ? sqrt(pairs.reduce(0.0) { $0 + pow($1.0.rr - $1.1.rr, 2) } / Double(pairs.count)) : nil
        let state = contact == false ? "no_contact" : (ready ? "ready" : (warm ? "low_quality" : "warming_up"))
        return (samples, HRVSample(rmssdMs: rmssd, windowSeconds: windowSeconds,
                validFraction: fraction, totalBeats: beats.count, validBeats: valid, pairs: pairs.count, state: state))
    }
}
