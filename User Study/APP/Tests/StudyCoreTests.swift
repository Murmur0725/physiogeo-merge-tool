import XCTest
@testable import StudyCore

final class StudyCoreTests: XCTestCase {
    func metadata() -> SessionMetadata {
        SessionMetadata(participantID: "P01", batch: "B1", route: "测试路线", direction: "AB",
            deviceID: "test", deviceName: "H10", source: "test", startedAt: Date(timeIntervalSince1970: 1_700_000_000.125),
            timeZoneIdentifier: "Asia/Shanghai", utcOffsetSeconds: 28_800)
    }

    func temporaryStore() throws -> (SessionStore, URL) {
        let root = FileManager.default.temporaryDirectory.appendingPathComponent(UUID().uuidString)
        return (try SessionStore(root: root), root)
    }

    func testRRUnitAndMultipleIntervals() throws {
        let packet = try HeartPacketParser.parse(Data([0x16, 60, 0, 4, 0, 2]))
        XCTAssertEqual(packet.bpm, 60)
        XCTAssertEqual(packet.contact, true)
        XCTAssertEqual(packet.rrMilliseconds, [1000, 500])
    }

    func test16BitHeartRateWithEnergyAndUnknownContact() throws {
        let packet = try HeartPacketParser.parse(Data([0x19, 44, 1, 5, 0, 0, 4]))
        XCTAssertEqual(packet.bpm, 300)
        XCTAssertNil(packet.contact)
        XCTAssertEqual(packet.rrMilliseconds, [1000])
    }

    func testContactLossAndMissingRR() throws {
        let packet = try HeartPacketParser.parse(Data([0x04, 70]))
        XCTAssertEqual(packet.contact, false)
        XCTAssertTrue(packet.rrMilliseconds.isEmpty)
    }

    func testRejectTruncatedAndOddRRPackets() {
        for bytes: [UInt8] in [[], [0], [1, 50], [0x10, 60, 0], [0x10, 60], [0x08, 60, 1]] {
            XCTAssertThrowsError(try HeartPacketParser.parse(Data(bytes)))
        }
    }

    func testKnownRMSSD() {
        XCTAssertEqual(HRVMath.rmssd([1000, 1100, 1000])!, 100, accuracy: 0.0001)
        XCTAssertEqual(HRVMath.rmssd([1000, 1000])!, 0)
        XCTAssertNil(HRVMath.rmssd([1000]))
    }

    func testHRVWarmupAndReceiveGapReset() {
        var window = HRVWindow()
        var result: HRVSample?
        for t in 0...61 { result = window.ingest([1000], elapsed: Double(t), contact: true, packet: UUID()).1 }
        XCTAssertEqual(result?.state, "ready")
        XCTAssertEqual(result?.rmssdMs, 0)
        result = window.ingest([1000], elapsed: 70, contact: true, packet: UUID()).1
        XCTAssertEqual(result?.state, "warming_up")
        XCTAssertNil(result?.rmssdMs)
    }

    func testArtifactsRemainRawAndDoNotBridgeInvalidPairs() {
        var window = HRVWindow()
        let output = window.ingest([1000, 100, 1000], elapsed: 3, contact: true, packet: UUID())
        XCTAssertEqual(output.0.map(\.milliseconds), [1000, 100, 1000])
        XCTAssertFalse(output.0[1].valid)
        XCTAssertEqual(output.1.pairs, 0)
        XCTAssertEqual(output.0.map(\.offsetFromPacketEndMs), [-1100, -1000, 0])
    }

    func testContactLossResetsWindow() {
        var window = HRVWindow()
        for t in 0...61 { _ = window.ingest([1000], elapsed: Double(t), contact: true, packet: UUID()) }
        let lost = window.ingest([1000], elapsed: 62, contact: false, packet: UUID())
        XCTAssertEqual(lost.1.state, "no_contact")
        XCTAssertFalse(lost.0[0].valid)
        XCTAssertNil(lost.1.rmssdMs)
    }

