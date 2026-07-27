#!/usr/bin/env python3
"""Import geotagged field photos and align them to route sections."""

from __future__ import annotations

import argparse
import json
import math
from pathlib import Path

from PIL import ExifTags, Image, ImageOps


def decimal_degrees(values, reference):
    degrees, minutes, seconds = (float(value) for value in values)
    result = degrees + minutes / 60 + seconds / 3600
    return -result if reference in {"S", "W"} else result


def read_photo(path):
    with Image.open(path) as image:
        exif = image.getexif()
        gps_ifd = exif.get_ifd(ExifTags.IFD.GPSInfo)
        gps = {ExifTags.GPSTAGS.get(key, key): value for key, value in gps_ifd.items()}
        if not gps.get("GPSLatitude") or not gps.get("GPSLongitude"):
            raise ValueError(f"{path.name} does not contain GPS coordinates")

        exif_ifd = exif.get_ifd(ExifTags.IFD.Exif)
        captured_at = exif_ifd.get(ExifTags.Base.DateTimeOriginal) or exif.get(
            ExifTags.Base.DateTime
        )
        return {
            "path": path,
            "lat": decimal_degrees(gps["GPSLatitude"], gps.get("GPSLatitudeRef")),
            "lng": decimal_degrees(gps["GPSLongitude"], gps.get("GPSLongitudeRef")),
            "capturedAt": captured_at,
            "compassAngle": (
                float(gps["GPSImgDirection"]) if gps.get("GPSImgDirection") else None
            ),
        }


def meters_xy(point, origin):
    lat_scale = 110_540
    lng_scale = 111_320 * math.cos(math.radians(origin["lat"]))
    return (
        (point["lng"] - origin["lng"]) * lng_scale,
        (point["lat"] - origin["lat"]) * lat_scale,
    )


def distance(a, b):
    ax, ay = meters_xy(a, a)
    bx, by = meters_xy(b, a)
    return math.hypot(bx - ax, by - ay)


def closest_position(point, geometry):
    cumulative = [0.0]
    for index in range(1, len(geometry)):
        cumulative.append(cumulative[-1] + distance(geometry[index - 1], geometry[index]))
    total = cumulative[-1] or 1

    best = {"distance": math.inf, "progress": 0.0}
    for index in range(1, len(geometry)):
        start = geometry[index - 1]
        end = geometry[index]
        px, py = meters_xy(point, start)
        ex, ey = meters_xy(end, start)
        length_sq = ex * ex + ey * ey
        ratio = max(0.0, min(1.0, (px * ex + py * ey) / length_sq)) if length_sq else 0
        projected_x = ratio * ex
        projected_y = ratio * ey
        gap = math.hypot(px - projected_x, py - projected_y)
        if gap < best["distance"]:
            segment_length = math.sqrt(length_sq)
            best = {
                "distance": gap,
                "progress": (cumulative[index - 1] + ratio * segment_length) / total,
            }
    return best


def route_sections(config):
    waypoints = config["waypoints"]
    waypoint_index = {waypoint["id"]: index for index, waypoint in enumerate(waypoints)}
    split_indexes = sorted(
        {
            0,
            len(waypoints) - 1,
            *(
                waypoint_index[split["afterWaypointId"]]
                for split in config.get("splits", [])
                if split.get("afterWaypointId") in waypoint_index
            ),
        }
    )
    split_labels = {
        split.get("afterWaypointId"): split.get("segmentLabel")
        for split in config.get("splits", [])
    }
    sections = []
    for order, (start, end) in enumerate(zip(split_indexes, split_indexes[1:]), start=1):
        label = split_labels.get(waypoints[start]["id"]) or f"Segment {order}"
        sections.append(
            {
                "label": label,
                "geometry": [
                    {"lng": waypoint["lng"], "lat": waypoint["lat"]}
                    for waypoint in waypoints[start : end + 1]
                ],
            }
        )
    return sections


def web_copy(source, destination, max_size):
    destination.parent.mkdir(parents=True, exist_ok=True)
    with Image.open(source) as original:
        image = ImageOps.exif_transpose(original)
        image.thumbnail((max_size, max_size), Image.Resampling.LANCZOS)
        if image.mode != "RGB":
            image = image.convert("RGB")
        image.save(destination, "JPEG", quality=84, optimize=True, progressive=True)


def main():
    parser = argparse.ArgumentParser()
    parser.add_argument("photos", nargs="+", type=Path)
    parser.add_argument(
        "--route",
        type=Path,
        default=Path("src/config/routes/shenzhen-2026-07-17-cd.json"),
    )
    parser.add_argument("--max-size", type=int, default=1600)
    parser.add_argument("--apply", action="store_true")
    args = parser.parse_args()

    config = json.loads(args.route.read_text())
    sections = route_sections(config)
    photos = [read_photo(path.resolve()) for path in args.photos]
    assignments = {section["label"]: [] for section in sections}

    for photo in photos:
        candidates = []
        for section in sections:
            position = closest_position(photo, section["geometry"])
            candidates.append((position["distance"], section, position))
        gap, section, position = min(candidates, key=lambda candidate: candidate[0])
        photo.update(
            {
                "section": section["label"],
                "routeDistanceMeters": gap,
                "routeProgress": position["progress"],
            }
        )
        assignments[section["label"]].append(photo)

    for items in assignments.values():
        items.sort(key=lambda item: item["routeProgress"])

    output_dir = Path("public/streetviews") / config["id"]
    segment_samples = {}
    for section in sections:
        label = section["label"]
        samples = []
        for photo in assignments[label]:
            destination_name = f"{photo['path'].stem.lower()}.jpg"
            destination = output_dir / destination_name
            if args.apply:
                web_copy(photo["path"], destination, args.max_size)
            samples.append(
                {
                    "id": f"photo-{photo['path'].stem.lower()}",
                    "lng": round(photo["lng"], 7),
                    "lat": round(photo["lat"], 7),
                    "label": photo["path"].stem,
                    "thumbUrl": f"streetviews/{config['id']}/{destination_name}",
                    "capturedAt": photo["capturedAt"],
                    "compassAngle": (
                        round(photo["compassAngle"], 1)
                        if photo["compassAngle"] is not None
                        else None
                    ),
                    "imageDistanceMeters": round(photo["routeDistanceMeters"], 1),
                }
            )
        segment_samples[label] = samples

    print("Photo alignment:")
    for section in sections:
        label = section["label"]
        print(f"\n{label} ({len(assignments[label])} photos)")
        for photo in assignments[label]:
            print(
                f"  {photo['path'].name}: {photo['routeDistanceMeters']:.1f} m "
                f"from route, progress {photo['routeProgress']:.1%}"
            )

    if args.apply:
        config["segmentSamples"] = segment_samples
        args.route.write_text(json.dumps(config, ensure_ascii=False, indent=2) + "\n")
        print(f"\nUpdated {args.route}")
        print(f"Created web images in {output_dir}")
    else:
        print("\nPreview only. Add --apply to write the route config and web images.")


if __name__ == "__main__":
    main()
