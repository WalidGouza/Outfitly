// Client for the Outfitly FastAPI backend (backend/app/main.py).
// On a phone, "localhost" is the phone itself: set EXPO_PUBLIC_API_URL in mobile/.env to
// the deployed API (https://….onrender.com) or to this computer's LAN address.
export const API_URL = (process.env.EXPO_PUBLIC_API_URL ?? "").trim().replace(/\/+$/, "");

export type Category = "tops" | "pants" | "shoes" | "jackets";
export const categories: Category[] = ["tops", "pants", "shoes", "jackets"];
export const textures = ["cotton", "denim", "knit", "leather", "linen", "silk", "other"] as const;
export const styles = ["Everyday", "Minimal", "Smart casual", "Streetwear", "Evening"] as const;
export const harmonies = [
  { value: "balanced", label: "Balanced" },
  { value: "tonal", label: "Tonal" },
  { value: "contrast", label: "Contrast" },
] as const;

export type Wardrobe = { id: string; name: string };
export type Piece = {
  id: string;
  name: string;
  category: Category;
  texture: string;
  style: string;
  color: string;
  /** Stored photo filename; absent for sample illustrations. */
  image?: string | null;
};
export type Look = {
  id?: string;
  name?: string;
  style: string;
  items: Piece[];
  score?: number;
  breakdown?: Record<string, number>;
};
export type Suggestion = {
  name: string;
  color: string;
  category: Category | null;
  texture: string | null;
  style: string | null;
  confidence: Record<string, number>;
  detected: boolean;
};
export type PhotoFile = { uri: string; name: string; type: string };

export class ApiError extends Error {
  constructor(message: string, readonly status = 0) {
    super(message);
  }
}

export async function request<T>(
  path: string,
  { token, method = "GET", body }: { token?: string; method?: string; body?: unknown } = {},
): Promise<T> {
  if (!API_URL) {
    throw new ApiError("Set EXPO_PUBLIC_API_URL in mobile/.env to your Outfitly API, then restart Expo.");
  }
  const form = typeof FormData !== "undefined" && body instanceof FormData;
  let response: Response;
  try {
    response = await fetch(API_URL + path, {
      method,
      headers: {
        Accept: "application/json",
        ...(token ? { Authorization: `Bearer ${token}` } : {}),
        // FormData sets its own multipart boundary.
        ...(body && !form ? { "Content-Type": "application/json" } : {}),
      },
      body: form ? (body as FormData) : body ? JSON.stringify(body) : undefined,
    });
  } catch {
    throw new ApiError(`Can't reach ${API_URL}. Check your connection and EXPO_PUBLIC_API_URL.`);
  }
  const text = await response.text();
  let data: any = null;
  try {
    data = text ? JSON.parse(text) : null;
  } catch {
    throw new ApiError(`The server returned an unexpected response (${response.status}).`, response.status);
  }
  if (!response.ok) {
    const detail = data?.detail;
    const message =
      typeof detail === "string"
        ? detail
        : Array.isArray(detail)
          ? detail.map((d: any) => d.msg).join("; ")
          : `Request failed (${response.status}).`;
    throw new ApiError(message, response.status);
  }
  return data as T;
}

/** Image source for a stored photo; the backend checks ownership on every read. */
export const photoSource = (filename: string, token: string) => ({
  uri: `${API_URL}/images/${filename}`,
  headers: { Authorization: `Bearer ${token}` },
  cacheKey: filename,
});

export function photoForm(photo: PhotoFile, fields: Record<string, string> = {}) {
  const form = new FormData();
  for (const [key, value] of Object.entries(fields)) form.append(key, value);
  // React Native's FormData accepts { uri, name, type } for files.
  form.append("image", photo as unknown as Blob);
  return form;
}