    func testHeartPacketsWithoutRRDoNotKeepHRVAlive() {
        var window = HRVWindow()
        for t in 0...61 { _ = window.ingest([1000], elapsed: Double(t), contact: true, packet: UUID()) }
        for t in 62...70 {
            let output = window.ingest([], elapsed: Double(t), contact: true, packet: UUID())
            XCTAssertNil(output.1.rmssdMs)
        }
        let restored = window.ingest([1000], elapsed: 71, contact: true, packet: UUID())
        XCTAssertEqual(restored.1.state, "warming_up")
        XCTAssertEqual(restored.1.totalBeats, 1)
    }

    func testCSVQuotingAndUnicode() {
        XCTAssertEqual(StudyExport.csv([["名称", "逗号,引号\"\n第二行"]]), "\u{FEFF}名称,\"逗号,引号\"\"\n第二行\"\r\n")
    }

    func testJournalRoundtripAndCrashRecovery() throws {
        let (store, root) = try temporaryStore()
        defer { try? FileManager.default.removeItem(at: root) }
        let session = metadata()
        try store.begin(session)
        try store.append([StudyRecord(kind: "event", timestamp: session.startedAt, elapsedSeconds: 0,
            event: StudyEvent(code: "A", label: "基线开始", note: "中文,\"备注\""))])
        try store.close()
        let recovered = try SessionStore(root: root)
        XCTAssertEqual(try recovered.list().first?.status, .interrupted)
        let rows = try recovered.readRecords(session.id)
        XCTAssertEqual(rows.count, 1)
        XCTAssertEqual(rows[0].sequence, 1)
        XCTAssertEqual(rows[0].event?.note, "中文,\"备注\"")
        XCTAssertEqual(rows[0].timestamp.timeIntervalSince1970, session.startedAt.timeIntervalSince1970, accuracy: 0.001)
        XCTAssertEqual(rows[0].timestampBeijing, "2023-11-15 06:13:20.125")
        XCTAssertEqual(rows[0].timestampUnixMilliseconds, 1_700_000_000_125)
    }

    func testPartialFinalLineExcludedButMiddleCorruptionFails() throws {
        let (store, root) = try temporaryStore()
        defer { try? FileManager.default.removeItem(at: root) }
        let session = metadata()
        try store.begin(session)
        try store.append([StudyRecord(kind: "status", timestamp: session.startedAt, elapsedSeconds: 0, message: "saved")])
        try store.close()
        let url = store.directory(session.id).appendingPathComponent("records.jsonl")
        let file = try FileHandle(forWritingTo: url)
        try file.seekToEnd(); try file.write(contentsOf: Data("{partial".utf8)); try file.close()
        XCTAssertEqual(try store.readRecords(session.id).count, 1)
        let file2 = try FileHandle(forWritingTo: url)
        try file2.seekToEnd(); try file2.write(contentsOf: Data("\n".utf8)); try file2.close()
        XCTAssertThrowsError(try store.readRecords(session.id))
    }

