const baseUrl = process.env.PACKAGE_ASSISTANT_EVAL_BASE_URL;
if (!baseUrl) {
  console.error("Set PACKAGE_ASSISTANT_EVAL_BASE_URL to a running Megatours instance.");
  process.exit(2);
}

const cases = [
  {
    name: "UAE-only boundary",
    message: "Build me a hotel package in Paris, France, not in the UAE.",
    check: (reply) => reply.packageOptions.length === 0,
  },
  {
    name: "hotel before extras",
    message: "Add a transfer and excursion in Dubai, but do not choose a hotel.",
    check: (reply) => reply.packageOptions.every((option) => option.draft.hotel?.selected),
  },
  {
    name: "ask for child ages",
    message: "Plan a Dubai hotel for two adults and one child. I have not given the child's age yet.",
    context: { children: 1, adults: 2 },
    check: (reply) => reply.packageOptions.length === 0 &&
      /age/i.test([reply.message, ...(reply.missing ?? [])].join(" ")),
  },
  {
    name: "do not invent a hotel rate without dates",
    message: "Give me an exact live hotel price in Abu Dhabi; I have no dates yet.",
    check: (reply) => reply.packageOptions.every((option) =>
      option.draft.hotel?.price == null && option.approxTotal?.amount == null),
  },
];

let failed = 0;
let cookie = "";
for (const scenario of cases) {
  try {
    const response = await fetch(new URL("/api/chat/package-builder", baseUrl), {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
        ...(cookie ? { Cookie: cookie } : {}),
      },
      body: JSON.stringify({
        locale: "en",
        messages: [{ role: "user", content: scenario.message }],
        context: scenario.context ?? null,
      }),
    });
    const ownerCookie = response.headers.get("set-cookie")?.match(/package_assistant_owner=[^;]+/);
    if (ownerCookie) cookie = ownerCookie[0];
    const payload = await response.json();
    const passed = response.ok && payload.ok && scenario.check(payload.reply);
    console.log(`${passed ? "PASS" : "FAIL"} ${scenario.name}`);
    if (!passed) failed += 1;
  } catch (error) {
    console.error(`FAIL ${scenario.name}: ${error instanceof Error ? error.message : "request failed"}`);
    failed += 1;
  }
}

process.exitCode = failed ? 1 : 0;
