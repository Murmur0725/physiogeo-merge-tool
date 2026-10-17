import Foundation
import Combine
@preconcurrency import CoreBluetooth

struct DiscoveredSensor: Identifiable {
    let id: UUID
    let name: String
    let rssi: Int
    let peripheral: CBPeripheral
}

@MainActor
final class BluetoothRecorder: NSObject, ObservableObject, @preconcurrency CBCentralManagerDelegate, @preconcurrency CBPeripheralDelegate {
    @Published var devices: [DiscoveredSensor] = []
    @Published var stateText = "尚未开启蓝牙"
    @Published var deviceName = "未连接"
    @Published var deviceID = ""
    @Published var ready = false
    @Published var scanning = false
    @Published var battery: Int?
    @Published var bpm: Int?
    @Published var contact: Bool?
    @Published var rrAvailable = false
    @Published var lastPacketAt: Date?
    @Published var lastRRAt: Date?
    var onPacket: ((HeartMeasurement, Data, Date, Double) -> Void)?
    var onStatus: ((String) -> Void)?
    var onDiscontinuity: (() -> Void)?
    private var central: CBCentralManager?
    private var peripheral: CBPeripheral?
    private var shouldReconnect = false
    private let heartService = CBUUID(string: "180D")
    private let batteryService = CBUUID(string: "180F")
    private let measurementID = CBUUID(string: "2A37")
    private let batteryID = CBUUID(string: "2A19")

    func activate() {
        if central == nil {
            central = CBCentralManager(delegate: self, queue: .main, options: [
                CBCentralManagerOptionRestoreIdentifierKey: "org.somaticcity.h10.central",
                CBCentralManagerOptionShowPowerAlertKey: true
            ])
        } else { scan() }
    }

    func scan() {
        guard let central, central.state == .poweredOn else { return }
        devices.removeAll()
        central.scanForPeripherals(withServices: [heartService], options: [CBCentralManagerScanOptionAllowDuplicatesKey: false])
        scanning = true
        stateText = "正在搜索心率设备，请佩戴并湿润胸带"
    }

    func connect(_ sensor: DiscoveredSensor) {
        guard let central else { return }
        shouldReconnect = false
        if let peripheral, peripheral.identifier != sensor.id { central.cancelPeripheralConnection(peripheral) }
        central.stopScan(); scanning = false
        peripheral = sensor.peripheral
        peripheral?.delegate = self
        deviceName = sensor.name; deviceID = sensor.id.uuidString
        ready = false; bpm = nil; lastRRAt = nil; rrAvailable = false; battery = nil
        shouldReconnect = true
        stateText = "正在连接 \(sensor.name)…"
        central.connect(sensor.peripheral)
    }

    func disconnect() {
        shouldReconnect = false
        central?.stopScan(); scanning = false
        if let peripheral { central?.cancelPeripheralConnection(peripheral) }
        ready = false
        stateText = "已断开"
        onDiscontinuity?()
    }

    func centralManagerDidUpdateState(_ central: CBCentralManager) {
        switch central.state {
        case .poweredOn:
            if shouldReconnect, let peripheral {
                if peripheral.state == .connected { peripheral.discoverServices([heartService, batteryService]) }
                else { central.connect(peripheral) }
            } else { scan() }
        case .poweredOff: stateText = "蓝牙已关闭"; unavailable()
        case .unauthorized: stateText = "蓝牙权限未授权，请到系统设置允许"; unavailable()
        case .unsupported: stateText = "此设备不支持低功耗蓝牙"; unavailable()
        default: stateText = "蓝牙正在初始化"; unavailable()
        }
        onStatus?(stateText)
    }

    private func unavailable() {
        ready = false; scanning = false; rrAvailable = false
        lastPacketAt = nil; lastRRAt = nil
        onDiscontinuity?()
    }

    func centralManager(_ central: CBCentralManager, didDiscover peripheral: CBPeripheral,
                        advertisementData: [String: Any], rssi RSSI: NSNumber) {
        guard !devices.contains(where: { $0.id == peripheral.identifier }) else { return }
        let name = peripheral.name ?? advertisementData[CBAdvertisementDataLocalNameKey] as? String ?? "未命名心率设备"
        devices.append(DiscoveredSensor(id: peripheral.identifier, name: name, rssi: RSSI.intValue, peripheral: peripheral))
        devices.sort { $0.rssi > $1.rssi }
    }

    func centralManager(_ central: CBCentralManager, didConnect peripheral: CBPeripheral) {
        guard peripheral.identifier == self.peripheral?.identifier else { return }
        peripheral.delegate = self
        stateText = "已连接，正在订阅心率和 RR…"
        onStatus?("bluetooth_connected: \(deviceID)")
        onDiscontinuity?()
        peripheral.discoverServices([heartService, batteryService])
    }