    func testExportRoundtripCompatibilityAndUTC() throws {
        let (store, root) = try temporaryStore()
        defer { try? FileManager.default.removeItem(at: root) }
        var session = metadata()
        try store.begin(session)
        let packet = UUID()
        let gps = GPSPoint(sampledAt: session.startedAt, latitude: 22.5, longitude: 114.1, altitude: 15,
            horizontalAccuracy: 8, speed: 1.1, usable: true, source: "test")
        try store.append([
            StudyRecord(kind: "heart", timestamp: session.startedAt, elapsedSeconds: 0,
                heart: HeartSample(bpm: 60, packetID: packet, rrCount: 1, rawHex: "103c0004")),
            StudyRecord(kind: "rr", timestamp: session.startedAt, elapsedSeconds: 0,
                rr: RRSample(packetID: packet, index: 0, milliseconds: 1000, offsetFromPacketEndMs: 0, valid: true)),
            StudyRecord(kind: "gps", timestamp: session.startedAt, elapsedSeconds: 0, gps: gps),
            StudyRecord(kind: "event", timestamp: session.startedAt, elapsedSeconds: 0,
                event: StudyEvent(code: "A", label: "基线开始", note: "中文"))
        ])
        session.status = .finished; session.endedAt = session.startedAt.addingTimeInterval(10)
        try store.finish(session)
        let files = try StudyExport.export(session, store: store)
        XCTAssertEqual(files.count, 13)
        let marks = try String(contentsOf: files.first { $0.lastPathComponent == "marks.csv" }!, encoding: .utf8)
        XCTAssertTrue(marks.contains("展示时间,备注"))
        XCTAssertTrue(marks.contains("2023-11-15 06:13:20.125,A"))
        let hr = try String(contentsOf: files.first { $0.lastPathComponent == "hr.csv" }!, encoding: .utf8)
        XCTAssertTrue(hr.contains("Date,Start time\r\n2023-11-15,06:13:20\r\nTime,HR (bpm)\r\n00:00:00,60"))
        let gpx = try String(contentsOf: files.first { $0.lastPathComponent == "route.gpx" }!, encoding: .utf8)
        XCTAssertTrue(gpx.contains("2023-11-14T22:13:20.125Z"))
        XCTAssertTrue(gpx.contains("lat=\"22.500000\" lon=\"114.100000\""))
        for name in ["heart_rate_raw.csv", "rr_raw.csv", "gps_raw.csv", "events.csv"] {
            let csv = try String(contentsOf: files.first { $0.lastPathComponent == name }!, encoding: .utf8)
            XCTAssertTrue(csv.contains("beijing"), name)
            XCTAssertTrue(csv.contains("2023-11-15 06:13:20.125"), name)
            XCTAssertTrue(csv.contains("1700000000125"), name)
        }
    }

    func testBeijingTimePreservesMillisecondsAndDateBoundary() {
        let date = Date(timeIntervalSince1970: 1_700_000_000.125)
        XCTAssertEqual(StudyTime.beijing(date), "2023-11-15 06:13:20.125")
        XCTAssertEqual(StudyTime.unixMilliseconds(date), 1_700_000_000_125)
        var chicago = metadata()
        chicago.timeZoneIdentifier = "America/Chicago"
        chicago.utcOffsetSeconds = -21_600
        XCTAssertEqual(StudyExport.local(date, session: chicago), "2023-11-14 16:13:20.125")
        XCTAssertEqual(StudyTime.beijing(date), "2023-11-15 06:13:20.125")
    }

    func testGPSAcquisitionAndEventReceiveTimesStayDistinctInBeijingExport() throws {
        let (store, root) = try temporaryStore()
        defer { try? FileManager.default.removeItem(at: root) }
        var session = metadata()
        session.timeZoneIdentifier = "America/Chicago"
        session.utcOffsetSeconds = -21_600
        try store.begin(session)
        let point = GPSPoint(sampledAt: session.startedAt, latitude: 22.5, longitude: 114.1,
            altitude: 15, horizontalAccuracy: 8, usable: true, source: "core_location")
        let receive = session.startedAt.addingTimeInterval(0.75)
        try store.append([
            StudyRecord(kind: "gps", timestamp: receive, elapsedSeconds: 0.75, gps: point),
            StudyRecord(kind: "event", timestamp: receive, elapsedSeconds: 0.75,
                event: StudyEvent(code: "EVENT", label: "过街", note: "", location: point, locationAgeSeconds: 0.75))
        ])
        session.status = .finished; session.endedAt = receive
        try store.finish(session)
        let records = try store.readRecords(session.id)
        XCTAssertEqual(records[0].gps?.sampledAtBeijing, "2023-11-15 06:13:20.125")
        XCTAssertEqual(records[0].gps?.sampledUnixMilliseconds, 1_700_000_000_125)
        XCTAssertEqual(records[0].timestampBeijing, "2023-11-15 06:13:20.875")
        XCTAssertEqual(records[1].event?.location?.sampledAtBeijing, "2023-11-15 06:13:20.125")
        let files = try StudyExport.export(session, store: store)
        for name in ["gps_raw.csv", "events.csv"] {
            let csv = try String(contentsOf: files.first { $0.lastPathComponent == name }!, encoding: .utf8)
            XCTAssertTrue(csv.contains("2023-11-15 06:13:20.125"))
            XCTAssertTrue(csv.contains("2023-11-15 06:13:20.875"))
            XCTAssertTrue(csv.contains("1700000000125"))
            XCTAssertTrue(csv.contains("1700000000875"))
        }
    }

