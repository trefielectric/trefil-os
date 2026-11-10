import { cashLogoDataUrl, excelMoney } from './cash-report-export';
import { formatCOP } from './finance/money';
import type { InventoryAuthorizationRequest, InventoryPrice, InventoryReport, InventoryType, InventoryUnit } from './inventory/types';

const QUANTITY_SCALE=1_000_000n;
const EXCEL_EXACT_DIGITS=999_999_999_999_999n;
const NAVY='1D3D6A',YELLOW='F8E62B',WHITE='FFFFFF';
export interface InventoryExportOptions { companyName?:string;logoDataUrl?:string;closedSnapshot?:{closedAt:string;closedBy:string;version:number};authorizations?:InventoryAuthorizationRequest[];prices?:InventoryPrice[];comparison?:InventoryReport[];cashReferences?:Record<string,string> }
export const inventoryReportLabels:Record<InventoryType,string>={asset:'Propiedad, planta y equipo',raw_material:'Materia prima',supply:'Insumos de fabricación',scrap:'Chatarra',finished:'Producto terminado'};
export const inventoryUnitLabels:Record<InventoryUnit,string>={unit:'unidades',kg:'kg',m:'m',l:'l'};
const fileSlugs:Record<InventoryType,string>={asset:'propiedad-planta-equipo',raw_material:'materia-prima',supply:'insumos-fabricacion',scrap:'chatarra',finished:'producto-terminado'};
const movementLabels:Record<string,string>={origin:'ORIGEN',purchase:'Compra vinculada a Caja',consumption:'Consumo de Producción',production:'Lote aceptado',sale:'Venta',scrap_generation:'Generación de chatarra',scrap_dispatch:'Despacho de chatarra',scrap_return:'Retorno de chatarra',asset_theft:'Baja por hurto',asset_damage:'Baja por daño',warranty_replacement:'Reemplazo por garantía'};
const requestLabels:Record<InventoryAuthorizationRequest['kind'],string>={origin_omission:'Omisión histórica de ORIGEN',emergency_adjustment:'Ajuste de emergencia',scrap_loss:'Diferencia de peso',closed_invoice:'Factura de período cerrado',closed_lot:'Lote de período cerrado'};
type Cell=string|number|null;
export interface InventoryExportTable {name:string;headers:string[];rows:Cell[][];quantityColumns:number[];moneyColumns:number[];integerRows?:boolean[];dateColumns?:number[]}

/** Formatting never passes quantities through floating point. */
export function inventoryQuantityMicros(value:string):bigint {
  if(typeof value!=='string'||! /^-?\d+(?:\.\d{1,6})?$/.test(value))throw new Error('La cantidad debe tener como máximo seis decimales.');
  const negative=value.startsWith('-'),[whole,fraction='']=value.replace(/^-/,'').split('.');
  const result=BigInt(whole)*QUANTITY_SCALE+BigInt(fraction.padEnd(6,'0'));
  return negative?-result:result;
}
export function formatInventoryQuantity(value:string|null,integer=false):string {
  if(value===null)return '-';
  const micros=inventoryQuantityMicros(value),negative=micros<0n,absolute=negative?-micros:micros;
  if(integer&&absolute%QUANTITY_SCALE!==0n)throw new Error('El producto terminado debe expresarse en unidades enteras.');
  const whole=new Intl.NumberFormat('es-CO',{maximumFractionDigits:0}).format(absolute/QUANTITY_SCALE);
  return `${negative?'-':''}${whole}${integer?'':','+(absolute%QUANTITY_SCALE).toString().padStart(6,'0')}`;
}
export function excelInventoryQuantity(value:string,integer=false):number {
  const micros=inventoryQuantityMicros(value);
  if(integer){if(micros%QUANTITY_SCALE!==0n)throw new Error('El producto terminado debe tener cantidades enteras.');const units=micros/QUANTITY_SCALE;if(units>EXCEL_EXACT_DIGITS||units< -EXCEL_EXACT_DIGITS)throw new Error('La cantidad excede la precisión de Excel.');return Number(units);}
  if(micros>EXCEL_EXACT_DIGITS||micros< -EXCEL_EXACT_DIGITS)throw new Error('La cantidad excede la precisión de Excel a seis decimales. Selecciona un alcance menor para conservar su precisión.');
  return Number(micros)/Number(QUANTITY_SCALE);
}

