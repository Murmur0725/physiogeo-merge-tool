import SwiftUI
import UIKit
import Combine
import UniformTypeIdentifiers

private let accent = Color(red: 0.35, green: 0.88, blue: 0.74)
private let page = Color(red: 0.045, green: 0.065, blue: 0.09)

struct ContentView: View {
    @ObservedObject var recorder: StudyRecorder
    @State private var selection = 0
    @State private var now = Date()
    private let clock = Timer.publish(every: 1, on: .main, in: .common).autoconnect()

    var body: some View {
        TabView(selection: $selection) {
            NavigationStack {
                PrepareView(recorder: recorder, bluetooth: recorder.bluetooth, location: recorder.location) {
                    recorder.start()
                    if recorder.recording { selection = 1 }
                }
            }.tabItem { Label("准备", systemImage: "sensor.tag.radiowaves.forward") }.tag(0)
            NavigationStack {
                RecordingView(recorder: recorder, bluetooth: recorder.bluetooth) { selection = 2 }
            }.tabItem { Label("记录", systemImage: "waveform.path.ecg") }.tag(1)
            NavigationStack { HistoryView(recorder: recorder) }
                .tabItem { Label("实验记录", systemImage: "tray.full") }.tag(2)
        }
        .tint(accent)
        .onReceive(clock) { now = $0; recorder.tick() }
        .environment(\.studyNow, now)
        .alert(recorder.errorMessage == nil ? "导出完成" : "记录提示", isPresented: Binding(
            get: { recorder.errorMessage != nil || recorder.exportNotice != nil },
            set: { if !$0 { recorder.errorMessage = nil; recorder.exportNotice = nil } })) {
            Button("知道了", role: .cancel) { recorder.errorMessage = nil; recorder.exportNotice = nil }
        } message: { Text(recorder.errorMessage ?? recorder.exportNotice ?? "") }
        .sheet(isPresented: $recorder.sharing) { ActivitySheet(files: recorder.shareFiles) }
        .fileImporter(isPresented: $recorder.choosingExportDestination, allowedContentTypes: [.folder],
            onCompletion: recorder.saveExport)
    }
}

private struct StudyNowKey: EnvironmentKey { static let defaultValue = Date() }
private extension EnvironmentValues {
    var studyNow: Date { get { self[StudyNowKey.self] } set { self[StudyNowKey.self] = newValue } }
}

private struct Panel<Content: View>: View {
    var title: String
    @ViewBuilder var content: Content
    init(_ title: String, @ViewBuilder content: () -> Content) { self.title = title; self.content = content() }
    var body: some View {
        VStack(alignment: .leading, spacing: 15) {
            Text(title).font(.headline)
            content
        }.frame(maxWidth: .infinity, alignment: .leading)
            .padding(20).background(.white.opacity(0.055), in: RoundedRectangle(cornerRadius: 22))
    }
}

private struct StateLine: View {
    var label: String
    var detail: String
    var good: Bool
    var body: some View {
        HStack(alignment: .top, spacing: 10) {
            Image(systemName: good ? "checkmark.circle.fill" : "circle.dashed").foregroundStyle(good ? accent : .orange)
            Text(label).font(.subheadline.weight(.medium))
            Spacer(minLength: 6)
            Text(detail).font(.caption).foregroundStyle(.secondary).multilineTextAlignment(.trailing)
        }.accessibilityElement(children: .combine)
    }
}

private struct DemoBanner: View {
    var body: some View {
        Label("演示模式 · 所有信号与位置均为模拟数据", systemImage: "testtube.2")
            .font(.caption.weight(.semibold)).foregroundStyle(.orange)
            .frame(maxWidth: .infinity, alignment: .leading).padding(14)
            .background(.orange.opacity(0.12), in: RoundedRectangle(cornerRadius: 14))
    }
}

private struct PrepareView: View {
    @ObservedObject var recorder: StudyRecorder
    @ObservedObject var bluetooth: BluetoothRecorder
    @ObservedObject var location: LocationRecorder
    @Environment(\.studyNow) private var now
    var onStart: () -> Void

