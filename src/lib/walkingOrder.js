export const WALKING_ORDER_OPTIONS = [
  { value: "clockwise_commercial_first", label: "顺时针先商业后绿地" },
  { value: "counterclockwise_green_first", label: "逆时针先绿地后商业" }
];

export function walkingOrderMetadata(value) {
  const option = WALKING_ORDER_OPTIONS.find((item) => item.value === value);
  if (!option) throw new Error("Please select a valid walking order.");
  return { walkingOrder: option.value, walkingOrderLabel: option.label };
}
