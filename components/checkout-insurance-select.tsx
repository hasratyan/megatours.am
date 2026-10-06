"use client";

import Select, { type Props } from "react-select";

export type InsuranceSelectOption = {
  value: string;
  label: string;
  flag?: string;
  alpha2?: string | null;
  alpha3?: string | null;
};

export type InsuranceSelectProps = Props<InsuranceSelectOption, false>;

export default function CheckoutInsuranceSelect(props: InsuranceSelectProps) {
  return <Select<InsuranceSelectOption> {...props} />;
}
