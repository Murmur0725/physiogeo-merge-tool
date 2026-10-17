import Foundation
import Combine
import UIKit

struct TimedStudyEvent: Identifiable {
    var id: UUID { event.id }
    var event: StudyEvent
    var time: Date
    var elapsed: Double
}

struct RecordingCounts {
    var packets = 0
    var rr = 0
    var validRR = 0
    var gps = 0
    var usableGPS = 0
    var events = 0
}

@MainActor
final class StudyRecorder: ObservableObject {
    let bluetooth = BluetoothRecorder()
    let location = LocationRecorder()
    @Published var participant = ""
    @Published var batch = "B1"
    @Published var route = "城市环线"
    @Published var direction = "顺时针（先商业后绿地）"
    @Published var demo = ProcessInfo.processInfo.arguments.contains("--demo")
    @Published var participantMode = false
    @Published var session: SessionMetadata?
    @Published var sessions: [SessionMetadata] = []
    @Published var stage: Stage = .ready
    @Published var events: [TimedStudyEvent] = []
    @Published var counts = RecordingCounts()
    @Published var liveBPM: Int?
    @Published var lastHeartDate: Date?
    @Published var latestGPS: GPSPoint?
    @Published var liveHRV: HRVSample?
    @Published var elapsed: Double = 0
    @Published var errorMessage: String?
    @Published var shareFiles: [URL] = []
    @Published var sharing = false
    @Published var exporting = false
    @Published var choosingExportDestination = false
    @Published var deleting = false
    @Published var exportNotice: String?
    private var pendingExport: (folder: URL, session: SessionMetadata)?
    private var store: SessionStore?
    private var hrv = HRVWindow()
    private var startUptime: Double = 0
    private var demoTick = 0
    private var demoTimer: Timer?
    private var lastClockWarning: Double = -100
    private var lastForegroundState = ""

    init() {
        do {
            let documents = FileManager.default.urls(for: .documentDirectory, in: .userDomainMask)[0]
            store = try SessionStore(root: documents.appendingPathComponent("StudySessions", isDirectory: true))
            sessions = try store!.list()
        } catch { errorMessage = "无法打开本地记录目录：\(error.localizedDescription)" }
        bluetooth.onPacket = { [weak self] packet, data, received, uptime in
            guard let self, !self.demo else { return }
            self.receive(packet, raw: data, received: received, uptime: uptime)
        }
        bluetooth.onStatus = { [weak self] status in
            guard let self, !self.demo else { return }
            self.diagnostic(status)
        }
        bluetooth.onDiscontinuity = { [weak self] in
            guard let self, !self.demo else { return }
            self.hrv.reset(); self.liveHRV = nil; self.liveBPM = nil; self.lastHeartDate = nil
            self.diagnostic("hrv_window_reset: connection or Bluetooth state change")
        }
        location.onPoint = { [weak self] point, received, uptime in
            guard let self, !self.demo else { return }
            self.receive(point, received: received, uptime: uptime)
        }
        location.onStatus = { [weak self] message in
            guard let self, !self.demo else { return }
            self.diagnostic(message)
        }
        if demo { participant = "DEMO-001"; prepare() }
    }

    var recording: Bool { session != nil }
    var canStart: Bool {
        guard !recording, store != nil, !participant.trimmingCharacters(in: .whitespacesAndNewlines).isEmpty else { return false }
        if demo { return latestGPS != nil && liveBPM != nil }
        return bluetooth.ready && bluetooth.contact != false &&
            bluetooth.lastPacketAt.map { Date().timeIntervalSince($0) < 5 } == true &&
            bluetooth.lastRRAt.map { Date().timeIntervalSince($0) < 5 } == true &&
            location.authorized && latestGPS.map { $0.usable && Date().timeIntervalSince($0.sampledAt) <= 15 } == true
    }

    var heartFresh: Bool { lastHeartDate.map { Date().timeIntervalSince($0) < 5 } ?? false }
    var gpsFresh: Bool { latestGPS.map { $0.usable && Date().timeIntervalSince($0.sampledAt) <= 15 } ?? false }

    func prepare() {
        if demo {
            bluetooth.disconnect(); location.stop()
            if demoTimer == nil {
                demoTimer = Timer.scheduledTimer(withTimeInterval: 1, repeats: true) { [weak self] _ in
                    MainActor.assumeIsolated { self?.simulate() }
                }
            }
            simulate()
        } else {
            demoTimer?.invalidate(); demoTimer = nil
            bluetooth.activate(); location.prepare()
        }
    }

    func changeSource() {
        guard !recording else { return }
        liveBPM = nil; latestGPS = nil; lastHeartDate = nil; liveHRV = nil; hrv.reset()
        prepare()
    }

