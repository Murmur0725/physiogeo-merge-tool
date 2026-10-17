import Foundation

final class SessionStore {
    let root: URL
    private var handle: FileHandle?
    private var sequence = 0

    static func encoder() -> JSONEncoder {
        let encoder = JSONEncoder()
        encoder.dateEncodingStrategy = .millisecondsSince1970
        encoder.outputFormatting = [.sortedKeys]
        return encoder
    }

    static func decoder() -> JSONDecoder {
        let decoder = JSONDecoder()
        decoder.dateDecodingStrategy = .millisecondsSince1970
        return decoder
    }

    init(root: URL) throws {
        self.root = root
        try FileManager.default.createDirectory(at: root, withIntermediateDirectories: true)
        // An open manifest from a previous process is interrupted, never silently resumed.
        for var session in try list() where session.status == .recording {
            let records = try readRecords(session.id)
            session.status = .interrupted
            session.endedAt = records.last?.timestamp ?? session.startedAt
            try saveMetadata(session)
        }
    }

    func directory(_ id: UUID) -> URL { root.appendingPathComponent(id.uuidString, isDirectory: true) }

    func list() throws -> [SessionMetadata] {
        try FileManager.default.contentsOfDirectory(at: root, includingPropertiesForKeys: nil)
            .filter { UUID(uuidString: $0.lastPathComponent) != nil }
            .compactMap { folder in
                let url = folder.appendingPathComponent("metadata.json")
                guard FileManager.default.fileExists(atPath: url.path) else { return nil }
                return try Self.decoder().decode(SessionMetadata.self, from: Data(contentsOf: url))
            }.sorted { $0.startedAt > $1.startedAt }
    }

    func begin(_ metadata: SessionMetadata) throws {
        try close()
        let folder = directory(metadata.id)
        try FileManager.default.createDirectory(at: folder, withIntermediateDirectories: true)
        try saveMetadata(metadata)
        let url = folder.appendingPathComponent("records.jsonl")
        guard FileManager.default.createFile(atPath: url.path, contents: nil,
            attributes: [.protectionKey: FileProtectionType.completeUntilFirstUserAuthentication]) else {
            throw CocoaError(.fileWriteUnknown)
        }
        handle = try FileHandle(forWritingTo: url)
        sequence = 0
    }

    func append(_ records: [StudyRecord]) throws {
        guard let handle else { throw CocoaError(.fileWriteUnknown) }
        var data = Data()
        for var record in records {
            sequence += 1
            record.sequence = sequence
            record.timestampBeijing = StudyTime.beijing(record.timestamp)
            record.timestampUnixMilliseconds = StudyTime.unixMilliseconds(record.timestamp)
            if var point = record.gps {
                point.sampledAtBeijing = StudyTime.beijing(point.sampledAt)
                point.sampledUnixMilliseconds = StudyTime.unixMilliseconds(point.sampledAt)
                record.gps = point
            }
            if var point = record.event?.location {
                point.sampledAtBeijing = StudyTime.beijing(point.sampledAt)
                point.sampledUnixMilliseconds = StudyTime.unixMilliseconds(point.sampledAt)
                record.event?.location = point
            }
            data.append(try Self.encoder().encode(record))
            data.append(0x0A)
        }
        try handle.write(contentsOf: data)
        // Each notification/event is durable before the UI reports success.
        try handle.synchronize()
    }

    func finish(_ metadata: SessionMetadata) throws {
        try close()
        try saveMetadata(metadata)
    }

    func close() throws {
        if let handle { try handle.synchronize(); try handle.close() }
        handle = nil
    }

    private func saveMetadata(_ metadata: SessionMetadata) throws {
        try Self.encoder().encode(metadata).write(to: directory(metadata.id).appendingPathComponent("metadata.json"),
            options: [.atomic, .completeFileProtectionUntilFirstUserAuthentication])
    }

