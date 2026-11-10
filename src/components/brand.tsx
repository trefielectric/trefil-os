import Link from 'next/link';

const logo = '/brand/trefielectric-logo.jpg';
const alternative = 'TrefiElectric · +15 años';

/** The supplied original is displayed whole, with its original 628 × 631 ratio. */
export function Brand({ href }: { href?: string }) {
  const content = <>
    <img className="brand-logo" src={logo} alt={alternative} width={628} height={631} decoding="async" />
    <span className="brand-caption">Trefil OS · Gestión empresarial</span>
  </>;
  return href ? <Link className="brand" href={href}>{content}</Link> : <div className="brand">{content}</div>;
}

export function MobileBrand() {
  return <div className="mobile-brand"><img src={logo} alt={alternative} width={628} height={631} decoding="async" /></div>;
}