    func start() {
        guard canStart, let store else { errorMessage = "请先填写编号，并确认心率、RR 和精确定位已就绪。"; return }
        let now = Date()
        let metadata = SessionMetadata(participantID: participant.trimmingCharacters(in: .whitespacesAndNewlines),
            batch: batch, route: route, direction: direction, deviceID: demo ? "DEMO" : bluetooth.deviceID,
            deviceName: demo ? "模拟 H10（非真实数据）" : bluetooth.deviceName, source: demo ? "demo" : "polar_h10_ble_hrs",
            startedAt: now, timeZoneIdentifier: TimeZone.current.identifier,
            utcOffsetSeconds: TimeZone.current.secondsFromGMT(for: now))
        do {
            try store.begin(metadata)
            session = metadata; startUptime = ProcessInfo.processInfo.systemUptime
            elapsed = 0; counts = RecordingCounts(); events = []; stage = .ready; hrv.reset(); liveHRV = nil
            lastClockWarning = -100
            if !demo { location.startRecording() }
            diagnostic("session_start; app_version=1.0; raw_rr_and_gps_not_interpolated")
            if demo { diagnostic("DEMO_DATA: generated by app, not from a wearable") }
            advanceStage()
            refreshSessions()
        } catch { errorMessage = "无法开始记录：\(error.localizedDescription)" }
    }

    func tick() {
        guard let session else { return }
        elapsed = max(0, ProcessInfo.processInfo.systemUptime - startUptime)
        if abs(Date().timeIntervalSince(session.startedAt) - elapsed) > 2, elapsed - lastClockWarning > 60 {
            lastClockWarning = elapsed
            diagnostic("wall_clock_shift_detected: use elapsed_s for within-session duration")
        }
    }

    func sceneChanged(_ state: String) {
        guard state != lastForegroundState else { return }
        lastForegroundState = state
        diagnostic("app_scene: \(state)")
    }

    func advanceStage() {
        guard let code = stage.nextCode, let label = stage.nextLabel else { return }
        if mark(code: code, label: label, note: "") { stage = stage.advanced }
    }

    @discardableResult
    func mark(code: String = "EVENT", label: String, note: String) -> Bool {
        guard recording else { return false }
        let now = Date()
        let elapsed = max(0, ProcessInfo.processInfo.systemUptime - startUptime)
        let point = latestGPS.flatMap { $0.usable && (0...15).contains(now.timeIntervalSince($0.sampledAt)) ? $0 : nil }
        let event = StudyEvent(code: code, label: label, note: note, location: point,
            locationAgeSeconds: point.map { now.timeIntervalSince($0.sampledAt) })
        let record = StudyRecord(kind: "event", timestamp: now, elapsedSeconds: elapsed, event: event)
        guard persist([record]) else { return false }
        counts.events += 1
        events.insert(TimedStudyEvent(event: event, time: now, elapsed: elapsed), at: 0)
        UIImpactFeedbackGenerator(style: .light).impactOccurred()
        return true
    }

    func finish() {
        guard var session, let store else { return }
        let completed = stage == .done
        guard mark(code: "SESSION_END", label: completed ? "记录结束" : "提前结束（流程不完整）", note: "") else { return }
        session.endedAt = Date(); session.status = completed ? .finished : .interrupted
        do {
            try store.finish(session)
            self.session = nil
            if !demo { location.stop() }
            hrv.reset(); liveHRV = nil
            refreshSessions()
        } catch { storageFailure(error) }
    }

    func refreshSessions() {
        do { sessions = try store?.list() ?? [] }
        catch { errorMessage = "无法读取历史实验：\(error.localizedDescription)" }
    }

    func savedRecords(_ id: UUID) throws -> [StudyRecord] {
        guard let store else { throw CocoaError(.fileReadUnknown) }
        return try store.readRecords(id)
    }

    var managingFiles: Bool { exporting || deleting || sharing || choosingExportDestination }

    func export(_ session: SessionMetadata, shareArchive: Bool = false) {
        guard let store, !managingFiles, session.status != .recording else { return }
        exporting = true
        // Export only closed immutable session files, off the UI thread.
        Task {
            do {
                let url = try await Task.detached(priority: .userInitiated) {
                    let files = try StudyExport.export(session, store: store)
                    guard let folder = files.first?.deletingLastPathComponent() else { throw CocoaError(.fileReadUnknown) }
                    return try shareArchive ? StudyExport.archive(folder, session: session) : folder
                }.value
                if shareArchive {
                    shareFiles = [url]; sharing = true
                } else {
                    pendingExport = (url, session); choosingExportDestination = true
                }
            } catch { errorMessage = "导出失败：\(error.localizedDescription)" }
            exporting = false
        }
    }