    var body: some View {
        ScrollView {
            VStack(alignment: .leading, spacing: 20) {
                VStack(alignment: .leading, spacing: 8) {
                    HStack(spacing: 12) {
                        Image("SomaticLogo")
                            .resizable().scaledToFit().frame(width: 52, height: 52)
                            .clipShape(RoundedRectangle(cornerRadius: 13))
                            .accessibilityHidden(true)
                        Text("SOMATIC CITY").font(.caption.weight(.bold)).tracking(3).foregroundStyle(accent)
                    }
                    Text("把身体与城市\n记在同一条时间线上。")
                        .font(.system(size: 30, weight: .semibold, design: .rounded))
                    Text("心率 · RR / HRV · 路线 · 事件标记").font(.subheadline).foregroundStyle(.secondary)
                }.padding(.vertical, 8)
                if recorder.demo { DemoBanner() }
                Panel("本次实验") {
                    TextField("参与者名称或匿名编号，例如 P01", text: $recorder.participant)
                        .textInputAutocapitalization(.characters).autocorrectionDisabled()
                        .accessibilityIdentifier("participantField")
                    Text("导出文件夹将使用这里填写的名称或编号。")
                        .font(.caption).foregroundStyle(.secondary)
                    Divider()
                    Picker("批次", selection: $recorder.batch) {
                        ForEach(["B1", "B2", "B3"], id: \.self) { Text($0) }
                    }
                    TextField("路线名称", text: $recorder.route)
                    Picker("行走方向", selection: $recorder.direction) {
                        Text("顺时针 · 先商业后绿地").tag("顺时针（先商业后绿地）")
                        Text("逆时针 · 先绿地后商业").tag("逆时针（先绿地后商业）")
                    }.pickerStyle(.menu)
                }.disabled(recorder.recording)
                Panel("设备与定位") {
                    if recorder.demo {
                        StateLine(label: "模拟 H10", detail: "已就绪", good: true)
                        StateLine(label: "模拟 GPS", detail: "不代表真实位置", good: true)
                    } else {
                        StateLine(label: "Polar H10", detail: bluetooth.stateText, good: bluetooth.ready && recorder.heartFresh)
                        StateLine(label: "RR 间期", detail: bluetooth.lastRRAt.map { now.timeIntervalSince($0) < 5 ? "正在接收" : "暂无新 RR" } ?? "等待数据", good: bluetooth.lastRRAt.map { now.timeIntervalSince($0) < 5 } ?? false)
                        StateLine(label: "iPhone GPS", detail: location.stateText, good: recorder.gpsFresh)
                        Text("位置来自本机 iPhone；H10 提供心率与 RR。时间显示为北京时间，精确到毫秒。")
                            .font(.caption).foregroundStyle(.secondary)
                        if let battery = bluetooth.battery { Text("胸带电量 \(battery)%").font(.caption).foregroundStyle(.secondary) }
                        if !bluetooth.ready {
                            ForEach(bluetooth.devices) { sensor in
                                Button { bluetooth.connect(sensor) } label: {
                                    HStack {
                                        VStack(alignment: .leading) {
                                            Text(sensor.name)
                                            Text("\(sensor.id.uuidString.prefix(8)) · \(sensor.rssi) dBm").font(.caption).foregroundStyle(.secondary)
                                        }
                                        Spacer()
                                        Text("连接").font(.subheadline.weight(.semibold))
                                    }
                                }.padding(.vertical, 6).disabled(recorder.recording)
                            }
                        }
                        Button(bluetooth.scanning ? "重新搜索与定位" : "开启蓝牙与定位") { recorder.prepare() }
                            .buttonStyle(.bordered).disabled(recorder.recording)
                        if bluetooth.ready {
                            Button("断开设备", role: .destructive) { bluetooth.disconnect() }
                                .font(.caption).disabled(recorder.recording)
                        }
                    }
                }
                Panel("记录方式") {
                    Toggle("参与者模式", isOn: $recorder.participantMode)
                    Text("开启后隐藏心率与 HRV 数值，避免信号反馈影响实验中的感受。采集保持进行。")
                        .font(.caption).foregroundStyle(.secondary)
                    Toggle("使用演示数据", isOn: $recorder.demo)
                        .disabled(recorder.recording)
                        .onChange(of: recorder.demo) { _, _ in recorder.changeSource() }
                    Text("记录仅保存在本机。导出前不上传到研究平台。")
                        .font(.caption).foregroundStyle(.secondary)
                }
                Button(action: onStart) {
                    Label(recorder.recording ? "当前实验正在记录" : "开始记录与静息基线", systemImage: "record.circle")
                        .font(.headline).frame(maxWidth: .infinity).padding(.vertical, 12)
                }.buttonStyle(.borderedProminent).tint(accent).foregroundStyle(.black)
                    .disabled(!recorder.canStart).accessibilityIdentifier("startRecording")
                Text("开始即写入「基线开始 A」。请静息 5 分钟，然后在记录页结束基线。真实采集须先收到心率、RR 和有效定位。")
                    .font(.caption).foregroundStyle(.secondary)
            }.padding(20)
        }.background(page).navigationTitle("实验准备").navigationBarTitleDisplayMode(.inline)
    }
}

