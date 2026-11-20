import { migrate } from './packages/db/src/migrate';

export default async function setup(): Promise<void> {
  await migrate();
}
