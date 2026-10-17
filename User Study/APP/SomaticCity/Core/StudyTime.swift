import Foundation

enum StudyTime {
    static let beijingTimeZone = TimeZone(identifier: "Asia/Shanghai")!
    private static let beijingFormatter: DateFormatter = {
        let formatter = DateFormatter()
        formatter.locale = Locale(identifier: "en_US_POSIX")
        formatter.calendar = Calendar(identifier: .gregorian)
        formatter.timeZone = beijingTimeZone
        formatter.dateFormat = "yyyy-MM-dd HH:mm:ss.SSS"
        return formatter
    }()

    static func beijing(_ date: Date) -> String { beijingFormatter.string(from: date) }

    static func unixMilliseconds(_ date: Date) -> Int64 {
        Int64((date.timeIntervalSince1970 * 1000).rounded())
    }
}