private struct RecordingView: View {
    @ObservedObject var recorder: StudyRecorder
    @ObservedObject var bluetooth: BluetoothRecorder
    @Environment(\.studyNow) private var now
    @State private var showEvent = false
    @State private var confirmFinish = false
    var onFinish: () -> Void

    var body: some View {
        ScrollView {
            VStack(spacing: 20) {
                if recorder.demo { DemoBanner() }
                if let session = recorder.session {
                    HStack {
                        Circle().fill(accent).frame(width: 8, height: 8)
                        Text("\(session.participantID) · \(session.batch)").font(.subheadline.weight(.medium))
                        Spacer()
                        Text(duration(recorder.elapsed)).monospacedDigit().font(.title2.weight(.semibold))
                    }
                    VStack(alignment: .leading, spacing: 6) {
                        Text("北京时间 · UTC+08:00").font(.caption).foregroundStyle(.secondary)
                        Text(StudyTime.beijing(now)).font(.system(.title3, design: .monospaced)).monospacedDigit()
                    }.frame(maxWidth: .infinity, alignment: .leading)
                    Panel(recorder.stage.label) {
                        HStack(spacing: 0) {
                            ForEach(0..<4) { index in
                                VStack(spacing: 8) {
                                    Image(systemName: recorder.stage.rawValue > index ? "checkmark.circle.fill" : "circle")
                                        .foregroundStyle(recorder.stage.rawValue > index ? accent : .gray)
                                    Text(["基线开始", "基线结束", "步行开始", "步行结束"][index]).font(.caption2)
                                }.frame(maxWidth: .infinity)
                            }
                        }
                        if let next = recorder.stage.nextLabel {
                            Button { recorder.advanceStage() } label: {
                                Label(next, systemImage: "flag.fill").font(.headline)
                                    .frame(maxWidth: .infinity).padding(.vertical, 10)
                            }.buttonStyle(.borderedProminent).foregroundStyle(.black)
                                .accessibilityIdentifier("advanceStage")
                        } else { Text("步行阶段已完成。确认数据后结束本次记录。 ").font(.subheadline).foregroundStyle(accent) }
                    }
                    Panel("实时采集") {
                        if recorder.participantMode {
                            Label("参与者模式：生理数值已隐藏", systemImage: "eye.slash").foregroundStyle(.secondary)
                        } else {
                            HStack(alignment: .firstTextBaseline) {
                                metric("心率", value: recorder.heartFresh ? recorder.liveBPM.map(String.init) ?? "—" : "—", unit: "bpm")
                                Spacer()
                                metric("HRV · RMSSD", value: recorder.heartFresh ? recorder.liveHRV?.rmssdMs.map { String(format: "%.1f", $0) } ?? "—" : "—", unit: "ms")
                            }
                            Text(hrvDescription).font(.caption).foregroundStyle(.secondary)
                        }
                        StateLine(label: "心率信号", detail: recorder.demo ? "演示中" : bluetooth.stateText, good: recorder.heartFresh)
                        StateLine(label: recorder.demo ? "模拟 GPS" : "iPhone GPS", detail: recorder.latestGPS.map { "±\(Int(max(0, $0.horizontalAccuracy))) 米" } ?? "等待定位", good: recorder.gpsFresh)
                        if let point = recorder.latestGPS {
                            Text(String(format: "%.6f, %.6f", point.latitude, point.longitude))
                                .font(.caption.monospaced()).foregroundStyle(.secondary)
                            Text("位置采样：\(StudyTime.beijing(point.sampledAt)) 北京时间")
                                .font(.caption2.monospaced()).foregroundStyle(.secondary)
                        }
                        Divider()
                        Text("已保存 \(recorder.counts.packets) 个心率包 · \(recorder.counts.rr) 个 RR · \(recorder.counts.gps) 个位置点")
                            .font(.caption).foregroundStyle(.secondary)
                        if !recorder.heartFresh || !recorder.gpsFresh {
                            Label("数据暂缺已保留记录，请检查胸带和定位。", systemImage: "exclamationmark.triangle")
                                .font(.caption).foregroundStyle(.orange)
                        }
                    }
                    Panel("事件时间戳") {
                        Text("点击即记录时间，并关联最近 15 秒内的有效位置。")
                            .font(.caption).foregroundStyle(.secondary)
                        LazyVGrid(columns: [GridItem(.flexible()), GridItem(.flexible())], spacing: 10) {
                            ForEach(["进入商业段", "进入绿地段", "停留", "过街", "设备调整", "突发干扰"], id: \.self) { label in
                                Button(label) { recorder.mark(label: label, note: "") }
                                    .buttonStyle(.bordered).frame(maxWidth: .infinity).controlSize(.large)
                            }
                        }
                        Button { showEvent = true } label: {
                            Label("自定义事件与备注", systemImage: "plus.circle").frame(maxWidth: .infinity)
                        }.buttonStyle(.bordered).accessibilityIdentifier("customEvent")
                    }
                    Panel("最近标记") {
                        ForEach(recorder.events.prefix(8)) { item in
                            VStack(alignment: .leading, spacing: 6) {
                                Text(item.event.label).font(.subheadline.weight(.medium))
                                if !item.event.note.isEmpty { Text(item.event.note).font(.caption).foregroundStyle(.secondary) }
                                HStack {
                                    Text(StudyTime.beijing(item.time)).font(.caption.monospaced())
                                    Spacer(minLength: 4)
                                    Text("+\(duration(item.elapsed))").font(.caption2).foregroundStyle(.secondary)
                                }
                            }
                        }
                    }
                    Button("结束并保存本次记录", role: .destructive) { confirmFinish = true }
                        .buttonStyle(.bordered).controlSize(.large).accessibilityIdentifier("finishRecording")
                } else {
                    ContentUnavailableView("尚未开始记录", systemImage: "waveform.path.ecg", description: Text("在准备页连接胸带并开始实验。已结束的记录可在「实验记录」中查看和导出。"))
                        .padding(.top, 60)
                }
            }.padding(20)
        }.background(page).navigationTitle("现场记录").navigationBarTitleDisplayMode(.inline)
            .sheet(isPresented: $showEvent) { EventEditor(recorder: recorder) }
            .confirmationDialog(recorder.stage == .done ? "结束本次记录？" : "步行流程尚未完成，提前结束将标记为中断。", isPresented: $confirmFinish, titleVisibility: .visible) {
                Button("结束并保存", role: .destructive) {
                    recorder.finish()
                    if !recorder.recording { onFinish() }
                }
                Button("继续记录", role: .cancel) {}
            }
    }

