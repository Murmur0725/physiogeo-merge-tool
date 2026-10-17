import Foundation
import Combine
@preconcurrency import CoreLocation

@MainActor
final class LocationRecorder: NSObject, ObservableObject, @preconcurrency CLLocationManagerDelegate {
    @Published var authorization: CLAuthorizationStatus = .notDetermined
    @Published var latest: GPSPoint?
    @Published var stateText = "尚未请求定位权限"
    var onPoint: ((GPSPoint, Date, Double) -> Void)?
    var onStatus: ((String) -> Void)?
    private let manager = CLLocationManager()
    private var wantsUpdates = false
    private var lastSampleDate: Date?

    override init() {
        super.init()
        manager.delegate = self
        manager.desiredAccuracy = kCLLocationAccuracyBest
        manager.distanceFilter = kCLDistanceFilterNone
        manager.activityType = .fitness
        manager.pausesLocationUpdatesAutomatically = false
        authorization = manager.authorizationStatus
    }

    var authorized: Bool { authorization == .authorizedWhenInUse || authorization == .authorizedAlways }

    func prepare() {
        wantsUpdates = true
        if authorization == .notDetermined { manager.requestWhenInUseAuthorization() }
        else if authorized { manager.startUpdatingLocation() }
        else { stateText = "定位权限未授权，请到系统设置允许精确定位" }
    }

    func startRecording() {
        manager.allowsBackgroundLocationUpdates = true
        manager.showsBackgroundLocationIndicator = true
        prepare()
    }

    func stop() {
        wantsUpdates = false
        manager.stopUpdatingLocation()
        manager.allowsBackgroundLocationUpdates = false
    }

    func locationManagerDidChangeAuthorization(_ manager: CLLocationManager) {
        authorization = manager.authorizationStatus
        if authorized {
            stateText = manager.accuracyAuthorization == .reducedAccuracy ? "仅有模糊定位，请开启精确位置" : "定位已授权，等待卫星定位"
            if wantsUpdates { manager.startUpdatingLocation() }
        } else if authorization == .denied || authorization == .restricted {
            latest = nil
            stateText = "定位权限不可用，请到系统设置允许"
        }
        onStatus?(stateText)
    }

    func locationManager(_ manager: CLLocationManager, didUpdateLocations locations: [CLLocation]) {
        let received = Date()
        let uptime = ProcessInfo.processInfo.systemUptime
        for location in locations.sorted(by: { $0.timestamp < $1.timestamp }) {
            guard lastSampleDate.map({ location.timestamp > $0 }) ?? true else { continue }
            lastSampleDate = location.timestamp
            let age = received.timeIntervalSince(location.timestamp)
            let usable = (0...50).contains(location.horizontalAccuracy) && age >= -1 && age <= 15
            let point = GPSPoint(sampledAt: location.timestamp, latitude: location.coordinate.latitude,
                longitude: location.coordinate.longitude, altitude: location.altitude,
                horizontalAccuracy: location.horizontalAccuracy, speed: location.speed >= 0 ? location.speed : nil,
                usable: usable, source: location.sourceInformation?.isSimulatedBySoftware == true ? "simulated_location" : "core_location")
            latest = point
            stateText = usable ? "定位精度 ±\(Int(location.horizontalAccuracy)) 米" : "定位精度不足或数据过旧"
            onPoint?(point, received, uptime)
        }
    }

    func locationManager(_ manager: CLLocationManager, didFailWithError error: Error) {
        stateText = "定位异常：\(error.localizedDescription)"
        onStatus?(stateText)
    }
}