export function inventoryReportIdentity(report:InventoryReport):string {
  let hash=2166136261;const source=JSON.stringify(report);
  for(let index=0;index<source.length;index++){hash^=source.charCodeAt(index);hash=Math.imul(hash,16777619);}
  return `INV-${fileSlugs[report.inventoryType]}-${report.startDate.slice(0,7)}-V${report.version}-${(hash>>>0).toString(16).padStart(8,'0').toUpperCase()}`;
}
export function inventoryReportStatus(report:InventoryReport,options:InventoryExportOptions={}):string {
  if(report.status==='closed'||options.closedSnapshot)return report.issues.some(row=>row.status==='open')?'Cierre local conservado con novedades abiertas':'Cierre local conservado';
  if(!report.rows.length)return 'Borrador local sin referencias registradas';
  const pending=report.issues.some(row=>row.status==='open')||report.rows.some(row=>row.counted===null||row.difference===null||inventoryQuantityMicros(row.difference)!==0n||row.unitPrice===null)||report.totalValue===null;
  return report.reconciled&&!pending?'Borrador local sin diferencias registradas':'Borrador local con novedades, conteos o valores pendientes';
}
export function inventoryReportTables(report:InventoryReport,options:InventoryExportOptions={}):InventoryExportTable[]{
  const units=new Map(report.rows.map(row=>[row.itemId,row.unit]));
  const items=new Map(report.rows.map(row=>[row.itemId,`${row.code} · ${row.description}`]));
  const warehouses=new Map(report.rows.map(row=>[row.warehouseId,row.warehouseName]));
  const integers=report.rows.map(row=>row.unit==='unit'||report.inventoryType==='finished'||report.inventoryType==='asset');
  const tables:InventoryExportTable[]=[
    {name:'Resumen',headers:['Control','Resultado'],rows:[['Inventario',inventoryReportLabels[report.inventoryType]],['Período',`${report.startDate} al ${report.endDate}`],['Estado',inventoryReportStatus(report,options)],['Versión',report.version],['Referencias / ubicaciones',report.rows.length],['Conteos físicos pendientes',report.rows.filter(row=>row.counted===null).length],['Referencias sin precio',report.rows.filter(row=>row.unitPrice===null).length],['Novedades abiertas',report.issues.filter(row=>row.status==='open').length],['Valor teórico COP',report.totalValue]],quantityColumns:[],moneyColumns:[]},
    {name:'Existencias',headers:['Código','Descripción','Ubicación','Unidad','Saldo inicial','Entradas','Salidas','Teórico al corte','Conteo físico','Diferencia','Fecha de conteo','Responsable de conteo'],rows:report.rows.map(row=>[row.code,row.description,row.warehouseName,inventoryUnitLabels[row.unit],row.opening,row.incoming,row.outgoing,row.theoretical,row.counted,row.difference,row.countDate??null,row.responsible??null]),quantityColumns:[5,6,7,8,9,10],moneyColumns:[],integerRows:integers,dateColumns:[11]},
    {name:'Disponibilidad',headers:['Código','Descripción','Ubicación','Unidad','Teórico','Reservado','Cuarentena','Disponible'],rows:report.rows.map(row=>[row.code,row.description,row.warehouseName,inventoryUnitLabels[row.unit],row.theoretical,row.reserved,row.quarantine,row.available]),quantityColumns:[5,6,7,8],moneyColumns:[],integerRows:integers},
    {name:'Valoracion',headers:['Código','Descripción','Ubicación','Precio unitario COP','Valor teórico COP','Valor contado COP','Diferencia de valor COP'],rows:report.rows.map(row=>[row.code,row.description,row.warehouseName,row.unitPrice,row.theoreticalValue,row.countedValue,row.differenceValue]),quantityColumns:[],moneyColumns:[4,5,6,7]},
    {name:'Movimientos',headers:['Fecha efectiva','Movimiento','Referencia del documento','Producto / activo','Ubicación','Sentido','Cantidad','Unidad','Valor de operación COP','Responsable','Comprobante','Observaciones'],rows:report.movements.map(row=>[row.date,movementLabels[row.kind]??row.kind,row.sourceReference,items.get(row.itemId)??'Referencia histórica',warehouses.get(row.warehouseId)??'Ubicación histórica',row.direction==='in'?'Entrada':'Salida',row.quantity,units.has(row.itemId)?inventoryUnitLabels[units.get(row.itemId)!]:'-',row.totalValue??null,row.responsible,row.support?.name??null,row.notes]),quantityColumns:[7],moneyColumns:[9],integerRows:report.movements.map(row=>units.get(row.itemId)==='unit'||['asset','finished'].includes(report.inventoryType)),dateColumns:[1]},
    {name:'Novedades',headers:['Fecha','Prioridad','Novedad','Descripción','Producto / activo','Ubicación','Cantidad','Estado'],rows:report.issues.map(row=>[row.date,row.priority,row.title,row.description,row.itemId?items.get(row.itemId)??'Referencia histórica':null,row.warehouseId?warehouses.get(row.warehouseId)??'Ubicación histórica':null,row.quantity??null,row.status==='resolved'?'Resuelta':'Abierta']),quantityColumns:[7],moneyColumns:[],integerRows:report.issues.map(row=>row.itemId?units.get(row.itemId)==='unit':report.inventoryType==='finished'),dateColumns:[1]},
  ];
  if(report.status==='closed'||options.closedSnapshot){tables[0].rows.push(['Cierre local conservado',report.closedAt??options.closedSnapshot?.closedAt??null],['Responsable del cierre local',options.closedSnapshot?.closedBy??'Responsable registrado']);}
  const prices=report.prices??options.prices;const authorizations=report.authorizations??options.authorizations;
  if(report.countDocuments?.length)tables.push({name:'Actas de conteo',headers:['Fecha del acta','Documento fuente','Referencias / ubicaciones','Responsable','Comprobante'],rows:report.countDocuments.map(row=>[row.date,row.sourceReference,report.rows.filter(line=>line.countId===row.id).map(line=>`${line.code} · ${line.warehouseName}`).join('\n'),row.responsible,row.support.name]),quantityColumns:[],moneyColumns:[],dateColumns:[1]});
  if(prices?.length)tables.push({name:'Precios del periodo',headers:['Período','Producto / material','Precio unitario COP','Compras Caja vinculadas','Responsable','Comprobante','Versión','Observaciones'],rows:prices.map(row=>[row.month,items.get(row.itemId)??'Referencia histórica',row.unitPrice,row.cashTransactionIds.map(id=>options.cashReferences?.[id]??'Compra de Caja registrada').join('\n'),row.responsible,row.support.name,row.version,row.notes]),quantityColumns:[],moneyColumns:[3]});
  if(authorizations?.length)tables.push({name:'Autorizaciones',headers:['Fecha de solicitud','Solicitud','Autorización requerida','Producto / activo','Ubicación','Cantidad propuesta','Motivo','Comprobante','Estado'],rows:authorizations.map(row=>[row.createdAt.slice(0,10),requestLabels[row.kind],row.requiredRole==='owner'?'Solo Creador':'Creador o Gerente',row.itemId?items.get(row.itemId)??'Referencia histórica':null,row.warehouseId?warehouses.get(row.warehouseId)??'Ubicación histórica':null,row.quantity??null,row.reason,row.support.name,'Pendiente institucional; sin aplicar']),quantityColumns:[6],moneyColumns:[],integerRows:authorizations.map(row=>row.itemId?units.get(row.itemId)==='unit':report.inventoryType==='finished'),dateColumns:[1]});
  if(options.comparison?.length)tables.push({name:'Comparacion anual',headers:['Mes','Referencias / ubicaciones','Conteos pendientes','Novedades abiertas','Valor teórico COP','Estado del período'],rows:options.comparison.map(row=>[row.startDate.slice(0,7),row.rows.length,row.rows.filter(line=>line.counted===null).length,row.issues.filter(line=>line.status==='open').length,row.totalValue,inventoryReportStatus(row)]),quantityColumns:[],moneyColumns:[5]});
  return tables;
}