    private var hrvDescription: String {
        guard let sample = recorder.liveHRV else { return "HRV 需要收集连续 60 秒 RR；断连后重新积累。" }
        switch sample.state {
        case "ready": return "60 秒滚动窗口 · 有效 RR \(Int(sample.validFraction * 100))% · 探索性指标"
        case "no_contact": return "胸带接触不良，HRV 暂不可用"
        case "low_quality": return "有效 RR 或相邻有效心跳不足，暂不显示 HRV"
        default: return "正在积累 60 秒 RR · \(sample.totalBeats) 个心跳"
        }
    }

    private func metric(_ title: String, value: String, unit: String) -> some View {
        VStack(alignment: .leading, spacing: 8) {
            Text(title).font(.caption).foregroundStyle(.secondary)
            HStack(alignment: .firstTextBaseline, spacing: 4) {
                Text(value).font(.system(size: 38, weight: .semibold, design: .rounded)).monospacedDigit()
                Text(unit).font(.caption).foregroundStyle(.secondary)
            }
        }
    }
}

private struct EventEditor: View {
    @ObservedObject var recorder: StudyRecorder
    @Environment(\.dismiss) private var dismiss
    @State private var label = ""
    @State private var note = ""
    var body: some View {
        NavigationStack {
            Form {
                Section("事件内容") {
                    TextField("事件名称", text: $label).accessibilityIdentifier("eventLabel")
                    TextField("备注（可选）", text: $note, axis: .vertical).lineLimit(3...6)
                }
                Section { Text("按下「保存」时打时间戳。紧急事件可直接使用记录页的快捷按钮。").font(.caption) }
            }.navigationTitle("自定义事件").navigationBarTitleDisplayMode(.inline)
                .toolbar {
                    ToolbarItem(placement: .cancellationAction) { Button("取消") { dismiss() } }
                    ToolbarItem(placement: .confirmationAction) {
                        Button("保存") {
                            if recorder.mark(label: label.trimmingCharacters(in: .whitespacesAndNewlines), note: note) { dismiss() }
                        }.disabled(label.trimmingCharacters(in: .whitespacesAndNewlines).isEmpty || !recorder.recording)
                    }
                }
        }
    }
}

