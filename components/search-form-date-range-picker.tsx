"use client";

import { DateRange, type RangeKeyDict } from "react-date-range";
import "react-date-range/dist/styles.css";
import "react-date-range/dist/theme/default.css";
import type { Locale as DateFnsLocale } from "date-fns";
import { enGB, hy, ru } from "date-fns/locale";
import type { Locale as AppLocale } from "@/lib/i18n";

const dateFnsLocales: Record<AppLocale, DateFnsLocale> = {
  hy,
  en: enGB,
  ru,
};

export type SearchFormDateRange = {
  startDate: Date | undefined;
  endDate: Date | undefined;
  key: "selection";
};

export type SearchFormDateRangePickerProps = {
  locale: AppLocale;
  value: SearchFormDateRange;
  onChange: (nextValue: SearchFormDateRange, hasCompleteRange: boolean) => void;
};

export default function SearchFormDateRangePicker({
  locale,
  value,
  onChange,
}: SearchFormDateRangePickerProps) {
  return (
    <DateRange
      ranges={[value]}
      minDate={new Date()}
      onChange={(ranges: RangeKeyDict) => {
        const selection = ranges.selection;
        const nextValue: SearchFormDateRange = {
          startDate: selection.startDate,
          endDate: selection.endDate,
          key: "selection",
        };
        const hasCompleteRange =
          selection.startDate &&
          selection.endDate &&
          selection.startDate.getTime() !== selection.endDate.getTime();
        onChange(nextValue, Boolean(hasCompleteRange));
      }}
      rangeColors={["#10b981"]}
      moveRangeOnFirstSelection={false}
      showMonthAndYearPickers
      direction="vertical"
      locale={dateFnsLocales[locale]}
    />
  );
}