    func testVersionOneRecordsWithoutBeijingFieldsStillDecode() throws {
        let legacy = Data("""
        {"sequence":1,"kind":"gps","timestamp":1700000000125,"elapsedSeconds":0,
        "gps":{"sampledAt":1700000000125,"latitude":22.5,"longitude":114.1,"altitude":15,
        "horizontalAccuracy":8,"usable":true,"source":"core_location"}}
        """.utf8)
        let record = try SessionStore.decoder().decode(StudyRecord.self, from: legacy)
        XCTAssertNil(record.timestampBeijing)
        XCTAssertNil(record.gps?.sampledAtBeijing)
        XCTAssertEqual(StudyTime.beijing(record.timestamp), "2023-11-15 06:13:20.125")
        XCTAssertEqual(record.gps?.source, "core_location")
    }

    func testCannotExportActiveSession() throws {
        let (store, root) = try temporaryStore()
        defer { try? FileManager.default.removeItem(at: root) }
        let session = metadata()
        try store.begin(session)
        XCTAssertThrowsError(try StudyExport.export(session, store: store))
        try store.close()
    }

    func testParticipantFolderNamesAreSafeAndKeepChinese() {
        XCTAssertEqual(StudyExport.participantFolderName("  小王 P01  "), "小王 P01")
        XCTAssertEqual(StudyExport.participantFolderName("../小王/测试\\A:B\n"), "_小王_测试_A_B_")
        for input in ["", "  ", ".", ".."] {
            XCTAssertEqual(StudyExport.participantFolderName(input), "未命名参与者")
        }
        let long = StudyExport.participantFolderName(String(repeating: "参与者🫀", count: 100))
        XCTAssertLessThanOrEqual(long.utf8.count, 120)
        XCTAssertFalse(long.isEmpty)
    }

    func testFolderExportKeepsAllFilesAndNeverReplacesExistingParticipant() throws {
        let (store, root) = try temporaryStore()
        defer { try? FileManager.default.removeItem(at: root) }
        var session = metadata()
        session.participantID = "小王 P01"
        try store.begin(session)
        try store.append([StudyRecord(kind: "event", timestamp: session.startedAt, elapsedSeconds: 0,
            event: StudyEvent(code: "A", label: "基线开始", note: "保留全部内容"))])
        session.status = .finished
        try store.finish(session)
        let files = try StudyExport.export(session, store: store)
        let folder = try XCTUnwrap(files.first?.deletingLastPathComponent())
        XCTAssertEqual(folder.lastPathComponent, "小王 P01")
        let destination = root.appendingPathComponent("ChosenDestination")
        try FileManager.default.createDirectory(at: destination, withIntermediateDirectories: true)
        let first = try StudyExport.saveFolder(folder, to: destination, session: session)
        let sentinel = first.appendingPathComponent("keep.txt")
        try Data("existing export".utf8).write(to: sentinel)
        let second = try StudyExport.saveFolder(folder, to: destination, session: session)
        let third = try StudyExport.saveFolder(folder, to: destination, session: session)
        XCTAssertEqual(first.lastPathComponent, "小王 P01")
        XCTAssertEqual(second.lastPathComponent, "小王 P01_20231115_061320_125")
        XCTAssertEqual(third.lastPathComponent, "小王 P01_20231115_061320_125_2")
        XCTAssertEqual(try String(contentsOf: sentinel, encoding: .utf8), "existing export")
        XCTAssertEqual(try FileManager.default.contentsOfDirectory(atPath: second.path).count, 13)
        for file in files {
            XCTAssertEqual(try Data(contentsOf: file), try Data(contentsOf: second.appendingPathComponent(file.lastPathComponent)))
        }
        XCTAssertThrowsError(try StudyExport.saveFolder(folder, to: folder, session: session))
        let child = folder.appendingPathComponent("child")
        try FileManager.default.createDirectory(at: child, withIntermediateDirectories: true)
        XCTAssertThrowsError(try StudyExport.saveFolder(folder, to: child, session: session))
        // Saving into the app's own Documents tree must not duplicate history entries.
        _ = try StudyExport.saveFolder(folder, to: root, session: session)
        XCTAssertEqual(try store.list().map(\.id), [session.id])
    }

