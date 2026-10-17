export const WALKING_ORDER_OPTIONS = [
  { value: "clockwise_commercial_first", label: "Clockwise: commercial → green" },
  { value: "counterclockwise_green_first", label: "Counterclockwise: green → commercial" }
];

export function walkingOrderMetadata(value) {
  const option = WALKING_ORDER_OPTIONS.find((item) => item.value === value);
  if (!option) throw new Error("Please select a valid walking order.");
  return { walkingOrder: option.value, walkingOrderLabel: option.label };
}
