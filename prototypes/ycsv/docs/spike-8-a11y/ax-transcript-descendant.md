# What Chromium exposes per keystroke (descendant focus model)

Recorded by `e2e/a11y/a11y.spec.ts` (RECORD=1). Focused = the node with DOM focus; Position = the gridcell a screen reader treats as current (the focused cell, or the aria-activedescendant target).

| Key | Step | Focused | Position (role, name — description) | Column header | Row header | Live region |
|---|---|---|---|---|---|---|
| — | start on Product row 1 | textbox "Sheet" | gridcell "Appels" | Product | 1 (aria-rowindex 2) |  |
| ArrowRight | next column | textbox "Sheet" | gridcell "6" | Aantal | 1 (aria-rowindex 2) |  |
| ArrowRight | currency column | textbox "Sheet" | gridcell "€ 0,45" | Prijs | 1 (aria-rowindex 2) |  |
| ArrowRight | formula cell | textbox "Sheet" | gridcell "€ 3,27" — Formula =aantal*prijs*(1+btw) | Totaal | 1 (aria-rowindex 2) |  |
| ArrowDown | down one row | textbox "Sheet" | gridcell "€ 7,24" — Formula =aantal*prijs*(1+btw) | Totaal | 2 (aria-rowindex 3) |  |
| Meta+ArrowDown | jump to data edge | textbox "Sheet" | gridcell "circular reference error" — The formula depends on itself. Formula =totaal6 | Totaal | 6 (aria-rowindex 7) |  |
| ArrowLeft | blank cell | textbox "Sheet" | gridcell "" | Prijs | 6 (aria-rowindex 7) |  |
| ArrowLeft | error cell (#REF!) | textbox "Sheet" | gridcell "reference error" — Points at a row or column that no longer exists. Formula =#REF! | Aantal | 6 (aria-rowindex 7) |  |
| Shift+ArrowLeft | extend selection | textbox "Sheet" | gridcell "reference error" — Points at a row or column that no longer exists. Formula =#REF! | Aantal | 6 (aria-rowindex 7) | Product row 6 to Aantal row 6 selected, 1 row by 2 columns |
| Shift+ArrowUp | extend selection | textbox "Sheet" | gridcell "reference error" — Points at a row or column that no longer exists. Formula =#REF! | Aantal | 6 (aria-rowindex 7) | Product row 5 to Aantal row 6 selected, 2 rows by 2 columns, sum 12 |
| Enter | edit mode on | combobox "Editing Aantal row 6, edit mode" | combobox "Editing Aantal row 6, edit mode" |  |  (aria-rowindex ) | Product row 5 to Aantal row 6 selected, 2 rows by 2 columns, sum 12 |
| Escape | edit cancelled | textbox "Sheet" | gridcell "reference error" — Points at a row or column that no longer exists. Formula =#REF! | Aantal | 6 (aria-rowindex 7) | Edit cancelled |
