/**
 * Clipboard payloads as Excel, Google Sheets and Numbers put them on the
 * clipboard. Reconstructed from the formats these apps are documented to write
 * (Excel: Office HTML with x:num; Sheets: google-sheets-html-origin with
 * data-sheets-value / data-sheets-formula in R1C1; Numbers: Cocoa HTML Writer
 * table + TSV). Not captured live tonight — see the spike doc.
 */
export const EXCEL_HTML = `<html xmlns:v="urn:schemas-microsoft-com:vml"
xmlns:o="urn:schemas-microsoft-com:office:office"
xmlns:x="urn:schemas-microsoft-com:office:excel"
xmlns="http://www.w3.org/TR/REC-html40">
<head>
<meta http-equiv=Content-Type content="text/html; charset=utf-8">
<meta name=ProgId content=Excel.Sheet>
<meta name=Generator content="Microsoft Excel 15">
<style>
td {padding-top:1px; mso-number-format:General;}
.xl65 {mso-number-format:"\\0022€\\0022\\\\ \\#\\,\\#\\#0\\.00";}
</style>
</head>
<body link="#0563C1" vlink="#954F72">
<table border=0 cellpadding=0 cellspacing=0 width=174 style='border-collapse:collapse;width:130pt'>
<!--StartFragment-->
 <tr height=21 style='height:16.0pt'>
  <td height=21 width=87 style='height:16.0pt;width:65pt'>Peren</td>
  <td class=xl65 align=right width=87 style='width:65pt' x:num="1234.5">€ 1.234,50</td>
 </tr>
 <tr height=21 style='height:16.0pt'>
  <td height=21 style='height:16.0pt'>Druiven<br>wit</td>
  <td class=xl65 align=right x:num="2.75">€ 2,75</td>
 </tr>
<!--EndFragment-->
</table>
</body>
</html>`;

export const EXCEL_TSV = 'Peren\t€ 1.234,50\n"Druiven\nwit"\t€ 2,75\n';

export const SHEETS_HTML = `<meta charset="utf-8"><google-sheets-html-origin><style type="text/css"><!--td {border: 1px solid #cccccc;}br {mso-data-placement:same-cell;}--></style><table xmlns="http://www.w3.org/1999/xhtml" cellspacing="0" cellpadding="0" dir="ltr" border="1" style="table-layout:fixed;font-size:10pt;font-family:Arial;width:0px;border-collapse:collapse;border:none" data-sheets-root="1"><colgroup><col width="100"/><col width="100"/></colgroup><tbody><tr style="height:21px;"><td style="overflow:hidden;padding:2px 3px 2px 3px;vertical-align:bottom;text-align:right;" data-sheets-value="{&quot;1&quot;:3,&quot;3&quot;:5}">5</td><td style="overflow:hidden;padding:2px 3px 2px 3px;vertical-align:bottom;text-align:right;" data-sheets-value="{&quot;1&quot;:3,&quot;3&quot;:10}" data-sheets-formula="=R[0]C[-1]*2">10</td></tr><tr style="height:21px;"><td style="overflow:hidden;padding:2px 3px 2px 3px;vertical-align:bottom;text-align:right;" data-sheets-value="{&quot;1&quot;:3,&quot;3&quot;:7}">7</td><td style="overflow:hidden;padding:2px 3px 2px 3px;vertical-align:bottom;text-align:right;" data-sheets-value="{&quot;1&quot;:3,&quot;3&quot;:14}" data-sheets-formula="=R[0]C[-1]*2">14</td></tr></tbody></table>`;

export const SHEETS_TSV = "5\t10\n7\t14";

export const NUMBERS_HTML = `<!DOCTYPE html PUBLIC "-//W3C//DTD HTML 4.01//EN" "http://www.w3.org/TR/html4/strict.dtd">
<html>
<head>
<meta http-equiv="Content-Type" content="text/html; charset=UTF-8">
<meta name="Generator" content="Cocoa HTML Writer">
<style type="text/css">td.td1 {border-style: solid; padding: 4.0px 5.0px 4.0px 5.0px}</style>
</head>
<body>
<table cellspacing="0" cellpadding="0" class="t1">
<tbody>
<tr><td valign="top" class="td1"><p class="p1">Mango</p></td><td valign="top" class="td1"><p class="p2">3,5</p></td></tr>
<tr><td valign="top" class="td1"><p class="p1">Kiwi</p></td><td valign="top" class="td1"><p class="p2">12</p></td></tr>
</tbody>
</table>
</body>
</html>`;

export const NUMBERS_TSV = "Mango\t3,5\nKiwi\t12";
