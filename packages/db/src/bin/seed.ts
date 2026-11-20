import { seed } from '../seed';

seed().catch((error: unknown) => {
  console.error(error);
  process.exit(1);
});
