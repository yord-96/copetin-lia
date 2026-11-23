import { prepareContractBookReport } from './contractBookReport.js';

export async function buildContractBookWorkbook(report) {
  const { default: ExcelJS } = await import('exceljs');
  const {compact, replacementBs} = prepareContractBookReport(report);
  const workbook = new ExcelJS.Workbook();
  workbook.creator = 'El Copetín';
  const sheet = workbook.addWorksheet('Reporte para libro', {
    views:[{state:'frozen',ySplit:5}],
    pageSetup:{paperSize:1,orientation:'portrait',fitToPage:true,fitToWidth:1,fitToHeight:0,printTitlesRow:'5:5',margins:{left:.6,right:.6,top:.35,bottom:.35,header:.15,footer:.15}},
  });
  sheet.columns = [{width:5},{width:60},{width:12},{width:15},{width:16},{width:24}];
  const money = '#,##0.00;[Red]-#,##0.00';
  const mergedLine = (text, fontSize = 11) => {
    const row = sheet.addRow([text]); sheet.mergeCells(row.number,1,row.number,6);
    row.font = {name:'Arial',size:fontSize,bold:fontSize>11}; row.height = fontSize>11?24:22;
    row.alignment = {wrapText:true,vertical:'middle'}; return row;
  };
  mergedLine(`REPORTE PARA LIBRO - ${report.documentLabel} ${report.code}`,14);
  mergedLine(`${report.customer || ''}${report.eventDate ? ` · Evento: ${report.eventDate}` : ''}`);
  mergedLine(`DIRECCIÓN: ${report.address || 'Sin dirección registrada'}`);
  sheet.addRow([]);
  const heading = sheet.addRow(['N°','DESCRIPCIÓN DEL PRODUCTO','CANTIDAD','COSTO UNITARIO','COSTO TOTAL','FALTANTES / DEVOLUCIÓN']);
  heading.font = {name:'Arial',bold:true,color:{argb:'FFFFFFFF'}}; heading.height = 32;
  heading.eachCell(cell => {cell.fill={type:'pattern',pattern:'solid',fgColor:{argb:'FF233D57'}};cell.alignment={wrapText:true,vertical:'middle',horizontal:'center'};});
  const dayTotals = new Map(); compact.forEach(row=>{if(row.dayKey)dayTotals.set(row.dayKey,(dayTotals.get(row.dayKey)||0)+row.totalBs);});
  let previousDay = null;
  compact.forEach((entry,index)=>{
    if(entry.dayKey && entry.dayKey!==previousDay){
      const row=mergedLine(`${entry.dayLabel}${entry.dayDate ? ` - ${entry.dayDate.split('-').reverse().join('/')}` : ''} · SUBTOTAL Bs ${Number(dayTotals.get(entry.dayKey)).toFixed(2)}`);
      row.font={name:'Arial',bold:true,size:11}; row.getCell(1).fill={type:'pattern',pattern:'solid',fgColor:{argb:'FFE6EDF4'}};
    }
    previousDay=entry.dayKey;
    const description=entry.names.join(' + ');
    const row=sheet.addRow([index+1,description,Number(entry.quantity),Number(entry.unitPriceBs),Number(entry.totalBs),entry.issues.length?entry.issues.map(issue=>issue.text).join('\n'):entry.returned?'DV':'']);
    row.height=Math.max(22,Math.ceil(description.length/52)*15+7);
    row.eachCell(cell=>{cell.font={name:'Arial',size:11};cell.alignment={wrapText:true,vertical:'middle'};cell.border={bottom:{style:'hair',color:{argb:'FFCBD5E1'}}};});
    for(const column of [4,5]){row.getCell(column).numFmt=money;row.getCell(column).alignment={horizontal:'right',vertical:'middle'};}
  });
  const summary = (label,value,color='FFF0F3F6') => {
    const row=sheet.addRow([label,null,null,null,value]);sheet.mergeCells(row.number,1,row.number,4);
    row.font={name:'Arial',size:11,bold:true};row.height=23;row.getCell(5).numFmt=money;
    row.eachCell(cell=>{cell.fill={type:'pattern',pattern:'solid',fgColor:{argb:color}};});return row.number;
  };
  summary('SUBTOTAL',Number(report.subtotalBs || 0));
  summary(`DESCUENTO${report.discountPercent ? ` ${report.discountPercent}%` : ''}`,Number(report.discountBs || 0));
  summary('TRANSPORTE',Number(report.deliveryFeeBs || 0),'FFFFF0C2');
  const rentalRow=summary('TOTAL ALQUILER',Number(report.totalBs || 0),'FFFFDA75');
  const replacementRow=summary('TOTAL REPOSICIÓN',replacementBs);
  const combined=summary('TOTAL ALQUILER + REPOSICIÓN',{formula:`E${rentalRow}+E${replacementRow}`,result:Number(report.totalBs||0)+replacementBs});
  const guarantee=summary('GARANTÍA (SEPARADA DEL ALQUILER)',Number(report.guaranteeBs || 0));
  summary('TOTAL GENERAL (INCLUYE GARANTÍA)',{formula:`E${combined}+E${guarantee}`,result:Number(report.totalBs||0)+replacementBs+Number(report.guaranteeBs||0)},'FFDCE8F2');
  mergedLine('Importes en bolivianos. DV: devolución completa registrada. Los espacios vacíos no confirman devolución.');
  sheet.pageSetup.horizontalCentered=true;
  sheet.pageSetup.printArea=`A1:F${sheet.rowCount}`;
  workbook.calcProperties.fullCalcOnLoad=true;
  return workbook;
}