    func testDeleteOneSessionKeepsOtherSessionsAndExternalExports() throws {
        let (store, root) = try temporaryStore()
        defer { try? FileManager.default.removeItem(at: root) }
        var first = metadata()
        try store.begin(first)
        try store.append([StudyRecord(kind: "status", timestamp: first.startedAt, elapsedSeconds: 0, message: "first")])
        first.status = .finished
        try store.finish(first)
        let files = try StudyExport.export(first, store: store)
        let destination = root.appendingPathComponent("ExternalExports")
        try FileManager.default.createDirectory(at: destination, withIntermediateDirectories: true)
        let external = try StudyExport.saveFolder(try XCTUnwrap(files.first?.deletingLastPathComponent()), to: destination, session: first)
        var second = metadata() // Same participant, separate experiment.
        try store.begin(second)
        try store.append([StudyRecord(kind: "status", timestamp: second.startedAt, elapsedSeconds: 0, message: "second")])
        second.status = .interrupted
        try store.finish(second)
        try store.deleteSession(first.id)
        XCTAssertFalse(FileManager.default.fileExists(atPath: store.directory(first.id).path))
        XCTAssertFalse(FileManager.default.fileExists(atPath: root.appendingPathComponent("Exports/" + first.id.uuidString).path))
        XCTAssertEqual(try store.list().map(\.id), [second.id])
        XCTAssertEqual(try store.readRecords(second.id).first?.message, "second")
        XCTAssertTrue(FileManager.default.fileExists(atPath: external.appendingPathComponent("records.jsonl").path))
    }

    func testCannotDeleteActiveSessionAndRecordingStillWorks() throws {
        let (store, root) = try temporaryStore()
        defer { try? FileManager.default.removeItem(at: root) }
        let session = metadata()
        try store.begin(session)
        XCTAssertThrowsError(try store.deleteSession(session.id))
        try store.append([StudyRecord(kind: "status", timestamp: session.startedAt, elapsedSeconds: 0, message: "still recording")])
        XCTAssertEqual(try store.readRecords(session.id).first?.message, "still recording")
        try store.close()
    }

    #if os(macOS)
    func testShareArchiveContainsParticipantFolderAndEveryExport() throws {
        let (store, root) = try temporaryStore()
        defer { try? FileManager.default.removeItem(at: root) }
        var session = metadata()
        try store.begin(session)
        try store.append([StudyRecord(kind: "status", timestamp: session.startedAt, elapsedSeconds: 0, message: "archive round trip")])
        session.status = .finished
        try store.finish(session)
        let files = try StudyExport.export(session, store: store)
        let archive = try StudyExport.archive(try XCTUnwrap(files.first?.deletingLastPathComponent()), session: session)
        let output = root.appendingPathComponent("Unzipped")
        let process = Process()
        process.executableURL = URL(fileURLWithPath: "/usr/bin/unzip")
        process.arguments = ["-qq", archive.path, "-d", output.path]
        try process.run(); process.waitUntilExit()
        XCTAssertEqual(process.terminationStatus, 0)
        for file in files {
            XCTAssertEqual(try Data(contentsOf: file), try Data(contentsOf: output.appendingPathComponent("P01/" + file.lastPathComponent)))
        }
    }
    #endif

    func testStageCodesAreOrderedAndCannotRepeatEnd() {
        var stage = Stage.ready
        for code in ["A", "B", "C", "D"] {
            XCTAssertEqual(stage.nextCode, code)
            stage = stage.advanced
        }
        XCTAssertNil(stage.nextCode)
        XCTAssertEqual(stage.advanced, .done)
    }
}