    func saveExport(to selection: Result<URL, Error>) {
        guard let pendingExport else { return }
        self.pendingExport = nil
        choosingExportDestination = false
        switch selection {
        case .failure(let error):
            if (error as NSError).code != CocoaError.userCancelled.rawValue {
                errorMessage = "无法选择保存位置：\(error.localizedDescription)"
            }
        case .success(let destination):
            exporting = true
            Task {
                do {
                    let saved = try await Task.detached(priority: .userInitiated) {
                        let access = destination.startAccessingSecurityScopedResource()
                        defer { if access { destination.stopAccessingSecurityScopedResource() } }
                        return try StudyExport.saveFolder(pendingExport.folder, to: destination, session: pendingExport.session)
                    }.value
                    exportNotice = "已保存文件夹「\(saved.lastPathComponent)」，包含本次实验全部 13 个文件。"
                } catch { errorMessage = "文件夹保存失败：\(error.localizedDescription)" }
                exporting = false
            }
        }
    }

    func delete(_ session: SessionMetadata) async -> Bool {
        guard let store, !managingFiles, session.status != .recording, self.session?.id != session.id else { return false }
        deleting = true
        defer { deleting = false }
        do {
            try await Task.detached(priority: .userInitiated) { try store.deleteSession(session.id) }.value
            shareFiles = []
            refreshSessions()
            return true
        } catch {
            errorMessage = "删除失败：\(error.localizedDescription)"
            return false
        }
    }

    private func persist(_ records: [StudyRecord]) -> Bool {
        guard recording, let store else { return false }
        do { try store.append(records); return true }
        catch { storageFailure(error); return false }
    }

    private func storageFailure(_ error: Error) {
        if var session {
            session.status = .interrupted; session.endedAt = Date()
            try? store?.finish(session)
        }
        session = nil; location.stop(); hrv.reset(); liveHRV = nil
        errorMessage = "本地写入失败，已停止录制。已写入的数据保留。请检查剩余空间后重试。\n\(error.localizedDescription)"
        refreshSessions()
    }

    private func diagnostic(_ message: String) {
        guard recording else { return }
        _ = persist([StudyRecord(kind: "status", timestamp: Date(),
            elapsedSeconds: max(0, ProcessInfo.processInfo.systemUptime - startUptime), message: message)])
    }

    private func receive(_ packet: HeartMeasurement, raw: Data, received: Date, uptime: Double) {
        liveBPM = packet.bpm; lastHeartDate = received
        guard recording else { return }
        let elapsed = max(0, uptime - startUptime)
        let packetID = UUID()
        let result = hrv.ingest(packet.rrMilliseconds, elapsed: elapsed, contact: packet.contact, packet: packetID)
        let heart = HeartSample(bpm: packet.bpm, contact: packet.contact, packetID: packetID,
            rrCount: packet.rrMilliseconds.count, rawHex: raw.map { String(format: "%02x", $0) }.joined())
        var records = [StudyRecord(kind: "heart", timestamp: received, elapsedSeconds: elapsed, heart: heart)]
        records += result.0.map { StudyRecord(kind: "rr", timestamp: received, elapsedSeconds: elapsed, rr: $0) }
        records.append(StudyRecord(kind: "hrv", timestamp: received, elapsedSeconds: elapsed, hrv: result.1))
        guard persist(records) else { return }
        liveHRV = result.1
        counts.packets += 1; counts.rr += result.0.count; counts.validRR += result.0.filter(\.valid).count
        self.elapsed = elapsed
    }

    private func receive(_ point: GPSPoint, received: Date, uptime: Double) {
        latestGPS = point
        guard recording else { return }
        let record = StudyRecord(kind: "gps", timestamp: received,
            elapsedSeconds: max(0, uptime - startUptime), gps: point)
        guard persist([record]) else { return }
        counts.gps += 1
        if point.usable { counts.usableGPS += 1 }
    }

    private func simulate() {
        guard demo else { return }
        demoTick += 1
        let now = Date(), uptime = ProcessInfo.processInfo.systemUptime
        let rr = 850 + sin(Double(demoTick) * 0.4) * 35
        let unit = UInt16((rr * 1024 / 1000).rounded())
        let raw = Data([0x16, UInt8((60_000 / rr).rounded()), UInt8(unit & 0xff), UInt8(unit >> 8)])
        if let packet = try? HeartPacketParser.parse(raw) { receive(packet, raw: raw, received: now, uptime: uptime) }
        let point = GPSPoint(sampledAt: now, latitude: 22.543 + Double(demoTick % 300) * 0.000008,
            longitude: 114.057 + sin(Double(demoTick) / 60) * 0.0004, altitude: 20,
            horizontalAccuracy: 5, speed: 1, usable: true, source: "demo")
        receive(point, received: now, uptime: uptime)
    }
}