private struct HistoryView: View {
    @ObservedObject var recorder: StudyRecorder
    @State private var pendingDeletion: SessionMetadata?
    var body: some View {
        ScrollView {
            VStack(spacing: 18) {
                if recorder.sessions.isEmpty {
                    ContentUnavailableView("还没有实验记录", systemImage: "tray", description: Text("完成一次记录后，数据会保存在本机，并可导出到「文件」或通过 AirDrop 传输。"))
                }
                ForEach(recorder.sessions) { session in
                    NavigationLink {
                        SessionDetailView(recorder: recorder, session: session)
                    } label: {
                        Panel(session.participantID) {
                            HStack {
                                Text("\(session.batch) · \(session.route)")
                                Spacer()
                                Text(statusLabel(session.status)).foregroundStyle(session.status == .finished ? accent : .orange)
                            }.font(.caption)
                            Text("\(StudyTime.beijing(session.startedAt)) 北京时间").font(.caption.monospaced()).foregroundStyle(.secondary)
                            if session.source == "demo" { Text("模拟数据").font(.caption).foregroundStyle(.orange) }
                        }
                    }.buttonStyle(.plain)
                        .contextMenu {
                            Button("删除实验记录", systemImage: "trash", role: .destructive) { pendingDeletion = session }
                                .disabled(session.status == .recording || recorder.managingFiles)
                        }
                }
                Text("数据仅在本机。卸载 App 会删除本地记录，请及时导出。")
                    .font(.caption).foregroundStyle(.secondary).padding(.top, 10)
            }.padding(20)
        }.background(page).navigationTitle("实验记录")
            .toolbar { Button("刷新", systemImage: "arrow.clockwise") { recorder.refreshSessions() } }
            .onAppear { recorder.refreshSessions() }
            .modifier(SessionDeletionConfirmation(recorder: recorder, session: $pendingDeletion))
    }
}

