import Papa from "papaparse";

export function parseLocationCsv(content: string): Record<string, string>[] {
  const result = Papa.parse<Record<string, string>>(content, {
    header: true,
    skipEmptyLines: true,
    transformHeader: (value) => value.trim(),
  });

  if (result.errors.length > 0) {
    throw new Error(result.errors[0]?.message ?? "Invalid CSV.");
  }

  return result.data;
}
