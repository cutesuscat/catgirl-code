export type MobileStageLabel = ":3" | "Dev";

export function resolveMobileStageLabel(appVariant: unknown): MobileStageLabel {
  if (appVariant === "development") return "Dev";
  return ":3";
}
