export const SEED = `---
ycsv_version: 1
name: Q3 Omzet
columns:
  - ref: product
    type: string
  - ref: aantal
    type: number
  - ref: prijs
    type: currency
    currency: EUR
    locale: nl-NL
  - ref: totaal
    type: currency
    currency: EUR
    locale: nl-NL
defs:
  btw: 0.21
cells:
  totaal:
    style:
      color: "#2e7d32"
      bold: IF(totaal > 500)
---
product,aantal,prijs,totaal
Appels,6,0.45,=aantal*prijs*(1+btw)
Brood,2,2.99,=aantal*prijs*(1+btw)
Kaas,1,4.50,=aantal*prijs*(1+btw)
Wijn,3,8.95,=aantal*prijs*(1+btw)
`;
