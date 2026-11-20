export type Access = {
  canEdit: boolean;
  canOperate: boolean;
  canApprove: boolean;
  canSeeCosts: boolean;
  canSeeQuantities: boolean;
  canSeeValuation: boolean;
};

export type StockRow = {
  id: string;
  name: string;
  code: string;
  barcode: string;
  kind: string;
  kindLabel: string;
  category: string;
  unit: string;
  cost?: string | null;
  tracksSerials?: boolean;
  tracksBatches?: boolean;
  onHandLabel: string | null;
  costLabel: string | null;
  priceLabel: string;
  valueLabel: string | null;
  low: boolean;
  archived: boolean;
};

export type BranchOption = { id: string; name: string; headOffice: boolean };

export type ItemDetail = {
  access: Access;
  item: {
    id: string;
    name: string;
    code: string;
    barcode: string;
    description: string;
    category: string;
    kind: string;
    kindLabel: string;
    unit: string;
    unitPlural: string;
    costLabel: string | null;
    cost: string | null;
    priceLabel: string;
    price: string;
    vatLabel: string;
    reorder: string;
    trackBatches: boolean;
    trackSerials: boolean;
    archived: boolean;
    onHandLabel: string | null;
    low: boolean;
    packs: { name: string; plural: string; factor: string; label: string }[];
  };
  totalOnHandLabel: string;
  balances: { branchId: string; branch: string; onHandLabel: string }[];
  movements: {
    id: string;
    what: string;
    branch: string;
    quantityLabel: string;
    direction: 'in' | 'out';
    reason: string;
    whenLabel: string;
    valueLabel: string | null;
    actorName: string;
    reversible: boolean;
  }[];
  batches: {
    code: string;
    expiresOn: string | null;
    places: { branch: string; onHandLabel: string }[];
  }[];
  serials: { serial: string; statusLabel: string; branch: string }[];
  pending: { id: string; summary: string; reason: string; valueLabel: string | null }[];
};
