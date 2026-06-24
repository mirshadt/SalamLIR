import { clsx, type ClassValue } from "clsx";
import { twMerge } from "tailwind-merge";

export function cn(...inputs: ClassValue[]) {
  return twMerge(clsx(inputs));
}

export function formatHosts(value: number) {
  return new Intl.NumberFormat("en", {
    maximumFractionDigits: 1,
    notation: value >= 1_000_000 ? "compact" : "standard"
  }).format(value);
}