    func readRecords(_ id: UUID) throws -> [StudyRecord] {
        let url = directory(id).appendingPathComponent("records.jsonl")
        guard FileManager.default.fileExists(atPath: url.path) else { return [] }
        let data = try Data(contentsOf: url)
        var lines = data.split(separator: 0x0A, omittingEmptySubsequences: true)
        // A crash may leave a partial final line. Only complete, newline-committed rows count.
        if data.last != 0x0A, !lines.isEmpty { lines.removeLast() }
        return try lines.map { try Self.decoder().decode(StudyRecord.self, from: Data($0)) }
    }

    func deleteSession(_ id: UUID) throws {
        let folder = directory(id)
        // Check the persisted state too; a stale history screen must never delete a live session.
        let metadata = try Self.decoder().decode(SessionMetadata.self,
            from: Data(contentsOf: folder.appendingPathComponent("metadata.json")))
        guard metadata.status != .recording else { throw CocoaError(.fileWriteNoPermission) }
        let exports = root.appendingPathComponent("Exports", isDirectory: true)
            .appendingPathComponent(id.uuidString, isDirectory: true)
        if FileManager.default.fileExists(atPath: exports.path) {
            try FileManager.default.removeItem(at: exports)
        }
        try FileManager.default.removeItem(at: folder)
    }

    deinit { try? handle?.close() }
}

enum StudyExport {
    static func participantFolderName(_ participant: String) -> String {
        let forbidden = CharacterSet(charactersIn: "/\\:*?\"<>|").union(.controlCharacters)
        let cleaned = participant.components(separatedBy: forbidden).joined(separator: "_")
            .trimmingCharacters(in: .whitespacesAndNewlines.union(CharacterSet(charactersIn: ".")))
        // Leave room for a date suffix within common file-system component limits.
        var name = ""
        for character in cleaned {
            guard (name + String(character)).utf8.count <= 120 else { break }
            name.append(character)
        }
        return name.isEmpty ? "未命名参与者" : name
    }

    static func dateSuffix(_ session: SessionMetadata) -> String {
        let formatter = DateFormatter()
        formatter.locale = Locale(identifier: "en_US_POSIX")
        formatter.timeZone = TimeZone(identifier: "Asia/Shanghai")
        formatter.dateFormat = "yyyyMMdd_HHmmss_SSS"
        return formatter.string(from: session.startedAt)
    }

    /// Copy all files together. A collision always creates a new folder, never replaces data.
    static func saveFolder(_ folder: URL, to destination: URL, session: SessionMetadata) throws -> URL {
        let sourcePath = folder.resolvingSymlinksInPath().standardizedFileURL.path
        let destinationPath = destination.resolvingSymlinksInPath().standardizedFileURL.path
        guard destinationPath != sourcePath, !destinationPath.hasPrefix(sourcePath + "/") else {
            throw CocoaError(.fileWriteInvalidFileName)
        }
        var coordinationError: NSError?
        var result: Result<URL, Error> = .failure(CocoaError(.fileWriteUnknown))
        NSFileCoordinator().coordinate(writingItemAt: destination, options: [], error: &coordinationError) { directory in
            result = Result {
                let base = participantFolderName(session.participantID)
                let staging = directory.appendingPathComponent(".SomaticCity-export-" + UUID().uuidString, isDirectory: true)
                do { try FileManager.default.copyItem(at: folder, to: staging) }
                catch { try? FileManager.default.removeItem(at: staging); throw error }
                defer { try? FileManager.default.removeItem(at: staging) }
                var index = 0
                while true {
                    let suffix = index == 0 ? "" : "_" + dateSuffix(session) + (index == 1 ? "" : "_\(index)")
                    let target = directory.appendingPathComponent(base + suffix, isDirectory: true)
                    if FileManager.default.fileExists(atPath: target.path) { index += 1; continue }
                    do {
                        try FileManager.default.moveItem(at: staging, to: target)
                        return target
                    } catch let error as CocoaError where error.code == .fileWriteFileExists {
                        index += 1
                    }
                }
            }
        }
        if let coordinationError { throw coordinationError }
        return try result.get()
    }