export async function createInventoryWorkbook(report:InventoryReport,options:InventoryExportOptions={}){
  const module=await import('exceljs'),Workbook=module.Workbook??module.default.Workbook;
  const workbook=new Workbook();workbook.creator=options.companyName??'TrefiElectric';workbook.title=inventoryReportIdentity(report);workbook.subject=inventoryReportLabels[report.inventoryType];workbook.created=new Date(report.generatedAt);workbook.calcProperties.fullCalcOnLoad=true;
  for(const table of inventoryReportTables(report,options)){
    const sheet=workbook.addWorksheet(table.name,{views:[{state:'frozen',ySplit:5}],pageSetup:{paperSize:9,orientation:'landscape',fitToPage:true,fitToWidth:1,fitToHeight:0}});
    for(const [rowIndex,text] of [[1,`${options.companyName??'TrefiElectric'} · ${inventoryReportLabels[report.inventoryType]}`],[2,`${report.startDate} al ${report.endDate} · ${inventoryReportStatus(report,options)}`],[3,inventoryReportIdentity(report)]] as const){sheet.mergeCells(rowIndex,1,rowIndex,table.headers.length);sheet.getCell(rowIndex,1).value=text;sheet.getRow(rowIndex).height=rowIndex===1?30:24;sheet.getRow(rowIndex).font={name:'Arial',size:rowIndex===1?15:10,bold:rowIndex===1,color:{argb:rowIndex===1?WHITE:NAVY}};if(rowIndex===1)sheet.getCell(rowIndex,1).fill={type:'pattern',pattern:'solid',fgColor:{argb:NAVY}};}
    sheet.getRow(5).values=table.headers;sheet.getRow(5).height=36;sheet.getRow(5).font={name:'Arial',size:10,bold:true,color:{argb:NAVY}};sheet.getRow(5).fill={type:'pattern',pattern:'solid',fgColor:{argb:YELLOW}};sheet.getRow(5).alignment={wrapText:true,vertical:'middle'};
    for(const [index,values] of table.rows.entries()){
      const row=sheet.getRow(index+6);row.values=values.map((value,column)=>value===null?null:table.moneyColumns.includes(column+1)?excelMoney(String(value)):table.quantityColumns.includes(column+1)?excelInventoryQuantity(String(value),table.integerRows?.[index]):table.dateColumns?.includes(column+1)?new Date(String(value)+'T12:00:00Z'):value);row.font={name:'Arial',size:10};row.alignment={wrapText:true,vertical:'top'};row.height=36;
      if(index%2===1)row.fill={type:'pattern',pattern:'solid',fgColor:{argb:'F2F5F9'}};
      for(const column of table.quantityColumns)row.getCell(column).numFmt=table.integerRows?.[index]?'#,##0':'#,##0.000000';
      for(const column of table.moneyColumns)row.getCell(column).numFmt='"$" #,##0.00;[Red]("$" #,##0.00);"$" 0.00';
      for(const column of table.dateColumns??[])row.getCell(column).numFmt='dd/mm/yyyy';
      if(table.name==='Resumen'&&values[0]==='Valor teórico COP'){row.getCell(2).value=report.totalValue===null?null:excelMoney(report.totalValue);row.getCell(2).numFmt='\"$\" #,##0.00';}
      if(table.name==='Existencias'){
        const at=index+6;row.getCell(8).value={formula:`ROUND(E${at}+F${at}-G${at},6)`,result:excelInventoryQuantity(String(values[7]),table.integerRows?.[index])};
        if(values[8]!==null)row.getCell(10).value={formula:`ROUND(I${at}-H${at},6)`,result:excelInventoryQuantity(String(values[9]),table.integerRows?.[index])};
      }
    }
    sheet.autoFilter={from:{row:5,column:1},to:{row:Math.max(5,table.rows.length+5),column:table.headers.length}};
    sheet.columns.forEach((column,index)=>{column.width=table.moneyColumns.includes(index+1)?24:table.quantityColumns.includes(index+1)?22:table.headers[index].includes('Descripción')||table.headers[index]==='Observaciones'?48:table.headers[index].includes('Código')?20:29;});
    sheet.headerFooter.oddFooter=`&L${inventoryReportLabels[report.inventoryType]} · Registro local&R Página &P de &N`;
  }
  return workbook;
}

