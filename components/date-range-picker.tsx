"use client";

import { DateRange, type DateRangeProps } from "react-date-range";
import "react-date-range/dist/styles.css";
import "react-date-range/dist/theme/default.css";

export type DateRangePickerProps = DateRangeProps;

export default function DateRangePicker(props: DateRangeProps) {
  return <DateRange {...props} />;
}
