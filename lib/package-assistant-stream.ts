export const extractStreamingMessage = (json: string): string => {
  const match = /"message"\s*:\s*"/.exec(json);
  if (!match) return "";
  const start = match.index + match[0].length - 1;
  let escaped = false;
  for (let index = start + 1; index < json.length; index += 1) {
    const char = json[index];
    if (char === '"' && !escaped) {
      try { return JSON.parse(json.slice(start, index + 1)) as string; } catch { return ""; }
    }
    if (char === "\\") escaped = !escaped;
    else escaped = false;
  }
  try { return JSON.parse(`${json.slice(start)}"`) as string; } catch { return ""; }
};