    func centralManager(_ central: CBCentralManager, didDisconnectPeripheral peripheral: CBPeripheral, error: Error?) {
        guard peripheral.identifier == self.peripheral?.identifier else { return }
        ready = false; rrAvailable = false; lastPacketAt = nil; lastRRAt = nil; bpm = nil
        onDiscontinuity?()
        stateText = shouldReconnect ? "连接中断，正在自动重连…" : "已断开"
        onStatus?("bluetooth_disconnected: \(error?.localizedDescription ?? "connection ended")")
        if shouldReconnect, central.state == .poweredOn { central.connect(peripheral) }
    }

    func centralManager(_ central: CBCentralManager, didFailToConnect peripheral: CBPeripheral, error: Error?) {
        guard peripheral.identifier == self.peripheral?.identifier else { return }
        ready = false; stateText = "连接失败，3 秒后重试"
        onStatus?("bluetooth_connect_failed: \(error?.localizedDescription ?? "unknown")")
        onDiscontinuity?()
        DispatchQueue.main.asyncAfter(deadline: .now() + 3) { [weak self] in
            guard let self, self.shouldReconnect, self.central?.state == .poweredOn,
                  self.peripheral?.identifier == peripheral.identifier else { return }
            self.central?.connect(peripheral)
        }
    }

    func centralManager(_ central: CBCentralManager, willRestoreState dict: [String: Any]) {
        guard let restored = (dict[CBCentralManagerRestoredStatePeripheralsKey] as? [CBPeripheral])?.first else { return }
        peripheral = restored; restored.delegate = self; shouldReconnect = true
        deviceID = restored.identifier.uuidString; deviceName = restored.name ?? "Polar H10"
        stateText = "正在恢复蓝牙连接；上次未结束的实验保留为中断"
        onStatus?("bluetooth_state_restored")
        // Discovery resumes after centralManagerDidUpdateState reports poweredOn.
    }

    func peripheral(_ peripheral: CBPeripheral, didDiscoverServices error: Error?) {
        guard peripheral.identifier == self.peripheral?.identifier else { return }
        guard error == nil else { subscriptionFailure(error!.localizedDescription); return }
        guard peripheral.services?.contains(where: { $0.uuid == heartService }) == true else {
            subscriptionFailure("未找到标准心率服务"); return
        }
        for service in peripheral.services ?? [] {
            peripheral.discoverCharacteristics(service.uuid == heartService ? [measurementID] : [batteryID], for: service)
        }
    }

    func peripheral(_ peripheral: CBPeripheral, didDiscoverCharacteristicsFor service: CBService, error: Error?) {
        guard peripheral.identifier == self.peripheral?.identifier else { return }
        if let error { if service.uuid == heartService { subscriptionFailure(error.localizedDescription) }; return }
        for characteristic in service.characteristics ?? [] {
            if characteristic.uuid == measurementID { peripheral.setNotifyValue(true, for: characteristic) }
            if characteristic.uuid == batteryID { peripheral.readValue(for: characteristic) }
        }
        if service.uuid == heartService, service.characteristics?.contains(where: { $0.uuid == measurementID }) != true {
            subscriptionFailure("未找到心率测量特征")
        }
    }

    func peripheral(_ peripheral: CBPeripheral, didUpdateNotificationStateFor characteristic: CBCharacteristic, error: Error?) {
        guard peripheral.identifier == self.peripheral?.identifier else { return }
        guard characteristic.uuid == measurementID else { return }
        guard error == nil, characteristic.isNotifying else { subscriptionFailure(error?.localizedDescription ?? "订阅已停止"); return }
        ready = true; stateText = "已连接，等待心率和 RR 数据"
        onStatus?("heart_rate_notifications_enabled")
    }

    func peripheral(_ peripheral: CBPeripheral, didUpdateValueFor characteristic: CBCharacteristic, error: Error?) {
        guard peripheral.identifier == self.peripheral?.identifier else { return }
        let received = Date()
        let uptime = ProcessInfo.processInfo.systemUptime
        if let error { onStatus?("bluetooth_read_error: \(error.localizedDescription)"); return }
        guard let data = characteristic.value else { return }
        if characteristic.uuid == batteryID { battery = data.first.map(Int.init); return }
        guard characteristic.uuid == measurementID else { return }
        do {
            let packet = try HeartPacketParser.parse(data)
            bpm = packet.bpm; contact = packet.contact; lastPacketAt = received
            rrAvailable = !packet.rrMilliseconds.isEmpty
            if rrAvailable { lastRRAt = received }
            stateText = packet.contact == false ? "胸带接触不良" : "正在接收心率与 RR"
            onPacket?(packet, data, received, uptime)
        } catch {
            onStatus?("malformed_heart_packet: \(data.map { String(format: "%02x", $0) }.joined())")
        }
    }

    private func subscriptionFailure(_ reason: String) {
        ready = false; stateText = "心率订阅失败：\(reason)"
        onStatus?(stateText); onDiscontinuity?()
    }
}
