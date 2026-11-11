import type { Money, State, Support } from '../finance/types';
import type { InventoryUnit, Quantity } from '../inventory/types';

export type SalesCategory='TFI'|'TFF'|'TFM'|'TFR'|'TFC'|'TFMP'|'TFMI'|'GAR'|'EXTERNAL';
export type SalesDocumentStatus='draft'|'requested'|'ready'|'dispatched'|'delivered'|'cancelled';
export type InvoiceStatus='pending'|'partially_paid'|'paid'|'annulled';

export interface SalesCustomer {id:string;name:string;document:string;priceListId?:string;active:boolean;createdBy:string;createdAt:string}
export interface ExternalSeller {id:string;name:string;initials:string;active:boolean;createdBy:string;createdAt:string}
export interface SalesPriceLine {category:Exclude<SalesCategory,'GAR'|'EXTERNAL'>;itemId?:string;description:string;unit:InventoryUnit;unitPrice:Money}
export interface SalesPriceList {id:string;name:string;version:number;effectiveFrom:string;origin:'production';active:boolean;lines:SalesPriceLine[];createdBy:string;createdAt:string}
export interface SalesLine {id:string;category:SalesCategory;itemId?:string;description:string;unit:InventoryUnit;quantity:Quantity;unitPrice:Money;warehouseId?:string}
export interface SalesQuote {id:string;reference:string;date:string;customerId:string;lines:SalesLine[];status:'draft'|'converted';orderIds:string[];notes:string;createdBy:string;createdAt:string}
export interface ShippingGuide {carrier:string;guideNumber:string;status:'prepared'|'in_transit'|'delivered'|'return_in_route'|'return_delivered';shippedAt:string;deliveredAt?:string;support?:Support}
export interface SalesOrder {id:string;reference:string;date:string;customerId:string;category:SalesCategory;lines:SalesLine[];status:SalesDocumentStatus;quoteId?:string;externalSellerId?:string;productionReadyAt?:string;shippingGuide?:ShippingGuide;externalAcceptedAt?:string;dispatchSupport?:Support;invoiceId?:string;cancelledAt?:string;cancelReason?:string;createdBy:string;createdAt:string;history:{at:string;actorId:string;action:string}[]}
export interface SalesInvoice {id:string;reference:string;date:string;customerId:string;category:SalesCategory;orderIds:string[];lines:SalesLine[];total:Money;paid:Money;status:InvoiceStatus;externalSellerId?:string;weekId?:string;priceSnapshotAt:string;createdBy:string;createdAt:string;history:{at:string;actorId:string;action:string;reason?:string}[]}
export interface ExternalReturn {id:string;reference:string;date:string;externalSellerId:string;orderId:string;lines:{orderLineId:string;quantity:Quantity}[];status:'reported'|'confirmed';reportedBy:string;confirmedBy?:string;confirmedAt?:string;support?:Support;createdAt:string}
export interface ExternalWeek {id:string;externalSellerId:string;weekStart:string;weekEnd:string;orderIds:string[];returnIds:string[];status:'open'|'closed';invoiceId?:string;closedBy?:string;closedAt?:string}
export interface PaymentApplication {invoiceId:string;amount:Money;appliedAt:string}
export interface ExternalPaymentReport {id:string;externalSellerId:string;date:string;amount:Money;method:'cash'|'account';support:Support;cashTransactionId?:string;verifiedAt?:string;applications:PaymentApplication[];status:'reported'|'verified'|'partially_applied'|'applied';createdBy:string;createdAt:string}
export interface SalesWarranty {id:string;reference:string;date:string;invoiceId:string;itemId?:string;description:string;quantity:Quantity;reason:string;photo:Support;receivedBy:string;productionDecision?:'accepted'|'rejected';productionResponse?:string;decidedBy?:string;decidedAt?:string;solution?:'refund'|'replacement';garOrderId?:string;status:'received'|'rejected'|'accepted'|'replacement_created'|'refunded';createdBy:string;createdAt:string}
export interface SalesState {version:1;customers:SalesCustomer[];externalSellers:ExternalSeller[];priceLists:SalesPriceList[];quotes:SalesQuote[];orders:SalesOrder[];invoices:SalesInvoice[];externalReturns:ExternalReturn[];externalWeeks:ExternalWeek[];paymentReports:ExternalPaymentReport[];warranties:SalesWarranty[]}
export type SalesWorkspace=State&{salesModule?:SalesState};
