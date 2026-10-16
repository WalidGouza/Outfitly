/** Home's greeting and the line under it, by the user's local time. */
export function greeting(now = new Date()) {
  const h = now.getHours();
  if (h >= 5 && h < 12) return { title: "Good morning", sub: "What are we wearing today?" };
  if (h >= 12 && h < 17) return { title: "Good afternoon", sub: "Need a change for the rest of the day?" };
  if (h >= 17 && h < 21) return { title: "Good evening", sub: "Going out, or planning tomorrow?" };
  if (h >= 21 && h < 23) return { title: "Good night", sub: "Night out? let's plan something that stands out then." };
  return { title: "Hello, night owl", sub: "Let's get tomorrow's outfit ready." };
}
