// Port of herdr's shell_quote: bare words pass through untouched, anything else
// is single-quoted so the argv survives being typed into an interactive shell.
const shellQuote = (value: string): string => {
  if (value === "") return "''";
  if (/^[A-Za-z0-9_\-./:@%+=]+$/.test(value)) return value;

  return `'${value.replace(/'/g, `'\\''`)}'`;
};

export const shellCommandFromArgv = (argv: string[]): string => argv.map(shellQuote).join(" ");
