"use client";

import { useDeferredValue, useMemo, useState } from "react";
import Select, {
  components as selectComponents,
  type CSSObjectWithLabel,
  type StylesConfig,
  type ControlProps,
  type OptionProps,
} from "react-select";

type LocationOption = {
  value: string;
  label: string;
  rawId?: string;
  type: "destination" | "hotel";
  parentDestinationId?: string;
  lat?: number;
  lng?: number;
  rating?: number;
  imageUrl?: string;
  price?: string;
};

const LocationControl = (props: ControlProps<LocationOption, false>) => {
  const current = props.getValue()[0];
  const icon = current?.type === "hotel" ? "hotel" : current?.type === "destination" ? "location_city" : "travel_explore";
  return (
    <selectComponents.Control {...props}>
      <span className="material-symbols-rounded" aria-hidden="true">{icon}</span>
      {props.children}
    </selectComponents.Control>
  );
};

const LocationOptionRow = (props: OptionProps<LocationOption, false>) => (
  <selectComponents.Option {...props}>
    <div style={{ display: "flex", alignItems: "center", gap: 10 }}>
      <span className="material-symbols-rounded" aria-hidden="true" style={{ margin: 0 }}>
        {props.data.type === "destination" ? "location_city" : "hotel"}
      </span>
      {props.data.type === "destination" ? <strong>{props.data.label}</strong> : <span>{props.data.label}</span>}
    </div>
  </selectComponents.Option>
);

const locationComponents = {
  IndicatorSeparator: () => null,
  Control: LocationControl,
  Option: LocationOptionRow,
};

const selectStyles: StylesConfig<LocationOption, false> = {
  container: (base: CSSObjectWithLabel) => ({
    ...base,
    height: "100%",
  }),
  control: (base: CSSObjectWithLabel) => ({
    ...base,
    backgroundColor: "rgba(255, 255, 255, 0.1)",
    borderColor: "rgba(255, 255, 255, 0.3)",
    padding: ".25em .8em",
    height: "100%",
    color: "#fff",
    minHeight: "50px",
    borderRadius: "1em",
    "&:hover": {
      borderColor: "rgba(255, 255, 255, 0.5)",
    },
  }),
  menu: (base: CSSObjectWithLabel) => ({
    ...base,
    backgroundColor: "#1a1a2e",
    border: "1px solid rgba(255, 255, 255, 0.2)",
    borderRadius: "1em",
    padding: "0.5em",
  }),
  option: (base: CSSObjectWithLabel, state) => ({
    ...base,
    borderRadius: "0.5em",
    backgroundColor: state.isSelected
      ? "#10b981"
      : state.isFocused
      ? "rgba(16, 185, 129, 0.2)"
      : "transparent",
    color: "#fff",
    "&:active": {
      backgroundColor: "#10b981",
    },
  }),
  singleValue: (base: CSSObjectWithLabel) => ({
    ...base,
    color: "#fff",
    fontWeight: 700,
  }),
  input: (base: CSSObjectWithLabel) => ({
    ...base,
    color: "#fff",
    fontWeight: 700,
  }),
  placeholder: (base: CSSObjectWithLabel) => ({
    ...base,
    color: "rgba(255, 255, 255, 0.5)",
  }),
  indicatorsContainer: (base: CSSObjectWithLabel) => ({
    ...base,
    gap: "0.5em",
  }),
  dropdownIndicator: (base: CSSObjectWithLabel) => ({
    ...base,
    padding: "0",
    color: "#fff",
  }),
  clearIndicator: (base: CSSObjectWithLabel) => ({
    ...base,
    padding: "0",
    color: "#fff",
  }),
};

export type SearchFormLocationSelectProps = {
  instanceId: string;
  inputId: string;
  options: LocationOption[];
  value: LocationOption | null;
  onChange: (option: LocationOption | null) => void;
  placeholder: string;
  loadingMessage: string;
  emptyMessage: string;
  isLoading: boolean;
  isDisabled: boolean;
  onMenuOpen?: () => void;
  matchesOption: (option: LocationOption, input: string) => boolean;
};

export default function SearchFormLocationSelect({
  instanceId,
  inputId,
  options,
  value,
  onChange,
  placeholder,
  loadingMessage,
  emptyMessage,
  isLoading,
  isDisabled,
  matchesOption,
  onMenuOpen,
}: SearchFormLocationSelectProps) {
  "use memo";
  const [inputValue, setInputValue] = useState("");
  const [visibleCount, setVisibleCount] = useState(40);
  const deferredInput = useDeferredValue(inputValue);
  const matchingOptions = useMemo(
    () => options.filter((option) => matchesOption(option, deferredInput)),
    [options, matchesOption, deferredInput]
  );
  return (
    <Select<LocationOption>
      classNamePrefix="search-form-select"
      instanceId={instanceId}
      inputId={inputId}
      options={matchingOptions.slice(0, visibleCount)}
      aria-label={placeholder}
      value={value}
      onMenuOpen={onMenuOpen}
      onChange={(option) => onChange(option ?? null)}
      placeholder={placeholder}
      styles={selectStyles}
      isClearable
      isSearchable
      isLoading={isLoading || inputValue !== deferredInput}
      isDisabled={isDisabled}
      noOptionsMessage={() => (isLoading ? loadingMessage : emptyMessage)}
      filterOption={null}
      inputValue={inputValue}
      onInputChange={(value, meta) => {
        if (meta.action === "input-change" || meta.action === "menu-close") {
          setInputValue(value);
          setVisibleCount(40);
        }
      }}
      onMenuScrollToBottom={() => setVisibleCount((count) => count + 40)}
      onKeyDown={(event) => {
        if (event.key !== "ArrowDown" && event.key !== "PageDown") return;
        const activeOption = (event.target as HTMLInputElement).getAttribute("aria-activedescendant")
          // react-select omits aria-activedescendant on Apple devices.
          ?? event.currentTarget.querySelector(".search-form-select__option--is-focused")?.id;
        const index = Number(activeOption?.match(/-option-(\d+)$/)?.[1]);
        // Extend before keyboard focus reaches the current window's edge.
        if (Number.isFinite(index) && index >= visibleCount - 10 && visibleCount < matchingOptions.length) {
          setVisibleCount((count) => count + 40);
        }
      }}
      components={locationComponents}
    />
  );
}
