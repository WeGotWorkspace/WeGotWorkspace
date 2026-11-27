/** Single-sheet sample workbook used by stories and tests. */
export const SAMPLE_YCSV = `---
ycsv_version: 1
defs:
  btw: 0.21
  min_order: 10
columns:
  - ref: product
    type: string
  - ref: aantal
    name: Aantal
    type: number
  - ref: prijs
    name: Prijs ex. BTW
    type: currency
    currency: EUR
    locale: nl-NL
    minimumFractionDigits: 2
    maximumFractionDigits: 2
  - ref: totaal
    name: Prijs incl. BTW
    type: currency
    currency: EUR
    locale: nl-NL
    minimumFractionDigits: 2
    maximumFractionDigits: 2
  - ref: marge
    name: Marge
    type: percent
    minimumFractionDigits: 1
---
product,aantal,prijs,totaal,marge
Appels,6,0.45,=prijs2*aantal2*(1+btw),18
Brood,2,2.99,=prijs3*aantal3*(1+btw),32
Melk,3,1.19,=prijs4*aantal4*(1+btw),25
Kaas,1,8.50,=prijs5*aantal5*(1+btw),41
,,Totaal,=SUM(totaal2:totaal5),=AVERAGE(marge2:marge5)
`;

/** Multi-sheet sample workbook with a cross-sheet reference. */
export const SAMPLE_MULTI_SHEET_YCSV = `---
ycsv_version: 1
defs:
  btw: 0.21
sheets:
  - ref: producten
    name: Productenoverzicht
    columns:
      - ref: product
        type: string
      - ref: prijs
        type: currency
        currency: EUR
        locale: nl-NL
      - ref: totaal_incl
        type: currency
        currency: EUR
        locale: nl-NL
  - ref: categorieen
    columns:
      - ref: id
        type: string
      - ref: label
        type: string
---
product,prijs,totaal_incl
Appels,0.45,=prijs2*(1+btw)
Brood,2.99,=prijs3*(1+btw)
---
id,label
fruit,Fruit
bakkerij,Bakkerij
`;