function saveInventoryBlob(filename:string,blob:Blob){const url=URL.createObjectURL(blob);const anchor=document.createElement('a');anchor.href=url;anchor.download=filename;anchor.click();setTimeout(()=>URL.revokeObjectURL(url),1000);}
export async function downloadInventoryExcel(report:InventoryReport,options:InventoryExportOptions={}){const workbook=await createInventoryWorkbook(report,options),buffer=await workbook.xlsx.writeBuffer();saveInventoryBlob(`${inventoryReportIdentity(report)}.xlsx`,new Blob([new Uint8Array(buffer)],{type:'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet'}));}

export async function createInventoryPdf(report:InventoryReport,options:InventoryExportOptions={}){
  const [{jsPDF},{autoTable}]=await Promise.all([import('jspdf'),import('jspdf-autotable')]);
  const doc=new jsPDF({orientation:'landscape',unit:'mm',format:'a4'}),logo=options.logoDataUrl??await cashLogoDataUrl();
  const identity=inventoryReportIdentity(report);doc.setProperties({title:identity,subject:inventoryReportLabels[report.inventoryType],author:options.companyName??'TrefiElectric'});
  const header=()=>{doc.setFillColor('#'+NAVY);doc.rect(0,0,297,28,'F');doc.setFillColor('#'+YELLOW);doc.rect(0,28,297,2,'F');doc.setFillColor('#FFFFFF');doc.roundedRect(12,3,22,22,1,1,'F');doc.addImage(logo,'JPEG',13,4,20,20*631/628);doc.setFont('helvetica','bold');doc.setTextColor('#FFFFFF');doc.setFontSize(15);doc.text(inventoryReportLabels[report.inventoryType],40,12);doc.setFont('helvetica','normal');doc.setFontSize(9);doc.text(`${report.startDate} al ${report.endDate} · ${inventoryReportStatus(report,options)}`,40,21);};
  const itemNames=new Map(report.rows.map(row=>[row.itemId,`${row.code}\n${row.description}`])),warehouseNames=new Map(report.rows.map(row=>[row.warehouseId,row.warehouseName]));
  const tables=inventoryReportTables(report,options).filter(table=>table.rows.length||['Resumen','Existencias','Valoracion','Novedades'].includes(table.name));
  for(const [index,source] of tables.entries()){
    let startY=index===0?43:((doc as typeof doc&{lastAutoTable?:{finalY:number}}).lastAutoTable?.finalY??150)+14;if(startY>162){doc.addPage();startY=43;}
    const table:InventoryExportTable=source.name==='Existencias'?{...source,headers:['Referencia','Ubicación','Unidad','Saldo inicial','Entradas','Salidas','Teórico','Conteo físico','Diferencia'],rows:source.rows.map(row=>[`${row[0]}\n${row[1]}`,row[2],row[3],row[4],row[5],row[6],row[7],row[8],row[9]]),quantityColumns:[4,5,6,7,8,9]}:source.name==='Disponibilidad'?{...source,headers:['Referencia','Ubicación','Unidad','Teórico','Reservado','Cuarentena','Disponible'],rows:source.rows.map(row=>[`${row[0]}\n${row[1]}`,row[2],row[3],row[4],row[5],row[6],row[7]]),quantityColumns:[4,5,6,7]}:source.name==='Valoracion'?{...source,headers:['Referencia','Ubicación','Precio unitario COP','Valor teórico COP','Valor contado COP','Diferencia de valor COP'],rows:source.rows.map(row=>[`${row[0]}\n${row[1]}`,row[2],row[3],row[4],row[5],row[6]]),moneyColumns:[3,4,5,6]}:source.name==='Movimientos'?{...source,headers:['Fecha / documento','Movimiento / referencia','Ubicación','Sentido','Cantidad','Unidad','Valor COP','Responsable / soporte','Observaciones'],rows:source.rows.map(row=>[`${row[0]}\n${row[2]}`,`${row[1]}\n${row[3]}`,row[4],row[5],row[6],row[7],row[8],`${row[9]}\n${row[10]??'-'}`,row[11]]),quantityColumns:[5],moneyColumns:[7]}:source.name==='Novedades'?{...source,headers:['Fecha / prioridad','Novedad','Descripción','Referencia / ubicación','Cantidad','Estado'],rows:report.issues.map(row=>[`${row.date}\nPrioridad ${row.priority}`,row.title,row.description,`${row.itemId?itemNames.get(row.itemId)??'Referencia histórica':'-'}\n${row.warehouseId?warehouseNames.get(row.warehouseId)??'Ubicación histórica':'-'}`,row.quantity??null,row.status==='resolved'?'Resuelta':'Abierta']),quantityColumns:[5]}:source;
    autoTable(doc,{startY,margin:{top:43,left:12,right:12,bottom:17},head:[table.headers],body:table.rows.length?table.rows.map((row,rowIndex)=>row.map((value,column)=>value===null?'-':(table.name==='Resumen'&&row[0]==='Valor teórico COP'&&column===1)||table.moneyColumns.includes(column+1)?formatCOP(String(value),{decimals:true}).replace('−','-'):table.quantityColumns.includes(column+1)?formatInventoryQuantity(String(value),table.integerRows?.[rowIndex]):String(value))):[['Sin registros en este período',...table.headers.slice(1).map(()=>'-')]],styles:{font:'helvetica',fontSize:8,cellPadding:2.2,overflow:'linebreak',lineColor:'#E0E5EC',lineWidth:0.1,textColor:'#223249'},headStyles:{fillColor:'#'+NAVY,textColor:'#FFFFFF'},columnStyles:table.name==='Movimientos'?{0:{cellWidth:27},1:{cellWidth:46},2:{cellWidth:25},3:{cellWidth:20},4:{cellWidth:25},5:{cellWidth:16},6:{cellWidth:28,halign:'right'},7:{cellWidth:39},8:{cellWidth:47}}:{},alternateRowStyles:{fillColor:'#F2F5F9'},rowPageBreak:'avoid',showHead:'everyPage',willDrawPage:data=>{header();doc.setTextColor('#'+NAVY);doc.setFont('helvetica','bold');doc.setFontSize(12);doc.text(({Valoracion:'Valoración','Comparacion anual':'Comparación anual','Precios del periodo':'Precios del período'} as Record<string,string>)[table.name]??table.name,12,data.pageNumber===1?startY-5:38);}});
  }
  for(let page=1;page<=doc.getNumberOfPages();page++){doc.setPage(page);doc.setFont('helvetica','normal');doc.setTextColor('#64748B');doc.setFontSize(7);doc.text(identity,12,202);doc.text(`Página ${page} de ${doc.getNumberOfPages()}`,285,202,{align:'right'});}
  return doc;
}
export async function downloadInventoryPdf(report:InventoryReport,options:InventoryExportOptions={}){const doc=await createInventoryPdf(report,options);doc.save(`${inventoryReportIdentity(report)}.pdf`);}
