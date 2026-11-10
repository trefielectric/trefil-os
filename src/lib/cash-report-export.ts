import { add, fromCents, toCents, formatCOP } from './finance/money';
import type { CashPeriodReport, CashReportMovement } from './finance/cash-types';
import type { Money } from './finance/types';

type ReportScalar = string | number;
export interface ReportTable { name:string; headers:string[]; rows:ReportScalar[][]; moneyColumns:number[] }
export interface CashExportOptions { companyName?:string; logoDataUrl?:string; comparison?:CashPeriodReport[] }
const NAVY='1D3D6A';
const YELLOW='F8E62B';
const WHITE='FFFFFF';
const MONEY_FORMAT='"$" #,##0.00;[Red]("$" #,##0.00);"$" 0.00';
export const cashNatureLabels:Record<CashReportMovement['nature'],string>={operating:'Operación',financing:'Financiación',asset:'Activo',internal:'Traslado interno',opening:'Saldo inicial',adjustment:'Ajuste',excluded:'Fuera del informe operativo'};
const directionLabels={in:'Entrada',out:'Salida',transfer:'Traslado'};

/** A spreadsheet must never silently round a ledger value outside exact cent precision. */
export function excelMoney(value:Money):number {
  const cents=toCents(value);
  if(cents>999999999999999n||cents< -999999999999999n)throw new Error('El importe excede la precisión de Excel. Selecciona un período más corto para exportar sin perder centavos.');
  return Number(cents)/100;
}
export function cashReportIdentity(report:CashPeriodReport):string {
  let hash=2166136261;
  const serialized=JSON.stringify(report);
  for(let i=0;i<serialized.length;i++){hash^=serialized.charCodeAt(i);hash=Math.imul(hash,16777619);}
  return `CAJA-${report.startDate.replaceAll('-','')}-${report.endDate.replaceAll('-','')}-V${report.version}-${(hash>>>0).toString(16).padStart(8,'0').toUpperCase()}`;
}
export function cashReportBridge(report:CashPeriodReport){
  const byNature=(nature:CashReportMovement['nature'])=>fromCents(report.movements.filter(row=>row.nature===nature).reduce((sum,row)=>sum+(row.direction==='in'?1n:row.direction==='out'?-1n:0n)*toCents(row.amount),0n));
  const registeredOpenings=byNature('opening'),netAdjustments=byNature('adjustment');
  const calculatedClosing=fromCents(toCents(report.openingAvailable)+toCents(registeredOpenings)+toCents(netAdjustments)+toCents(report.externalInflows)-toCents(report.operatingExpenses)+toCents(report.financingInflows)-toCents(report.financingOutflows)+toCents(report.otherAssetInflows)-toCents(report.otherAssetOutflows)+toCents(report.excludedInflows)-toCents(report.excludedOutflows));
  return {registeredOpenings,netAdjustments,calculatedClosing,difference:fromCents(toCents(report.closingAvailable)-toCents(calculatedClosing))};
}
export function cashReportSummary(report:CashPeriodReport):[string,Money][] {
  const bridge=cashReportBridge(report);
  return [
    ['Disponible al inicio',report.openingAvailable],['Saldos iniciales registrados en el período',bridge.registeredOpenings],['Ajustes netos del período',bridge.netAdjustments],['Entradas externas operativas',report.externalInflows],
    ['Entradas por traslados',report.transferInflows],['Gastos operativos',report.operatingExpenses],
    ['Financiación recibida',report.financingInflows],['Pagos de financiación',report.financingOutflows],
    ['Entradas por activos',report.otherAssetInflows],['Salidas por activos',report.otherAssetOutflows],
    ['Traslados internos',report.internalTransfers],['Entradas fuera del informe operativo',report.excludedInflows],
    ['Salidas fuera del informe operativo',report.excludedOutflows],['Disponible al cierre',report.closingAvailable],['Diferencia de comprobación',bridge.difference],
  ];
}
export function cashReportTables(report:CashPeriodReport):ReportTable[] {
  const groups=new Map<string,{name:string;amount:Money}>();
  for(const category of report.categories){const previous=groups.get(category.groupId);groups.set(category.groupId,{name:category.groupName,amount:add(previous?.amount??'0.00',category.amount)});}
  const accounts=new Map(report.accounts.map(row=>[row.accountId,row.name]));
  const visible=report.movements.filter(row=>row.nature!=='excluded');
  const detail=(rows:CashReportMovement[])=>rows.map(row=>[row.reference,row.date,directionLabels[row.direction],cashNatureLabels[row.nature],row.party,row.description,row.groupName,row.categoryName,row.amount,row.accountIds.map(id=>accounts.get(id)??'Cuenta').join(' / '),row.supportMissing?'Pendiente':'Documentado',row.reversalOf?'Reverso':'Movimiento',row.principal??'',row.interest??'',row.insurance??'',row.commission??'',row.lateFee??'']);
  const headers=['Referencia','Fecha','Naturaleza del flujo','Clasificación','Tercero','Concepto','Grupo','Categoría','Valor COP','Cuenta','Soporte','Tipo de registro','Capital COP','Intereses COP','Seguros COP','Comisiones COP','Mora COP'];
  return [
    {name:'Resumen',headers:['Concepto','Valor COP'],rows:cashReportSummary(report).map(([label,amount])=>[label,amount]),moneyColumns:[2]},
    {name:'Saldos',headers:['Cuenta','Tipo','Saldo inicial COP','Entradas COP','Salidas COP','Saldo final COP','Diferencia de comprobación COP'],rows:report.accounts.map(row=>[row.name,({cash:'Efectivo',bank:'Banco',wallet:'Billetera / pasarela',personal:'Cuenta autorizada',ledger:'Contable'})[row.kind],row.opening,row.inflows,row.outflows,row.closing,fromCents(toCents(row.closing)-toCents(row.opening)-toCents(row.inflows)+toCents(row.outflows))]),moneyColumns:[3,4,5,6,7]},
    {name:'Grupos',headers:['Grupo de salidas','Valor neto COP'],rows:[...groups.values()].map(row=>[row.name,row.amount]),moneyColumns:[2]},
    {name:'Categorias',headers:['Grupo de salidas','Categoría','Valor neto COP','Movimientos'],rows:report.categories.map(row=>[row.groupName,row.categoryName,row.amount,row.transactionIds.length]),moneyColumns:[3]},
    {name:'Traslados',headers,rows:detail(visible.filter(row=>row.nature==='internal')),moneyColumns:[9,13,14,15,16,17]},
    {name:'Detalle',headers,rows:detail(visible),moneyColumns:[9,13,14,15,16,17]},
    {name:'Financiacion y activos',headers,rows:detail(visible.filter(row=>row.nature==='financing'||row.nature==='asset')),moneyColumns:[9,13,14,15,16,17]},
    {name:'Novedades',headers:['Prioridad','Novedad','Descripción','Responsable','Fecha de revisión','Estado'],rows:report.alerts.map(row=>[row.severity==='critical'?'Crítica':row.severity==='warning'?'Atención':'Información',row.title,row.description,row.responsible,row.dueDate,row.status==='resolved'?'Resuelta':row.status==='in_progress'?'En seguimiento':'Abierta']),moneyColumns:[]},
  ];
}

