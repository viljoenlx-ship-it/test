import { MenuButton } from '@omnivate/ui';

export function MoreMenu({
  label,
  items,
}: {
  label: string;
  items: { label: string; onSelect: () => void; tone?: 'default' | 'danger' }[];
}) {
  return <MenuButton label={label === '…' ? 'More' : label} items={items} />;
}
