import { Suspense } from "react";

import ResultsClient from "./results-client";

export default function ResultsPage() {
  return (
    <Suspense fallback={null}>
      <ResultsClient />
    </Suspense>
  );
}
