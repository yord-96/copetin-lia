
const escape = value => String(value ?? '').replace(/[&<>"']/g, char => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[char]));

const amount = value => Number(value || 0).toLocaleString('es-BO', {
  minimumFractionDigits: 2,
  maximumFractionDigits: 2
});

export function buildContractBookReport({
  code,
  customer,
  eventDate,
  address,
  guaranteeBs,
  rows,
  subtotalBs,
  discountBs,
  discountPercent,
  deliveryFeeBs,
  totalBs
}) {
  const compact = [];
  const combos = new Map();

  for (const row of rows) {
    const key = row.comboKey ? `${row.comboKey}:${row.quantity}` : '';
    const existing = key && combos.get(key);

    if (existing) {
      existing.names.push(row.name);
      existing.totalBs += row.totalBs;
      existing.unitPriceBs = existing.quantity
        ? existing.totalBs / existing.quantity
        : 0;
      existing.issues.push(...row.issues);
      existing.returned = existing.returned && row.returned;
    } else {
      const next = {
        ...row,
        names: [row.name],
        issues: [...row.issues]
      };

      compact.push(next);
      if (key) combos.set(key, next);
    }
  }

  const replacementBs = rows.reduce(
    (sum, row) =>
      sum + row.issues.reduce(
        (total, issue) => total + issue.chargeBs,
        0
      ),
    0
  );

  // TOTAL GENERAL: alquiler + reposición + garantía
  const grandTotalBs =
    Number(totalBs || 0) +
    Number(replacementBs || 0) +
    Number(guaranteeBs || 0);

  const body = compact.map((row, index) => `
    <tr>
      <td class="index">${index + 1}</td>
      <td class="description">${escape(row.names.join(' + '))}</td>
      <td class="number">${escape(row.quantity)}</td>
      <td class="number">${amount(row.unitPriceBs)}</td>
      <td class="number">${amount(row.totalBs)}</td>
      <td class="returns">${
        row.issues.length
          ? row.issues.map(issue =>
              `<span class="issue">${escape(issue.text)}</span>`
            ).join('<br>')
          : row.returned
            ? '<span class="returned">DV</span>'
            : ''
      }</td>
    </tr>
  `).join('');

  const fontSize = compact.length > 35 ? '8pt' : '9pt';

  return `<!doctype html>
<html lang="es">
<head>
<meta charset="utf-8">
<title>Reporte para libro - ${escape(code)}</title>

<style>
  @page {
    size: Letter portrait;
    margin: 9mm;
  }

  * {
    box-sizing: border-box;
  }

  html, body {
    margin: 0;
    padding: 0;
    background: #fff;
    color: #151515;
    font-family: Arial, sans-serif;
  }

  body {
    font-size: ${fontSize};
  }

  header {
    display: flex;
    justify-content: space-between;
    align-items: flex-end;
    gap: 12px;
    margin-bottom: 7px;
  }

  h1 {
    font-size: 12pt;
    margin: 0 0 3px;
  }

  header p {
    margin: 0;
    font-size: 8pt;
  }

  .code {
    text-align: right;
    white-space: nowrap;
    font-size: 10pt;
  }

  table {
    width: 100%;
    border-collapse: collapse;
    table-layout: fixed;
  }

  th, td {
    border: 1px solid #555;
    padding: 3px 4px;
    line-height: 1.13;
    vertical-align: middle;
  }

  thead {
    display: table-header-group;
  }

  th {
    background: #e8e8e8;
    text-align: center;
    font-size: 8pt;
  }

  tr {
    break-inside: avoid;
    page-break-inside: avoid;
  }

  .description {
    overflow-wrap: anywhere;
    text-transform: uppercase;
  }

  .index {
    text-align: center;
  }

  .number {
    text-align: right;
    font-variant-numeric: tabular-nums;
    white-space: nowrap;
  }

  .returns {
    text-align: center;
    font-size: 8pt;
    overflow-wrap: anywhere;
  }

  .issue {
    color: #a51c24;
    font-weight: bold;
  }

  .returned {
    color: #167345;
    font-weight: bold;
  }

  .summary {
    break-inside: avoid;
    margin-top: -1px;
  }

  .summary th {
    text-align: right;
    font-size: 9pt;
    font-style: italic;
    background: transparent;
  }

  .subtotal {
    background: #e3ecd8;
  }

  .transport {
    background: #fff0c5;
  }

  .total {
    background: #f7d778;
    font-weight: bold;
  }

  .replacement {
    background: #f2e6e6;
  }

  .grand {
    background: #dce8f0;
    font-weight: bold;
  }

  /* NUEVA FILA TOTAL GENERAL */
  .final-total {
    background: #dce8f0;
    font-weight: bold;
  }

  .final-total th {
    font-weight: bold;
  }

  .note {
    margin: 5px 0 0;
    font-size: 7pt;
    color: #555;
  }

  @media print {
    th,
    .subtotal,
    .transport,
    .total,
    .replacement,
    .grand,
    .final-total {
      print-color-adjust: exact;
      -webkit-print-color-adjust: exact;
    }
  }
</style>
</head>

<body>

<header>
  <div>
    <h1>REPORTE PARA LIBRO</h1>

    <p>
      ${escape(customer)}
      ${eventDate ? ` · Evento: ${escape(eventDate)}` : ''}
    </p>

    <p style="margin-top:3px;overflow-wrap:anywhere">
      <b>DIRECCIÓN:</b>
      ${escape(address || 'Sin dirección registrada')}
    </p>
  </div>

  <div class="code">
    CONTRATO <b>${escape(code)}</b>
  </div>
</header>

<table>
  <colgroup>
    <col style="width:4%">
    <col style="width:44%">
    <col style="width:9%">
    <col style="width:12%">
    <col style="width:13%">
    <col style="width:18%">
  </colgroup>

  <thead>
    <tr>
      <th>N°</th>
      <th>DESCRIPCIÓN DEL PRODUCTO</th>
      <th>CANTIDAD</th>
      <th>COSTO<br>UNITARIO</th>
      <th>COSTO<br>TOTAL</th>
      <th>FALTANTES / DEVOLUCIÓN</th>
    </tr>
  </thead>

  <tbody>
    ${body || '<tr><td colspan="6">Sin ítems registrados.</td></tr>'}
  </tbody>
</table>

<table class="summary">

  <colgroup>
    <col style="width:69%">
    <col style="width:13%">
    <col style="width:18%">
  </colgroup>

  <tbody>

    <tr class="subtotal">
      <th>SUBTOTAL</th>
      <td class="number">${amount(subtotalBs)}</td>
      <td class="returns" rowspan="4">
        TOTAL REPOSICIÓN<br>
        <b>${amount(replacementBs)}</b>
      </td>
    </tr>

    <tr>
      <th>
        DESCUENTO${
          Number(discountPercent) > 0
            ? ` ${escape(discountPercent)}%`
            : ''
        }
      </th>
      <td class="number">${amount(discountBs)}</td>
    </tr>

    <tr class="transport">
      <th>TRANSPORTE</th>
      <td class="number">${amount(deliveryFeeBs)}</td>
    </tr>

    <tr class="total">
      <th>TOTAL ALQUILER</th>
      <td class="number">${amount(totalBs)}</td>
    </tr>

    <tr class="grand">
      <th colspan="2">TOTAL ALQUILER + REPOSICIÓN</th>
      <td class="number">
        ${amount(Number(totalBs) + replacementBs)}
      </td>
    </tr>

    <tr>
      <th colspan="2">GARANTÍA (SEPARADA DEL ALQUILER)</th>
      <td class="number">${amount(guaranteeBs)}</td>
    </tr>

    <!-- NUEVA FILA -->
    <tr class="final-total">
      <th colspan="2">TOTAL GENERAL (INCLUYE GARANTÍA)</th>
      <td class="number">${amount(grandTotalBs)}</td>
    </tr>

  </tbody>
</table>

<p class="note">
  Importes en bolivianos. DV: devolución completa registrada.
  Los espacios vacíos no confirman devolución.
  Resumen para archivo en libro.
</p>

</body>
</html>`;
}
