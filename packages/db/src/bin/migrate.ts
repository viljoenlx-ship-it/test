import { migrate } from '../migrate';

migrate().catch((error: unknown) => {
  console.error(error);
  process.exit(1);
});
