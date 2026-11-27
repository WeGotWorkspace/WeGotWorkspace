/** Seeds shared by the spike 6 and spike 7 stories. */
export const UX_SEED = `---
ycsv_version: 1
name: Q3 Omzet
columns:
  - ref: product
    name: Product
    type: string
  - ref: aantal
    name: Aantal
    type: number
  - ref: prijs
    name: Prijs
    type: currency
    currency: EUR
    locale: nl-NL
  - ref: totaal
    name: Totaal
    type: currency
    currency: EUR
    locale: nl-NL
  - ref: datum
    name: Datum
    type: string
  - ref: notitie
    name: Notitie
    type: string
defs:
  btw: 0.21
---
product,aantal,prijs,totaal,datum,notitie
Appels,6,0.45,=aantal*prijs*(1+btw),2026-01-01,Item 1
Brood,2,2.99,=aantal*prijs*(1+btw),2026-01-02,
Kaas,1,4.50,=aantal*prijs*(1+btw),,
Wijn,3,8.95,=aantal*prijs*(1+btw),,
Totaal,=SUM(aantal1:aantal4),,=SUM(totaal1:totaal4),,
Fout,=aantal99,,=totaal6,,
`;

export function bigSeed(rows: number): string {
  const head = `---
ycsv_version: 1
name: Big
columns:
  - ref: id
    type: number
  - ref: naam
  - ref: bedrag
    type: number
  - ref: dubbel
    type: number
---
id,naam,bedrag,dubbel
`;
  const lines: string[] = [];
  for (let i = 1; i <= rows; i += 1) lines.push(`${i},Item ${i},${(i * 7) % 1000},=bedrag*2`);
  return head + lines.join("\n") + "\n";
}

