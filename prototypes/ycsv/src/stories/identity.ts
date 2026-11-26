const PALETTE = ["#2e7d32", "#1565c0", "#ef6c00", "#6a1b9a", "#c62828", "#00838f"];

export function identity(clientId: number) {
  return {
    id: String(clientId),
    name: `Tab ${clientId % 100}`,
    color: PALETTE[clientId % PALETTE.length] ?? "#2e7d32",
  };
}