export async function createCashWorkbook(report:CashPeriodReport,options:CashExportOptions={}) {
  const module=await import('exceljs');
  const Workbook=module.Workbook??module.default.Workbook;
  const book=new Workbook();
  book.creator=options.companyName??'TrefiElectric';book.subject='Informe de caja';book.title=cashReportIdentity(report);book.created=new Date(report.generatedAt);book.calcProperties.fullCalcOnLoad=true;
  const tables=cashReportTables(report);
  if(options.comparison?.length)tables.push({name:'Comparacion mensual',headers:['Mes','Entradas externas COP','Gastos operativos COP','Disponible al cierre COP'],rows:options.comparison.map(row=>[row.startDate.slice(0,7),row.externalInflows,row.operatingExpenses,row.closingAvailable]),moneyColumns:[2,3,4]});
  for(const table of tables){
    const sheet=book.addWorksheet(table.name,{views:[{state:'frozen',ySplit:5}],pageSetup:{paperSize:9,orientation:table.headers.length>6?'landscape':'portrait',fitToPage:true,fitToWidth:1,fitToHeight:0}});
    sheet.mergeCells(1,1,1,table.headers.length);sheet.getCell(1,1).value=`${options.companyName??'TrefiElectric'} · ${table.name}`;sheet.getRow(1).height=30;
    sheet.getCell(1,1).font={name:'Arial',size:16,bold:true,color:{argb:WHITE}};sheet.getCell(1,1).fill={type:'pattern',pattern:'solid',fgColor:{argb:NAVY}};
    sheet.mergeCells(2,1,2,table.headers.length);sheet.getCell(2,1).value=`Del ${report.startDate} al ${report.endDate} · COP · Bogotá`;
    sheet.mergeCells(3,1,3,table.headers.length);sheet.getCell(3,1).value=`${cashReportIdentity(report)} · Registro local`;
    sheet.getRow(3).font={name:'Arial',size:9,color:{argb:'666666'}};
    const heading=sheet.getRow(5);heading.values=table.headers;heading.height=30;heading.font={name:'Arial',bold:true,size:10,color:{argb:NAVY}};heading.fill={type:'pattern',pattern:'solid',fgColor:{argb:YELLOW}};heading.alignment={vertical:'middle',wrapText:true};
    for(const [index,values] of table.rows.entries()){
      const row=sheet.getRow(index+6);row.values=values.map((cell,column)=>table.moneyColumns.includes(column+1)&&cell!==''?excelMoney(String(cell)):table.headers[column]==='Fecha'&&/^\d{4}-\d{2}-\d{2}$/.test(String(cell))?new Date(String(cell)+'T12:00:00Z'):cell);row.font={name:'Arial',size:10};row.alignment={vertical:'top',wrapText:true};row.height=table.headers.length>6?36:28;
      if(index%2===1)row.fill={type:'pattern',pattern:'solid',fgColor:{argb:'F2F5F9'}};
      for(const column of table.moneyColumns)row.getCell(column).numFmt=MONEY_FORMAT; for(const [column,label] of table.headers.entries())if(label==='Fecha')row.getCell(column+1).numFmt='dd/mm/yyyy';
      if(table.name==='Saldos'){const at=index+6;row.getCell(7).value={formula:`ROUND(F${at}-(C${at}+D${at}-E${at}),2)`,result:excelMoney(String(values[6]))};}
    }
    sheet.autoFilter={from:{row:5,column:1},to:{row:Math.max(5,table.rows.length+5),column:table.headers.length}};
    sheet.columns.forEach((column,index)=>{column.width=table.moneyColumns.includes(index+1)?23:index===0?30:table.headers.length>6?25:34;});
    // Summary lines are different economic quantities, so they must never be summed together.
    if(table.rows.length&&['Saldos','Grupos','Categorias'].includes(table.name)&&table.moneyColumns.length){
      const totalRow=table.rows.length+6;sheet.getCell(totalRow,1).value='TOTAL';sheet.getRow(totalRow).font={name:'Arial',bold:true,color:{argb:NAVY}};
      for(const column of table.moneyColumns){const letter=sheet.getColumn(column).letter;const cached=table.rows.reduce((sum,row)=>sum+(row[column-1]===''?0n:toCents(String(row[column-1]))),0n);sheet.getCell(totalRow,column).value={formula:`ROUND(SUM(${letter}6:${letter}${totalRow-1}),2)`,result:excelMoney(fromCents(cached))};sheet.getCell(totalRow,column).numFmt=MONEY_FORMAT;}
    }
    sheet.headerFooter.oddFooter='&LTrefiElectric · Caja&R Página &P de &N';
  }
  const summary=book.getWorksheet('Resumen')!;const lastAccount=Math.max(6,report.accounts.length+5);
  summary.getCell('B6').value={formula:`ROUND(SUM(Saldos!C6:C${lastAccount}),2)`,result:excelMoney(report.openingAvailable)};
  summary.getCell('B19').value={formula:`ROUND(SUM(Saldos!F6:F${lastAccount}),2)`,result:excelMoney(report.closingAvailable)};
  summary.getCell('B20').value={formula:'ROUND(B19-(B6+B7+B8+B9-B11+B12-B13+B14-B15+B17-B18),2)',result:excelMoney(cashReportBridge(report).difference)};
  return book;
}
export async function downloadCashExcel(report:CashPeriodReport,options:CashExportOptions={}) {
  const book=await createCashWorkbook(report,options);const buffer=await book.xlsx.writeBuffer();
  saveBlob(`${cashReportIdentity(report)}.xlsx`,new Blob([new Uint8Array(buffer)],{type:'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet'}));
}
function saveBlob(name:string,blob:Blob){const url=URL.createObjectURL(blob);const anchor=document.createElement('a');anchor.href=url;anchor.download=name;anchor.click();setTimeout(()=>URL.revokeObjectURL(url),1000);}
export async function cashLogoDataUrl():Promise<string> {
  const response=await fetch('/brand/trefielectric-logo.jpg');if(!response.ok)throw new Error('No se pudo cargar el logo para el informe.');
  const blob=await response.blob();return new Promise((resolve,reject)=>{const reader=new FileReader();reader.onload=()=>resolve(String(reader.result));reader.onerror=()=>reject(new Error('No se pudo leer el logo del informe.'));reader.readAsDataURL(blob);});
}
export async function createCashPdf(report:CashPeriodReport,options:CashExportOptions={}) {
  const [{jsPDF},{autoTable}]=await Promise.all([import('jspdf'),import('jspdf-autotable')]);
  const doc=new jsPDF({orientation:'landscape',unit:'mm',format:'a4'});const identity=cashReportIdentity(report);
  const logo=options.logoDataUrl??await cashLogoDataUrl();
  doc.setProperties({title:identity,subject:'Informe de caja',author:options.companyName??'TrefiElectric'});
  const pageHeader=()=>{
    doc.setFillColor('#'+NAVY);doc.rect(0,0,297,28,'F');doc.setFillColor('#'+YELLOW);doc.rect(0,28,297,2,'F');
    // Preserve the entire source logo, including the +15 años signature.
    doc.setFillColor('#FFFFFF');doc.roundedRect(12,3,22,22,1,1,'F');doc.addImage(logo,'JPEG',13,4,20,20*631/628);
    doc.setTextColor('#FFFFFF');doc.setFont('helvetica','bold');doc.setFontSize(17);doc.text('Informe de caja',40,12);doc.setFont('helvetica','normal');doc.setFontSize(10);doc.text(`${options.companyName??'TrefiElectric'} · Del ${report.startDate} al ${report.endDate} · COP`,40,20);
  };
  const tables=cashReportTables(report).filter(table=>table.name!=='Detalle'&&(table.rows.length>0||['Resumen','Saldos','Grupos'].includes(table.name))).map(table=>table.name==='Financiacion y activos'?{...table,headers:['Referencia / tercero','Fecha','Flujo','Valor COP','Capital COP','Intereses COP','Seguros COP','Comisiones COP','Mora COP'],rows:table.rows.map(row=>[`${row[0]}\n${row[4]}`,row[1],row[2],row[8],row[12],row[13],row[14],row[15],row[16]]),moneyColumns:[4,5,6,7,8,9]}:table.name==='Traslados'?{...table,headers:['Referencia','Fecha','Concepto','Cuentas','Valor COP','Soporte'],rows:table.rows.map(row=>[row[0],row[1],row[5],row[9],row[8],row[10]]),moneyColumns:[5]}:table);
  if(options.comparison?.length)tables.push({name:'Comparación mensual',headers:['Mes','Entradas externas COP','Gastos operativos COP','Disponible al cierre COP'],rows:options.comparison.map(row=>[row.startDate.slice(0,7),row.externalInflows,row.operatingExpenses,row.closingAvailable]),moneyColumns:[2,3,4]});
  for(const [index,table] of tables.entries()){
    let startY=index===0?43:((doc as typeof doc&{lastAutoTable?:{finalY:number}}).lastAutoTable?.finalY??150)+14;
    if(startY>164){doc.addPage();startY=43;}
    autoTable(doc,{startY,margin:{left:12,right:12,top:43,bottom:17},head:[table.headers],body:table.rows.length?table.rows.map(row=>row.map((cell,column)=>table.moneyColumns.includes(column+1)?(cell===''?'-':formatCOP(String(cell),{decimals:true}).replace('−','-')):String(cell))):[['Sin registros en este período',...table.headers.slice(1).map(()=>'-')]],
      styles:{font:'helvetica',fontSize:8,cellPadding:2.5,overflow:'linebreak',textColor:'#223249',lineColor:'#E0E5EC',lineWidth:0.1},headStyles:{fillColor:'#'+NAVY,textColor:'#FFFFFF',fontStyle:'bold'},alternateRowStyles:{fillColor:'#F2F5F9'},rowPageBreak:'avoid',showHead:'everyPage',
      willDrawPage:data=>{pageHeader();doc.setFontSize(12);doc.setFont('helvetica','bold');doc.setTextColor('#'+NAVY);doc.text(table.name==='Categorias'?'Categorías':table.name==='Financiacion y activos'?'Financiación y activos':table.name,12,data.pageNumber===1?startY-5:38);},
    });
  }
  const detail=cashReportTables(report).find(table=>table.name==='Detalle')!;
  doc.addPage();
  autoTable(doc,{startY:43,margin:{left:12,right:12,top:43,bottom:17},head:[['Referencia / fecha','Tercero / concepto','Clasificación','Flujo','Valor COP','Cuenta / soporte']],body:detail.rows.length?detail.rows.map(row=>[`${row[0]}\n${row[1]}`,`${row[4]}\n${row[5]}`,`${row[3]}\n${row[6]} / ${row[7]}`,`${row[2]}\n${row[11]}`,formatCOP(String(row[8]),{decimals:true}).replace('−','-'),`${row[9]}\n${row[10]}`]):[['Sin movimientos registrados','-','-','-','-','-']],styles:{font:'helvetica',fontSize:8,cellPadding:2.5,overflow:'linebreak'},columnStyles:{0:{cellWidth:28},1:{cellWidth:58},2:{cellWidth:65},3:{cellWidth:24},4:{cellWidth:38,halign:'right'},5:{cellWidth:60}},headStyles:{fillColor:'#'+NAVY,textColor:'#FFFFFF'},alternateRowStyles:{fillColor:'#F2F5F9'},rowPageBreak:'avoid',willDrawPage:()=>{pageHeader();doc.setFontSize(12);doc.setTextColor('#'+NAVY);doc.text('Detalle trazable',12,38);}});
  const total=doc.getNumberOfPages();
  for(let page=1;page<=total;page++){doc.setPage(page);doc.setFont('helvetica','normal');doc.setFontSize(7);doc.setTextColor('#64748B');doc.text(`${identity} · Registro local`,12,202);doc.text(`Página ${page} de ${total}`,285,202,{align:'right'});}
  return doc;
}
export async function downloadCashPdf(report:CashPeriodReport,options:CashExportOptions={}){const doc=await createCashPdf(report,options);doc.save(`${cashReportIdentity(report)}.pdf`);}