    static func archive(_ folder: URL, session: SessionMetadata) throws -> URL {
        let target = folder.deletingLastPathComponent().appendingPathComponent(
            participantFolderName(session.participantID) + "_" + dateSuffix(session) + ".zip")
        var coordinationError: NSError?
        var result: Result<Void, Error> = .failure(CocoaError(.fileWriteUnknown))
        // Apple's file coordinator produces a ZIP snapshot for a directory.
        NSFileCoordinator().coordinate(readingItemAt: folder, options: .forUploading, error: &coordinationError) { snapshot in
            result = Result {
                try Data(contentsOf: snapshot, options: .mappedIfSafe).write(to: target,
                    options: [.atomic, .completeFileProtectionUntilFirstUserAuthentication])
            }
        }
        if let coordinationError { throw coordinationError }
        try result.get()
        return target
    }

    static func csv(_ rows: [[String]]) -> String {
        "\u{FEFF}" + rows.map { row in
            row.map { value in
                if value.contains(",") || value.contains("\"") || value.contains("\n") || value.contains("\r") {
                    return "\"" + value.replacingOccurrences(of: "\"", with: "\"\"") + "\""
                }
                return value
            }.joined(separator: ",")
        }.joined(separator: "\r\n") + "\r\n"
    }

    static func number(_ value: Double?) -> String {
        guard let value, value.isFinite else { return "" }
        return String(format: "%.6f", locale: Locale(identifier: "en_US_POSIX"), value)
    }

    static func utc(_ date: Date) -> String {
        let formatter = ISO8601DateFormatter()
        formatter.formatOptions = [.withInternetDateTime, .withFractionalSeconds]
        return formatter.string(from: date)
    }

    static func local(_ date: Date, session: SessionMetadata, pattern: String = "yyyy-MM-dd HH:mm:ss.SSS") -> String {
        let formatter = DateFormatter()
        formatter.locale = Locale(identifier: "en_US_POSIX")
        formatter.timeZone = TimeZone(identifier: session.timeZoneIdentifier) ?? TimeZone(secondsFromGMT: session.utcOffsetSeconds)
        formatter.dateFormat = pattern
        return formatter.string(from: date)
    }