private struct SessionDetailView: View {
    @ObservedObject var recorder: StudyRecorder
    let session: SessionMetadata
    @State private var records: [StudyRecord] = []
    @State private var loadError: String?
    @State private var pendingDeletion: SessionMetadata?
    @Environment(\.dismiss) private var dismiss
    var body: some View {
        ScrollView {
            VStack(spacing: 18) {
                if session.source == "demo" { DemoBanner() }
                Panel("实验信息") {
                    LabeledContent("参与者", value: session.participantID)
                    LabeledContent("批次", value: session.batch)
                    LabeledContent("路线", value: session.route)
                    LabeledContent("方向", value: session.direction)
                    LabeledContent("状态", value: statusLabel(session.status))
                    LabeledContent("设备", value: session.deviceName)
                    LabeledContent("手机时区", value: session.timeZoneIdentifier)
                    LabeledContent("显示时间", value: "北京时间 UTC+08:00")
                    Text("开始：\(StudyTime.beijing(session.startedAt))").font(.caption.monospaced()).foregroundStyle(.secondary)
                    if let end = session.endedAt {
                        Text("结束：\(StudyTime.beijing(end))").font(.caption.monospaced()).foregroundStyle(.secondary)
                    }
                }.font(.subheadline)
                if session.status == .recording {
                    Text("当前实验仍在采集，请先结束记录再导出。").foregroundStyle(.orange)
                } else {
                    if let loadError { Text(loadError).foregroundStyle(.orange) }
                    Panel("已保存数据") {
                        LabeledContent("心率数据包", value: String(records.filter { $0.heart != nil }.count))
                        LabeledContent("RR 间期（总数 / 有效）", value: "\(records.filter { $0.rr != nil }.count) / \(records.filter { $0.rr?.valid == true }.count)")
                        LabeledContent("GPS 点（总数 / 可用）", value: "\(records.filter { $0.gps != nil }.count) / \(records.filter { $0.gps?.usable == true }.count)")
                        LabeledContent("事件标记", value: String(records.filter { $0.event != nil }.count))
                        if session.status == .interrupted {
                            Text("本次记录未正常完成，已保存的原始数据仍可导出。请核对诊断日志和阶段标记。")
                                .font(.caption).foregroundStyle(.orange)
                        }
                    }.font(.subheadline)
                    Button { recorder.export(session) } label: {
                        HStack {
                            if recorder.exporting { ProgressView() }
                            Label("导出全部到参与者文件夹", systemImage: "folder.badge.plus")
                        }.font(.headline).frame(maxWidth: .infinity).padding(.vertical, 10)
                    }.buttonStyle(.borderedProminent).foregroundStyle(.black).disabled(recorder.managingFiles || loadError != nil)
                        .accessibilityIdentifier("exportSession")
                    Text("选择保存位置后，会新建「\(StudyExport.participantFolderName(session.participantID))」文件夹，内含本次实验全部 13 个文件。同名已存在时自动加上实验时间，不覆盖。")
                        .font(.caption).foregroundStyle(.secondary)
                    Button { recorder.export(session, shareArchive: true) } label: {
                        Label("AirDrop / 分享全部文件压缩包", systemImage: "square.and.arrow.up")
                            .frame(maxWidth: .infinity)
                    }.buttonStyle(.bordered).disabled(recorder.managingFiles || loadError != nil)
                    Panel("事件时间线") {
                        ForEach(records.filter { $0.event != nil }, id: \.sequence) { row in
                            if let event = row.event {
                                VStack(alignment: .leading, spacing: 4) {
                                    HStack {
                                        Text(event.label).font(.subheadline)
                                        Spacer()
                                        Text("+\(duration(row.elapsedSeconds))").font(.caption.monospaced()).foregroundStyle(.secondary)
                                    }
                                    Text("\(StudyTime.beijing(row.timestamp)) 北京时间")
                                        .font(.caption.monospaced()).foregroundStyle(.secondary)
                                    if !event.note.isEmpty { Text(event.note).font(.caption).foregroundStyle(.secondary) }
                                }
                            }
                        }
                    }
                    Button(role: .destructive) { pendingDeletion = session } label: {
                        Label("删除本次实验记录", systemImage: "trash").frame(maxWidth: .infinity)
                    }.buttonStyle(.bordered).disabled(recorder.managingFiles)
                        .accessibilityIdentifier("deleteSession")
                }
            }.padding(20)
        }.background(page).navigationTitle(session.participantID).navigationBarTitleDisplayMode(.inline)
            .task {
                guard session.status != .recording else { return }
                do { records = try recorder.savedRecords(session.id) }
                catch { loadError = "记录读取失败：\(error.localizedDescription)" }
            }
            .modifier(SessionDeletionConfirmation(recorder: recorder, session: $pendingDeletion, onDeleted: { dismiss() }))
    }
}

private struct SessionDeletionConfirmation: ViewModifier {
    @ObservedObject var recorder: StudyRecorder
    @Binding var session: SessionMetadata?
    var onDeleted: () -> Void = {}

    func body(content: Content) -> some View {
        content.confirmationDialog("删除这次实验记录？", isPresented: Binding(
            get: { session != nil }, set: { if !$0 { session = nil } }), titleVisibility: .visible) {
            if let selected = session {
                Button("永久删除本次记录", role: .destructive) {
                    Task { if await recorder.delete(selected) { onDeleted() } }
                }
            }
            Button("取消", role: .cancel) { session = nil }
        } message: {
            if let selected = session {
                Text("参与者：\(selected.participantID)\n开始时间：\(StudyTime.beijing(selected.startedAt)) 北京时间\n\n将永久删除本机这一场实验的原始记录及 App 内的导出副本。已另存或传出的文件会保留。")
            }
        }
    }
}

private struct ActivitySheet: UIViewControllerRepresentable {
    let files: [URL]
    func makeUIViewController(context: Context) -> UIActivityViewController {
        UIActivityViewController(activityItems: files, applicationActivities: nil)
    }
    func updateUIViewController(_ uiViewController: UIActivityViewController, context: Context) {}
}

private func duration(_ seconds: Double) -> String {
    let total = max(0, Int(seconds))
    return String(format: "%02d:%02d:%02d", total / 3600, total / 60 % 60, total % 60)
}

private func statusLabel(_ status: SessionStatus) -> String {
    switch status { case .recording: return "记录中"; case .finished: return "已完成"; case .interrupted: return "已中断" }
}
