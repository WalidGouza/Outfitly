export type Theme = "light" | "dark" | "system";
export function validTheme(value: string | null): Theme {
  return value === "light" || value === "dark" ? value : "system";
}
export function resolvedTheme(
  theme: Theme,
  systemDark: boolean,
): "light" | "dark" {
  return theme === "system" ? (systemDark ? "dark" : "light") : theme;
}
