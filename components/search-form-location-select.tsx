"use client";

import Select, {
  components as selectComponents,
  type CSSObjectWithLabel,
  type StylesConfig,
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
}: SearchFormLocationSelectProps) {
  return (
    <Select<LocationOption>
      classNamePrefix="search-form-select"
      instanceId={instanceId}
      inputId={inputId}
      options={options}
      value={value}
      onChange={(option) => onChange(option ?? null)}
      placeholder={placeholder}
      styles={selectStyles}
      isClearable
      isSearchable
      isLoading={isLoading}
      isDisabled={isDisabled}
      noOptionsMessage={() => (isLoading ? loadingMessage : emptyMessage)}
      filterOption={(option, input) => matchesOption(option.data, input)}
      components={{
        IndicatorSeparator: () => null,
        Control: (props) => {
          const current = props.getValue()[0] as LocationOption | undefined;
          const icon =
            current?.type === "hotel"
              ? "hotel"
              : current?.type === "destination"
              ? "location_city"
              : "travel_explore";
          return (
            <selectComponents.Control {...props}>
              <span className="material-symbols-rounded">{icon}</span>
              {props.children}
            </selectComponents.Control>
          );
        },
        Option: (optionProps) => {
          const data = optionProps.data as LocationOption;
          const icon = data.type === "destination" ? "location_city" : "hotel";
          return (
            <selectComponents.Option {...optionProps}>
              <div style={{ display: "flex", alignItems: "center", gap: 10 }}>
                <span className="material-symbols-rounded" style={{ margin: 0 }}>
                  {icon}
                </span>
                {data.type === "destination" ? (
                  <strong>{data.label}</strong>
                ) : (
                  <span>{data.label}</span>
                )}
              </div>
            </selectComponents.Option>
          );
        },
      }}
    />
  );
}
