const two = (n: number) => String(n).padStart(2, '0');

/** HH:mm of an instant in the time zone of this device (never the server's zone). No imports: a test runs it under other zones. */
export function clockTime(instant: string): string {
  const at = new Date(instant);
  return `${two(at.getHours())}:${two(at.getMinutes())}`;
}