    static func export(_ session: SessionMetadata, store: SessionStore) throws -> [URL] {
        guard session.status != .recording else { throw CocoaError(.fileWriteNoPermission) }
        let records = try store.readRecords(session.id)
        let folder = store.root.appendingPathComponent("Exports", isDirectory: true)
            .appendingPathComponent(session.id.uuidString, isDirectory: true)
            .appendingPathComponent(participantFolderName(session.participantID), isDirectory: true)
        try FileManager.default.createDirectory(at: folder, withIntermediateDirectories: true)
        var files: [URL] = []
        func write(_ name: String, _ text: String) throws {
            let url = folder.appendingPathComponent(name)
            try text.write(to: url, atomically: true, encoding: .utf8)
            try FileManager.default.setAttributes([.protectionKey: FileProtectionType.completeUntilFirstUserAuthentication], ofItemAtPath: url.path)
            files.append(url)
        }
        func table(_ name: String, _ rows: [[String]]) throws { try write(name, csv(rows)) }

        var hr = [["received_at_utc", "elapsed_s", "bpm", "skin_contact", "packet_id", "rr_count", "raw_hex", "received_at_beijing", "received_unix_ms"]]
        var rr = [["received_at_utc", "elapsed_s", "packet_id", "rr_index", "rr_ms", "offset_from_packet_end_ms", "valid", "exclusion", "received_at_beijing", "received_unix_ms"]]
        var gps = [["sampled_at_utc", "received_at_utc", "elapsed_s", "latitude", "longitude", "altitude_m", "accuracy_m", "speed_m_s", "usable", "source", "sampled_at_beijing", "sampled_unix_ms", "received_at_beijing", "received_unix_ms"]]
        var events = [["timestamp_utc", "elapsed_s", "code", "label", "note", "latitude", "longitude", "gps_sampled_at_utc", "gps_age_s", "gps_accuracy_m", "timestamp_beijing", "timestamp_unix_ms", "gps_sampled_at_beijing", "gps_sampled_unix_ms"]]
        var hrv = [["window_end_received_at_utc", "elapsed_s", "rmssd_ms", "window_s", "valid_fraction", "total_beats", "valid_beats", "adjacent_valid_pairs", "state", "algorithm", "window_end_received_at_beijing", "window_end_unix_ms"]]
        var status = [["timestamp_utc", "elapsed_s", "message", "timestamp_beijing", "timestamp_unix_ms"]]
        var marks = [["展示时间", "备注", "事件名称", "补充说明", "timestamp_utc", "elapsed_s", "北京时间", "unix_ms"]]
        var compatibleRR = [["timestamp", "rr_ms"]]
        let start = local(session.startedAt, session: session, pattern: "HH:mm:ss")
        let date = local(session.startedAt, session: session, pattern: "yyyy-MM-dd")
        let hrOrigin = floor(session.startedAt.timeIntervalSince1970)
        var compatibleHR = [["Date", "Start time"], [date, start], ["Time", "HR (bpm)"]]
        for record in records {
            let time = utc(record.timestamp)
            let elapsed = number(record.elapsedSeconds)
            let beijing = StudyTime.beijing(record.timestamp)
            let unixMs = String(StudyTime.unixMilliseconds(record.timestamp))
            if let sample = record.heart {
                hr.append([time, elapsed, String(sample.bpm), sample.contact.map { $0 ? "Y" : "N" } ?? "unknown", sample.packetID.uuidString, String(sample.rrCount), sample.rawHex, beijing, unixMs])
                let seconds = max(0, Int(floor(record.timestamp.timeIntervalSince1970) - hrOrigin))
                let duration = String(format: "%02d:%02d:%02d", seconds / 3600, seconds / 60 % 60, seconds % 60)
                if sample.contact != false { compatibleHR.append([duration, String(sample.bpm)]) }
            }
            if let sample = record.rr {
                rr.append([time, elapsed, sample.packetID.uuidString, String(sample.index), number(sample.milliseconds), number(sample.offsetFromPacketEndMs), sample.valid ? "Y" : "N", sample.exclusion ?? "", beijing, unixMs])
                if sample.valid { compatibleRR.append([local(record.timestamp, session: session), number(sample.milliseconds)]) }
            }
            if let point = record.gps {
                gps.append([utc(point.sampledAt), time, elapsed, number(point.latitude), number(point.longitude), number(point.altitude), number(point.horizontalAccuracy), number(point.speed), point.usable ? "Y" : "N", point.source, StudyTime.beijing(point.sampledAt), String(StudyTime.unixMilliseconds(point.sampledAt)), beijing, unixMs])
            }
            if let event = record.event {
                events.append([time, elapsed, event.code, event.label, event.note, number(event.location?.latitude), number(event.location?.longitude), event.location.map { utc($0.sampledAt) } ?? "", number(event.locationAgeSeconds), number(event.location?.horizontalAccuracy), beijing, unixMs, event.location.map { StudyTime.beijing($0.sampledAt) } ?? "", event.location.map { String(StudyTime.unixMilliseconds($0.sampledAt)) } ?? ""])
                marks.append([local(record.timestamp, session: session), event.code, event.label, event.note, time, elapsed, beijing, unixMs])
            }
            if let sample = record.hrv {
                hrv.append([time, elapsed, number(sample.rmssdMs), number(sample.windowSeconds), number(sample.validFraction), String(sample.totalBeats), String(sample.validBeats), String(sample.pairs), sample.state, session.hrvAlgorithm, beijing, unixMs])
            }
            if let message = record.message { status.append([time, elapsed, message, beijing, unixMs]) }
        }
        try table("heart_rate_raw.csv", hr)
        try table("rr_raw.csv", rr)
        try table("gps_raw.csv", gps)
        try table("events.csv", events)
        try table("hrv.csv", hrv)
        try table("diagnostics.csv", status)
        try table("marks.csv", marks)
        try table("rr.csv", compatibleRR)
        try table("hr.csv", compatibleHR)
        var segments: [String] = []
        var segment = ""
        var lastGPS: Date?
        for record in records {
            guard let point = record.gps else { continue }
            guard point.usable else {
                if !segment.isEmpty { segments.append(segment); segment = "" }
                lastGPS = nil
                continue
            }
            if let lastGPS, point.sampledAt.timeIntervalSince(lastGPS) > 30, !segment.isEmpty {
                segments.append(segment); segment = ""
            }
            segment += "<trkpt lat=\"\(number(point.latitude))\" lon=\"\(number(point.longitude))\"><ele>\(number(point.altitude))</ele><time>\(utc(point.sampledAt))</time></trkpt>\n"
            lastGPS = point.sampledAt
        }
        if !segment.isEmpty { segments.append(segment) }
        let tracks = segments.map { "<trkseg>\n" + $0 + "</trkseg>" }.joined(separator: "\n")
        try write("route.gpx", "<?xml version=\"1.0\" encoding=\"UTF-8\"?>\n<gpx version=\"1.1\" creator=\"SomaticCity\" xmlns=\"http://www.topografix.com/GPX/1/1\"><trk><name>\(session.id.uuidString)</name>\(tracks)</trk></gpx>")
        let summary = """
        Somatic City session \(session.id.uuidString)
        Source: \(session.source). Status: \(session.status.rawValue).
        Started UTC: \(utc(session.startedAt)). Timezone: \(session.timeZoneIdentifier).
        Started Beijing (UTC+08:00): \(StudyTime.beijing(session.startedAt)).
        All detailed CSVs include explicit Beijing (Asia/Shanghai) and Unix millisecond columns, independent of phone timezone.
        GPS is from the iPhone Core Location service, not the Polar H10. Demo/simulated positions are explicitly labelled.
        Raw UTC timestamps preserve milliseconds; elapsed_s uses a monotonic clock during this process.
        HR/RR timestamps are phone receipt times, NOT absolute R-peak times. Offset is within a packet only.
        rr_raw.csv preserves every RR value and exclusion reason. rr.csv contains only accepted RR values.
        HRV: \(session.hrvRules)
        No missing values are interpolated. GPS usable: horizontal accuracy 0–50 m and sample age <=15 s at receipt.
        Event coordinates are a recent usable fix (<=15 s); gps_age_s identifies its age, not a new synchronous fix.
        Web import: marks.csv + rr.csv + hr.csv + route.gpx; EEG is a separate optional source.
        Compatibility CSV uses session local time and may lose subsecond precision in the existing Web merger.
        Import on a computer whose system timezone matches the session timezone. Web Route timezone affects EEG only.
        The existing Web merger aggregates and forward-fills RR; use rr_raw.csv for HRV analysis. Raw files are authoritative.
        CSV/GPX exports are snapshots; original JSONL and metadata are also included.
        An interrupted session is never silently resumed. A partial final JSONL line, if any, is excluded.
        """
        try write("README.txt", summary)
        for name in ["metadata.json", "records.jsonl"] {
            let data = try Data(contentsOf: store.directory(session.id).appendingPathComponent(name))
            let target = folder.appendingPathComponent(name)
            try data.write(to: target, options: [.atomic, .completeFileProtectionUntilFirstUserAuthentication])
            files.append(target)
        }
        return files
    }
}
