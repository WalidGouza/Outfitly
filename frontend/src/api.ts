export function resolveApiUrl(raw?: string, appEnv: "dev" | "prod" = "dev"): string {
  const value = (raw?.trim() || "/api").replace(/\/+$/, "");
  if (value.startsWith("/")) {
    if (appEnv === "prod") throw new Error("APP_ENV=prod requires VITE_API_URL set to the public HTTPS API URL (e.g. your Render service).");
    return value;
  }
  let url: URL;
  try {
    url = new URL(value);
  } catch {
    throw new Error("VITE_API_URL must be /api or an HTTP(S) FastAPI URL.");
  }
  if (!["http:", "https:"].includes(url.protocol))
    throw new Error("Use an HTTP(S) FastAPI URL.");
  if (url.username || url.password)
    throw new Error("Never put database credentials in VITE_API_URL.");
  if (appEnv === "prod" && (url.protocol !== "https:" || url.hostname === "localhost" || url.hostname.endsWith(".localhost") || url.hostname.endsWith(".local") || url.hostname.startsWith("127.") || ["[::1]", "0.0.0.0", "[::]"].includes(url.hostname) || url.search || url.hash))
    throw new Error("APP_ENV=prod requires a public HTTPS API URL without localhost, query parameters, or fragments.");
  if (
    url.hostname.endsWith(".supabase.co") ||
    url.hostname.endsWith(".supabase.com")
  ) {
    throw new Error(
      "VITE_API_URL must point to FastAPI, not the Supabase project or database. Set DATABASE_URL only in backend/.env.",
    );
  }
  return value;
}
export async function requestJson(
  url: string,
  options: RequestInit = {},
  transport: typeof fetch = fetch,
) {
  let response: Response;
  try {
    response = await transport(url, options);
  } catch (error) {
    if (options.signal?.aborted) throw error;
    throw new Error(
      `Cannot reach the Python API at ${url.split("/auth/")[0]}. Start FastAPI, check VITE_API_URL and FRONTEND_ORIGINS, and use HTTPS for the API if the frontend uses HTTPS.`,
    );
  }
  const raw = await response.text();
  let data: any;
  try {
    data = JSON.parse(raw);
  } catch {
    throw new Error(
      response.status >= 500
        ? "The API proxy could not reach FastAPI. Check that the backend is running on the configured port and that its database startup succeeded."
        : "The API returned a non-JSON response. Check VITE_API_URL points to FastAPI, not the frontend or Supabase.",
    );
  }
  if (!response.ok) {
    if (typeof data.detail === "string") throw new Error(data.detail);
    if (Array.isArray(data.detail))
      throw new Error(
        data.detail
          .map(
            (issue: any) =>
              `${issue.loc?.slice(1).join(".") || "Input"}: ${issue.msg}`,
          )
          .join("; "),
      );
    throw new Error(`Request failed (${response.status}). Please try again.`);
  }
  return data;
}
